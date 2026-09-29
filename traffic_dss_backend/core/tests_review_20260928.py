"""Behavioral regressions for publication, privacy, history, and worker recovery."""
from datetime import timedelta
from io import StringIO
from unittest.mock import AsyncMock, patch
import pytest
from django.core.management import call_command, CommandError
from django.db import connection, IntegrityError
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient
from core.models import AuditLog, Bottleneck, Deployment, Incident, OptimizationRun, POI, ScheduleRevision, TrafficData, WeatherData
from core.operational_time import operational_date, shift_window
from core.tasks import deployment_lifecycle
from core.tests_review_fixes import schedule
from deployments.services import schedule_version
from optimization.recovery import expire_abandoned_runs
from optimization.tasks import capture_inputs, run_optimization

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("generations,converged_early", [(48, True), (300, False)])
def test_completed_status_reports_actual_generations_and_stop_reason(schedule, generations, converged_early):
    s = schedule
    s.run.parameters["generations"] = 300
    s.run.fitness_scores = [95.75] * generations
    s.run.result_data["converged_early"] = converged_early
    s.run.save()
    with patch("optimization.views.load_progress", return_value={"status": "running", "current_generation": 42}):
        response = s.client.get(f"/api/optimization/status/{s.run.run_id}/")
    assert response.status_code == 200
    assert response.data["status"] == "completed"
    assert response.data["current_generation"] == generations
    assert response.data["total_generations"] == 300
    assert response.data["converged_early"] is converged_early
    assert response.data["estimated_completion"] == response.data["updated_at"]


def test_worker_completion_event_matches_persisted_early_stop(schedule):
    from types import SimpleNamespace
    s = schedule
    s.run.status = "queued"
    s.run.parameters["generations"] = 300
    s.run.save()
    result = SimpleNamespace(status="completed", top_solutions=[], generation_fitness=[95.75] * 48,
        best_fitness=95.75, pareto_curve_data=[], converged_early=True)
    with patch("optimization.tasks.GeneticDeploymentOptimizer.run", return_value=result), \
            patch("optimization.tasks._broadcast_progress") as emit:
        event = run_optimization(s.run.run_id)
    assert event["current_generation"] == 48 and event["total_generations"] == 300
    assert event["converged_early"] is True
    assert event["estimated_completion"] == event["updated_at"]
    emit.assert_called_once_with(s.run.run_id, event)
    response = s.client.get(f"/api/optimization/status/{s.run.run_id}/")
    for key in ("status", "current_generation", "total_generations", "current_fitness", "converged_early", "updated_at"):
        assert response.data[key] == event[key]


@pytest.mark.parametrize("path", ["/api/dashboard/officers/", "/api/optimization/history/", "/api/optimization/results/fix-run/", "/api/optimization/status/fix-run/", "/api/deployments/revisions/", "/api/optimization/export/fix-run/"])
def test_operational_details_require_authentication(schedule, path):
    assert APIClient().get(path).status_code == 401


def test_public_dashboard_hides_assignee_identity_and_preserves_tsi(schedule):
    s = schedule
    Bottleneck.objects.filter(pk=s.node.pk).update(tsi=0.799)
    response = APIClient().get(f"/api/dashboard/bottlenecks/?shift=morning&date={s.day}")
    row = response.data["results"][0]
    assert row["tsi"] == 0.799 and row["status"] == "warning"
    assert row["assigned_officers"] == [] and row["assigned_officer"] is None


@pytest.mark.parametrize("bad", ["old_run", "old_traffic", "missing_weather", "future_timestamp", "unverified"])
def test_freshness_is_checked_in_preview_and_commit(schedule, bad):
    s = schedule
    snapshot = s.run.result_data["input_snapshot"]
    if bad == "old_run":
        snapshot["captured_at"] = (timezone.now() - timedelta(days=7)).isoformat()
    elif bad == "old_traffic":
        snapshot["bottlenecks"][0]["provenance"]["observed_at"] = (timezone.now() - timedelta(hours=2)).isoformat()
    elif bad == "missing_weather":
        snapshot["weather"] = {"data_status": "missing"}
    elif bad == "future_timestamp":
        snapshot["captured_at"] = (timezone.now() + timedelta(hours=1)).isoformat()
    else:
        snapshot["bottlenecks"][0]["provenance"]["data_status"] = "unverified"
    s.run.save()
    for endpoint in ["preview", "publish"]:
        response = s.client.post(f"/api/deployments/{endpoint}-optimization/", s.payload, format="json")
        assert response.status_code == 409 and response.data["input_issues"]
    assert not ScheduleRevision.objects.exists() and Deployment.objects.count() == 1


def test_supervisor_input_override_is_recorded_but_cannot_override_staffing(schedule):
    s = schedule
    s.run.result_data["input_snapshot"]["weather"] = {"data_status": "missing"}
    s.run.save()
    payload = {**s.payload, "input_override_reason": "Confirmed dry weather with the field supervisor."}
    response = s.client.post("/api/deployments/publish-optimization/", payload, format="json")
    assert response.status_code == 201
    log = AuditLog.objects.get(action="publish")
    assert log.changes["input_override_reason"] == payload["input_override_reason"] and log.changes["input_issues"]


@pytest.mark.parametrize("changed", ["minimum", "incident", "new_node", "date", "shadow"])
def test_publication_revalidates_operational_context(schedule, changed):
    s = schedule
    payload = dict(s.payload)
    if changed == "minimum":
        Bottleneck.objects.filter(pk=s.node.pk).update(min_officers_required=3)
    elif changed == "incident":
        Bottleneck.objects.filter(pk=s.node.pk).update(min_officers_required=2)
        Incident.objects.create(bottleneck=s.node, reported_by=s.user, timestamp=timezone.now(), severity="critical", description="Changed requirements")
    elif changed == "new_node":
        Bottleneck.objects.create(id="NEW", name="New location", district="Iloilo", latitude=10.7, longitude=122.5)
    elif changed == "date":
        payload["operational_date"] = str(s.day + timedelta(days=1))
    else:
        s.run.parameters.update(mode="shadow", session_id="pilot-1")
        s.run.save()
    response = s.client.post("/api/deployments/preview-optimization/", payload, format="json")
    assert response.status_code == 409
    assert not ScheduleRevision.objects.exists()


def test_repeated_publication_replays_receipt_and_rejects_key_reuse(schedule):
    s = schedule
    first = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert first.status_code == 201
    retry = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert retry.status_code == 201 and retry.data == first.data
    assert ScheduleRevision.objects.count() == 1
    assert Deployment.objects.filter(status="assigned").count() == 2
    assert AuditLog.objects.filter(action="publish").count() == 1
    changed = s.client.post("/api/deployments/publish-optimization/", {**s.payload, "replace_existing": False}, format="json")
    assert changed.status_code == 409


def test_manual_change_invalidates_reviewed_revision(schedule):
    s = schedule
    preview = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert preview.status_code == 200
    Deployment.objects.filter(pk=s.old.pk).update(assignment_type="mobile", updated_at=timezone.now())
    response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert response.status_code == 409 and "schedule changed" in str(response.data).lower()


def test_mid_shift_publication_preserves_elapsed_service_and_linked_history(schedule):
    s = schedule
    now = s.start + timedelta(hours=3, minutes=45)
    s.run.result_data["input_snapshot"]["captured_at"] = now.isoformat()
    s.run.result_data["input_snapshot"]["weather"]["observed_at"] = now.isoformat()
    s.run.result_data["input_snapshot"]["bottlenecks"][0]["provenance"]["observed_at"] = now.isoformat()
    s.run.save()
    with patch("deployments.services.timezone.now", return_value=now):
        response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert response.status_code == 201
    s.old.refresh_from_db()
    assert not s.old.is_deleted and s.old.end_time == now and s.old.status == "completed"
    assert all(row.start_time == now for row in Deployment.objects.filter(source="optimized"))
    revision = ScheduleRevision.objects.get()
    assert parse_datetime(revision.previous_assignments[0]["end_time"]) == s.end
    assert all(row.revision_id == revision.pk for row in Deployment.objects.filter(source="optimized"))
    history = s.client.get(f"/api/deployments/revisions/?date={s.day}")
    assert history.data["results"][0]["assignments"][0]["badge_number"] == s.officers[1].badge_number


def test_incident_location_change_updates_coordinates_and_commits_event(schedule, django_capture_on_commit_callbacks):
    s = schedule
    other = Bottleneck.objects.create(id="MOVE", name="New location", district="Iloilo", latitude=10.75, longitude=122.55)
    row = Incident.objects.create(bottleneck=s.node, reported_by=s.user, timestamp=timezone.now(), severity="critical", description="Flooding", incident_type="flooding")
    for path in [f"/api/incidents/{row.pk}/update/", f"/api/dashboard/incidents/{row.pk}/"]:
        with patch("core.mutations.broadcast") as event:
            with django_capture_on_commit_callbacks(execute=True):
                response = s.client.put(path, {"bottleneck": other.pk}, format="json")
                assert response.status_code == 200
                event.assert_not_called()
            event.assert_called_once()
        row.refresh_from_db()
        assert row.bottleneck_id == other.pk and (row.latitude, row.longitude) == (other.latitude, other.longitude)
        assert row.severity == "critical" and row.incident_type == "flooding"


def test_poi_edit_audits_and_emits_after_commit(schedule, django_capture_on_commit_callbacks):
    s = schedule
    poi = POI.objects.create(poi_id="TEST-POI", name="School", category="school", latitude=10.7, longitude=122.5, priority_boost=8.25)
    with patch("core.mutations.broadcast") as event:
        with django_capture_on_commit_callbacks(execute=True):
            response = s.client.put(f"/api/dashboard/pois/{poi.poi_id}/", {"category": "hospital", "priority_boost": 0}, format="json")
            assert response.status_code == 200
            event.assert_not_called()
        assert event.call_args.args[2]["event"] == "pois_updated"
    assert AuditLog.objects.filter(resource="poi", action="update").exists()


def test_idle_lifecycle_does_not_write_audit_or_broadcast(schedule, django_capture_on_commit_callbacks):
    before = AuditLog.objects.count()
    with patch("deployments.services.broadcast") as event:
        with django_capture_on_commit_callbacks(execute=True):
            assert deployment_lifecycle() == 0
        event.assert_not_called()
    assert AuditLog.objects.count() == before


def test_input_capture_query_count_does_not_grow_per_node(schedule):
    with CaptureQueriesContext(connection) as first:
        capture_inputs({"shift": "morning"})
    Bottleneck.objects.bulk_create([Bottleneck(id=f"BATCH-{i}", name=f"Node {i}", district="Iloilo", latitude=10.7, longitude=122.5) for i in range(9)])
    with CaptureQueriesContext(connection) as second:
        capture_inputs({"shift": "morning"})
    assert len(second) <= len(first) + 1 and len(second) <= 6


def test_expired_worker_runs_are_terminal_and_late_worker_cannot_revive(schedule):
    s = schedule
    old = timezone.now() - timedelta(hours=1)
    OptimizationRun.objects.filter(pk=s.run.pk).update(status="running", heartbeat_at=old, updated_at=old)
    with patch("optimization.recovery.broadcast"):
        assert expire_abandoned_runs() == [s.run.run_id]
        assert expire_abandoned_runs() == []
    result = run_optimization(s.run.run_id)
    assert result["status"] == "failed"
    s.run.refresh_from_db()
    assert s.run.result_data["failure_code"] == "worker_timeout"


def test_history_uses_summary_and_export_retains_zero_values(schedule):
    s = schedule
    snapshot = s.run.result_data["input_snapshot"]
    snapshot["officers"] = [{"id": officer.pk, "badge_number": officer.badge_number} for officer in s.officers]
    snapshot["bottlenecks"][0].update(tsi=0)
    s.run.parameters.update(mode="shadow", session_id="pilot-zero")
    s.run.save()
    history = s.client.get("/api/optimization/history/").data["results"][0]
    assert "input_snapshot" not in history["result_data"] and "top_solutions" not in history["result_data"]
    export = s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    assert export.status_code == 200
    text = export.content.decode()
    assert "pilot-zero,shadow" in text and ",0," in text and ",No,Pending" in text


def test_field_comparison_filters_dates_and_reads_saved_inputs(schedule):
    s = schedule
    s.run.result_data["input_snapshot"]["bottlenecks"][0].update(tsi=0.25)
    s.run.save()
    start, end = shift_window("morning", s.day + timedelta(days=1))
    Deployment.objects.create(officer=s.officers[0], bottleneck=s.node, shift="morning", start_time=start, end_time=end)
    Bottleneck.objects.filter(pk=s.node.pk).update(tsi=0.95)
    output = StringIO()
    call_command("field_test_compare", location=s.node.name, shift="morning", date=str(s.day), run_id=s.run.run_id, stdout=output)
    assert "Total assignments: 1" in output.getvalue() and "25.0%" in output.getvalue()
    assert "95.0%" not in output.getvalue()
    with pytest.raises(CommandError):
        call_command("field_test_compare", location=s.node.name, shift="morning", date=str(s.day))


def test_shadow_mode_requires_session_and_scope_is_saved(schedule):
    s = schedule
    assert s.client.post("/api/optimization/configure/", {"mode": "shadow"}, format="json").status_code == 400
    with patch("optimization.tasks.run_optimization.apply_async") as enqueue:
        response = s.client.post("/api/optimization/start/", {"shift": "morning", "mode": "shadow",
            "session_id": "pilot-2", "operational_date": str(s.day)}, format="json")
    assert response.status_code == 202
    run = OptimizationRun.objects.get(run_id=response.data["run_id"])
    assert run.parameters["session_id"] == "pilot-2" and run.parameters["operational_date"] == str(s.day)
    enqueue.assert_called_once_with(args=[run.run_id], task_id=run.task_id)


def test_clear_preserves_elapsed_service(schedule):
    s = schedule
    now = s.start + timedelta(hours=2)
    with patch("deployments.services.timezone.now", return_value=now):
        response = s.client.delete(f"/api/deployments/schedule/?date={s.day}&shift=morning")
    assert response.status_code == 200 and response.data["cleared"] == 1
    s.old.refresh_from_db()
    assert s.old.status == "completed" and s.old.end_time == now and not s.old.is_deleted


def test_health_checks_services_without_exposing_broker_details(schedule):
    from core.health import system_health, queue_health
    from django.core.cache import cache
    from django.test import override_settings
    cache.clear()
    with override_settings(CELERY_BROKER_URL="redis://fixture.invalid:6379/0"):
        with patch("core.health.app.connection_for_read", side_effect=RuntimeError("secret broker url")):
            health = queue_health()
    assert health == {"queue": "error", "workers": "unavailable", "scheduler": "unavailable"}
    assert "secret" not in str(health)
    with patch("core.health.queue_health", return_value=health):
        status = system_health()
    assert status["database"] == "ok" and status["status"] == "degraded" and status["pending_migrations"] == 0


def test_recent_heartbeat_and_recent_queued_run_are_not_expired(schedule):
    s = schedule
    OptimizationRun.objects.filter(pk=s.run.pk).update(status="running", heartbeat_at=timezone.now())
    assert expire_abandoned_runs() == []
    OptimizationRun.objects.filter(pk=s.run.pk).update(status="queued")
    assert expire_abandoned_runs() == []


def test_health_detects_a_missing_location_even_when_other_traffic_is_fresh(schedule):
    from core.health import system_health
    s = schedule
    now = timezone.now()
    TrafficData.objects.create(bottleneck=s.node, timestamp=now, observed_at=now, data_status="live")
    WeatherData.objects.create(timestamp=now, observed_at=now, data_status="live")
    Bottleneck.objects.create(id="MISSING-INPUT", name="Missing location", district="Iloilo", latitude=10.7, longitude=122.5)
    with patch("core.health.queue_health", return_value={"queue": "ok", "workers": "ok", "scheduler": "ok"}):
        health = system_health()
    assert health["status"] == "degraded"
    assert health["providers"]["traffic"]["locations_needing_refresh"] == 1


def test_legacy_run_can_be_compared_but_cannot_be_published(schedule):
    s = schedule
    s.run.parameters.pop("operational_date")
    s.run.result_data["input_snapshot"].pop("operational_date")
    s.run.save()
    output = StringIO()
    call_command("field_test_compare", location=s.node.name, shift="morning", date=str(operational_date()), run_id=s.run.run_id, stdout=output)
    assert "Legacy run" in output.getvalue() and "intended deployment date was not recorded" in output.getvalue()
    assert s.client.post("/api/deployments/preview-optimization/", s.payload, format="json").status_code == 409
    export = s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    assert "Unknown (legacy)" in export.content.decode()


def test_audit_failure_cannot_report_a_successful_publication(schedule):
    s = schedule
    with patch("core.utils.AuditLog.objects.create", side_effect=IntegrityError("Audit write failed")):
        response = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert response.status_code == 409
    s.old.refresh_from_db()
    assert s.old.status == "assigned" and Deployment.objects.count() == 1
    assert not ScheduleRevision.objects.exists()


def test_anonymous_websocket_cannot_subscribe_to_optimization_progress():
    from asgiref.sync import async_to_sync
    from django.contrib.auth.models import AnonymousUser
    from optimization.consumers import OptimizationProgressConsumer
    consumer = OptimizationProgressConsumer()
    consumer.scope = {"user": AnonymousUser()}
    consumer.close = AsyncMock()
    consumer.channel_layer = AsyncMock()
    async_to_sync(consumer.connect)()
    consumer.close.assert_awaited_once_with(code=4401)
    consumer.channel_layer.group_add.assert_not_called()
    async_to_sync(consumer.disconnect)(4401)
