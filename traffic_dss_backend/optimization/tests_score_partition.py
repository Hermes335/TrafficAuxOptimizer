"""Assignment scores must not improve merely because a time window was split."""
from copy import deepcopy
from datetime import datetime, timedelta

import pytest
from geopy.distance import geodesic

from core.officer_locations import MISSING_LOCATION_DISTANCE_KM
from optimization.scheduling import run_schedule


START = datetime.fromisoformat("2099-01-01T06:00:00+08:00")
PARAMETERS = {"population_size": 50, "generations": 50}


def estimated_travel_minutes():
    return MISSING_LOCATION_DISTANCE_KM/28*60


def person():
    return {"id": 1, "badge_number": "PARTITION-1", "skills": [],
            "current_latitude": None, "current_longitude": None}


def location(key, spans, latitude=10.72):
    return {
        "id": key, "name": key, "latitude": latitude, "longitude": 122.56,
        "tsi": 0, "road_priority_weight": 1, "min_officers_required": 1,
        "max_officers_allowed": 1, "staffing_target": 1,
        "staffing_windows": [{
            "start_time": (START+timedelta(minutes=left)).isoformat(),
            "end_time": (START+timedelta(minutes=right)).isoformat(),
            "required": required, "reason": "Recorded staffing",
        } for left, right, required in spans],
    }


def run(people, nodes):
    result = run_schedule(officers=deepcopy(people), bottlenecks=deepcopy(nodes),
                          parameters=PARAMETERS, seed=9)
    assert result.status == "completed"
    for solution in result.top_solutions:
        breakdown = solution["score_breakdown"]
        explained = (sum(row["contribution"] for row in breakdown["components"])
                     + breakdown["incident_bonus"]["contribution"]
                     + breakdown["constraint_adjustment"] + breakdown["rounding_adjustment"])
        assert explained == pytest.approx(solution["fitness"])
        assert breakdown["total"] == pytest.approx(solution["fitness"])
    return result


@pytest.mark.parametrize("split", ["staffing_window", "travel_retry"])
def test_identical_continuous_assignment_has_the_same_score_with_an_extra_boundary(split):
    whole = run([person()], [location("A", [(0, 480, 1)])])
    officer = person()
    spans = [(0, 60, 1), (60, 480, 1)] if split == "staffing_window" else [(0, 480, 1)]
    if split == "travel_retry":
        officer["travel_ready_times"] = [(START+timedelta(hours=1)).isoformat()]
    divided = run([officer], [location("A", spans)])
    assert divided.generation_fitness == whole.generation_fitness
    assert divided.best_fitness == pytest.approx(whole.best_fitness)
    for actual, baseline in zip(divided.top_solutions, whole.top_solutions):
        assert actual["assignments"] == baseline["assignments"]
        assert actual["avg_response_time"] == pytest.approx(baseline["avg_response_time"])
        assert actual["fitness"] == pytest.approx(baseline["fitness"])
        for row, expected in zip(actual["score_breakdown"]["components"], baseline["score_breakdown"]["components"]):
            assert row["score"] == pytest.approx(expected["score"])
            assert row["weight"] == expected["weight"]
            assert row["contribution"] == pytest.approx(expected["contribution"])
        assert actual["avg_response_time"] == pytest.approx(estimated_travel_minutes(), abs=0.001)


def test_a_real_post_change_uses_the_last_post_as_its_arrival_origin():
    nodes = [
        location("A", [(0, 60, 1), (60, 180, 0)]),
        location("B", [(0, 75, 0), (75, 120, 1), (120, 180, 1)], latitude=10.745),
    ]
    result = run([person()], nodes)
    transfer_minutes = geodesic((nodes[0]["latitude"], nodes[0]["longitude"]),
                               (nodes[1]["latitude"], nodes[1]["longitude"])).km/28*60
    expected = round(estimated_travel_minutes(), 3)*(60/180) + round(transfer_minutes, 3)*(105/180)
    for solution in result.top_solutions:
        assert [(row["bottleneck_id"], row["start_time"], row["end_time"]) for row in solution["assignments"]] == [
            ("A", START.isoformat(), (START+timedelta(hours=1)).isoformat()),
            ("B", (START+timedelta(minutes=75)).isoformat(), (START+timedelta(hours=3)).isoformat()),
        ]
        assert solution["avg_response_time"] == pytest.approx(expected)
        assert transfer_minutes < 15
        assert not solution["constraints_violated"]


@pytest.mark.parametrize("gap", ["break", "zero_demand"])
def test_a_new_assignment_episode_resets_its_arrival_origin_after_a_gap(gap):
    officer = person()
    spans = [(0, 30, 1), (30, 60, 1), (60, 120, 0 if gap == "zero_demand" else 1),
             (120, 150, 1), (150, 180, 1)]
    if gap == "break":
        officer["time_blocks"] = [{
            "start_time": (START+timedelta(hours=1)).isoformat(),
            "end_time": (START+timedelta(hours=2)).isoformat(), "kind": "break",
        }]
    result = run([officer], [location("A", spans)])
    for solution in result.top_solutions:
        assert [(row["start_time"], row["end_time"]) for row in solution["assignments"]] == [
            (START.isoformat(), (START+timedelta(hours=1)).isoformat()),
            ((START+timedelta(hours=2)).isoformat(), (START+timedelta(hours=3)).isoformat()),
        ]
        # Initial arrival retains its estimate through 06:30. Returning after the
        # gap starts a new episode from the known last post, with zero travel.
        assert solution["avg_response_time"] == pytest.approx(round(estimated_travel_minutes(), 3)/3)
        assert solution["constraints_violated"] is (gap == "break")
