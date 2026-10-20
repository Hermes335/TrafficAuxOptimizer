"""Optional skill preferences across API reads, manual ranking, publication and exports."""
import csv
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from core.assignment_scoring import rank_candidates_for_bottleneck
from core.models import AuditLog, Incident, Officer
from core.serializers import OfficerSerializer
from core.skills import SKILL_OPTIONS, SKILL_POLICY_VERSION, preferred_skills_for, skill_match
from core.tests_review_fixes import schedule

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def intersection_profile(schedule):
    schedule.node.bottleneck_type = "intersection"
    schedule.node.save(update_fields=["bottleneck_type"])


def save_assessed_snapshot(s):
    snapshot = s.run.result_data["input_snapshot"]
    snapshot["skill_policy_version"] = SKILL_POLICY_VERSION
    snapshot["officers"] = [{"id": o.pk, "badge_number": o.badge_number, "skills": list(o.skills)} for o in s.officers]
    snapshot["bottlenecks"][0]["preferred_skills"] = preferred_skills_for(s.node)
    for assignment in s.run.result_data["top_solutions"][0]["assignments"]:
        officer = next(o for o in s.officers if o.pk == assignment["officer_id"])
        assignment["skill_match"] = skill_match(officer.skills, preferred_skills_for(s.node))
    s.run.save()


def export_rows(s):
    response = s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    assert response.status_code == 200, response.data if hasattr(response, "data") else response.content
    return list(csv.DictReader(StringIO(response.content.decode())))


def test_skill_catalogue_requires_login_and_exposes_only_policy_metadata(schedule):
    assert APIClient().get("/api/dashboard/skill-policy/").status_code == 401
    response = schedule.client.get("/api/dashboard/skill-policy/")
    assert response.status_code == 200
    assert response.data == {"version": SKILL_POLICY_VERSION, "skills": SKILL_OPTIONS}


def test_officer_write_normalizes_aliases_and_retains_unknown_legacy_labels(schedule):
    officer = schedule.officers[0]
    response = schedule.client.put(f"/api/dashboard/officers/manage/{officer.pk}/", {
        "skills": [" First Aid ", "first-aid", "TRAFFIC", " Local expertise ", "local expertise"],
    }, format="json")
    assert response.status_code == 200, response.data
    assert response.data["skills"] == ["first_aid", "traffic_control", "Local expertise"]
    officer.refresh_from_db()
    assert officer.skills == response.data["skills"]


@pytest.mark.parametrize("skills", ["traffic", {"traffic": True}, [1], [None], [" "], ["a" * 101], ["traffic"] * 51])
def test_malformed_skill_writes_are_rejected_without_overwriting_saved_skills(schedule, skills):
    officer = schedule.officers[0]
    Officer.objects.filter(pk=officer.pk).update(skills=["traffic"])
    response = schedule.client.put(f"/api/dashboard/officers/manage/{officer.pk}/", {"skills": skills}, format="json")
    assert response.status_code == 400 and "skills" in response.data
    officer.refresh_from_db()
    assert officer.skills == ["traffic"]


def test_legacy_skill_reads_are_normalized_without_rewriting_the_database(schedule):
    officer = schedule.officers[0]
    legacy = [" Traffic ", "traffic_control", "Local expertise", "", 42]
    Officer.objects.filter(pk=officer.pk).update(skills=legacy)
    response = schedule.client.get("/api/dashboard/officers/")
    row = next(item for item in response.data["results"] if item["id"] == officer.pk)
    assert row["skills"] == ["traffic_control", "Local expertise"]
    officer.refresh_from_db()
    assert officer.skills == legacy
    officer.skills = {"old": "malformed"}
    assert OfficerSerializer(officer).data["skills"] == []


def test_dashboard_preferences_ignore_pending_incidents_and_rank_only_eligible_shift_officers(schedule):
    s = schedule
    Officer.objects.create(name="Wrong shift", badge_number="WRONG", shift="afternoon", skills=["first_aid"])
    Officer.objects.create(name="Off duty", badge_number="OFF", shift="morning", status="off_duty")
    # A precise public report only becomes relevant after staff approve it.
    report = Incident.objects.create(description="Collision nearby", incident_type="collision", severity="major",
        source="public", status="pending", latitude=s.node.latitude, longitude=s.node.longitude, timestamp=timezone.now())
    path = f"/api/dashboard/bottlenecks/?shift=morning&date={s.day}"
    with patch("dashboard.views.rank_candidates_for_bottleneck", wraps=rank_candidates_for_bottleneck) as rank:
        response = s.client.get(path)
    assert response.status_code == 200
    assert response.data["results"][0]["preferred_skills"] == preferred_skills_for(s.node)
    assert {o.pk for o in rank.call_args.args[1]} == {o.pk for o in s.officers}
    report.status = "active"
    report.save(update_fields=["status"])
    response = s.client.get(path)
    assert response.data["results"][0]["preferred_skills"][:2] == ["incident_response", "first_aid"]
    assert APIClient().get(path).status_code == 401


def test_manual_candidate_ranking_uses_preference_order_without_overriding_longer_travel(schedule):
    s = schedule
    first, second, third = s.officers
    for officer in s.officers:
        officer.current_latitude, officer.current_longitude = s.node.latitude, s.node.longitude
    first.skills = []
    second.skills = ["traffic"]
    third.skills = ["intersection"]
    ranked = rank_candidates_for_bottleneck(s.node, s.officers)
    assert [row["officer_id"] for row in ranked] == [third.pk, second.pk, first.pk]
    assert ranked[0]["skill_match"]["matched_skills"] == ["intersection_management"]
    third.current_latitude += 0.1
    ranked = rank_candidates_for_bottleneck(s.node, s.officers)
    assert ranked[-1]["officer_id"] == third.pk
    third.status = "unavailable"
    assert third.pk not in {row["officer_id"] for row in rank_candidates_for_bottleneck(s.node, s.officers)}


def test_missing_skills_and_skill_changes_warn_but_never_block_publication(schedule):
    s = schedule
    s.officers[1].skills = ["intersection_management"]
    s.officers[1].save(update_fields=["skills"])
    save_assessed_snapshot(s)
    Officer.objects.filter(pk=s.officers[1].pk).update(skills=[])
    preview = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert preview.status_code == 200, preview.data
    assert any("changed since optimization" in item for item in preview.data["skill_warnings"])
    assert any("no recorded match" in item for item in preview.data["skill_warnings"])
    assert preview.data["input_issues"] == []
    committed = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert committed.status_code == 201, committed.data
    assert committed.data["skill_warnings"] == preview.data["skill_warnings"]
    assert AuditLog.objects.get(action="publish").changes["skill_warnings"] == preview.data["skill_warnings"]


def test_current_location_preference_changes_are_advisory(schedule):
    s = schedule
    save_assessed_snapshot(s)
    s.node.bottleneck_type = "school_zone"
    s.node.save(update_fields=["bottleneck_type"])
    response = s.client.post("/api/deployments/preview-optimization/", s.payload, format="json")
    assert response.status_code == 200, response.data
    assert any("Preferred skills" in item and "changed since optimization" in item for item in response.data["skill_warnings"])


def test_legacy_recommendations_remain_publishable_with_explicit_unassessed_advice(schedule):
    response = schedule.client.post("/api/deployments/publish-optimization/", schedule.payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["skill_warnings"] == ["Skills were not assessed for this saved run. Re-run optimization to include skill preferences."]


def test_export_uses_saved_skill_explanations_after_roster_changes(schedule):
    s = schedule
    s.officers[1].skills = ["intersection_management"]
    save_assessed_snapshot(s)
    before = export_rows(s)[0]
    Officer.objects.filter(pk=s.officers[1].pk).update(skills=["first_aid"])
    after = export_rows(s)[0]
    assert before == after
    assert before["Skill_Policy_Version"] == SKILL_POLICY_VERSION
    assert "intersection_management" in before["Preferred_Skills"]
    assert f"{s.officers[1].badge_number}: matched" in before["Skill_Match_Statuses"]
    assert "Recorded skill match: Intersection management." in before["Skill_Match_Reasons"]
    assert "first_aid" not in before["Matched_Skills"]


def test_legacy_exports_do_not_fabricate_skill_matches_from_current_roster(schedule):
    Officer.objects.filter(pk__in=[o.pk for o in schedule.officers]).update(skills=["intersection_management"])
    row = export_rows(schedule)[0]
    assert all(row[column] == "" for column in ["Skill_Policy_Version", "Preferred_Skills", "Skill_Match_Statuses", "Matched_Skills", "Skill_Match_Reasons"])


def test_timed_exports_keep_skill_reasons_with_their_actual_assignment_window(schedule):
    s = schedule
    save_assessed_snapshot(s)
    middle = s.start + timedelta(hours=4)
    solution = s.run.result_data["top_solutions"][0]
    solution["time_periods"] = [{"start_time": left.isoformat(), "end_time": right.isoformat(), "requirements": []}
        for left, right in [(s.start, middle), (middle, s.end)]]
    for assignment, period in zip(solution["assignments"], solution["time_periods"]):
        assignment.update(start_time=period["start_time"], end_time=period["end_time"])
        assignment["skill_match"]["explanation"] = f"Saved explanation for officer {assignment['officer_id']}"
    s.run.save()
    rows = export_rows(s)
    assert len(rows) == 2
    for row, officer in zip(rows, s.officers[1:]):
        assert row["Recommended_Badges"] == officer.badge_number
        assert row["Skill_Match_Reasons"] == f"{officer.badge_number}: Saved explanation for officer {officer.pk}"
