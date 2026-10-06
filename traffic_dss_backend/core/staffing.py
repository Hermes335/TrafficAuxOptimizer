from datetime import datetime, timedelta
import re

from django.utils import timezone
from .operational_time import MANILA


def minute_of_day(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d|24:00", value):
        raise ValueError("Use HH:MM times in Asia/Manila.")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def validate_staffing_periods(periods, cap):
    if not isinstance(periods, list) or len(periods) > 32:
        raise ValueError("Provide up to 32 staffing periods.")
    occupied = {day: [] for day in range(7)}
    for period in periods:
        if not isinstance(period, dict):
            raise ValueError("Each staffing period must be an object.")
        start, end = minute_of_day(period.get("start")), minute_of_day(period.get("end"))
        required = period.get("required")
        days = period.get("days", list(range(7)))
        if start >= end or start % 15 or end % 15:
            raise ValueError("Periods must increase within one day, in 15-minute steps; split overnight periods.")
        if type(required) is not int or not 0 <= required <= cap:
            raise ValueError("Required officers must be a whole number from zero to the location capacity.")
        if not isinstance(days, list) or not days or any(type(d) is not int or d not in range(7) for d in days) or len(set(days)) != len(days):
            raise ValueError("Select distinct weekdays from 0 (Monday) to 6 (Sunday).")
        if not isinstance(period.get("label", ""), str) or len(period.get("label", "")) > 80:
            raise ValueError("Period labels must be at most 80 characters.")
        for day in days:
            if any(start < right and left < end for left, right in occupied[day]):
                raise ValueError("Staffing periods must not overlap on the same weekday.")
            occupied[day].append((start, end))


def staffing_requirement(node, incidents=(), at=None):
    moment = (at or timezone.now()).astimezone(MANILA)
    minute = moment.hour * 60 + moment.minute
    period = next((p for p in getattr(node, "staffing_periods", [])
                   if moment.weekday() in p.get("days", range(7))
                   and minute_of_day(p["start"]) <= minute < minute_of_day(p["end"])), None)
    required = max(0, node.min_officers_required)
    reason = "Normal staffing"
    if period is not None:
        required = period["required"]
        reason = period.get("label") or "Scheduled staffing"
    elif node.tsi >= 0.8:
        required = node.max_officers_allowed
        reason = "High congestion"
    elif node.tsi >= 0.5:
        required += 1
        reason = "Moderate congestion"
    if any(i.severity == "critical" for i in incidents):
        required += 1
        reason += "; critical incident"
    return max(0, min(node.max_officers_allowed, required)), reason


def required_staffing(node, incidents=(), at=None):
    return staffing_requirement(node, incidents, at)[0]


def staffing_windows(node, start, end, incidents=()):
    """Use the same boundaries for optimization, publication and coverage."""
    boundaries = {start, end}
    midnight = datetime.combine(start.astimezone(MANILA).date(), datetime.min.time(), MANILA)
    for period in getattr(node, "staffing_periods", []):
        if midnight.weekday() not in period.get("days", range(7)):
            continue
        for key in ("start", "end"):
            boundary = midnight + timedelta(minutes=minute_of_day(period[key]))
            if start < boundary < end:
                boundaries.add(boundary)
    ordered = sorted(boundaries)
    windows = []
    for left, right in zip(ordered, ordered[1:]):
        required, reason = staffing_requirement(node, incidents, left)
        windows.append({"start_time": left.isoformat(), "end_time": right.isoformat(),
                        "required": required, "reason": reason})
    return windows

def shift_staffing(deployments, required, start, end):
    """Average staffed posts and covered posts across the entire shift."""
    events = [(start, 0), (end, 0)]
    for row in deployments:
        if row.start_time < end and row.end_time > start:
            events.extend([(max(start, row.start_time), 1), (min(end, row.end_time), -1)])
    count = 0
    assigned_seconds = covered_seconds = 0
    previous = start
    for moment, delta in sorted(events):
        duration = (moment - previous).total_seconds()
        assigned_seconds += count * duration
        covered_seconds += min(required, count) * duration
        count += delta
        previous = moment
    duration = (end - start).total_seconds()
    return assigned_seconds / duration, covered_seconds / duration


def staffing_totals(node, deployments, start, end, incidents=()):
    required_seconds = assigned_seconds = covered_seconds = 0
    for window in staffing_windows(node, start, end, incidents):
        left, right = datetime.fromisoformat(window["start_time"]), datetime.fromisoformat(window["end_time"])
        duration = (right - left).total_seconds()
        assigned, covered = shift_staffing(deployments, window["required"], left, right)
        required_seconds += window["required"] * duration
        assigned_seconds += assigned * duration
        covered_seconds += covered * duration
    duration = (end - start).total_seconds()
    return required_seconds / duration, assigned_seconds / duration, covered_seconds / duration
