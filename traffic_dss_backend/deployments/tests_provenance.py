"""Persisted publication identity and schedule provenance; isolated test data only."""
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Deployment, OptimizationRun, ScheduleRevision
from core.tests_review_fixes import schedule
from deployments.provenance import PublicationProvenance
from deployments.services import publish, save_assignment, schedule_version, clear_schedule


pytestmark = pytest.mark.django_db


def publication(s, run=None, **extra):
    run = run or s.run
    return publish(s.user, {**s.payload, "run_id": run.run_id, "idempotency_key": uuid4().hex,
        "expected_revision": schedule_version("morning", s.day), **extra})


def next_run(s, suffix="next"):
    return OptimizationRun.objects.create(run_id=f"{s.run.run_id}-{suffix}", created_by=s.user,
        timestamp=timezone.now(), status="completed", parameters=deepcopy(s.run.parameters), result_data=deepcopy(s.run.result_data))


def state(run):
    return PublicationProvenance(runs=[run]).for_run(run)


def test_history_and_results_use_saved_ledger_across_fresh_requests(schedule):
    s = schedule
    assert state(s.run)["state"] == "unpublished"
    receipt = publication(s)
    fresh_run = OptimizationRun.objects.get(pk=s.run.pk)
    expected = state(fresh_run)
    assert expected["state"] == "published"
    assert expected["revision_id"] == receipt["revision_id"]
    assert expected["publication_count"] == 1
    assert expected["published_by"] == s.user.username
    assert expected["operational_date"] == str(s.day)
    for path in [f"/api/optimization/results/{s.run.run_id}/", "/api/optimization/history/"]:
        response = s.client.get(path)
        assert response.status_code == 200
        data = response.data["results"][0] if "results" in response.data else response.data
        assert data["publication_state"] == expected
    revision = ScheduleRevision.objects.get()
    assert revision.response["replace_existing"] is True
    assert revision.assignments[0]["assignment_type"] == "static"
    assert not AuditLog.objects.filter(action__in=["create", "update", "clear"]).exists()


def test_client_supplied_saved_result_metadata_cannot_override_ledger(schedule):
    s = schedule
    s.run.result_data["publication_state"] = {"state": "published", "revision_id": 999}
    s.run.save()
    response = s.client.get(f"/api/optimization/results/{s.run.run_id}/")
    assert response.data["publication_state"]["state"] == "unpublished"


def test_completion_and_merged_unchanged_service_do_not_look_modified(schedule):
    s = schedule
    publication(s)
    row = Deployment.objects.filter(revision__isnull=False).first()
    right = row.end_time
    row.end_time = s.start+timedelta(hours=4)
    row.status = "completed"
    row.save()
    Deployment.objects.create(officer=row.officer, bottleneck=row.bottleneck, shift=row.shift,
        start_time=row.end_time, end_time=right, source=row.source, revision=row.revision)
    Deployment.objects.filter(revision__isnull=False).update(status="completed")
    assert state(s.run)["state"] == "published"
    assert state(s.run)["manual_changes"] is False


@pytest.mark.parametrize("legacy_snapshot", [False, True])
def test_manual_type_edit_is_visible_even_though_source_and_revision_are_retained(schedule, legacy_snapshot):
    s = schedule
    publication(s)
    revision = ScheduleRevision.objects.get()
    if legacy_snapshot:
        for item in revision.assignments:
            item.pop("assignment_type")
        revision.save(update_fields=["assignments"])
    row = Deployment.objects.filter(revision=revision).first()
    saved = save_assignment(s.user, {"assignment_type": "mobile"}, row.pk)
    assert saved.source == "optimized" and saved.revision_id == revision.pk
    current = state(s.run)
    assert current["state"] == "modified" and current["manual_changes"] is True
    result = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=morning").data["shifts"][0]
    assert result["manual_assignment_count"] == 0
    assert result["optimized_assignment_count"] == 2
    assert result["assignments_changed_since_publication"] is True


def test_clear_changes_status_without_erasing_publication_history(schedule):
    s = schedule
    receipt = publication(s)
    assert clear_schedule(s.user, "morning", s.day) == 2
    current = state(s.run)
    assert current["state"] == "modified"
    assert current["revision_id"] == receipt["revision_id"] and current["manual_changes"]
    assert len(ScheduleRevision.objects.get().assignments) == 2
    result = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=morning").data["shifts"][0]
    assert result["optimized_assignment_count"] == 0 and result["sources"] == []
    assert result["latest_publication"]["state"] == "modified"


@pytest.mark.parametrize("already_started", [False, True])
def test_saving_unchanged_assignment_does_not_claim_manual_changes(schedule, monkeypatch, already_started):
    s = schedule
    publication(s)
    if already_started:
        monkeypatch.setattr("deployments.services.timezone.now", lambda: s.start+timedelta(hours=1))
    row = Deployment.objects.filter(revision__isnull=False).first()
    save_assignment(s.user, {}, row.pk)
    assert AuditLog.objects.filter(resource="deployment_schedule", action="update").exists()
    assert state(s.run)["state"] == "published"
    assert state(s.run)["manual_changes"] is False


def test_clearing_ended_service_only_completes_status_without_claiming_a_change(schedule, monkeypatch):
    s = schedule
    publication(s)
    monkeypatch.setattr("deployments.services.timezone.now", lambda: s.end+timedelta(minutes=1))
    clear_schedule(s.user, "morning", s.day)
    assert state(s.run)["state"] == "published"
    assert state(s.run)["manual_changes"] is False


def test_partial_replacement_preserves_prefix_and_tail_without_manual_warning(schedule):
    s = schedule
    first = publication(s)
    newer = next_run(s)
    receipt = publication(s, newer, start_time=(s.start+timedelta(hours=2)).isoformat(),
        end_time=(s.start+timedelta(hours=4)).isoformat())
    before = state(s.run)
    assert before["state"] == "partially_replaced" and before["manual_changes"] is False
    assert before["replacing_run_ids"] == [newer.run_id]
    assert state(newer)["state"] == "published"
    result = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=morning").data["shifts"][0]
    assert result["optimized_assignment_count"] == 6
    assert result["sources"] == [
        {"revision_id": receipt["revision_id"], "run_id": newer.run_id,
         "published_at": state(newer)["published_at"], "published_by": s.user.username, "assignment_count": 2},
        {"revision_id": first["revision_id"], "run_id": s.run.run_id,
         "published_at": before["published_at"], "published_by": s.user.username, "assignment_count": 4}]


def test_full_replacement_and_repeat_publication_of_same_run_are_distinct(schedule):
    s = schedule
    publication(s)
    publication(s)
    repeated = state(s.run)
    assert repeated["state"] == "published" and repeated["publication_count"] == 2
    assert repeated["replacing_run_ids"] == []
    newer = next_run(s)
    publication(s, newer)
    assert state(s.run)["state"] == "replaced"
    assert state(s.run)["replacing_run_ids"] == [newer.run_id]
    assert state(newer)["state"] == "published"


def test_newer_nonoverlapping_publication_does_not_replace_the_earlier_one(schedule):
    s = schedule
    middle = s.start+timedelta(hours=4)
    publication(s, end_time=middle.isoformat(), start_time=s.start.isoformat())
    newer = next_run(s)
    publication(s, newer, start_time=middle.isoformat(), end_time=s.end.isoformat())
    assert state(s.run)["state"] == "published"
    assert state(s.run)["replacing_run_ids"] == []
    assert state(newer)["state"] == "published"


def test_append_publication_is_not_a_replacement(schedule):
    s = schedule
    publication(s)
    newer = next_run(s)
    newer.result_data["top_solutions"][0]["assignments"] = [{"officer_id": s.officers[0].pk, "bottleneck_id": s.node.pk}]
    newer.save()
    publication(s, newer, replace_existing=False)
    assert state(s.run)["state"] == "published"
    assert state(newer)["state"] == "published"
    assert state(s.run)["replacing_run_ids"] == []


def test_zero_assignment_publication_is_still_published_and_can_be_replaced(schedule):
    s = schedule
    s.node.min_officers_required = 0
    s.node.save()
    s.run.result_data["input_snapshot"]["schema_version"] = 4
    s.run.result_data["top_solutions"][0].update(assignments=[], time_periods=[{
        "start_time": s.start.isoformat(), "end_time": s.end.isoformat()}])
    s.run.save()
    publication(s)
    assert state(s.run)["state"] == "published"
    current = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=morning").data["shifts"][0]
    assert current["optimized_assignment_count"] == 0
    assert current["latest_publication"]["run_id"] == s.run.run_id
    newer = next_run(s)
    publication(s, newer)
    assert state(s.run)["state"] == "replaced"
    assert state(newer)["state"] == "published"


@pytest.mark.parametrize("snapshot", [None, {}, [None], [{"officer_id": 1, "bottleneck_id": "FIX-A", "start_time": "broken"}]])
def test_malformed_legacy_snapshot_reports_unknown_instead_of_a_false_status(schedule, snapshot):
    s = schedule
    publication(s)
    # JSON null is not allowed by this model; a dict is equally invalid evidence.
    ScheduleRevision.objects.update(assignments={} if snapshot is None else snapshot)
    assert state(s.run)["state"] == "unknown"


def test_legacy_receipt_with_known_replaced_rows_is_supported(schedule):
    s = schedule
    publication(s)
    newer = next_run(s)
    publication(s, newer)
    revision = newer.publications.get()
    revision.response.pop("replace_existing")
    revision.save(update_fields=["response"])
    assert state(s.run)["state"] == "replaced"


def test_ambiguous_legacy_append_receipt_does_not_claim_replacement(schedule):
    s = schedule
    publication(s)
    newer = next_run(s)
    newer.result_data["top_solutions"][0]["assignments"] = [{"officer_id": s.officers[0].pk, "bottleneck_id": s.node.pk}]
    newer.save()
    publication(s, newer, replace_existing=False)
    revision = newer.publications.get()
    revision.response.pop("replace_existing")
    revision.save(update_fields=["response"])
    assert state(s.run)["state"] == "unknown"
    assert state(s.run)["replacing_run_ids"] == []


@pytest.mark.parametrize("query", ["date=invalid", "date=2026-02-30", "shift=night", "shift="])
def test_provenance_rejects_invalid_filters(schedule, query):
    assert schedule.client.get(f"/api/deployments/provenance/?{query}").status_code == 400


def test_provenance_is_authenticated_and_dispatchers_can_read_it(schedule):
    s = schedule
    anonymous = APIClient()
    assert anonymous.get("/api/deployments/provenance/").status_code in {401, 403}
    s.user.groups.clear()
    response = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=all")
    assert response.status_code == 200
    assert [row["shift"] for row in response.data["shifts"]] == ["morning", "afternoon"]
    assert response.data["shifts"][0]["manual_assignment_count"] == 1
    assert response.data["shifts"][1]["manual_assignment_count"] == 0
    assert all(row["latest_publication"] is None for row in response.data["shifts"])


def test_history_provenance_queries_are_batched_for_many_runs(schedule, django_assert_num_queries):
    s = schedule
    publication(s)
    runs = [s.run]
    for i in range(9):
        run = next_run(s, f"batch-{i}")
        publication(s, run)
        runs.append(run)
    with django_assert_num_queries(4):
        reader = PublicationProvenance(runs=runs)
        statuses = [reader.for_run(run)["state"] for run in runs]
    assert statuses == ["replaced"]*9+["published"]


def test_schedule_counts_include_completed_and_exclude_cancelled_or_deleted(schedule):
    s = schedule
    publication(s)
    optimized = list(Deployment.objects.filter(source="optimized"))
    optimized[0].status = "completed"
    optimized[0].save()
    optimized[1].is_deleted = True
    optimized[1].save()
    result = s.client.get(f"/api/deployments/provenance/?date={s.day}&shift=morning").data["shifts"][0]
    assert result["optimized_assignment_count"] == 1
    assert result["manual_assignment_count"] == 0
    assert result["sources"][0]["assignment_count"] == 1
    assert result["latest_publication"]["state"] == "modified"


def test_shadow_history_is_unpublished_comparison_only(schedule):
    s = schedule
    s.run.parameters["mode"] = "shadow"
    s.run.save()
    response = s.client.get("/api/optimization/history/")
    value = response.data["results"][0]["publication_state"]
    assert value["state"] == "unpublished" and "Shadow comparison only" in value["message"]
