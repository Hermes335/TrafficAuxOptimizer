from hashlib import sha256

from celery import shared_task
from django.utils import timezone

from core.models import Bottleneck, Incident, Officer, OptimizationRun, POI, WeatherData
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
    for b in Bottleneck.objects.filter(is_deleted=False, is_archived=False).order_by("id"):
        observation = b.traffic_data.filter(is_deleted=False).order_by("-timestamp").first()
        bottlenecks.append({
            "id": b.id, "name": b.name, "latitude": b.latitude, "longitude": b.longitude,
            "road_priority_weight": b.road_priority_weight, "tsi": b.tsi,
            "min_officers_required": required_staffing(b, b.incidents.filter(is_deleted=False, status__in=["active", "investigating"])), "max_officers_allowed": b.max_officers_allowed,
            "provenance": {"value_origin": "bottleneck.tsi", "source": observation.source if observation else "manual",
                "is_synthetic": bool(observation and observation.is_synthetic),
                "data_status": observation.data_status if observation else "unverified",
                "is_stale": bool(observation and (observation.is_stale or (timezone.now() - observation.timestamp).total_seconds() > 900)),
                "observed_at": observation.observed_at.isoformat() if observation and observation.observed_at else None,
                "fetched_at": observation.fetched_at.isoformat() if observation and observation.fetched_at else None},
        })
    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
    return officers, bottlenecks, weather


@shared_task
def run_optimization(run_id):
    # Conditional transitions prevent late worker writes from reviving cancelled runs.
    if not OptimizationRun.objects.filter(run_id=run_id, status="queued").update(status="running", updated_at=timezone.now()):
        return {"run_id": run_id, "status": OptimizationRun.objects.get(run_id=run_id).status}
    run = OptimizationRun.objects.get(run_id=run_id)
    params = run.parameters
    try:
        officers, bottlenecks, weather = capture_inputs(params)
        wif = float(weather.weather_impact_factor) if weather else 1.0
        incidents = list(Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"],
            latitude__isnull=False, longitude__isnull=False).values("latitude", "longitude", "severity", "incident_type"))
        pois = list(POI.objects.filter(is_deleted=False, is_active=True).values("latitude", "longitude", "priority_boost"))
        input_snapshot = {"officers": officers, "bottlenecks": [dict(b) for b in bottlenecks],
            "weather": {"impact_factor": wif if weather else None, "source": weather.source if weather else "missing",
                "data_status": weather.data_status if weather else "missing",
                "is_synthetic": bool(weather and weather.is_synthetic),
                "observed_at": weather.timestamp.isoformat() if weather else None,
                "is_stale": bool(weather and (weather.is_stale or (timezone.now() - weather.timestamp).total_seconds() > 1800)),
                "assumption": None if weather else "Neutral travel multiplier; weather unavailable"},
            "incidents": incidents, "pois": pois,
            "travel_time_model": {"speed_kmh": "max(8, 28 * (1 - TSI))", "missing_officer_location_distance_km": 3.0},
            "captured_at": timezone.now().isoformat()}
        def progress(generation, total, fitness):
            if not OptimizationRun.objects.filter(pk=run.pk, status="running").exists():
                return
            payload = {"event": "optimization_progress", "run_id": run_id, "status": "running",
                "current_generation": generation, "total_generations": total, "current_fitness": fitness}
            save_progress(run_id, payload)
            _broadcast_progress(run_id, payload)
        result = GeneticDeploymentOptimizer().run(officers=officers, bottlenecks=bottlenecks, parameters=params,
            weather_impact_factor=wif, incidents=incidents, pois=pois,
            seed=int(sha256(run_id.encode()).hexdigest()[:8], 16), progress_callback=progress,
            cancel_check=lambda: not OptimizationRun.objects.filter(pk=run.pk, status="running").exists())
        result_data = {"top_solutions": result.top_solutions, "weather_impact_factor": wif,
            "synthetic_data_used": (["weather"] if weather and weather.is_synthetic else []) + [b["id"] for b in bottlenecks if b["provenance"]["is_synthetic"]], "input_snapshot": input_snapshot,
            "pareto_curve_data": result.pareto_curve_data, "converged_early": result.converged_early}
        changed = OptimizationRun.objects.filter(pk=run.pk, status="running").update(status=result.status,
            fitness_scores=result.generation_fitness, result_data=result_data, updated_at=timezone.now())
        if not changed:
            return {"run_id": run_id, "status": "cancelled"}
        payload = {"event": "optimization_complete" if result.status == "completed" else "optimization_" + result.status,
            "run_id": run_id, "status": result.status, "current_generation": len(result.generation_fitness),
            "total_generations": params.get("generations", 300), "current_fitness": result.best_fitness}
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
