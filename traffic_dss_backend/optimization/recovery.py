"""Expire abandoned runs without replaying a potentially completed task."""
from datetime import timedelta
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from core.models import OptimizationRun
from core.realtime import broadcast
from core.utils import write_audit_log


def expire_abandoned_runs(now=None):
    now = now or timezone.now()
    queued_cutoff = now - timedelta(seconds=settings.OPTIMIZATION_QUEUE_TIMEOUT)
    running_cutoff = now - timedelta(seconds=settings.OPTIMIZATION_HEARTBEAT_TIMEOUT)
    overdue = Q(status="queued", timestamp__lt=queued_cutoff) | (
        Q(status="running") & (Q(heartbeat_at__lt=running_cutoff) | Q(heartbeat_at__isnull=True, updated_at__lt=running_cutoff)))
    expired = []
    for run in OptimizationRun.objects.filter(overdue, is_deleted=False):
        # Retest the lease in the UPDATE so a concurrent heartbeat or finish wins.
        message = "The background job stopped responding. Start a new run after checking worker health."
        if not OptimizationRun.objects.filter(overdue, pk=run.pk).update(status="failed",
                result_data={"error": message, "failure_code": "worker_timeout"}, updated_at=now):
            continue
        expired.append(run.run_id)
        write_audit_log(None, "timeout", "optimization_run", {"run_id": run.run_id, "task_id": run.task_id})
        payload = {"event": "optimization_failed", "run_id": run.run_id, "status": "failed", "error": message}
        broadcast(f"optimization_{run.run_id}", "optimization_event", payload)
        broadcast("dashboard_live", "dashboard_event", payload)
    return expired
