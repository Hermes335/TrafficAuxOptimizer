"""Capture an operational horizon and the published posts preserved before cutover."""
from datetime import date, datetime, timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import Deployment
from core.operational_time import MANILA, operational_date, shift_window
from core.officer_locations import TTMO_HQ_LATITUDE, TTMO_HQ_LONGITUDE, TTMO_HQ_NAME, valid_coordinates


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
    day = date.fromisoformat(str(params.get("operational_date") or operational_date(now)))
    day_start = datetime.combine(day, datetime.min.time(), MANILA)
    rows = Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"],
        officer_id__in=by_id, start_time__gte=day_start, start_time__lt=start,
        end_time__gte=now-timedelta(hours=2)).select_related("bottleneck").order_by("officer_id", "-start_time", "-pk")
    seen = set()
    for row in rows:
        if row.officer_id in seen:
            continue
        seen.add(row.officer_id)
        # Very old posts are not reliable current positions. Same-day saved coordinates or HQ are used instead.
        if row.end_time < now-timedelta(hours=2):
            continue
        release = row.end_time if row.status == "completed" or row.end_time <= now else min(row.end_time, start)
        by_id[row.officer_id]["initial_position"] = {
            "node_id": row.bottleneck_id, "latitude": row.bottleneck.latitude,
            "longitude": row.bottleneck.longitude, "end": release.isoformat(), "deployment_id": row.pk,
            "source": "served_post" if row.start_time <= now else "published_before_cutover",
        }


def starting_location_model():
    return {"speed_kmh": "max(8, 28 * (1 - TSI))", "initial_location_policy": "known_coordinates_then_hq",
            "origin_reset": "daily", "default_origin": {"name": TTMO_HQ_NAME,
                "latitude": TTMO_HQ_LATITUDE, "longitude": TTMO_HQ_LONGITUDE, "assumed": True}}


def capture_starting_locations(officers, params, now):
    """Resolve daily planning origins in memory without changing the officer roster."""
    day = date.fromisoformat(str(params.get("operational_date") or operational_date(now)))
    for officer in officers:
        recorded = officer.get("current_location_recorded_at")
        if isinstance(recorded, str):
            try:
                recorded = parse_datetime(recorded)
            except (ValueError, TypeError):
                recorded = None
        valid_time = isinstance(recorded, datetime) and timezone.is_aware(recorded)
        recorded_at = recorded.isoformat() if valid_time else None
        saved_today = (valid_time and recorded <= now and recorded.astimezone(MANILA).date() == day
                       and valid_coordinates(officer.get("current_latitude"), officer.get("current_longitude")))
        officer["recorded_location"] = {"latitude": officer.get("current_latitude"),
            "longitude": officer.get("current_longitude"), "recorded_at": recorded_at, "usable_today": bool(saved_today)}
        prior = officer.get("initial_position")
        if isinstance(prior, dict) and valid_coordinates(prior.get("latitude"), prior.get("longitude")):
            origin = {"source": prior["source"], "name": "Recorded post", "latitude": prior["latitude"],
                "longitude": prior["longitude"], "assumed": False, "deployment_id": prior.get("deployment_id")}
        elif saved_today:
            origin = {"source": "saved_coordinates", "name": "Saved officer location",
                "latitude": officer["current_latitude"], "longitude": officer["current_longitude"], "assumed": False}
        else:
            origin = {"source": "ttmo_hq", **starting_location_model()["default_origin"]}
        officer["starting_location"] = {**origin, "operational_date": str(day)}
        officer["current_latitude"], officer["current_longitude"] = origin["latitude"], origin["longitude"]
        officer["current_location_recorded_at"] = recorded_at


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

