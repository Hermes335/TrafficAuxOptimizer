from copy import deepcopy
from datetime import datetime, timedelta
from itertools import product
from math import floor, inf
from random import Random

import pytest

from core.skills import preferred_skills_for, skill_preference_score
from optimization.engine import GeneticDeploymentOptimizer
from optimization.matching import match_officers
from optimization.scheduling import run_schedule


START = datetime.fromisoformat("2099-01-01T06:00:00+08:00")


def node(key, kind="other", demand=1):
    value = {"id": key, "name": key, "bottleneck_type": kind, "latitude": 10.72,
             "longitude": 122.56, "tsi": 0, "road_priority_weight": 1,
             "min_officers_required": demand, "staffing_target": demand, "max_officers_allowed": 4}
    value["preferred_skills"] = preferred_skills_for(value)
    return value


def officer(key, skills=()):
    return {"id": key, "badge_number": f"TEST-{key}", "skills": list(skills)}


class TravelMatrix:
    def __init__(self, minutes=None):
        self.minutes = minutes or {}

    def _distance_km(self, origin, destination):
        return self.minutes.get((origin["id"], destination["id"]), 3)*28/60


def proposed(*pairs):
    return [{"officer_id": who, "bottleneck_id": where} for who, where in pairs]


def pairs(rows):
    return {(row["officer_id"], row["bottleneck_id"]) for row in rows}


def test_global_matching_preserves_a_specialist_while_filling_the_neutral_post():
    people = [officer(1, ["school_crossing"]), officer(2)]
    nodes = [node("A", "school_zone"), node("B")]
    for reverse in (False, True):
        result = match_officers(TravelMatrix(), people[::-1] if reverse else people,
            nodes, proposed((1, "B"), (2, "A"))[::-1] if reverse else proposed((1, "B"), (2, "A")))
        assert pairs(result) == {(1, "A"), (2, "B")}
        assert next(row for row in result if row["officer_id"] == 1)["skill_match"]["matched_skills"] == ["school_crossing"]


def test_scarce_multiskilled_officer_goes_to_the_post_without_another_match():
    nodes = [node("A", "school_zone"), node("B")]
    nodes[1]["preferred_skills"] = ["incident_response", "first_aid"]
    result = match_officers(TravelMatrix(), [officer(1, ["first_aid", "school_crossing"]),
        officer(2, ["school_crossing"])], nodes, proposed((1, "A"), (2, "B")))
    assert pairs(result) == {(1, "B"), (2, "A")}


def test_maximum_filled_posts_precedes_skill_preference():
    nodes = [node("A", "school_zone"), node("B")]
    result = match_officers(TravelMatrix({(2, "B"): inf}),
        [officer(1, ["school_crossing"]), officer(2)], nodes, proposed((1, "A"), (2, "B")))
    assert pairs(result) == {(1, "B"), (2, "A")}


def test_no_skill_records_do_not_deprioritize_a_post_with_preferences_under_scarcity():
    result = match_officers(TravelMatrix(), [officer(1)], [node("A", "school_zone"), node("B")],
        proposed((1, "A"), (2, "B")))
    assert pairs(result) == {(1, "A")}


@pytest.mark.parametrize("specialist_minutes,expected", [(3.3, 2), (3.6, 1)])
def test_skills_prefer_comparable_travel_but_not_a_higher_minute_cost(specialist_minutes, expected):
    result = match_officers(TravelMatrix({(1, "A"): 3.1, (2, "A"): specialist_minutes}),
        [officer(1), officer(2, ["school_crossing"])], [node("A", "school_zone")], proposed((1, "A")))
    assert result[0]["officer_id"] == expected


def test_continuity_and_travel_gaps_take_priority_over_skills():
    people = [officer(1), officer(2, ["school_crossing"])]
    continuing = {1: {"node_id": "A", "latitude": 10.72, "longitude": 122.56, "end": START}}
    result = match_officers(TravelMatrix(), people, [node("A", "school_zone")], proposed((2, "A")), continuing, START)
    assert pairs(result) == {(1, "A")}
    no_travel_gap = {2: {"node_id": "B", "latitude": 10.72, "longitude": 122.56, "end": START}}
    result = match_officers(TravelMatrix(), people, [node("A", "school_zone")], proposed((2, "A")), no_travel_gap, START)
    assert pairs(result) == {(1, "A")}


def test_small_exhaustive_oracle_validates_global_lexicographic_optimum():
    rng = Random(920)
    nodes = [node("A", "school_zone"), node("B", "intersection"), node("C")]
    people = [officer(1, ["school_crossing"]), officer(2, ["intersection_management"]), officer(3)]
    proposal = proposed((1, "B"), (2, "C"), (3, "A"))
    original = pairs(proposal)
    for _ in range(30):
        costs = {(person["id"], location["id"]): rng.choice([0.1, 0.3, 1.2, 3.9, inf]) for person in people for location in nodes}

        def objective(assignment):
            terms = []
            for i, j in enumerate(assignment):
                if j < 0:
                    continue
                who, location = people[i], nodes[j]
                minutes = costs[who["id"], location["id"]]
                if minutes == inf:
                    return None
                terms.append((1, floor(minutes+0.5), -skill_preference_score(who["skills"], location["preferred_skills"]),
                    round(minutes*1000), int((who["id"], location["id"]) not in original), i))
            return (-len(terms), *(sum(term[k] for term in terms) for k in range(6)))

        possibilities = [assignment for assignment in product(range(-1, 3), repeat=3)
                         if len([j for j in assignment if j >= 0]) == len({j for j in assignment if j >= 0})]
        expected = min(value for choice in possibilities if (value := objective(choice)) is not None)
        result = match_officers(TravelMatrix(costs), people[::-1], nodes, proposal[::-1])
        actual = {row["officer_id"]: next(j for j, location in enumerate(nodes) if location["id"] == row["bottleneck_id"]) for row in result}
        assert objective(tuple(actual.get(person["id"], -1) for person in people)) == expected


def test_static_results_score_and_explain_the_final_skill_matched_assignments():
    people = [officer(1), officer(2, ["School Zone"])]
    nodes = [node("A", "school_zone")]
    engine = GeneticDeploymentOptimizer(seed=7)
    parameters = {"population_size": 50, "generations": 50}
    result = engine.run(people, deepcopy(nodes), parameters)
    assert result.status == "completed"
    assert result.best_fitness == result.top_solutions[0]["fitness"]
    for solution in result.top_solutions:
        assert solution["assignments"][0]["officer_id"] == 2
        assert solution["assignments"][0]["skill_match"]["status"] == "matched"
        metrics = engine._evaluate([-1, 0], people, nodes, 1, engine._clamp_parameters(parameters))
        assert solution["fitness"] == metrics["fitness"]
        assert solution["reserve_officers"] == 1


def test_timed_breaks_and_zero_demand_are_preserved_with_skilled_officers():
    people = [officer(1, ["school_crossing"]), officer(2)]
    people[0]["time_blocks"] = [{"start_time": START.isoformat(), "end_time": (START+timedelta(minutes=30)).isoformat(), "kind": "break"}]
    location = node("A", "school_zone")
    location["staffing_windows"] = [{"start_time": (START+timedelta(minutes=i*30)).isoformat(),
        "end_time": (START+timedelta(minutes=(i+1)*30)).isoformat(), "required": need, "reason": "Recorded period"}
        for i, need in enumerate([1, 0, 1])]
    result = run_schedule(officers=people, bottlenecks=[location], parameters={"population_size": 50, "generations": 50})
    for solution in result.top_solutions:
        assert solution["time_periods"][1]["assigned_officers"] == 0
        assert all(row["officer_id"] == 2 for row in solution["assignments"])
        assert all(row["skill_match"]["status"] == "no_recorded_match" for row in solution["assignments"])
        assert all(not (datetime.fromisoformat(row["start_time"]) < START+timedelta(minutes=60) and
                        datetime.fromisoformat(row["end_time"]) > START+timedelta(minutes=30)) for row in solution["assignments"])
        assert not solution["staffing_shortages"]


def test_timed_metrics_keep_the_arrival_estimate_for_a_continuous_assignment():
    location = node("A", "school_zone")
    location["staffing_windows"] = [{"start_time": (START+timedelta(minutes=i*30)).isoformat(),
        "end_time": (START+timedelta(minutes=(i+1)*30)).isoformat(), "required": 1, "reason": "School"} for i in range(2)]
    result = run_schedule(officers=[officer(1, ["school_crossing"])], bottlenecks=[location],
                          parameters={"population_size": 50, "generations": 50})
    assert result.top_solutions[0]["avg_response_time"] == pytest.approx(3/28*60, abs=0.001)
    assert result.best_fitness == result.top_solutions[0]["fitness"]
    assert result.pareto_curve_data[0]["inverse_response_time"] == pytest.approx(100-result.top_solutions[0]["avg_response_time"]*2)


@pytest.mark.django_db
def test_snapshot_captures_normalized_skills_and_linked_incident_preferences():
    from django.utils import timezone
    from core.models import Bottleneck, Incident, Officer
    from optimization.tasks import capture_inputs

    person = Officer.objects.create(name="Officer", badge_number="SKILL-1", shift="morning", skills=["Traffic Control", "First-Aid"])
    location = Bottleneck.objects.create(id="SKILL-A", name="A", latitude=10.72, longitude=122.56, bottleneck_type="intersection")
    Incident.objects.create(bottleneck=location, incident_type="collision", severity="minor", description="Linked", status="active", timestamp=timezone.now())
    officers, nodes, _ = capture_inputs({"shift": "morning", "operational_date": "2099-01-01"})
    assert next(row for row in officers if row["id"] == person.pk)["skills"] == ["traffic_control", "first_aid"]
    assert nodes[0]["preferred_skills"] == ["incident_response", "first_aid", "intersection_management", "traffic_control"]
