from __future__ import annotations

from math import atan2, cos, floor, radians, sin, sqrt

from django.db.models import QuerySet

from core.models import Officer
from core.skills import preferred_skills_for, skill_match, skill_preference_score


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


def score_candidate_officer(officer: Officer, bottleneck, active_incident=None, preferred_skills=None):
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

    preferences = preferred_skills if preferred_skills is not None else preferred_skills_for(
        bottleneck, [active_incident] if active_incident is not None else [])
    if skill_match(officer.skills, preferences)["status"] == "matched":
        score += 20

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


def rank_candidates_for_bottleneck(bottleneck, officer_queryset=None, active_incident=None, preferred_skills=None, weather_impact_factor=1):
    queryset = officer_queryset
    if queryset is None:
        queryset = Officer.objects.filter(is_deleted=False, status__in=["available", "deployed"]).order_by("name")

    if isinstance(queryset, QuerySet):
        queryset = list(queryset)

    preferences = preferred_skills if preferred_skills is not None else preferred_skills_for(
        bottleneck, [active_incident] if active_incident is not None else [])
    ranked = []
    for officer in queryset:
        if officer.is_deleted or officer.status not in {"available", "deployed"}:
            continue
        distance = haversine_km(officer.current_latitude, officer.current_longitude,
            float(bottleneck.latitude), float(bottleneck.longitude))
        travel_minutes = distance / max(8, 28 * (1 - float(bottleneck.tsi))) * 60 * weather_impact_factor
        row = {
                "officer_id": officer.id,
                "badge_number": officer.badge_number,
                "name": officer.name,
                "status": officer.status,
                "score": score_candidate_officer(officer, bottleneck, active_incident=active_incident, preferred_skills=preferences),
                "skill_match": skill_match(officer.skills, preferences),
            }
        # Preserve response-time priority; skills distinguish comparable travel estimates.
        # Unknown coordinates remain unknown rather than implying zero travel time.
        ordering = (floor(travel_minutes + 0.5) if travel_minutes != float("inf") else float("inf"),
            -skill_preference_score(officer.skills, preferences), travel_minutes,
            -row["score"], officer.name.casefold(), officer.pk)
        ranked.append((ordering, row))
    return [row for _, row in sorted(ranked, key=lambda item: item[0])]
