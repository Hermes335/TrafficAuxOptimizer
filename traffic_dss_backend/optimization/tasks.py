from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from celery import shared_task
from django.utils import timezone

from core.models import Bottleneck, Incident, Officer, OptimizationRun, POI, WeatherData
from .engine import GeneticDeploymentOptimizer
from .progress_store import save_progress


def _broadcast_progress(run_id: str, payload: dict):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        f"optimization_{run_id}",
        {
            "type": "optimization_event",
            "data": payload,
        },
    )


@shared_task
def run_optimization(run_id: str):
    run = OptimizationRun.objects.select_related("created_by").get(run_id=run_id)
    params = run.parameters or {}
    optimizer = GeneticDeploymentOptimizer()

    if run.status == "cancelled":
        cancelled_payload = {
            "event": "optimization_cancelled",
            "run_id": run_id,
            "status": "cancelled",
            "current_generation": 0,
            "total_generations": int(params.get("generations", 300)),
            "current_fitness": 0.0,
            "updated_at": timezone.now().isoformat(),
        }
        save_progress(run_id, cancelled_payload)
        _broadcast_progress(run_id, cancelled_payload)
        return {"run_id": run_id, "best_fitness": 0.0, "status": "cancelled"}

    officers_qs = Officer.objects.filter(
        is_deleted=False,
        status__in=["available", "deployed"],
        shift=params.get("shift", "afternoon"),
    ).order_by("id")
    officers = [
        {
            "id": officer.id,
            "badge_number": officer.badge_number,
            "current_latitude": officer.current_latitude,
            "current_longitude": officer.current_longitude,
        }
        for officer in officers_qs
    ]

    bottlenecks_qs = Bottleneck.objects.filter(is_deleted=False).order_by("id")
    bottlenecks = []
    for bottleneck in bottlenecks_qs:
        # TSI priority: bottleneck.tsi field > latest TrafficData record > 0.0
        tsi_val = float(bottleneck.tsi) if bottleneck.tsi and bottleneck.tsi > 0 else (
            bottleneck.traffic_data.filter(is_deleted=False).order_by("-timestamp").values_list("traffic_severity_index", flat=True).first()
            or 0.0
        )
        bottlenecks.append({
            "id": bottleneck.id,
            "name": bottleneck.name,
            "latitude": bottleneck.latitude,
            "longitude": bottleneck.longitude,
            "road_priority_weight": bottleneck.road_priority_weight,
            "tsi": tsi_val,
            "min_officers_required": bottleneck.min_officers_required,
            "max_officers_allowed": bottleneck.max_officers_allowed,
        })

    synthetic_flags = []

    all_weights = [b["road_priority_weight"] for b in bottlenecks]
    if len(set(all_weights)) == 1:
        for i, bottleneck in enumerate(bottlenecks):
            bottleneck["road_priority_weight"] = 0.5 + (i % 3) * 0.3
        synthetic_flags.append("road_priority_weight")

    tsi_values = [b["tsi"] for b in bottlenecks]
    if all(tsi == 0.0 for tsi in tsi_values):
        for i, bottleneck in enumerate(bottlenecks):
            bottleneck["tsi"] = 0.3 + (i % 5) * 0.12
        synthetic_flags.append("tsi")

    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
    wif = float(getattr(weather, "weather_impact_factor", 1.0))

    # Fetch active incidents with location data
    active_incidents = list(
        Incident.objects.filter(
            is_deleted=False, status="active", latitude__isnull=False, longitude__isnull=False
        ).values("latitude", "longitude", "severity", "incident_type")
    )

    run.status = "running"
    run.save(update_fields=["status", "updated_at"])

    total_generations = max(50, min(1000, int(params.get("generations", 300))))

    start_time = timezone.now()

    def progress_callback(current_generation: int, _: int, current_fitness: float):
        elapsed = (timezone.now() - start_time).total_seconds()
        rate = current_generation / max(elapsed, 1)
        remaining = (total_generations - current_generation) / max(rate, 0.001)
        est_completion = (timezone.now() + timedelta(seconds=remaining)).isoformat()

        payload = {
            "event": "optimization_progress",
            "run_id": run_id,
            "status": "running",
            "current_generation": current_generation,
            "total_generations": total_generations,
            "current_fitness": round(current_fitness, 4),
            "estimated_completion": est_completion,
            "updated_at": timezone.now().isoformat(),
        }
        save_progress(run_id, payload)
        _broadcast_progress(run_id, payload)

    # Fetch active POIs for priority boost
    pois = [
        {"latitude": p.latitude, "longitude": p.longitude, "priority_boost": p.priority_boost}
        for p in POI.objects.filter(is_deleted=False, is_active=True)
    ]

    try:
        run_seed = int(run_id.replace('opt-', '').replace('-', '')) % (2**31)
        result = optimizer.run(
            officers=officers,
            bottlenecks=bottlenecks,
            parameters=params,
            weather_impact_factor=wif,
            incidents=active_incidents,
            pois=pois if pois else None,
            seed=run_seed,
            progress_callback=progress_callback,
            cancel_check=lambda: OptimizationRun.objects.filter(run_id=run_id, is_deleted=False, status="cancelled").exists(),
        )
    except Exception as exc:
        run.status = "failed"
        run.result_data = {"error": str(exc)}
        run.save(update_fields=["status", "result_data", "updated_at"])
        failure_payload = {
                "event": "optimization_failed",
            "run_id": run_id,
            "status": "failed",
            "error": str(exc),
            "updated_at": timezone.now().isoformat(),
        }
        save_progress(run_id, failure_payload)
        _broadcast_progress(run_id, failure_payload)
        raise

    run.fitness_scores = result.generation_fitness
    run.result_data = {
        "top_solutions": result.top_solutions,
        "weather_impact_factor": wif,
        "synthetic_data_used": synthetic_flags if synthetic_flags else None,
        "pareto_curve_data": result.pareto_curve_data,
        "converged_early": result.converged_early,
    }
    run.status = result.status
    run.save(update_fields=["fitness_scores", "result_data", "status", "updated_at"])

    if result.status != "completed":
        event_name = "optimization_cancelled" if result.status == "cancelled" else "optimization_failed"
        failed_payload = {
            "event": event_name,
            "run_id": run_id,
            "status": result.status,
            "current_generation": len(result.generation_fitness),
            "total_generations": total_generations,
            "current_fitness": round(result.best_fitness, 4),
            "updated_at": timezone.now().isoformat(),
        }
        save_progress(run_id, failed_payload)
        _broadcast_progress(run_id, failed_payload)
        return {"run_id": run_id, "best_fitness": result.best_fitness, "status": result.status}

    completed_payload = {
        "event": "optimization_complete",
        "run_id": run_id,
        "status": "completed",
        "current_generation": total_generations,
        "total_generations": total_generations,
        "current_fitness": round(result.best_fitness, 4),
        "estimated_completion": timezone.now().isoformat(),
        "updated_at": timezone.now().isoformat(),
    }
    save_progress(run_id, completed_payload)
    _broadcast_progress(run_id, completed_payload)

    return {"run_id": run_id, "best_fitness": result.best_fitness, "status": result.status}
