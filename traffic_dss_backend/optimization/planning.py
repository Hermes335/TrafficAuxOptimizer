"""Capture an operational horizon and the published posts preserved before cutover."""
from datetime import date, datetime, timedelta

from django.conf import settings
from django.utils import timezone

from core.models import Deployment
from core.operational_time import operational_date, shift_window


def review_lead_seconds():
    return max(0, int(getattr(settings, "OPTIMIZATION_REVIEW_LEAD_SECONDS", 120)))


def ceil_minute(moment):
    floor = moment.replace(second=0, microsecond=0)
    return floor+timedelta(minutes=1) if moment != floor else floor


def planning_window(params, now=None):
    now = now or timezone.now()
    day = date.fromisoformat(str(params.get("operational_date") or operational_date(now)))
    start, end = shift_window(params.get("shift", "afternoon"), day)
    if params.get("mode", "operational") == "operational" and now >= start:
        start = ceil_minute(now+timedelta(seconds=review_lead_seconds()))
    return start, end


def capture_origins(officers, params, start, now):
    """Honor current posts and committed prefixes; never assume a later replacement post."""
    if params.get("mode", "operational") == "shadow" or now < shift_window(
            params.get("shift", "afternoon"), date.fromisoformat(str(params.get("operational_date") or operational_date(now))))[0]:
        return
    by_id = {officer["id"]: officer for officer in officers}
    rows = Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"],
        officer_id__in=by_id, start_time__lt=start, end_time__gte=now-timedelta(hours=2)).select_related("bottleneck").order_by("officer_id", "-start_time", "-pk")
    seen = set()
    for row in rows:
        if row.officer_id in seen:
            continue
        seen.add(row.officer_id)
        # Very old posts are not reliable current positions. The roster/GPS fallback remains explicit.
        if row.end_time < now-timedelta(hours=2):
            continue
        release = row.end_time if row.status == "completed" or row.end_time <= now else min(row.end_time, start)
        by_id[row.officer_id]["initial_position"] = {
            "node_id": row.bottleneck_id, "latitude": row.bottleneck.latitude,
            "longitude": row.bottleneck.longitude, "end": release.isoformat(), "deployment_id": row.pk,
            "source": "served_post" if row.start_time <= now else "published_before_cutover",
        }


def add_transfer_boundaries(officers, start, end):
    """Retry transfers at bounded five-minute intervals throughout the remaining shift."""
    if not any(officer.get("initial_position") for officer in officers):
        return
    boundaries = []
    cursor = start+timedelta(minutes=5)
    while cursor < end:
        boundaries.append(cursor.isoformat())
        cursor += timedelta(minutes=5)
    for officer in officers:
        officer["travel_ready_times"] = boundaries

