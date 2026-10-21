"""Read-only preparation checks; advisory input quality is not publication approval."""
from datetime import datetime
from math import isfinite

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.operational_time import operational_date
from .input_policy import input_issues


def _location_known(latitude, longitude):
    try:
        return (latitude is not None and longitude is not None
                and isfinite(float(latitude)) and isfinite(float(longitude))
                and -90 <= float(latitude) <= 90 and -180 <= float(longitude) <= 180)
    except (TypeError, ValueError):
        return False


def _freshness(value, now, max_age):
    observed_at = value.get("observed_at")
    try:
        observed = parse_datetime(observed_at or "")
        age = (now - observed).total_seconds() if observed and timezone.is_aware(observed) else None
    except (TypeError, ValueError):
        age = None
    return {
        "observed_at": observed_at,
        "age_seconds": round(age, 1) if age is not None else None,
        "data_status": value.get("data_status") or "unknown",
        "is_stale": bool(value.get("is_stale") or (age is not None and age > max_age)),
        "is_synthetic": bool(value.get("is_synthetic")),
    }


def build_readiness(params, now=None, captured=None):
    """Describe the selected planning window without creating a run or changing data."""
    # Local imports avoid coupling endpoint imports to Celery task initialization.
    from .planning import planning_window
    from .scheduling import plan_periods
    from .tasks import capture_inputs

    now = now or timezone.now()
    start, end = planning_window(params, now=now)
    officers, nodes, weather_record = captured if captured is not None else capture_inputs(params, now=now)
    mode = params.get("mode", "operational")
    warnings, blockers, periods = [], [], []

    for left, right in plan_periods(nodes, officers):
        left, right = max(left, start), min(right, end)
        if left >= right:
            continue
        demand = sum(next((window["required"] for window in node["staffing_windows"]
                          if datetime.fromisoformat(window["start_time"]) <= left
                          < datetime.fromisoformat(window["end_time"])), 0) for node in nodes)
        available = sum(not any(datetime.fromisoformat(block["start_time"]) < right
                                and datetime.fromisoformat(block["end_time"]) > left
                                for block in officer.get("time_blocks", [])) for officer in officers)
        periods.append({
            "start_time": left.isoformat(), "end_time": right.isoformat(),
            "required_officers": demand, "available_officers": available,
            "shortage": max(0, demand - available),
        })

    peak_required = max((period["required_officers"] for period in periods), default=0)
    max_shortage = max((period["shortage"] for period in periods), default=0)
    if not nodes:
        blockers.append("No active bottlenecks are available. Add or activate a location before optimizing.")
    if not officers and peak_required:
        blockers.append("No eligible officers are available for this shift while staffing is required.")
    if mode == "operational" and start >= end:
        blockers.append("No planning time remains in this shift. Choose a later shift or date.")
    if max_shortage:
        warnings.append(f"Staffing demand exceeds the available roster by up to {max_shortage} officer(s) in a planning period. The recommendation may contain unfilled posts.")

    traffic = [{
        "bottleneck_id": node["id"], "name": node["name"],
        **_freshness(node.get("provenance") or {}, now, settings.TRAFFIC_MAX_INPUT_AGE),
    } for node in nodes]
    weather_value = {
        "observed_at": (weather_record.observed_at or weather_record.timestamp).isoformat() if weather_record else None,
        "data_status": weather_record.data_status if weather_record else "missing",
        "is_stale": bool(weather_record and weather_record.is_stale),
        "is_synthetic": bool(weather_record and weather_record.is_synthetic),
    }
    weather = _freshness(weather_value, now, settings.WEATHER_MAX_INPUT_AGE)
    warnings.extend(input_issues({
        "captured_at": now.isoformat(),
        "bottlenecks": [{"id": row["bottleneck_id"], "name": row["name"], "provenance": row} for row in traffic],
        "weather": weather,
    }, now=now))
    if any(row["is_synthetic"] for row in traffic) or weather["is_synthetic"]:
        warnings.append("Simulated inputs are present. The recommendation can be compared but cannot be published.")

    known_origins = {
        officer["id"] for officer in officers
        if mode == "operational" and isinstance(officer.get("initial_position"), dict)
        and _location_known(officer["initial_position"].get("latitude"), officer["initial_position"].get("longitude"))
    }
    missing_locations = sum(
        officer["id"] not in known_origins
        and not _location_known(officer.get("current_latitude"), officer.get("current_longitude"))
        for officer in officers)
    if missing_locations:
        warnings.append(f"{missing_locations} eligible officer(s) have no known starting location. Travel estimates will use the documented distance assumption.")

    return {
        "ready": not blockers, "checked_at": now.isoformat(),
        "mode": mode, "shift": params.get("shift", "afternoon"),
        "operational_date": str(params.get("operational_date") or operational_date(now)),
        "planning_start": start.isoformat(), "planning_end": end.isoformat(),
        "blockers": blockers, "warnings": warnings,
        "summary": {
            "active_locations": len(nodes), "eligible_officers": len(officers),
            "missing_officer_locations": missing_locations,
            "peak_required_officers": peak_required, "max_staffing_shortage": max_shortage,
        },
        "periods": periods, "traffic": traffic, "weather": weather,
    }
