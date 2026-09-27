import logging
from uuid import uuid4

from django.utils import timezone
from rest_framework import serializers

from core.models import OptimizationRun
from core.utils import write_audit_log


class OptimizationInput(serializers.Serializer):
    shift = serializers.ChoiceField(choices=["morning", "afternoon"], default="afternoon")
    population_size = serializers.IntegerField(min_value=50, max_value=500, default=200)
    generations = serializers.IntegerField(min_value=50, max_value=1000, default=300)
    mutation_rate = serializers.FloatField(min_value=0.01, max_value=0.30, default=0.10)
    crossover_rate = serializers.FloatField(min_value=0.50, max_value=0.95, default=0.80)
    elitism_count = serializers.IntegerField(min_value=1, max_value=20, default=5)
    tsi_weight = serializers.FloatField(min_value=0, max_value=1, default=0.35)
    wif_weight = serializers.FloatField(min_value=0, max_value=1, default=0.25)
    rpw_weight = serializers.FloatField(min_value=0, max_value=1, default=0.25)
    resource_utilization_weight = serializers.FloatField(min_value=0, max_value=1, default=0.15)
    enable_early_stopping = serializers.BooleanField(default=True)

    def validate(self, data):
        import math
        if any(isinstance(value, float) and not math.isfinite(value) for value in data.values()):
            raise serializers.ValidationError("Numeric parameters must be finite.")
        if sum(data[k] for k in ("tsi_weight", "wif_weight", "rpw_weight", "resource_utilization_weight")) <= 0:
            raise serializers.ValidationError({"weights": "At least one objective weight must be positive."})
        return data


def start_run(user, payload):
    serializer = OptimizationInput(data=payload)
    serializer.is_valid(raise_exception=True)
    run = OptimizationRun.objects.create(
        run_id=f"opt-{uuid4().hex}", timestamp=timezone.now(), created_by=user,
        parameters=serializer.validated_data, status="queued",
    )
    write_audit_log(user, "create", "optimization_run", {"run_id": run.run_id})
    try:
        from .tasks import run_optimization
        run_optimization.delay(run.run_id)
    except Exception as exc:
        logging.getLogger("optimization").exception("Failed to enqueue optimization %s", run.run_id)
        OptimizationRun.objects.filter(pk=run.pk, status="queued").update(
            status="failed", result_data={"error": "Background queue unavailable.", "enqueue_error": str(exc)}, updated_at=timezone.now())
        run.refresh_from_db()
        return run, False
    return run, True
