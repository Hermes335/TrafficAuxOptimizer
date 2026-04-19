from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from celery import shared_task
from django.utils import timezone

from core.models import Bottleneck, Officer, OptimizationRun, WeatherData
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
    bottlenecks = [
        {
            "id": bottleneck.id,
            "name": bottleneck.name,
            "latitude": bottleneck.latitude,
            "longitude": bottleneck.longitude,
            "road_priority_weight": bottleneck.road_priority_weight,
            "tsi": (
                bottleneck.traffic_data.filter(is_deleted=False).order_by("-timestamp").values_list("traffic_severity_index", flat=True).first()
                or 0.0
            ),
        }
        for bottleneck in bottlenecks_qs
    ]

    weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
    wif = float(getattr(weather, "weather_impact_factor", 1.0))

    run.status = "running"
    run.save(update_fields=["status", "updated_at"])

    total_generations = max(50, min(1000, int(params.get("generations", 300))))

    def progress_callback(current_generation: int, _: int, current_fitness: float):
        payload = {
            "event": "optimization_progress",
            "run_id": run_id,
            "status": "running",
            "current_generation": current_generation,
            "total_generations": total_generations,
            "current_fitness": round(current_fitness, 4),
            "estimated_completion": (timezone.now() + timedelta(minutes=3)).isoformat(),
            "updated_at": timezone.now().isoformat(),
        }
        save_progress(run_id, payload)
        _broadcast_progress(run_id, payload)

    try:
        result = optimizer.run(
            officers=officers,
            bottlenecks=bottlenecks,
            parameters=params,
            weather_impact_factor=wif,
            progress_callback=progress_callback,
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
    }
    run.status = result.status
    run.save(update_fields=["fitness_scores", "result_data", "status", "updated_at"])

    if result.status != "completed":
        failed_payload = {
            "event": "optimization_failed",
            "run_id": run_id,
            "status": "failed",
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
