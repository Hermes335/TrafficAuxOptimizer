"""Regression cases for the September 24 operational fixes. No live services."""
from datetime import date, datetime, timedelta, timezone as utc_timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Bottleneck, Deployment, Incident, Officer, OptimizationRun
from core.operational_time import MANILA, operational_date, shift_window, is_peak_hour
from core.tasks import incident_lifecycle, deployment_lifecycle
from deployments.services import publish, schedule_version
from optimization.engine import GeneticDeploymentOptimizer
from optimization.tasks import capture_inputs, run_optimization

pytestmark = pytest.mark.django_db


@pytest.fixture
def schedule():
    cache.clear()
    user = get_user_model().objects.create_user(username="shift-lead", password="password123")
    user.groups.add(Group.objects.get(name="supervisor"))
    client = APIClient()
    client.force_authenticate(user)
    node = Bottleneck.objects.create(id="FIX-A", name="Junction", district="Iloilo", latitude=10.7,
                                    longitude=122.5, min_officers_required=1, max_officers_allowed=4)
    officers = [Officer.objects.create(name=f"Officer {i}", badge_number=f"FIX-{i}", shift="morning",
                                      status="available") for i in range(3)]
    day = operational_date() + timedelta(days=1)
    start, end = shift_window("morning", day)
    old = Deployment.objects.create(officer=officers[0], bottleneck=node, shift="morning",
                                    start_time=start, end_time=end)
    run = OptimizationRun.objects.create(run_id="fix-run", timestamp=timezone.now(), created_by=user,
        status="completed", parameters={"shift": "morning", "operational_date": str(day)}, result_data={
            "input_snapshot": {"captured_at": timezone.now().isoformat(), "operational_date": str(day),
                "bottlenecks": [{"id": node.id, "name": node.name, "provenance": {"observed_at": timezone.now().isoformat(), "data_status": "live"}}],
                "weather": {"observed_at": timezone.now().isoformat(), "data_status": "live"}}, "top_solutions": [{
            "assignments": [{"officer_id": o.id, "bottleneck_id": node.id} for o in officers[1:]]
        }]})
    return SimpleNamespace(user=user, client=client, node=node, officers=officers, old=old, run=run,
                           day=day, start=start, end=end,
                           payload={"run_id": run.run_id, "operational_date": str(day),
                                    "expected_revision": schedule_version("morning", day), "idempotency_key": uuid4().hex})


@pytest.mark.parametrize("invalid", ["officer", "bottleneck", "empty", "malformed", "off_duty", "wrong_shift", "capacity", "violated", "synthetic"])
def test_invalid_publication_keeps_old_schedule(schedule, invalid):
    s = schedule
    if invalid == "officer":
        s.run.result_data["top_solutions"][0]["assignments"][0]["officer_id"] = 999999
    elif invalid == "bottleneck":
        s.run.result_data["top_solutions"][0]["assignments"][0]["bottleneck_id"] = "missing"
    elif invalid == "empty":
        s.run.result_data = {"top_solutions": []}
    elif invalid == "malformed":
        s.run.result_data = {"top_solutions": [{"assignments": [None]}]}
    elif invalid == "off_duty":
        Officer.objects.filter(pk=s.officers[1].id).update(status="off_duty")
    elif invalid == "wrong_shift":
        Officer.objects.filter(pk=s.officers[1].id).update(shift="afternoon")
    elif invalid == "capacity":
        Bottleneck.objects.filter(pk=s.node.id).update(max_officers_allowed=1)
    elif invalid == "violated":
        s.run.result_data["top_solutions"][0]["constraints_violated"] = True
    else:
        s.run.result_data["synthetic_data_used"] = ["traffic"]
    s.run.save()
    with patch("deployments.services.broadcast") as broadcast:
        response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert response.status_code == 409, response.data
    s.old.refresh_from_db()
    assert not s.old.is_deleted and s.old.status == "assigned"
    assert Deployment.objects.count() == 1
    broadcast.assert_not_called()
    assert not AuditLog.objects.filter(action="publish").exists()


@pytest.mark.parametrize("failure_on", [1, 2])
def test_publication_insertion_failure_rolls_back_entire_batch(schedule, failure_on):
    s = schedule
    original = Deployment.save
    calls = 0
    def fail_after_partial_insert(instance, *args, **kwargs):
        nonlocal calls
        if instance.pk:
            return original(instance, *args, **kwargs)
        calls += 1
        if calls == failure_on:
            raise IntegrityError("injected insertion failure")
        return original(instance, *args, **kwargs)
    with patch.object(Deployment, "save", fail_after_partial_insert), patch("deployments.services.broadcast") as broadcast:
        response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert response.status_code == 409
    s.old.refresh_from_db()
    assert not s.old.is_deleted and s.old.status == "assigned"
    assert Deployment.objects.count() == 1
    broadcast.assert_not_called()


def test_preview_is_read_only_and_publication_emits_only_after_commit(schedule, django_capture_on_commit_callbacks):
    s = schedule
    before = list(Deployment.objects.values())
    response = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert response.status_code == 200 and response.data["shift"] == "morning"
    assert response.data["staff_removed"] == [s.officers[0].id]
    assert response.data["created"] == 2
    assert list(Deployment.objects.values()) == before
    with patch("deployments.services.broadcast") as broadcast:
        with django_capture_on_commit_callbacks(execute=True) as callbacks:
            response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
            broadcast.assert_not_called()
        assert len(callbacks) == 1
        assert broadcast.call_args.args[2]["event"] == "deployment_changed"
    assert response.status_code == 201
    assert Deployment.objects.filter(is_deleted=False, source="optimized").count() == 2
    s.old.refresh_from_db()
    assert not s.old.is_deleted and s.old.status == "cancelled"
    assert Deployment.objects.filter(is_deleted=False, status="assigned").first().start_time == s.start


def test_preview_revalidates_before_publish(schedule):
    s = schedule
    assert s.client.post("/api/deployments/preview-optimization/", s.payload, format="json").status_code == 200
    Officer.objects.filter(pk=s.officers[1].pk).update(status="unavailable")
    assert s.client.post("/api/deployments/publish-optimization/", s.payload, format="json").status_code == 409
    s.old.refresh_from_db()
    assert not s.old.is_deleted


@pytest.mark.parametrize("role,expected", [("anonymous", 401), ("dispatcher", 403), ("supervisor", 400), ("administrator", 400)])
@pytest.mark.parametrize("url", ["/api/deployments/assign/", "/api/optimization/start/", "/api/dashboard/quick-optimize/"])
def test_mutation_roles_are_enforced(schedule, role, expected, url):
    s = schedule
    client = APIClient()
    if role != "anonymous":
        user = get_user_model().objects.create_user(username="supervisor", password="x", is_staff=role == "administrator")
        if role == "supervisor":
            user.groups.add(Group.objects.get(name="supervisor"))
        client.force_authenticate(user)
    response = client.post(url, {"population_size": "abc"}, format="json")
    assert response.status_code == expected


@pytest.mark.parametrize("method,url", [
    ("delete", "/api/deployments/schedule/"), ("post", "/api/deployments/publish-optimization/"),
    ("post", "/api/deployments/preview-optimization/"), ("put", "/api/deployments/1/update/"),
    ("post", "/api/optimization/cancel/fix-run/"), ("post", "/api/dashboard/officers/manage/"),
    ("post", "/api/dashboard/bottlenecks/manage/"),
])
def test_dispatcher_cannot_bypass_operational_permissions(schedule, method, url):
    user = get_user_model().objects.create_user(username="dispatcher")
    client = APIClient()
    client.force_authenticate(user)
    assert getattr(client, method)(url, {}, format="json").status_code == 403


def test_username_is_not_a_role(schedule):
    user = get_user_model().objects.create_user(username="supervisor", password="password123")
    response = APIClient().post("/api/auth/login/", {"username": user.username, "password": "password123"}, format="json")
    assert response.status_code == 200
    assert response.data["user"]["role"] == "dispatcher"


def test_exactly_sixty_eligible_officers_can_be_assigned(schedule):
    s = schedule
    Officer.objects.bulk_create([Officer(name=f"Roster {i}", badge_number=f"R-{i}", shift="morning") for i in range(57)])
    assert Officer.objects.filter(status="available").count() == 60
    response = s.client.post("/api/deployments/assign/", {"officer": s.officers[1].pk,
        "bottleneck": s.node.pk, "shift": "morning", "operational_date": str(s.day)}, format="json")
    assert response.status_code == 201, response.data


def test_create_update_and_publish_share_overlap_rules(schedule):
    s = schedule
    payload = {"officer": s.officers[0].pk, "bottleneck": s.node.pk, "shift": "morning", "operational_date": str(s.day)}
    assert s.client.post("/api/deployments/assign/", payload, format="json").status_code == 409
    payload["operational_date"] = str(s.day + timedelta(days=1))
    response = s.client.post("/api/deployments/assign/", payload, format="json")
    assert response.status_code == 201
    assert s.client.put(f"/api/deployments/{response.data['id']}/update/",
        {"start_time": s.start.isoformat(), "end_time": s.end.isoformat()}, format="json").status_code == 409
    s.run.result_data["top_solutions"][0]["assignments"][0]["officer_id"] = s.officers[0].id
    s.run.save()
    assert s.client.post("/api/deployments/publish-optimization/", {**s.payload, "replace_existing": False}, format="json").status_code == 409


@pytest.mark.parametrize("changes", [{"end_time": "bad"}, {"shift": "night"}, {"operational_date": "2026-02-30"},
                                      {"start_time": "2026-09-24T14:00:00+08:00", "end_time": "2026-09-24T06:00:00+08:00"}])
def test_assignment_rejects_invalid_dates_and_windows(schedule, changes):
    s = schedule
    response = s.client.post("/api/deployments/assign/", {"officer": s.officers[1].pk,
        "bottleneck": s.node.pk, "shift": "morning", **changes}, format="json")
    assert response.status_code == 400


def test_publish_cannot_override_runs_shift(schedule):
    s = schedule
    assert s.client.post("/api/deployments/publish-optimization/", {**s.payload, "shift": "afternoon"}, format="json").status_code == 409


@pytest.mark.parametrize("shift,local_hour,utc_hour,utc_day", [("morning", 6, 22, 23), ("afternoon", 14, 6, 24)])
def test_manila_windows_convert_to_correct_storage_times(shift, local_hour, utc_hour, utc_day):
    start, end = shift_window(shift, date(2026, 9, 24))
    assert start.hour == local_hour
    assert end - start == timedelta(hours=8)
    stored = start.astimezone(utc_timezone.utc)
    assert (stored.hour, stored.day) == (utc_hour, utc_day)


def test_operational_day_and_peak_hour_cross_utc_midnight():
    assert operational_date(datetime(2026, 9, 24, 16, 1, tzinfo=utc_timezone.utc)) == date(2026, 9, 25)
    assert is_peak_hour(datetime(2026, 9, 24, 23, 30, tzinfo=utc_timezone.utc))
    assert not is_peak_hour(datetime(2026, 9, 24, 4, 0, tzinfo=utc_timezone.utc))


def test_dashboard_coverage_uses_staffed_duration_and_requirements(schedule):
    s = schedule
    Bottleneck.objects.filter(pk=s.node.pk).update(min_officers_required=2)
    Deployment.objects.filter(pk=s.old.pk).update(end_time=s.start + timedelta(hours=4))
    response = s.client.get(f"/api/dashboard/kpis/?shift=morning&date={s.day}").json()
    assert response["required_staffing"] == 2
    assert response["assigned_staffing"] == 0.5
    assert response["coverage_efficiency"] == 25.0
    assert response["shortages"] == 1.5
    assert response["avg_response_time"] is None
    assert response["weather_impact_factor"] is None
    assert "weather_correlation" not in response


@pytest.mark.parametrize("field,value", [("population_size", "abc"), ("population_size", 49), ("elitism_count", 21),
                                         ("generations", 1.5), ("mutation_rate", "NaN"), ("shift", "night")])
@pytest.mark.parametrize("url", ["/api/optimization/configure/", "/api/optimization/start/", "/api/dashboard/quick-optimize/"])
def test_optimization_invalid_input_returns_structured_errors(schedule, field, value, url):
    response = schedule.client.post(url, {field: value}, format="json")
    assert response.status_code == 400, response.data
    assert response.data
    assert OptimizationRun.objects.count() == 1


@pytest.mark.parametrize("url", ["/api/optimization/start/", "/api/dashboard/quick-optimize/"])
def test_queue_failure_has_terminal_record(schedule, url):
    with patch("optimization.tasks.run_optimization.apply_async", side_effect=RuntimeError("broker down")):
        response = schedule.client.post(url, {"shift": "morning"}, format="json")
    assert response.status_code == 503
    run = OptimizationRun.objects.get(run_id=response.data["run_id"])
    assert run.status == "failed" and run.result_data["enqueue_error"] == "broker down"


def test_cancelled_run_cannot_be_revived_by_worker(schedule):
    s = schedule
    s.run.status = "queued"
    s.run.save()
    response = s.client.post(f"/api/optimization/cancel/{s.run.run_id}/")
    assert response.status_code == 200 and response.data["status"] == "cancelled"
    with patch("optimization.tasks.capture_inputs") as capture:
        result = run_optimization(s.run.run_id)
    assert result["status"] == "cancelled"
    capture.assert_not_called()


def test_cancel_during_worker_completion_wins(schedule):
    s = schedule
    s.run.status = "queued"
    s.run.save()
    def finish(**kwargs):
        OptimizationRun.objects.filter(pk=s.run.pk).update(status="cancelled")
        return SimpleNamespace(top_solutions=[], generation_fitness=[], status="completed",
                               best_fitness=10, pareto_curve_data=[], converged_early=False)
    with patch("optimization.tasks.GeneticDeploymentOptimizer.run", side_effect=finish):
        result = run_optimization(s.run.run_id)
    s.run.refresh_from_db()
    assert result["status"] == s.run.status == "cancelled"


def test_uniform_priority_and_zero_tsi_preserved_in_worker_snapshot(schedule):
    s = schedule
    Bottleneck.objects.create(id="FIX-B", name="Equal-priority junction", district="Iloilo",
        latitude=10.71, longitude=122.51, road_priority_weight=s.node.road_priority_weight, tsi=0)
    s.run.status = "queued"
    s.run.save()
    _, nodes, _ = capture_inputs({"shift": "morning"})
    assert len(nodes) == 2
    assert all(node["tsi"] == 0 for node in nodes)
    assert all(node["road_priority_weight"] == s.node.road_priority_weight for node in nodes)
    result = SimpleNamespace(top_solutions=[], generation_fitness=[], status="completed",
                             best_fitness=0, pareto_curve_data=[], converged_early=False)
    with patch("optimization.tasks.GeneticDeploymentOptimizer.run", return_value=result) as optimizer:
        run_optimization(s.run.run_id)
    assert optimizer.call_args.kwargs["bottlenecks"][0]["tsi"] == 0
    s.run.refresh_from_db()
    assert all(node["tsi"] == 0 for node in s.run.result_data["input_snapshot"]["bottlenecks"])
    assert all(node["road_priority_weight"] == s.node.road_priority_weight
               for node in optimizer.call_args.kwargs["bottlenecks"])
    assert not s.run.result_data["synthetic_data_used"]
    assert s.run.result_data["input_snapshot"]["weather"]["source"] == "missing"


def test_incident_lifecycle_uses_latest_activity_and_preserves_ongoing_types(schedule):
    s = schedule
    cases = [("collision", 5), ("collision", 0), ("road_closure", 5), ("construction", 5), ("flooding", 5)]
    rows = []
    for kind, hours in cases:
        row = Incident.objects.create(bottleneck=s.node, reported_by=s.user, incident_type=kind,
            severity="minor", description=kind, timestamp=timezone.now()-timedelta(hours=5))
        Incident.objects.filter(pk=row.pk).update(updated_at=timezone.now()-timedelta(hours=hours))
        rows.append(row)
    incident_lifecycle()
    for i, row in enumerate(rows):
        row.refresh_from_db()
        assert row.status == ("resolved" if i == 0 else "active")


def test_deployment_lifecycle_tracks_current_window_and_completion(schedule):
    s = schedule
    with patch("deployments.services.timezone.now", return_value=s.start+timedelta(hours=1)):
        deployment_lifecycle()
    s.officers[0].refresh_from_db()
    assert s.officers[0].status == "deployed"
    with patch("deployments.services.timezone.now", return_value=s.end+timedelta(minutes=1)):
        deployment_lifecycle()
    s.old.refresh_from_db()
    s.officers[0].refresh_from_db()
    assert s.old.status == "completed"
    assert s.officers[0].status == "available"
    assert s.client.put(f"/api/deployments/{s.old.pk}/update/", {"status": "assigned"}, format="json").status_code == 409


def test_active_incidents_are_paginated_without_silent_fifty_row_limit(schedule):
    s = schedule
    Incident.objects.bulk_create([Incident(bottleneck=s.node, reported_by=s.user, incident_type="other",
        severity="minor", description=str(i), timestamp=timezone.now()) for i in range(101)])
    first = s.client.get("/api/dashboard/incidents/active/").json()
    second = s.client.get("/api/dashboard/incidents/active/?page=2").json()
    assert first["count"] == 101 and len(first["results"]) == 100 and len(second["results"]) == 1
    detail = s.client.get(f"/api/dashboard/incidents/{second['results'][0]['id']}/")
    assert detail.status_code == 200


def test_incident_and_poi_creation_return_real_ids_and_persist(schedule):
    s = schedule
    incident = s.client.post("/api/dashboard/incidents/", {"incident_type": "collision", "severity": "minor",
        "description": "Saved", "latitude": 0, "longitude": 0}, format="json")
    assert incident.status_code == 201
    assert s.client.get(f"/api/dashboard/incidents/{incident.data['id']}/").data["description"] == "Saved"
    poi = s.client.post("/api/dashboard/pois/", {"name": "Saved POI", "category": "hospital",
        "latitude": 0, "longitude": 0}, format="json")
    assert poi.status_code == 201
    assert s.client.get("/api/dashboard/pois/").data["results"][0]["poi_id"] == poi.data["poi_id"]
    invalid = s.client.post("/api/dashboard/pois/", {"name": "Invalid", "latitude": 999, "longitude": 0}, format="json")
    assert invalid.status_code == 400


def test_removed_backend_routes_are_not_registered(schedule):
    from django.urls import resolve, Resolver404
    for path in ["/api/scenarios/", "/api/analytics/trends/"]:
        with pytest.raises(Resolver404):
            resolve(path)


def test_priority_coverage_counts_distinct_locations():
    optimizer = GeneticDeploymentOptimizer(seed=2)
    nodes = [{"id": str(i), "name": str(i), "latitude": 10.7, "longitude": 122.5, "tsi": 0,
              "road_priority_weight": 1, "min_officers_required": 2, "max_officers_allowed": 4} for i in range(3)]
    officers = [{"id": i, "badge_number": str(i)} for i in range(6)]
    scores = optimizer._evaluate_objectives([0, 0, 1], officers[:3], nodes, 1)
    assert scores["road_priority_coverage"] == pytest.approx(200/3, abs=0.001)
    violated, reasons = optimizer._check_constraints([0, 0, 0, 0, 1, 2], officers, nodes)
    assert violated and any("understaffed" in reason for reason in reasons)
    result = optimizer.run(officers, nodes, {"population_size": 50, "generations": 50}, seed=2)
    for solution in result.top_solutions:
        assert not solution["constraints_violated"]
        assert not solution["staffing_shortages"]
        assert all(sum(a["bottleneck_id"] == node["id"] for a in solution["assignments"]) == 2 for node in nodes)

def test_history_and_roster_tables_keep_pagination_and_filters(schedule):
    s = schedule
    OptimizationRun.objects.bulk_create([OptimizationRun(run_id=f"history-{i}", timestamp=timezone.now(),
        created_by=s.user, status="completed", parameters={"shift": "morning"}) for i in range(105)])
    response = s.client.get("/api/optimization/history/?page=11&page_size=10&status=completed")
    assert response.status_code == 200
    assert response.data["count"] == 106 and len(response.data["results"]) == 6
    Officer.objects.bulk_create([Officer(name=f"Archived {i}", badge_number=f"ARCH-{i}", shift="afternoon",
        status="off_duty") for i in range(101)])
    response = s.client.get("/api/dashboard/officers/?page=5&page_size=25&shift=afternoon&status=off_duty")
    assert response.status_code == 200
    assert response.data["count"] == 101 and len(response.data["results"]) == 1


def test_infeasible_minimum_staffing_is_explicit_in_result():
    nodes = [{"id": str(i), "name": str(i), "latitude": 10.7, "longitude": 122.5,
        "tsi": 0, "road_priority_weight": 1, "min_officers_required": 2, "max_officers_allowed": 4} for i in range(3)]
    officers = [{"id": i, "badge_number": str(i)} for i in range(3)]
    result = GeneticDeploymentOptimizer(seed=5).run(officers, nodes, {"population_size": 50, "generations": 50})
    assert result.status == "completed"
    assert all(sum(solution["staffing_shortages"].values()) >= 3 for solution in result.top_solutions)
