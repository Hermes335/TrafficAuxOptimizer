"""Saved explanations of the existing fitness arithmetic; no new objectives."""
from copy import deepcopy


SCORE_VERSION = "fitness-breakdown-v1"
COMPONENTS = [
    ("coverage_efficiency", "Coverage", "tsi_weight"),
    ("response_time_score", "Estimated travel", "wif_weight"),
    ("road_priority_coverage", "Road priority", "rpw_weight"),
    ("staffing_efficiency", "Staffing efficiency", "resource_utilization_weight"),
]


def score_breakdown(objectives, weights, incident_bonus, constrained, total):
    components = [{"key": key, "label": label, "score": objectives[key], "weight": weights[weight],
                   "contribution": objectives[key]*weights[weight]} for key, label, weight in COMPONENTS]
    bonus = {"score": objectives.get("incident_coverage_score", 0) if incident_bonus else 0,
             "weight": 0.15, "contribution": objectives.get("incident_coverage_score", 0)*0.15 if incident_bonus else 0}
    subtotal = sum(row["contribution"] for row in components)+bonus["contribution"]
    adjustment = subtotal*(1e-6-1) if constrained else 0
    return {"version": SCORE_VERSION, "basis": "final_assignments", "components": components,
            "incident_bonus": bonus, "constraint_adjustment": adjustment,
            "rounding_adjustment": total-subtotal-adjustment, "total": total}


def accumulate_breakdown(current, period, fraction):
    if current is None:
        current = deepcopy(period)
        current["basis"] = "time_weighted_final_assignments"
        for row in current["components"]:
            row["score"] = row["contribution"] = 0
        current["incident_bonus"]["score"] = current["incident_bonus"]["contribution"] = 0
        current["constraint_adjustment"] = current["rounding_adjustment"] = current["total"] = 0
    for row, value in zip(current["components"], period["components"]):
        row["score"] += value["score"]*fraction
        row["contribution"] += value["contribution"]*fraction
    for key in ("score", "contribution"):
        current["incident_bonus"][key] += period["incident_bonus"][key]*fraction
    for key in ("constraint_adjustment", "rounding_adjustment", "total"):
        current[key] += period[key]*fraction
    return current
