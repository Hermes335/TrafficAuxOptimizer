from hashlib import sha256
from time import monotonic
from datetime import date, timedelta

from celery import shared_task
from django.utils import timezone
from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Prefetch, Subquery

from core.models import Bottleneck, Incident, Officer, OfficerTimeBlock, OptimizationRun, POI, TrafficData, WeatherData
from core.realtime import broadcast
from core.staffing import required_staffing, staffing_windows
from core.operational_time import shift_window, operational_date
from core.skills import SKILL_POLICY_VERSION, normalize_skills, preferred_skills_for
from .engine import GeneticDeploymentOptimizer
from .convergence import CONVERGENCE_POLICY_VERSION, MINIMUM_GENERATIONS, PATIENCE, TOLERANCE
from .scheduling import run_schedule, plan_periods, search_count
from .progress_store import save_progress
from .planning import planning_window, capture_origins, capture_starting_locations, starting_location_model, add_transfer_boundaries, review_lead_seconds


def _broadcast_progress(run_id, payload):
    broadcast(f"optimization_{run_id}", "optimization_event", payload)


def capture_inputs(params, now=None):
    now = now or timezone.now()
    start, end = planning_window(params, now)
    officers = list(Officer.objects.filter(is_deleted=False, status__in=["available", "deployed"],
        shift=params.get("shift", "afternoon")).order_by("id").values("id", "badge_number", "current_latitude", "current_longitude", "current_location_recorded_at", "skills"))
    bottlenecks = []
    shift_start, shift_end = shift_window(params.get("shift", "afternoon"), date.fromisoformat(str(params.get("operational_date") or operational_date(now))))
    block_start = now-timedelta(hours=2) if params.get("mode", "operational") == "operational" and shift_start <= now < shift_end else start
    blocks = list(OfficerTimeBlock.objects.filter(is_deleted=False, start_time__lt=end, end_time__gt=block_start))
    for officer in officers:
        officer["skills"] = normalize_skills(officer["skills"])
        officer["time_blocks"] = [{"start_time": b.start_time.isoformat(), "end_time": b.end_time.isoformat(), "kind": b.kind}
                                  for b in blocks if b.officer_id == officer["id"]]
    latest = TrafficData.objects.filter(bottleneck_id=OuterRef("pk"), is_deleted=False).order_by("-timestamp", "-id")
    rows = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).order_by("id").annotate(
        latest_traffic_id=Subquery(latest.values("pk")[:1])).prefetch_related(Prefetch("incidents",
        queryset=Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]), to_attr="snapshot_incidents")))
    observations = TrafficData.objects.in_bulk([b.latest_traffic_id for b in rows if b.latest_traffic_id])
    skill_incidents = list(Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]))
    for b in rows:
        observation = observations.get(b.latest_traffic_id)
        staffing_target = required_staffing(b, b.snapshot_incidents, start)
        bottlenecks.append({
            "id": b.id, "name": b.name, "latitude": b.latitude, "longitude": b.longitude,
            "bottleneck_type": b.bottleneck_type, "preferred_skills": preferred_skills_for(b, skill_incidents),
            "road_priority_weight": b.road_priority_weight, "tsi": b.tsi,
            "min_officers_required": staffing_target, "max_officers_allowed": b.max_officers_allowed,
            "staffing_target": staffing_target, "configured_min_officers_required": b.min_officers_required,
            "area_name": b.area_name, "signal_status": b.signal_status, "staffing_periods": b.staffing_periods,
            "staffing_windows": staffing_windows(b, start, end, b.snapshot_incidents) if start < end else [],
            "provenance": {"value_origin": "bottleneck.tsi", "source": observation.source if observation else "manual",
                "is_synthetic": bool(observation and observation.is_synthetic),
                "data_status": observation.data_status if observation else "unverified",
                "is_stale": bool(observation and (observation.is_stale or (timezone.now() - (observation.observed_at or observation.timestamp)).total_seconds() > settings.TRAFFIC_MAX_INPUT_AGE)),
                "observed_at": (observation.observed_at or observation.timestamp).isoformat() if observation else None,
                "fetched_at": observation.fetched_at.isoformat() if observation and observation.fetched_at else None},
        })
    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
    capture_origins(officers, params, start, now)
    capture_starting_locations(officers, params, now)
    if start < end:
        add_transfer_boundaries(officers, start, end)
    return officers, bottlenecks, weather


@shared_task(bind=True)
def run_optimization(self, run_id):
    # Conditional transitions prevent late worker writes from reviving cancelled runs.
    if not OptimizationRun.objects.filter(run_id=run_id, status="queued").update(status="running", updated_at=timezone.now(), heartbeat_at=timezone.now()):
        return {"run_id": run_id, "status": OptimizationRun.objects.get(run_id=run_id).status}
    run = OptimizationRun.objects.get(run_id=run_id)
    params = run.parameters
    try:
        # Domain mutation services use this same lock order. Release before the search.
        from deployments.services import lock_schedule
        from deployments.services import schedule_version
        from .readiness import build_readiness
        with transaction.atomic():
            lock_schedule()
            captured_now = timezone.now()
            officers, bottlenecks, weather = capture_inputs(params, now=captured_now)
            readiness = build_readiness(params, now=captured_now, captured=(officers, bottlenecks, weather))
            if not readiness["ready"]:
                raise ValueError(" ".join(readiness["blockers"]))
            incidents = list(Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"])
                .values("bottleneck_id", "latitude", "longitude", "severity", "incident_type", "status"))
            pois = list(POI.objects.filter(is_deleted=False, is_active=True).values("latitude", "longitude", "priority_boost"))
            captured_at = captured_now.isoformat()
            planning_start, planning_end = planning_window(params, now=captured_now)
            baseline_revision = schedule_version(params.get("shift", "afternoon"), date.fromisoformat(str(params.get("operational_date") or operational_date(captured_now))))
        wif = float(weather.weather_impact_factor) if weather else 1.0
        seed = int(sha256(run_id.encode()).hexdigest()[:8], 16)
        input_snapshot = {"officers": officers, "bottlenecks": [dict(b) for b in bottlenecks],
            "weather": {"impact_factor": wif if weather else None, "source": weather.source if weather else "missing",
                "data_status": weather.data_status if weather else "missing",
                "is_synthetic": bool(weather and weather.is_synthetic),
                "observed_at": (weather.observed_at or weather.timestamp).isoformat() if weather else None,
                "is_stale": bool(weather and (weather.is_stale or (timezone.now() - (weather.observed_at or weather.timestamp)).total_seconds() > settings.WEATHER_MAX_INPUT_AGE)),
                "assumption": None if weather else "Neutral travel multiplier; weather unavailable"},
            "incidents": incidents, "pois": pois,
            "travel_time_model": starting_location_model(),
            "captured_at": captured_at, "operational_date": params.get("operational_date"),
            "mode": params.get("mode", "operational"), "session_id": params.get("session_id", ""),
            "schema_version": 4, "engine_version": settings.BACKEND_VERSION, "seed": seed,
            "convergence_policy": {"version": CONVERGENCE_POLICY_VERSION, "minimum_generations": MINIMUM_GENERATIONS,
                                   "patience": PATIENCE, "tolerance": TOLERANCE,
                                   "enabled": bool(params.get("enable_early_stopping", True))},
            "skill_policy_version": SKILL_POLICY_VERSION,
            "readiness": readiness,
            "planning_window": {"start_time": planning_start.isoformat(), "end_time": planning_end.isoformat(),
                "captured_at": captured_at, "mode": params.get("mode", "operational"),
                "review_lead_seconds": review_lead_seconds() if params.get("mode", "operational") == "operational" else 0,
                "baseline_revision": baseline_revision},
            "allocation_policy_version": GeneticDeploymentOptimizer.ALLOCATION_POLICY_VERSION}
        periods = plan_periods(bottlenecks, officers)
        total_generations = params.get("generations", 300) * max(1, search_count(bottlenecks, officers))
        params = {**params, "total_generations": total_generations, "time_period_count": len(periods)}
        OptimizationRun.objects.filter(pk=run.pk, status="running").update(parameters=params)
        last_heartbeat = [monotonic()]
        def cancelled():
            if monotonic() - last_heartbeat[0] >= 10:
                OptimizationRun.objects.filter(pk=run.pk, status="running").update(heartbeat_at=timezone.now())
                last_heartbeat[0] = monotonic()
            return not OptimizationRun.objects.filter(pk=run.pk, status="running").exists()
        def progress(generation, total, fitness):
            if not OptimizationRun.objects.filter(pk=run.pk, status="running").exists():
                return
            payload = {"event": "optimization_progress", "run_id": run_id, "status": "running",
                "current_generation": generation, "total_generations": total, "current_fitness": fitness,
                "updated_at": timezone.now().isoformat()}
            save_progress(run_id, payload)
            _broadcast_progress(run_id, payload)
        result = run_schedule(officers=officers, bottlenecks=bottlenecks, parameters=params,
            weather_impact_factor=wif, incidents=incidents, pois=pois,
            seed=seed, progress_callback=progress, cancel_check=cancelled)
        result_data = {"top_solutions": result.top_solutions, "weather_impact_factor": wif,
            "best_fitness": result.best_fitness,
            "total_generations": total_generations,
            "synthetic_data_used": (["weather"] if weather and weather.is_synthetic else []) + [b["id"] for b in bottlenecks if b["provenance"]["is_synthetic"]], "input_snapshot": input_snapshot,
            "pareto_curve_data": result.pareto_curve_data, "converged_early": result.converged_early}
        finished_at = timezone.now()
        changed = OptimizationRun.objects.filter(pk=run.pk, status="running").update(status=result.status,
            fitness_scores=result.generation_fitness, result_data=result_data, updated_at=finished_at, heartbeat_at=finished_at)
        if not changed:
            return {"run_id": run_id, "status": OptimizationRun.objects.get(pk=run.pk).status}
        payload = {"event": "optimization_complete" if result.status == "completed" else "optimization_" + result.status,
            "run_id": run_id, "status": result.status, "current_generation": len(result.generation_fitness),
            "total_generations": total_generations, "current_fitness": result.best_fitness,
            "converged_early": result.converged_early, "updated_at": finished_at.isoformat(),
            "estimated_completion": finished_at.isoformat() if result.status == "completed" else None}
        save_progress(run_id, payload)
        _broadcast_progress(run_id, payload)
        broadcast("dashboard_live", "dashboard_event", payload)
        return payload
    except Exception as exc:
        if OptimizationRun.objects.filter(pk=run.pk, status="running").update(
                status="failed", result_data={"error": str(exc)}, updated_at=timezone.now()):
            payload = {"event": "optimization_failed", "run_id": run_id, "status": "failed", "error": str(exc)}
            save_progress(run_id, payload)
            _broadcast_progress(run_id, payload)
        raise
