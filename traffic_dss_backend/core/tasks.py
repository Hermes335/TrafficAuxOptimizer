from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from celery import shared_task
from django.db.models import Avg
from django.utils import timezone

from core.models import Bottleneck, Incident, TrafficData


def _broadcast_incident_event(event_type: str, incident_data: dict):
    """Broadcast incident events via WebSocket."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        "dashboard_live",
        {
            "type": "dashboard_event",
            "event": event_type,
            "data": incident_data,
        },
    )


@shared_task
def incident_lifecycle():
    """
    Runs every 5 minutes.
    For incidents where status='active' and now - report_time > 4h and no updates,
    set status='resolved' and resolved_time=now.
    """
    from core.models import Incident
    from core.utils import write_audit_log

    four_hours_ago = timezone.now() - timedelta(hours=4)
    resolved_count = 0

    active_incidents = Incident.objects.filter(
        is_deleted=False,
        status="active",
        timestamp__lt=four_hours_ago,
    )

    for incident in active_incidents:
        # Check if there have been any updates (not implemented - resolves all old active incidents)
        incident.status = "resolved"
        incident.resolved_time = timezone.now()
        incident.save(update_fields=["status", "resolved_time", "updated_at"])
        write_audit_log(
            None,
            "auto_resolve",
            "incident",
            {"incident_id": incident.id, "reason": "No activity for 4 hours"},
        )
        resolved_count += 1

        # Broadcast event
        _broadcast_incident_event("incident_updated", {
            "id": incident.id,
            "status": "resolved",
            "resolved_time": incident.resolved_time.isoformat(),
        })

    return f"Resolved {resolved_count} incidents"


@shared_task
def incident_archive():
    """
    Runs daily.
    For incidents where status='resolved' and now - resolved_time >= 24h,
    set is_archived=True and status='archived'.
    """
    from core.models import Incident
    from core.utils import write_audit_log

    one_day_ago = timezone.now() - timedelta(hours=24)
    archived_count = 0

    resolved_incidents = Incident.objects.filter(
        is_deleted=False,
        status="resolved",
        resolved_time__lt=one_day_ago,
    )

    for incident in resolved_incidents:
        incident.is_archived = True
        incident.status = "archived"
        incident.save(update_fields=["is_archived", "status", "updated_at"])
        write_audit_log(
            None,
            "auto_archive",
            "incident",
            {"incident_id": incident.id},
        )
        archived_count += 1

    return f"Archived {archived_count} incidents"


@shared_task
def compute_heatmap_tsi():
    """
    Runs every 5 minutes (peak) / 15 minutes (off-peak).
    Sample traffic data and write heatmap_tsi to Bottleneck rows.
    """
    bottlenecks = Bottleneck.objects.filter(is_deleted=False)
    updated_count = 0
    now = timezone.now()

    # Determine if peak hour (7-9 AM, 5-7 PM)
    hour = now.hour
    is_peak = (7 <= hour <= 9) or (17 <= hour <= 19)
    time_delta = timedelta(minutes=5) if is_peak else timedelta(minutes=15)

    for bottleneck in bottlenecks:
        # Get recent traffic data
        recent_traffic = TrafficData.objects.filter(
            bottleneck=bottleneck,
            is_deleted=False,
            timestamp__gte=now - time_delta,
        ).aggregate(avg_tsi=Avg("traffic_severity_index"))

        avg_tsi = recent_traffic.get("avg_tsi")
        if avg_tsi is not None:
            bottleneck.heatmap_tsi = avg_tsi
            bottleneck.tsi = avg_tsi
            bottleneck.save(update_fields=["heatmap_tsi", "tsi", "updated_at"])
            updated_count += 1

            # Broadcast bottleneck update
            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    "dashboard_live",
                    {
                        "type": "dashboard_event",
                        "event": "bottleneck_updated",
                        "data": {
                            "id": bottleneck.id,
                            "heatmap_tsi": bottleneck.heatmap_tsi,
                            "tsi": bottleneck.tsi,
                        },
                    },
                )

    return f"Updated heatmap_tsi for {updated_count} bottlenecks"