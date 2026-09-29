"""Publication input checks; optimizer scoring is intentionally independent."""
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime


def input_issues(snapshot, now=None):
    now = now or timezone.now()
    issues = []

    def check(label, value, limit, status=None, stale=False):
        try:
            observed = parse_datetime(value or "")
            age = (now - observed).total_seconds() if observed and timezone.is_aware(observed) else None
        except (TypeError, ValueError):
            age = None
        if age is None or age < -60:
            issues.append(f"{label}: no valid observation time.")
        elif stale or age > limit:
            issues.append(f"{label}: input is stale.")
        if status in {"missing", "unverified", "unavailable", "unknown", None}:
            issues.append(f"{label}: input is not verified.")

    check("Recommendation", snapshot.get("captured_at"), settings.PUBLICATION_MAX_INPUT_AGE, status="captured")
    for node in snapshot.get("bottlenecks", []):
        provenance = node.get("provenance") or {}
        check(node.get("name") or node.get("id", "Location"), provenance.get("observed_at"),
              settings.TRAFFIC_MAX_INPUT_AGE, provenance.get("data_status"), provenance.get("is_stale", False))
    weather = snapshot.get("weather") or {}
    check("Weather", weather.get("observed_at"), settings.WEATHER_MAX_INPUT_AGE,
          weather.get("data_status"), weather.get("is_stale", False))
    return issues
