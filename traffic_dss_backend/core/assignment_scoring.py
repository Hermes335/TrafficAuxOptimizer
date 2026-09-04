from __future__ import annotations

from math import atan2, cos, radians, sin, sqrt

from django.db.models import QuerySet

from core.models import Officer


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if None in (lat1, lon1, lat2, lon2):
        return float("inf")

    radius_km = 6371.0
    phi1 = radians(lat1)
    phi2 = radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lambda = radians(lon2 - lon1)

    a = (
        sin(delta_phi / 2) ** 2
        + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return radius_km * c


def score_candidate_officer(officer: Officer, bottleneck, active_incident=None):
    """Return a transparent quality score for a candidate assignment."""
    score = 0.0

    if officer.status == "available":
        score += 25
    elif officer.status == "deployed":
        score += 15
    else:
        score -= 40

    if officer.shift in {"morning", "afternoon"}:
        score += 10

    if officer.current_latitude is not None and officer.current_longitude is not None:
        distance_km = haversine_km(
            officer.current_latitude,
            officer.current_longitude,
            float(bottleneck.latitude),
            float(bottleneck.longitude),
        )
        if distance_km != float("inf"):
            score += max(0, 35 - (distance_km * 2.5))

    officer_skill_tags = set((officer.skills or []) if isinstance(officer.skills, list) else [])
    bottleneck_tag = str(getattr(bottleneck, "bottleneck_type", "other"))
    if officer_skill_tags and (bottleneck_tag in officer_skill_tags or "traffic" in officer_skill_tags):
        score += 20
    elif bottleneck_tag in {"intersection", "bridge", "terminal"}:
        score += 10

    prefetched = getattr(officer, "_prefetched_objects_cache", {})
    if "deployments" in prefetched:
        # Deployments were prefiltered by caller when available.
        active_deployments = len(prefetched["deployments"])
    else:
        active_deployments = officer.deployments.filter(is_deleted=False, status="assigned").count()
    score -= min(active_deployments * 7, 25)

    if active_incident is not None and getattr(active_incident, "severity", "") == "critical":
        score += 15
    elif active_incident is not None and getattr(active_incident, "severity", "") == "major":
        score += 10

    return round(score, 2)


def rank_candidates_for_bottleneck(bottleneck, officer_queryset=None, active_incident=None):
    queryset = officer_queryset
    if queryset is None:
        queryset = Officer.objects.filter(is_deleted=False, status__in=["available", "deployed"]).order_by("name")

    if isinstance(queryset, QuerySet):
        queryset = list(queryset)

    ranked = []
    for officer in queryset:
        ranked.append(
            {
                "officer_id": officer.id,
                "badge_number": officer.badge_number,
                "name": officer.name,
                "status": officer.status,
                "score": score_candidate_officer(officer, bottleneck, active_incident=active_incident),
            }
        )
    return sorted(ranked, key=lambda item: item["score"], reverse=True)
