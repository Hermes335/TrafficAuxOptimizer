from collections import Counter
from copy import deepcopy
from types import SimpleNamespace

import pytest

from core.staffing import required_staffing
from optimization.engine import GeneticDeploymentOptimizer


def node(node_id, demand=2, tsi=0.33, cap=5):
    return {"id": node_id, "name": node_id, "latitude": 10.72, "longitude": 122.56,
            "tsi": tsi, "road_priority_weight": 1, "min_officers_required": demand,
            "staffing_target": demand, "max_officers_allowed": cap}


def roster(count):
    return [{"id": i, "badge_number": f"TEST-{i}", "current_latitude": 10.72,
             "current_longitude": 122.56} for i in range(count)]


def optimize(officers, nodes, seed=9):
    return GeneticDeploymentOptimizer(seed=seed).run(officers, deepcopy(nodes),
        {"population_size": 50, "generations": 50})


@pytest.mark.parametrize("tsi, critical, minimum, cap, expected", [
    (0.33, False, 2, 5, 2), (0.499, False, 2, 5, 2),
    (0.5, False, 2, 5, 3), (0.799, False, 2, 5, 3),
    (0.8, False, 2, 5, 5), (0.33, True, 2, 5, 3),
    (0.5, True, 2, 5, 4), (0.8, True, 2, 5, 5),
    (0.33, False, 4, 5, 4), (0.9, True, 2, 2, 2),
])
def test_existing_staffing_policy_boundaries(tsi, critical, minimum, cap, expected):
    location = SimpleNamespace(tsi=tsi, min_officers_required=minimum, max_officers_allowed=cap)
    incidents = [SimpleNamespace(severity="critical")] if critical else []
    assert required_staffing(location, incidents) == expected


def test_field_sized_surplus_roster_does_not_fill_every_location_to_five():
    nodes = [node("Prime State")] + [node(f"B-{i}", demand=3 if i < 10 else 2) for i in range(28)]
    result = optimize(roster(161), nodes)
    assert result.status == "completed"
    for solution in result.top_solutions:
        counts = Counter(a["bottleneck_id"] for a in solution["assignments"])
        assert counts["Prime State"] == 2
        assert counts == {b["id"]: b["staffing_target"] for b in nodes}
        assert len(solution["assignments"]) == 68
        assert solution["reserve_officers"] == 93
        assert solution["resource_utilization"] == pytest.approx(68 / 161 * 100, abs=0.001)
        assert solution["staffing_efficiency"] == 100
        assert not solution["staffing_shortages"]
        assert not solution["constraints_violated"]
        assert len({a["officer_id"] for a in solution["assignments"]}) == 68


def test_different_congestion_and_incident_requirements_are_preserved():
    nodes = [node("Quiet", 2), node("Moderate", 3, 0.5),
             node("Severe", 5, 0.8), node("Critical incident", 3)]
    result = optimize(roster(20), nodes)
    for solution in result.top_solutions:
        assert Counter(a["bottleneck_id"] for a in solution["assignments"]) == {
            "Quiet": 2, "Moderate": 3, "Severe": 5, "Critical incident": 3}
        assert solution["reserve_officers"] == 7


def test_staffing_efficiency_rewards_demand_not_using_every_officer():
    engine = GeneticDeploymentOptimizer(seed=1)
    nodes = [node("Quiet")]
    officers = roster(8)
    sufficient = engine._evaluate_objectives([0, 0, -1, -1, -1, -1, -1, -1], officers, nodes, 1)
    excess = engine._evaluate_objectives([0, 0, 0, 0, 0, -1, -1, -1], officers, nodes, 1)
    assert sufficient["staffing_efficiency"] == 100
    assert excess["staffing_efficiency"] == 40
    assert sufficient["resource_utilization"] == 25
    assert excess["resource_utilization"] == 62.5
    assert engine._dominates(sufficient, excess)
    weights = engine._clamp_parameters({"resource_utilization_weight": 1, "tsi_weight": 0,
                                      "wif_weight": 0, "rpw_weight": 0})
    assert engine._evaluate([0, 0, -1, -1, -1, -1, -1, -1], officers, nodes, 1, weights)["fitness"] == 100
    violated, reasons = engine._check_constraints([0, 0, 0, -1, -1, -1, -1, -1], officers, nodes)
    assert violated and any("above_staffing_target" in reason for reason in reasons)


def test_officer_shortage_uses_available_roster_and_reports_unfilled_requirements():
    nodes = [node(str(i)) for i in range(3)]
    result = optimize(roster(4), nodes)
    for solution in result.top_solutions:
        counts = Counter(a["bottleneck_id"] for a in solution["assignments"])
        assert len(solution["assignments"]) == 4
        assert set(counts) == {b["id"] for b in nodes}
        assert all(count <= 2 for count in counts.values())
        assert sum(solution["staffing_shortages"].values()) == 2
        assert solution["reserve_officers"] == 0


def test_repair_returns_excess_to_reserve_and_uses_reserve_for_unfilled_demand():
    engine = GeneticDeploymentOptimizer(seed=1)
    chromosome = [0] * 5 + [-1] * 3
    engine._repair_staffing(chromosome, [node("Quiet", 2), node("Severe", 5, 0.8)])
    assert Counter(chromosome) == {0: 2, 1: 5, -1: 1}
    scarce = [0, 0, -1, -1]
    engine._repair_staffing(scarce, [node(str(i)) for i in range(3)])
    assert -1 not in scarce and set(scarce) == {0, 1, 2}


def test_legacy_snapshot_minimum_is_used_and_seed_is_repeatable():
    nodes = [node("Legacy")]
    nodes[0].pop("staffing_target")
    first = optimize(roster(8), nodes)
    second = optimize(roster(8), nodes)
    assert first.generation_fitness == second.generation_fitness
    assert first.top_solutions[0]["assignments"] == second.top_solutions[0]["assignments"]
    assert len(first.top_solutions[0]["assignments"]) == 2


@pytest.mark.django_db
def test_capture_inputs_separates_configured_minimum_demand_and_cap():
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from core.models import Bottleneck, Incident
    from optimization.tasks import capture_inputs
    quiet = Bottleneck.objects.create(id="QUIET", name="Quiet", latitude=10.72, longitude=122.56,
                                     tsi=0.33, min_officers_required=2, max_officers_allowed=5)
    moderate = Bottleneck.objects.create(id="MODERATE", name="Moderate", latitude=10.72, longitude=122.56,
                                        tsi=0.5, min_officers_required=2, max_officers_allowed=5)
    Bottleneck.objects.create(id="SEVERE", name="Severe", latitude=10.72, longitude=122.56,
                              tsi=0.8, min_officers_required=2, max_officers_allowed=5)
    reporter = get_user_model().objects.create_user(username="staffing-test")
    Incident.objects.create(bottleneck=moderate, incident_type="collision", severity="critical",
                            status="active", timestamp=timezone.now(), reported_by=reporter)
    _, nodes, _ = capture_inputs({"shift": "afternoon"})
    by_id = {b["id"]: b for b in nodes}
    assert by_id[quiet.id]["staffing_target"] == 2
    assert by_id[moderate.id]["staffing_target"] == 4
    assert by_id["SEVERE"]["staffing_target"] == 5
    assert all(b["configured_min_officers_required"] == 2 and b["max_officers_allowed"] == 5 for b in nodes)
    assert all(b["min_officers_required"] == b["staffing_target"] for b in nodes)
