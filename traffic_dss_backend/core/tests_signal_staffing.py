"""Traffic-light status changes computed demand without overwriting site profiles."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.models import Deployment
from core.operational_time import MANILA
from core.serializers import BottleneckSerializer
from core.staffing import required_staffing, staffing_requirement, staffing_windows
from core.tests_review_fixes import schedule
from core.tests_timed_deployment import make_run, period


AT = datetime(2099, 1, 5, 7, tzinfo=MANILA)


@pytest.mark.parametrize("signal,expected", [("working", 1), ("out_of_order", 3), ("none", 5), ("unknown", 5)])
def test_traffic_lights_determine_the_default_even_during_high_congestion(signal, expected):
    node = SimpleNamespace(signal_status=signal, min_officers_required=3,
                           max_officers_allowed=5, staffing_periods=[], tsi=.95)
    assert required_staffing(node, at=AT) == expected


@pytest.mark.parametrize("signal", ["working", "out_of_order"])
@pytest.mark.parametrize("scheduled", [0, 2, 4])
def test_saved_periods_and_critical_incidents_override_signal_defaults(signal, scheduled):
    node = SimpleNamespace(signal_status=signal, min_officers_required=3, max_officers_allowed=4,
                           staffing_periods=[period("07:00", "08:00", scheduled)], tsi=.95)
    assert required_staffing(node, at=AT) == scheduled
    critical = [SimpleNamespace(severity="critical")]
    assert required_staffing(node, critical, AT) == min(4, scheduled+1)
    default = 1 if signal == "working" else 3
    assert required_staffing(node, at=AT+timedelta(hours=1)) == default
    assert required_staffing(node, critical, AT+timedelta(hours=1)) == min(4, default+1)
    windows = staffing_windows(node, AT-timedelta(hours=1), AT+timedelta(hours=2))
    assert [window["required"] for window in windows] == [default, scheduled, default]
    assert "critical incident" in staffing_requirement(node, critical, AT)[1]


@pytest.mark.parametrize("minimum", [0, 2, 4])
def test_working_lights_use_one_without_changing_the_saved_minimum(minimum):
    node = SimpleNamespace(signal_status="working", min_officers_required=minimum,
                           max_officers_allowed=5, staffing_periods=[], tsi=0)
    assert required_staffing(node) == 1
    assert node.min_officers_required == minimum
    node.signal_status = "out_of_order"
    assert required_staffing(node) == minimum
    node.signal_status = "working"
    assert required_staffing(node) == 1
    assert node.min_officers_required == minimum


@pytest.mark.django_db
def test_status_only_edit_updates_dashboard_and_preserves_assignments_and_minimum(schedule):
    s = schedule
    s.node.min_officers_required = 3
    s.node.save()
    before = list(Deployment.objects.values())
    path = f"/api/dashboard/bottlenecks/manage/{s.node.pk}/"
    for signal, expected in [("working", 1), ("out_of_order", 3), ("working", 1)]:
        response = s.client.put(path, {"signal_status": signal}, format="json")
        assert response.status_code == 200, response.data
        s.node.refresh_from_db()
        assert s.node.min_officers_required == 3
        with patch("dashboard.views.timezone.now", return_value=s.start):
            row = s.client.get(f"/api/dashboard/bottlenecks/?date={s.day}&shift=morning").data["results"][0]
            assert row["current_required"] == expected
            assert row["required_officers"] == expected
            assert all(window["required"] == expected for window in row["staffing_windows"])
        kpis = s.client.get(f"/api/dashboard/kpis/?date={s.day}&shift=morning").data
        assert kpis["required_staffing"] == expected
    assert list(Deployment.objects.values()) == before


@pytest.mark.django_db
def test_working_lights_cannot_be_saved_with_zero_capacity(schedule):
    serializer = BottleneckSerializer(schedule.node, data={"signal_status": "working",
        "min_officers_required": 0, "max_officers_allowed": 0}, partial=True)
    assert not serializer.is_valid()
    assert "max_officers_allowed" in serializer.errors


@pytest.mark.django_db
@pytest.mark.parametrize("initial,expected,changed", [("working", 1, "out_of_order"), ("out_of_order", 3, "working")])
def test_worker_uses_signal_rule_and_publication_rejects_a_plan_from_the_previous_status(schedule, initial, expected, changed):
    s = schedule
    s.node.signal_status = initial
    s.node.tsi = .95
    solution = make_run(s, [], minimum=3)
    assert s.run.status == "completed"
    assert not solution["constraints_violated"]
    assert len(solution["assignments"]) == expected
    captured = s.run.result_data["input_snapshot"]["bottlenecks"][0]
    assert captured["configured_min_officers_required"] == 3
    assert captured["staffing_target"] == expected
    assert all(window["required"] == expected for window in captured["staffing_windows"])
    preview = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert preview.status_code == 200, preview.data
    before = list(Deployment.objects.values())
    response = s.client.put(f"/api/dashboard/bottlenecks/manage/{s.node.pk}/", {"signal_status": changed}, format="json")
    assert response.status_code == 200, response.data
    s.node.refresh_from_db()
    assert s.node.min_officers_required == 3
    response = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert response.status_code == 409 and "staffing_gaps" in response.data
    assert list(Deployment.objects.values()) == before
    assert not s.run.publications.exists()
