from __future__ import annotations

from collections import Counter

from core.models import Bottleneck, Incident, Officer


def _is_placeholder_badge(value):
    if value is None:
        return False
    value = str(value).strip()
    if not value:
        return False
    if value.lower().startswith("test-") or value.lower().startswith("demo-"):
        return True
    if any(token in value.lower() for token in ["0001", "1001", "2001", "seed", "sample"]):
        return True
    return False


def validate_officer_record(officer: Officer):
    issues = []
    if _is_placeholder_badge(getattr(officer, "badge_number", None)):
        issues.append("placeholder_badge")
    if getattr(officer, "status", "") not in {"available", "deployed", "off_duty", "unavailable"}:
        issues.append("invalid_status")
    if getattr(officer, "shift", None) not in {"morning", "afternoon"}:
        issues.append("invalid_shift")
    return issues


def validate_bottleneck_record(bottleneck: Bottleneck):
    issues = []
    latitude = float(getattr(bottleneck, "latitude", 0) or 0)
    longitude = float(getattr(bottleneck, "longitude", 0) or 0)
    if not (-90 <= latitude <= 90):
        issues.append("invalid_latitude")
    if not (-180 <= longitude <= 180):
        issues.append("invalid_longitude")
    if not 0 <= float(getattr(bottleneck, "tsi", 0) or 0) <= 1:
        issues.append("invalid_tsi")
    return issues


def get_data_quality_issues(queryset=None):
    officer_qs = Officer.objects.filter(is_deleted=False)
    bottleneck_qs = Bottleneck.objects.filter(is_deleted=False)

    issue_counts = Counter()
    issue_examples = []

    for officer in officer_qs:
        issues = validate_officer_record(officer)
        for issue in issues:
            issue_counts[issue] += 1
            issue_examples.append({"type": "officer", "id": officer.id, "issue": issue})

    for bottleneck in bottleneck_qs:
        issues = validate_bottleneck_record(bottleneck)
        for issue in issues:
            issue_counts[issue] += 1
            issue_examples.append({"type": "bottleneck", "id": bottleneck.id, "issue": issue})

    return {"issue_counts": dict(issue_counts), "issues": issue_examples, "total_issues": sum(issue_counts.values())}
