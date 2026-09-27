from django.db import transaction
from core.realtime import broadcast
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from celery import shared_task
from django.db.models import Avg, OuterRef, Subquery
from django.utils import timezone

from core.models import Bottleneck, Incident, TrafficData


def _broadcast_incident_event(event_type: str, incident_data: dict):
    """Broadcast incident events via WebSocket."""
    broadcast("dashboard_live", "dashboard_event", {"event": event_type, **incident_data})


@shared_task
@transaction.atomic
def incident_lifecycle():
    """
    Runs every 5 minutes.
    For incidents where status='active' and now - report_time > 4h and no updates,
    set status='resolved' and resolved_time=now.
    """
    from core.utils import write_audit_log

    four_hours_ago = timezone.now() - timedelta(hours=4)
    now = timezone.now()

    active_incidents = list(Incident.objects.select_for_update().filter(
        is_deleted=False,
        status="active",
        updated_at__lt=four_hours_ago,
        incident_type__in=["collision", "other"],
    ))

    if not active_incidents:
        return "Resolved 0 incidents"

    incident_ids = [i.id for i in active_incidents]
    Incident.objects.filter(id__in=incident_ids).update(
        status="resolved",
        resolved_time=now,
        updated_at=now,
    )

    write_audit_log(
        None,
        "auto_resolve",
        "incident",
        {"incident_ids": incident_ids, "reason": "No activity for 4 hours"},
    )

    for incident_id in incident_ids:
        transaction.on_commit(lambda incident_id=incident_id: _broadcast_incident_event("incident_updated", {
            "id": incident_id,
            "status": "resolved",
            "resolved_time": now.isoformat(),
        }))

    return f"Resolved {len(incident_ids)} incidents"


@shared_task
def incident_archive():
    """
    Runs daily.
    For incidents where status='resolved' and now - resolved_time >= 24h,
    set is_archived=True and status='archived'.
    """
    from core.utils import write_audit_log

    one_day_ago = timezone.now() - timedelta(hours=24)
    now = timezone.now()

    archived_ids = list(Incident.objects.filter(
        is_deleted=False,
        status="resolved",
        resolved_time__lt=one_day_ago,
    ).values_list("id", flat=True))

    if not archived_ids:
        return "Archived 0 incidents"

    Incident.objects.filter(id__in=archived_ids).update(
        is_archived=True,
        status="archived",
        updated_at=now,
    )

    write_audit_log(
        None,
        "auto_archive",
        "incident",
        {"incident_ids": archived_ids},
    )

    return f"Archived {len(archived_ids)} incidents"


@shared_task
def compute_heatmap_tsi():
    """
    Runs every 5 minutes (peak) / 15 minutes (off-peak).
    Sample traffic data and write heatmap_tsi to Bottleneck rows.
    """
    now = timezone.now()
    from core.operational_time import is_peak_hour
    is_peak = is_peak_hour(now)
    time_delta = timedelta(minutes=5) if is_peak else timedelta(minutes=15)

    recent_tsi_subquery = TrafficData.objects.filter(
        bottleneck=OuterRef("pk"),
        is_deleted=False,
        timestamp__gte=now - time_delta,
    ).values("bottleneck").annotate(
        avg_tsi=Avg("traffic_severity_index")
    ).values("avg_tsi")[:1]

    bottlenecks = Bottleneck.objects.filter(is_deleted=False).annotate(
        computed_tsi=Subquery(recent_tsi_subquery)
    )

    to_update = []
    channel_layer = get_channel_layer()

    for bottleneck in bottlenecks:
        if bottleneck.computed_tsi is not None:
            bottleneck.heatmap_tsi = bottleneck.computed_tsi
            bottleneck.tsi = bottleneck.computed_tsi
            to_update.append(bottleneck)

    if to_update:
        Bottleneck.objects.bulk_update(to_update, ["heatmap_tsi", "tsi", "updated_at"])
        broadcast("dashboard_live", "dashboard_event", {"event": "bottlenecks_updated", "timestamp": now.isoformat()})

    return f"Updated heatmap_tsi for {len(to_update)} bottlenecks"

@shared_task
def deployment_lifecycle():
    from django.db import transaction
    from deployments.services import lock_schedule, sync_officer_status, schedule_event
    from core.models import Deployment
    with transaction.atomic():
        lock_schedule()
        count = Deployment.objects.filter(is_deleted=False, status="assigned", end_time__lte=timezone.now()).update(
            status="completed", updated_at=timezone.now())
        sync_officer_status()
        schedule_event(None, "lifecycle", {"completed": count})
    return count
