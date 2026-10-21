"""Readiness stays advisory except for starts with no usable planning problem."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from core.models import AuditLog, Bottleneck, Deployment, Officer, OfficerTimeBlock, OptimizationRun, TrafficData, WeatherData
from core.operational_time import MANILA, shift_window
from optimization.readiness import build_readiness


pytestmark = pytest.mark.django_db
NOW = datetime(2099, 1, 5, 7, tzinfo=MANILA)


@pytest.fixture(autouse=True)
def stable_clock():
    with patch("optimization.readiness.timezone.now", return_value=NOW):
        yield


@pytest.fixture
def inputs():
    user = get_user_model().objects.create_user(username="readiness-lead", password="test-password")
    user.groups.add(Group.objects.get(name="supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)
    node = Bottleneck.objects.create(id="READY-A", name="Readiness junction", latitude=10.72, longitude=122.56,
                                    min_officers_required=1, max_officers_allowed=3)
    officer = Officer.objects.create(name="Ready officer", badge_number="READY-1", shift="morning",
                                    current_latitude=node.latitude, current_longitude=node.longitude)
    traffic = TrafficData.objects.create(bottleneck=node, timestamp=NOW, observed_at=NOW, data_status="live",
                                        source="tomtom", traffic_severity_index=0)
    weather = WeatherData.objects.create(timestamp=NOW, observed_at=NOW, data_status="live", source="openweather")
    params = {"shift": "morning", "operational_date": str((NOW + timedelta(days=1)).date()), "mode": "operational"}
    return SimpleNamespace(client=client, user=user, node=node, officer=officer, traffic=traffic, weather=weather, params=params)


def test_readiness_is_supervisor_only_and_does_not_create_runs(inputs):
    assert APIClient().post("/api/optimization/readiness/", inputs.params, format="json").status_code == 401
    dispatcher = get_user_model().objects.create_user(username="readiness-dispatcher")
    client = APIClient()
    client.force_authenticate(user=dispatcher)
    assert client.post("/api/optimization/readiness/", inputs.params, format="json").status_code == 403
    before = (OptimizationRun.objects.count(), AuditLog.objects.count(), Deployment.objects.count())
    response = inputs.client.post("/api/optimization/readiness/", inputs.params, format="json")
    assert response.status_code == 200, response.data
    assert response.data["ready"] is True
    assert response.data["warnings"] == [] and response.data["blockers"] == []
    assert response.data["checked_at"] == NOW.isoformat()
    assert response.data["summary"] == {
        "active_locations": 1, "eligible_officers": 1, "missing_officer_locations": 0,
        "peak_required_officers": 1, "max_staffing_shortage": 0,
    }
    assert response.data["traffic"][0]["age_seconds"] == 0
    assert before == (OptimizationRun.objects.count(), AuditLog.objects.count(), Deployment.objects.count())


def test_readiness_validates_the_same_parameters_as_start(inputs):
    response = inputs.client.post("/api/optimization/readiness/", {**inputs.params, "shift": "night"}, format="json")
    assert response.status_code == 400 and "shift" in response.data
    response = inputs.client.post("/api/optimization/readiness/", {**inputs.params, "mode": "shadow"}, format="json")
    assert response.status_code == 400 and "session_id" in response.data


def test_worker_readiness_uses_the_exact_captured_inputs(inputs):
    from optimization.tasks import capture_inputs

    captured = capture_inputs(inputs.params, now=NOW)
    TrafficData.objects.filter(pk=inputs.traffic.pk).update(observed_at=NOW-timedelta(days=2))
    Bottleneck.objects.filter(pk=inputs.node.pk).update(min_officers_required=3)
    with patch("optimization.tasks.capture_inputs", side_effect=AssertionError("Snapshot must not be recaptured")):
        readiness = build_readiness(inputs.params, now=NOW, captured=captured)
    assert readiness["traffic"][0]["age_seconds"] == 0
    assert readiness["summary"]["peak_required_officers"] == 1
    assert readiness["warnings"] == []


def test_stale_live_labels_and_missing_locations_are_warnings_not_start_blockers(inputs):
    TrafficData.objects.filter(pk=inputs.traffic.pk).update(observed_at=NOW-timedelta(days=2), is_stale=False)
    WeatherData.objects.filter(pk=inputs.weather.pk).update(observed_at=NOW-timedelta(days=2), is_stale=False)
    Officer.objects.filter(pk=inputs.officer.pk).update(current_latitude=None, current_longitude=None)
    readiness = build_readiness(inputs.params)
    assert readiness["ready"] is True
    assert readiness["traffic"][0]["data_status"] == "live" and readiness["traffic"][0]["is_stale"]
    assert readiness["weather"]["is_stale"]
    assert readiness["summary"]["missing_officer_locations"] == 1
    assert any("Readiness junction: input is stale" in warning for warning in readiness["warnings"])
    assert any("Weather: input is stale" in warning for warning in readiness["warnings"])
    with patch("optimization.tasks.run_optimization.apply_async") as enqueue:
        response = inputs.client.post("/api/optimization/start/", inputs.params, format="json")
    assert response.status_code == 202, response.data
    saved = OptimizationRun.objects.get(run_id=response.data["run_id"])
    assert saved.parameters["readiness"] == readiness
    enqueue.assert_called_once_with(args=[saved.run_id], task_id=saved.task_id)


def test_missing_or_simulated_inputs_warn_without_fabricating_freshness(inputs):
    inputs.traffic.delete()
    inputs.weather.delete()
    readiness = build_readiness(inputs.params)
    assert readiness["ready"] is True
    assert readiness["traffic"][0]["observed_at"] is None
    assert readiness["weather"]["age_seconds"] is None
    assert any("no valid observation time" in item for item in readiness["warnings"])
    WeatherData.objects.create(timestamp=NOW, observed_at=NOW, data_status="live", is_synthetic=True)
    readiness = build_readiness(inputs.params)
    assert readiness["ready"] is True and readiness["weather"]["is_synthetic"]
    assert any("cannot be published" in item for item in readiness["warnings"])


def test_capacity_uses_eligible_shift_roster_and_time_blocks(inputs):
    Officer.objects.create(name="Wrong shift", badge_number="WRONG", shift="afternoon")
    Officer.objects.create(name="Off duty", badge_number="OFF", shift="morning", status="off_duty")
    Officer.objects.create(name="Deleted", badge_number="DELETED", shift="morning", is_deleted=True)
    start, _ = shift_window("morning", datetime.fromisoformat(inputs.params["operational_date"]).date())
    OfficerTimeBlock.objects.create(officer=inputs.officer, kind="break", start_time=start+timedelta(hours=1),
                                   end_time=start+timedelta(hours=2), created_by=inputs.user)
    readiness = build_readiness(inputs.params)
    assert readiness["ready"] is True
    assert readiness["summary"]["eligible_officers"] == 1
    assert readiness["summary"]["max_staffing_shortage"] == 1
    assert [(row["available_officers"], row["shortage"]) for row in readiness["periods"]] == [(1, 0), (0, 1), (1, 0)]
    assert any("unfilled posts" in warning for warning in readiness["warnings"])


@pytest.mark.parametrize("url", ["/api/optimization/start/", "/api/dashboard/quick-optimize/"])
@pytest.mark.parametrize("blocker", ["no_locations", "no_officers", "ended_shift", "insufficient_review_time"])
def test_start_api_cannot_bypass_true_blockers(inputs, url, blocker):
    params = dict(inputs.params)
    checked_at = NOW
    if blocker == "no_locations":
        Bottleneck.objects.filter(pk=inputs.node.pk).update(is_archived=True)
    elif blocker == "no_officers":
        Officer.objects.filter(pk=inputs.officer.pk).update(status="off_duty")
    else:
        params["operational_date"] = str(NOW.date())
        checked_at = NOW.replace(hour=15) if blocker == "ended_shift" else NOW.replace(hour=13, minute=59)
    with patch("optimization.readiness.timezone.now", return_value=checked_at):
        readiness = inputs.client.post("/api/optimization/readiness/", params, format="json")
        with patch("optimization.tasks.run_optimization.apply_async") as enqueue:
            response = inputs.client.post(url, params, format="json")
    assert readiness.status_code == 200 and readiness.data["ready"] is False
    assert response.status_code == 409, response.data
    assert response.data["readiness"]["ready"] is False
    assert type(response.data["readiness"]["summary"]["eligible_officers"]) is int
    assert response.data["readiness"]["blockers"]
    assert not OptimizationRun.objects.exists() and not AuditLog.objects.filter(resource="optimization_run").exists()
    enqueue.assert_not_called()


def test_zero_demand_remains_valid_without_any_officers(inputs):
    inputs.officer.delete()
    Bottleneck.objects.filter(pk=inputs.node.pk).update(min_officers_required=0, tsi=0)
    readiness = build_readiness(inputs.params)
    assert readiness["ready"] is True
    assert readiness["summary"]["eligible_officers"] == 0
    assert readiness["summary"]["peak_required_officers"] == 0
    assert readiness["summary"]["max_staffing_shortage"] == 0
    with patch("optimization.tasks.run_optimization.apply_async") as enqueue:
        response = inputs.client.post("/api/optimization/start/", inputs.params, format="json")
    assert response.status_code == 202
    enqueue.assert_called_once()


def test_ended_shadow_shift_remains_runnable_with_full_shift_comparison(inputs):
    params = {**inputs.params, "operational_date": str(NOW.date()), "mode": "shadow", "session_id": "late-comparison"}
    with patch("optimization.readiness.timezone.now", return_value=NOW.replace(hour=15)):
        readiness = build_readiness(params)
        with patch("optimization.tasks.run_optimization.apply_async"):
            response = inputs.client.post("/api/optimization/start/", params, format="json")
    start, end = shift_window("morning", NOW.date())
    assert response.status_code == 202, response.data
    assert readiness["ready"] is True
    assert readiness["planning_start"] == start.isoformat() and readiness["planning_end"] == end.isoformat()
    assert readiness["warnings"]  # The morning's inputs are no longer fresh.


def test_current_post_supplies_a_missing_starting_location(inputs):
    Officer.objects.filter(pk=inputs.officer.pk).update(current_latitude=None, current_longitude=None)
    start, end = shift_window("morning", NOW.date())
    Deployment.objects.create(officer=inputs.officer, bottleneck=inputs.node, shift="morning", start_time=start, end_time=end)
    params = {**inputs.params, "operational_date": str(NOW.date())}
    readiness = build_readiness(params)
    assert datetime.fromisoformat(readiness["planning_start"]) == NOW+timedelta(minutes=2)
    assert readiness["summary"]["missing_officer_locations"] == 0
    shadow = build_readiness({**params, "mode": "shadow", "session_id": "comparison"})
    assert shadow["summary"]["missing_officer_locations"] == 1


def test_capacity_excludes_elapsed_demand_for_operational_planning(inputs):
    inputs.officer.delete()
    Bottleneck.objects.filter(pk=inputs.node.pk).update(min_officers_required=0, staffing_periods=[
        {"start": "06:00", "end": "07:00", "required": 1},
    ])
    readiness = build_readiness({**inputs.params, "operational_date": str(NOW.date())})
    assert readiness["ready"] is True
    assert readiness["summary"]["peak_required_officers"] == 0
    assert all(datetime.fromisoformat(row["start_time"]) >= NOW for row in readiness["periods"])
