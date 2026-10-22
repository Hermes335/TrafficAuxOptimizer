"""Saved coordinates persist until changed; missing origins never become HQ."""
import csv
from io import StringIO
from datetime import timedelta
from unittest.mock import patch

import pytest

from core.models import Deployment, Officer
from core.officer_locations import MISSING_LOCATION_DISTANCE_KM
from core.tests_review_fixes import schedule
from optimization.planning import capture_starting_locations
from optimization.engine import GeneticDeploymentOptimizer
from optimization.readiness import build_readiness
from optimization.tasks import capture_inputs, run_optimization


pytestmark = pytest.mark.django_db


def params(s, day=None, **extra):
    return {"shift": "morning", "mode": "operational", "operational_date": str(day or s.day), **extra}


def person(s, index=1):
    return s.officers[index]


def captured(s, now, index=1, **extra):
    officers, _, _ = capture_inputs(params(s, **extra), now=now)
    return next(row for row in officers if row["id"] == person(s, index).pk)


def coordinates(row):
    return row["current_latitude"], row["current_longitude"]


@pytest.mark.parametrize("recorded", ["legacy", "yesterday", "future"])
def test_saved_coordinates_remain_usable_without_a_daily_timestamp_gate(schedule, recorded):
    s = schedule
    now = s.start+timedelta(minutes=1)
    timestamp = {"legacy": None, "yesterday": now-timedelta(days=1), "future": now+timedelta(minutes=1)}[recorded]
    Officer.objects.filter(pk=person(s).pk).update(current_latitude=10.75, current_longitude=122.59,
        current_location_recorded_at=timestamp)
    row = captured(s, now)
    assert coordinates(row) == (10.75, 122.59)
    assert row["starting_location"]["source"] == "saved_coordinates" and not row["starting_location"]["assumed"]
    assert "initial_position" not in row
    person(s).refresh_from_db()
    assert (person(s).current_latitude, person(s).current_longitude) == (10.75, 122.59)
    assert person(s).current_location_recorded_at == timestamp


def test_saved_coordinates_do_not_reset_on_the_next_operational_day(schedule):
    s = schedule
    now = s.start+timedelta(minutes=1)
    # Crossing either the UTC or Manila date must not discard saved coordinates.
    recorded = now-timedelta(minutes=30)
    Officer.objects.filter(pk=person(s).pk).update(current_latitude=10.75, current_longitude=122.59,
        current_location_recorded_at=recorded)
    row = captured(s, now)
    assert coordinates(row) == (10.75, 122.59)
    assert row["starting_location"]["source"] == "saved_coordinates"
    tomorrow = captured(s, now+timedelta(days=1), day=s.day+timedelta(days=1))
    assert coordinates(tomorrow) == (10.75, 122.59)
    assert tomorrow["starting_location"]["source"] == "saved_coordinates"
    assert tomorrow["starting_location"]["operational_date"] == str(s.day+timedelta(days=1))


def test_recorded_post_wins_over_saved_coordinates_and_shadow_does_not_invent_a_post(schedule):
    s = schedule
    now = s.start+timedelta(hours=1)
    Officer.objects.filter(pk=person(s, 0).pk).update(current_latitude=10.75, current_longitude=122.59,
        current_location_recorded_at=now-timedelta(minutes=30))
    row = captured(s, now, index=0)
    assert coordinates(row) == (s.node.latitude, s.node.longitude)
    assert row["starting_location"]["source"] == "served_post"
    shadow = captured(s, now, index=0, mode="shadow", session_id="recorded-origins-check")
    assert coordinates(shadow) == (10.75, 122.59)
    assert shadow["starting_location"]["source"] == "saved_coordinates"
    assert "initial_position" not in shadow


def test_previous_day_post_is_not_reused_as_todays_start(schedule):
    s = schedule
    now = s.start+timedelta(minutes=1)
    # A previous-day deployment is not a recent post for this operational day.
    Deployment.objects.create(officer=person(s), bottleneck=s.node, shift="morning",
        start_time=s.start-timedelta(hours=8), end_time=now+timedelta(minutes=1), status="completed")
    row = captured(s, now)
    assert coordinates(row) == (None, None)
    assert row["starting_location"]["distance_km"] == MISSING_LOCATION_DISTANCE_KM
    assert "initial_position" not in row


def test_date_normalization_preserves_snapshot_json_and_todays_origin_when_repeated(schedule):
    s = schedule
    now = s.start+timedelta(minutes=1)
    row = {"id": 1, "current_latitude": 10.75, "current_longitude": 122.59,
           "current_location_recorded_at": (now-timedelta(minutes=30)).isoformat()}
    capture_starting_locations([row], params(s), now)
    assert coordinates(row) == (10.75, 122.59)
    assert isinstance(row["current_location_recorded_at"], str)
    capture_starting_locations([row], params(s, day=s.day+timedelta(days=1)), now+timedelta(days=1))
    assert coordinates(row) == (10.75, 122.59)


def test_undated_and_older_saved_origins_keep_real_assignment_cost_differences():
    from datetime import datetime

    now = datetime.fromisoformat("2026-10-22T06:00:00+08:00")
    people = [
        {"id": 1, "current_latitude": 10.72, "current_longitude": 122.56},
        {"id": 2, "current_latitude": 10.75, "current_longitude": 122.59,
         "current_location_recorded_at": "2026-10-20T06:00:00+08:00"},
    ]
    capture_starting_locations(people, {"operational_date": "2026-10-22"}, now)
    nodes = [{"id": "A", "latitude": 10.72, "longitude": 122.56},
             {"id": "B", "latitude": 10.75, "longitude": 122.59}]
    matrix = GeneticDeploymentOptimizer._precompute_distance_matrix(people, nodes)
    assert matrix[0][0] == matrix[1][1] == 0
    assert matrix[0][1] > 1 and matrix[1][0] > 1
    assert all(row["starting_location"]["source"] == "saved_coordinates" for row in people)


def test_worker_records_legacy_distance_policy_without_roster_or_assignment_changes(schedule):
    s = schedule
    now = s.start-timedelta(minutes=30)
    before = list(Deployment.objects.values())
    s.run.status = "queued"
    s.run.parameters = params(s, population_size=50, generations=50)
    s.run.save()
    with patch("django.utils.timezone.now", return_value=now):
        ready = build_readiness(s.run.parameters)
        assert ready["summary"]["assumed_distance_origins"] == 3
        assert "assumed_hq_origins" not in ready["summary"]
        assert any("assumed 3 km" in warning for warning in ready["warnings"])
        run_optimization(s.run.run_id)
    s.run.refresh_from_db()
    assert s.run.status == "completed"
    snapshot = s.run.result_data["input_snapshot"]
    model = snapshot["travel_time_model"]
    assert model["initial_location_policy"] == "recorded_coordinates_then_distance_estimate" and model["origin_reset"] == "none"
    assert "default_origin" not in model
    assert model["missing_officer_location_distance_km"] == 3.0
    assert all(row["starting_location"]["source"] == "distance_estimate" for row in snapshot["officers"])
    assert all(coordinates(row) == (None, None) for row in snapshot["officers"])
    assert not any("initial_position" in row or "travel_ready_times" in row for row in snapshot["officers"])
    assert list(Deployment.objects.values()) == before
    assert not Officer.objects.filter(current_location_recorded_at__isnull=False).exists()
    response = s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    assert response.status_code == 200
    exported = list(csv.DictReader(StringIO(response.content.decode())))
    assert exported
    for row in exported:
        assert row["Initial_Location_Policy"] == "recorded_coordinates_then_distance_estimate"
        assert row["Origin_Reset"] == "none"
        assert row["Default_Origin_Name"] == ""
        assert row["Default_Origin_Latitude"] == row["Default_Origin_Longitude"] == ""


def test_legacy_export_does_not_retroactively_claim_hq_origins(schedule):
    s = schedule
    s.run.result_data["input_snapshot"]["travel_time_model"] = {"missing_officer_location_distance_km": 3}
    s.run.save()
    response = s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    assert response.status_code == 200
    rows = list(csv.DictReader(StringIO(response.content.decode())))
    assert rows
    for row in rows:
        for column in ("Initial_Location_Policy", "Origin_Reset", "Default_Origin_Name",
                       "Default_Origin_Latitude", "Default_Origin_Longitude"):
            assert row[column] == ""
