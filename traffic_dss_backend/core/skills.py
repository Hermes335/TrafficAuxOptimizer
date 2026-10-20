"""Shared, optional officer skill preferences. These are recorded tags, not credentials."""
from math import atan2, cos, radians, sin, sqrt
import re


SKILL_POLICY_VERSION = "skill-preference-v1"
SKILL_OPTIONS = [
    {"value": "traffic_control", "label": "Traffic control"},
    {"value": "intersection_management", "label": "Intersection management"},
    {"value": "school_crossing", "label": "School crossing"},
    {"value": "incident_response", "label": "Incident response"},
    {"value": "first_aid", "label": "First aid"},
]
_LABELS = {item["value"]: item["label"] for item in SKILL_OPTIONS}
_ALIASES = {key: key for key in _LABELS}
_ALIASES.update({
    "traffic": "traffic_control", "traffic_management": "traffic_control",
    "intersection": "intersection_management", "intersection_control": "intersection_management",
    "school_zone": "school_crossing", "school_crossing_control": "school_crossing",
    "firstaid": "first_aid", "incident_handling": "incident_response",
})
_LOCATION_PREFERENCES = {
    "intersection": ["intersection_management", "traffic_control"],
    "school_zone": ["school_crossing", "traffic_control"],
    "bridge": ["traffic_control"], "market": ["traffic_control"],
    "terminal": ["traffic_control"],
}
_INCIDENT_PREFERENCES = {
    "collision": ["incident_response", "first_aid"],
    "road_closure": ["incident_response"], "construction": ["incident_response"],
    "flooding": ["incident_response"],
}


def _key(value):
    return re.sub(r"[\s_-]+", "_", value.strip().casefold())


def normalize_skills(value):
    """Normalize known aliases; retain unknown legacy strings without scoring them."""
    if not isinstance(value, (list, tuple)):
        return []
    result, seen = [], set()
    for item in value:
        if not isinstance(item, str) or not item.strip():
            continue
        normalized = _ALIASES.get(_key(item), item.strip())
        key = normalized.casefold()
        if key not in seen:
            result.append(normalized)
            seen.add(key)
    return result


def _get(record, key, default=None):
    return record.get(key, default) if isinstance(record, dict) else getattr(record, key, default)


def _incident_applies(node, incident):
    if _get(incident, "status", "active") not in {"active", "investigating"}:
        return False
    linked = _get(incident, "bottleneck_id", _get(incident, "bottleneck"))
    if linked is not None:
        return str(linked) == str(_get(node, "id"))
    coords = [_get(node, "latitude"), _get(node, "longitude"),
              _get(incident, "latitude"), _get(incident, "longitude")]
    if any(value is None for value in coords):
        return False
    try:
        lat1, lon1, lat2, lon2 = map(lambda value: radians(float(value)), coords)
        a = sin((lat2-lat1)/2)**2 + cos(lat1)*cos(lat2)*sin((lon2-lon1)/2)**2
        distance = 6371 * 2 * atan2(sqrt(max(0, min(1, a))), sqrt(max(0, 1-a)))
        return distance <= 0.5
    except (ValueError, TypeError):
        return False


def preferred_skills_for(bottleneck, incidents=()):
    """Ordered task preferences, with active incident skills before routine skills."""
    preferred = []
    for incident in incidents:
        if _incident_applies(bottleneck, incident):
            preferred.extend(_INCIDENT_PREFERENCES.get(_get(incident, "incident_type"), []))
    # Sort incident types independently of database/input iteration order.
    incident_order = ["incident_response", "first_aid"]
    preferred = [key for key in incident_order if key in preferred]
    preferred.extend(_LOCATION_PREFERENCES.get(_get(bottleneck, "bottleneck_type"), []))
    return list(dict.fromkeys(preferred))


def skill_preference_score(officer_skills, preferred_skills):
    """The most relevant recorded skill wins; unrelated/unknown tags add no points."""
    skills = set(normalize_skills(officer_skills)) & _LABELS.keys()
    return max((len(preferred_skills)-i for i, key in enumerate(preferred_skills) if key in skills), default=0)


def skill_match(officer_skills, preferred_skills):
    preferred = [key for key in dict.fromkeys(preferred_skills) if key in _LABELS]
    recorded = set(normalize_skills(officer_skills))
    matched = [key for key in preferred if key in recorded]
    if matched:
        status = "matched"
        explanation = "Recorded skill match: " + ", ".join(_LABELS[key] for key in matched) + "."
    elif preferred:
        status = "no_recorded_match"
        explanation = "No matching skill recorded. Assignment remains eligible under staffing and schedule rules."
    else:
        status = "not_applicable"
        explanation = "No skill preference applies to this task."
    return {"policy_version": SKILL_POLICY_VERSION, "preferred_skills": preferred,
            "matched_skills": matched, "status": status, "explanation": explanation}
