"""Only a supplied complete planning position establishes its recording time."""
from datetime import datetime, timezone as datetime_timezone
from unittest.mock import patch

import pytest

from core.models import Officer
from core.serializers import OfficerSerializer


pytestmark = pytest.mark.django_db
RECORDED = datetime(2026, 10, 20, 2, 0, tzinfo=datetime_timezone.utc)
UPDATED = datetime(2026, 10, 21, 2, 0, tzinfo=datetime_timezone.utc)


def officer(**kwargs):
    return Officer.objects.create(
        name="Planning officer", badge_number="LOCATION-1", shift="morning", **kwargs
    )


def save_serializer(*, instance=None, data):
    serializer = OfficerSerializer(instance, data=data, partial=instance is not None)
    assert serializer.is_valid(), serializer.errors
    with patch("core.serializers.timezone.now", return_value=UPDATED):
        saved = serializer.save()
    saved.refresh_from_db()
    return saved, serializer


def test_legacy_model_coordinates_do_not_get_an_observation_timestamp():
    row = officer(current_latitude=10.7, current_longitude=122.6)
    assert row.current_location_recorded_at is None
    assert OfficerSerializer(row).data["current_location_recorded_at"] is None


@pytest.mark.parametrize("position", [
    {"current_latitude": 10.7, "current_longitude": 122.6},
    {"current_latitude": 0, "current_longitude": 0},
])
def test_create_supplied_complete_pair_gets_server_recorded_time(position):
    row, _ = save_serializer(data={
        "name": "New officer", "badge_number": "NEW-1", "shift": "morning", **position,
    })
    assert row.current_location_recorded_at == UPDATED


@pytest.mark.parametrize("position", [
    {}, {"current_latitude": 10.7}, {"current_longitude": 122.6},
    {"current_latitude": None, "current_longitude": 122.6},
])
def test_create_missing_or_incomplete_pair_has_no_recorded_time(position):
    row, _ = save_serializer(data={
        "name": "New officer", "badge_number": "NEW-1", "shift": "morning", **position,
    })
    assert row.current_location_recorded_at is None


@pytest.mark.parametrize("data", [
    {"name": "Renamed"}, {"skills": ["first_aid"]}, {"status": "unavailable"},
])
def test_unrelated_edits_never_refresh_existing_location_time(data):
    row = officer(current_latitude=10.7, current_longitude=122.6,
                  current_location_recorded_at=RECORDED)
    row, _ = save_serializer(instance=row, data=data)
    assert row.current_location_recorded_at == RECORDED


def test_unrelated_edit_cannot_make_legacy_coordinates_current():
    row = officer(current_latitude=10.7, current_longitude=122.6)
    row, _ = save_serializer(instance=row, data={"name": "Renamed"})
    assert row.current_location_recorded_at is None


def test_partial_coordinate_update_uses_existing_other_coordinate():
    row = officer(current_latitude=10.7, current_longitude=122.6,
                  current_location_recorded_at=RECORDED)
    row, _ = save_serializer(instance=row, data={"current_latitude": 10.8})
    assert (row.current_latitude, row.current_longitude) == (10.8, 122.6)
    assert row.current_location_recorded_at == UPDATED


def test_completing_a_previous_partial_pair_establishes_recorded_time():
    row = officer(current_latitude=10.7)
    row, _ = save_serializer(instance=row, data={"current_longitude": 122.6})
    assert row.current_location_recorded_at == UPDATED


@pytest.mark.parametrize("data", [
    {"current_latitude": None}, {"current_longitude": None},
    {"current_latitude": None, "current_longitude": None},
])
def test_clearing_either_coordinate_clears_recorded_time(data):
    row = officer(current_latitude=10.7, current_longitude=122.6,
                  current_location_recorded_at=RECORDED)
    row, _ = save_serializer(instance=row, data=data)
    assert row.current_location_recorded_at is None


@pytest.mark.parametrize("submitted", [None, "2026-10-22T02:00:00Z"])
def test_clients_cannot_spoof_or_clear_server_timestamp_without_coordinates(submitted):
    row = officer(current_latitude=10.7, current_longitude=122.6,
                  current_location_recorded_at=RECORDED)
    row, serializer = save_serializer(instance=row, data={"current_location_recorded_at": submitted})
    assert "current_location_recorded_at" not in serializer.validated_data
    assert row.current_location_recorded_at == RECORDED


def test_supplied_coordinates_ignore_client_timestamp_and_use_server_time():
    row = officer()
    row, _ = save_serializer(instance=row, data={
        "current_latitude": 10.7, "current_longitude": 122.6,
        "current_location_recorded_at": "2026-10-22T02:00:00Z",
    })
    assert row.current_location_recorded_at == UPDATED


@pytest.mark.parametrize("value", ["NaN", "Infinity", 91])
def test_invalid_coordinates_cannot_establish_a_fresh_timestamp(value):
    row = officer(current_latitude=10.7, current_longitude=122.6,
                  current_location_recorded_at=RECORDED)
    serializer = OfficerSerializer(row, data={"current_latitude": value}, partial=True)
    assert not serializer.is_valid()
    row.refresh_from_db()
    assert row.current_location_recorded_at == RECORDED
