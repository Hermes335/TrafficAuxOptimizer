"""Missing coordinates do not invent a position or overwrite a supplied origin."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from core.officer_locations import (
    MISSING_LOCATION_DISTANCE_KM,
    officer_coordinates,
    valid_coordinates,
)


def test_missing_location_distance_matches_the_reference_runs():
    assert MISSING_LOCATION_DISTANCE_KM == 3.0


@pytest.mark.parametrize("latitude,longitude", [
    (None, None), (None, 122.58), (10.68, None),
    (float("nan"), 122.58), (10.68, float("inf")),
    (91, 122.58), (10.68, -181), ("unknown", 122.58),
    (True, 122.58), (10.68, False), ([], 122.58),
])
def test_unknown_or_invalid_pairs_remain_unknown(latitude, longitude):
    row = {"current_latitude": latitude, "current_longitude": longitude}
    assert valid_coordinates(latitude, longitude) is False
    assert officer_coordinates(row) is None
    assert officer_coordinates(SimpleNamespace(**row)) is None


@pytest.mark.parametrize("latitude,longitude", [
    (10.72, 122.56), (0, 0), (-90, -180), (90, 180), ("10.72", "122.56"),
])
def test_a_valid_saved_or_served_position_is_preserved(latitude, longitude):
    row = {"current_latitude": latitude, "current_longitude": longitude,
           "initial_position": {"source": "served_post"}}
    original = deepcopy(row)
    assert valid_coordinates(latitude, longitude) is True
    assert officer_coordinates(row) == (float(latitude), float(longitude))
    assert officer_coordinates(SimpleNamespace(**row)) == (float(latitude), float(longitude))
    assert row == original


def test_unknown_origin_does_not_create_position_or_departure_records():
    row = {"id": 1}
    assert officer_coordinates(row) is None
    assert row == {"id": 1}
