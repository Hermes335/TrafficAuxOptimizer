"""Scalar and cached travel scoring must use the same planning origin."""
from copy import deepcopy

import pytest
from geopy.distance import geodesic

from optimization.engine import GeneticDeploymentOptimizer


HQ = (10.689327, 122.581486)


@pytest.mark.parametrize("officer,origin", [
    ({"id": 1}, HQ),
    ({"id": 1, "current_latitude": 10.75, "current_longitude": None}, HQ),
    ({"id": 1, "current_latitude": float("nan"), "current_longitude": 122.56}, HQ),
    ({"id": 1, "current_latitude": 10.72, "current_longitude": 122.56}, (10.72, 122.56)),
])
def test_scalar_and_matrix_distances_share_the_origin_without_mutating_inputs(officer, origin):
    nodes = [
        {"id": "HQ", "latitude": HQ[0], "longitude": HQ[1]},
        {"id": "POST", "latitude": 10.72, "longitude": 122.56},
    ]
    engine = GeneticDeploymentOptimizer(seed=7)
    original_keys = set(officer)
    distances = engine._precompute_distance_matrix([officer], nodes)
    for node, measured in zip(nodes, distances[0]):
        expected = geodesic(origin, (node["latitude"], node["longitude"])).km
        assert measured == pytest.approx(expected)
        assert engine._distance_km(officer, node) == pytest.approx(expected)
    assert set(officer) == original_keys
    assert "initial_position" not in officer


def test_default_origin_has_zero_travel_to_hq_and_destination_specific_travel():
    engine = GeneticDeploymentOptimizer(seed=3)
    nearby = {"latitude": HQ[0], "longitude": HQ[1]}
    farther = {"latitude": 10.75, "longitude": 122.56}
    assert engine._distance_km({}, nearby) == 0
    assert engine._distance_km({}, farther) > 1


def test_objective_evaluation_agrees_with_and_without_the_distance_cache():
    people = [{"id": 1}, {"id": 2, "current_latitude": 10.72, "current_longitude": 122.56}]
    nodes = [
        {"id": "HQ", "latitude": HQ[0], "longitude": HQ[1], "tsi": 0.2,
         "road_priority_weight": 1, "staffing_target": 1, "min_officers_required": 1},
        {"id": "POST", "latitude": 10.73, "longitude": 122.55, "tsi": 0.4,
         "road_priority_weight": 1, "staffing_target": 1, "min_officers_required": 1},
    ]
    engine = GeneticDeploymentOptimizer(seed=8)
    uncached = engine._evaluate_objectives([0, 1], people, deepcopy(nodes), 1.2, {})
    cached = engine._evaluate_objectives([0, 1], people, deepcopy(nodes), 1.2, {},
        engine._precompute_distance_matrix(people, nodes))
    assert cached == uncached
