from hashlib import sha256
from time import monotonic

from celery import shared_task
from django.utils import timezone
from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Prefetch, Subquery

from core.models import Bottleneck, Incident, Officer, OptimizationRun, POI, TrafficData, WeatherData
from core.realtime import broadcast
from core.staffing import required_staffing
from .engine import GeneticDeploymentOptimizer
from .progress_store import save_progress


def _broadcast_progress(run_id, payload):
    broadcast(f"optimization_{run_id}", "optimization_event", payload)


def capture_inputs(params):
    officers = list(Officer.objects.filter(is_deleted=False, status__in=["available", "deployed"],
        shift=params.get("shift", "afternoon")).order_by("id").values("id", "badge_number", "current_latitude", "current_longitude"))
    bottlenecks = []
    latest = TrafficData.objects.filter(bottleneck_id=OuterRef("pk"), is_deleted=False).order_by("-timestamp", "-id")
    rows = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).order_by("id").annotate(
        latest_traffic_id=Subquery(latest.values("pk")[:1])).prefetch_related(Prefetch("incidents",
        queryset=Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]), to_attr="snapshot_incidents")))
    observations = TrafficData.objects.in_bulk([b.latest_traffic_id for b in rows if b.latest_traffic_id])
    for b in rows:
        observation = observations.get(b.latest_traffic_id)
        staffing_target = required_staffing(b, b.snapshot_incidents)
        bottlenecks.append({
            "id": b.id, "name": b.name, "latitude": b.latitude, "longitude": b.longitude,
            "road_priority_weight": b.road_priority_weight, "tsi": b.tsi,
            "min_officers_required": staffing_target, "max_officers_allowed": b.max_officers_allowed,
            "staffing_target": staffing_target, "configured_min_officers_required": b.min_officers_required,
            "provenance": {"value_origin": "bottleneck.tsi", "source": observation.source if observation else "manual",
                "is_synthetic": bool(observation and observation.is_synthetic),
                "data_status": observation.data_status if observation else "unverified",
                "is_stale": bool(observation and (observation.is_stale or (timezone.now() - (observation.observed_at or observation.timestamp)).total_seconds() > settings.TRAFFIC_MAX_INPUT_AGE)),
                "observed_at": (observation.observed_at or observation.timestamp).isoformat() if observation else None,
                "fetched_at": observation.fetched_at.isoformat() if observation and observation.fetched_at else None},
        })
    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
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
        with transaction.atomic():
            lock_schedule()
            officers, bottlenecks, weather = capture_inputs(params)
            incidents = list(Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"],
                latitude__isnull=False, longitude__isnull=False).values("latitude", "longitude", "severity", "incident_type"))
            pois = list(POI.objects.filter(is_deleted=False, is_active=True).values("latitude", "longitude", "priority_boost"))
            captured_at = timezone.now().isoformat()
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
            "travel_time_model": {"speed_kmh": "max(8, 28 * (1 - TSI))", "missing_officer_location_distance_km": 3.0},
            "captured_at": captured_at, "operational_date": params.get("operational_date"),
            "mode": params.get("mode", "operational"), "session_id": params.get("session_id", ""),
            "schema_version": 3, "engine_version": settings.BACKEND_VERSION, "seed": seed,
            "allocation_policy_version": GeneticDeploymentOptimizer.ALLOCATION_POLICY_VERSION}
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
        result = GeneticDeploymentOptimizer().run(officers=officers, bottlenecks=bottlenecks, parameters=params,
            weather_impact_factor=wif, incidents=incidents, pois=pois,
            seed=seed, progress_callback=progress, cancel_check=cancelled)
        result_data = {"top_solutions": result.top_solutions, "weather_impact_factor": wif,
            "synthetic_data_used": (["weather"] if weather and weather.is_synthetic else []) + [b["id"] for b in bottlenecks if b["provenance"]["is_synthetic"]], "input_snapshot": input_snapshot,
            "pareto_curve_data": result.pareto_curve_data, "converged_early": result.converged_early}
        finished_at = timezone.now()
        changed = OptimizationRun.objects.filter(pk=run.pk, status="running").update(status=result.status,
            fitness_scores=result.generation_fitness, result_data=result_data, updated_at=finished_at, heartbeat_at=finished_at)
        if not changed:
            return {"run_id": run_id, "status": OptimizationRun.objects.get(pk=run.pk).status}
        payload = {"event": "optimization_complete" if result.status == "completed" else "optimization_" + result.status,
            "run_id": run_id, "status": result.status, "current_generation": len(result.generation_fitness),
            "total_generations": params.get("generations", 300), "current_fitness": result.best_fitness,
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
