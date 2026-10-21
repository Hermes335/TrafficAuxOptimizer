"""HQ assumptions do not overwrite a supplied planning position."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from core.officer_locations import (
    TTMO_HQ_LATITUDE,
    TTMO_HQ_LONGITUDE,
    TTMO_HQ_NAME,
    officer_coordinates,
    valid_coordinates,
)


HQ = (10.689327, 122.581486)


def test_shared_hq_coordinates_match_the_requested_office():
    assert (TTMO_HQ_LATITUDE, TTMO_HQ_LONGITUDE) == HQ
    assert TTMO_HQ_NAME == "TTMO HQ"


@pytest.mark.parametrize("latitude,longitude", [
    (None, None), (None, 122.58), (10.68, None),
    (float("nan"), 122.58), (10.68, float("inf")),
    (91, 122.58), (10.68, -181), ("unknown", 122.58),
    (True, 122.58), (10.68, False), ([], 122.58),
])
def test_unknown_or_invalid_pairs_use_the_complete_hq_position(latitude, longitude):
    row = {"current_latitude": latitude, "current_longitude": longitude}
    assert valid_coordinates(latitude, longitude) is False
    assert officer_coordinates(row) == HQ
    assert officer_coordinates(SimpleNamespace(**row)) == HQ


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


def test_hq_resolution_does_not_create_position_or_departure_records():
    row = {"id": 1}
    assert officer_coordinates(row) == HQ
    assert row == {"id": 1}
