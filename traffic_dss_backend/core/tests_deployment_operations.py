from datetime import timedelta
from unittest.mock import patch
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import AuditLog, Deployment, FieldObservation, Incident, OfficerTimeBlock
from core.tests_review_fixes import schedule
from core.tests_timed_deployment import make_run, period
from deployments.services import save_assignment, ScheduleConflict

pytestmark = pytest.mark.django_db


def test_current_map_counts_exclude_future_assignments_and_protect_names(schedule):
    s = schedule
    s.old.start_time = s.start + timedelta(hours=2)
    s.old.save()
    with patch("dashboard.views.timezone.now", return_value=s.start):
        response = s.client.get(f"/api/dashboard/bottlenecks/?date={s.day}&shift=morning")
        node = response.data["results"][0]
        assert node["current_assigned"] == 0 and node["current_required"] == 1
        assert node["deployed_officers"] == .75
    with patch("dashboard.views.timezone.now", return_value=s.start+timedelta(hours=2)):
        node = APIClient().get(f"/api/dashboard/bottlenecks/?date={s.day}&shift=morning").data["results"][0]
        assert node["current_assigned"] == 1 and node["current_assigned_officers"] == []


def test_manual_excess_and_shortage_need_audited_reasons(schedule):
    s = schedule
    payload = {"officer": s.officers[1].pk, "bottleneck": s.node.pk, "shift": "morning", "operational_date": str(s.day)}
    with pytest.raises(ScheduleConflict, match="override"):
        save_assignment(s.user, payload)
    saved = save_assignment(s.user, {**payload, "override_reason": "School crossing needs temporary support"})
    assert saved.override_reason == "School crossing needs temporary support"
    assert AuditLog.objects.filter(changes__deployment_id=saved.pk).exists()
    saved.status = "cancelled"
    saved.save()
    with pytest.raises(ScheduleConflict, match="override"):
        save_assignment(s.user, {"status":"cancelled"}, s.old.pk)
    save_assignment(s.user, {"status":"cancelled", "override_reason":"Supervisor releases post for emergency response"}, s.old.pk)


def test_reason_does_not_bypass_overlap_or_capacity(schedule):
    s=schedule
    with pytest.raises(ScheduleConflict, match="overlapping"):
        save_assignment(s.user,{"officer":s.officers[0].pk,"bottleneck":s.node.pk,"shift":"morning",
            "operational_date":str(s.day),"override_reason":"Emergency staffing override approved"})


def test_time_blocks_protect_assignments_and_optimizer(schedule):
    s=schedule
    payload={"officer":s.officers[1].pk,"kind":"break","start_time":s.start.isoformat(),
             "end_time":(s.start+timedelta(hours=1)).isoformat(),"note":"Meal break"}
    response=s.client.post("/api/deployments/time-blocks/",payload,format="json")
    assert response.status_code==201,response.data
    block_id=response.data["id"]
    assert s.client.post("/api/deployments/time-blocks/",payload,format="json").status_code==409
    with pytest.raises(ScheduleConflict,match="reservation"):
        save_assignment(s.user,{"officer":s.officers[1].pk,"bottleneck":s.node.pk,"shift":"morning",
            "operational_date":str(s.day),"override_reason":"Temporary extra staffing requested"})
    solution=make_run(s,[],minimum=1)
    assert not solution["constraints_violated"]
    assert len(solution["time_periods"])==2
    assert not any(a["officer_id"]==s.officers[1].pk and a["start_time"]<payload["end_time"] for a in solution["assignments"])
    assert s.client.delete(f"/api/deployments/time-blocks/?id={block_id}").status_code==204
    assert OfficerTimeBlock.objects.get(pk=block_id).is_deleted


@pytest.mark.parametrize("change", ["past", "shift", "overlap", "ineligible"])
def test_invalid_time_reservations_are_rejected(schedule, change):
    s=schedule
    payload={"officer":s.officers[1].pk,"kind":"travel","start_time":s.start.isoformat(),"end_time":s.end.isoformat()}
    if change=="past": payload.update(start_time=(s.start-timedelta(days=2)).isoformat(),end_time=(s.end-timedelta(days=2)).isoformat())
    elif change=="shift": payload["end_time"]=(s.end+timedelta(hours=1)).isoformat()
    elif change=="overlap": payload["officer"]=s.officers[0].pk
    else:
        s.officers[1].status="unavailable";s.officers[1].save()
    assert s.client.post("/api/deployments/time-blocks/",payload,format="json").status_code in [400,409]
    assert not OfficerTimeBlock.objects.exists()


def test_publication_rechecks_new_reservations(schedule):
    s=schedule
    solution=make_run(s,[],minimum=1)
    a=solution["assignments"][0]
    OfficerTimeBlock.objects.create(officer_id=a["officer_id"],start_time=s.start,end_time=s.end,kind="break",created_by=s.user)
    response=s.client.post("/api/deployments/preview-optimization/",s.payload,format="json")
    assert response.status_code==409 and "reservation" in str(response.data)


def test_all_officers_reserved_exposes_shortages_and_blocks_publication(schedule):
    s=schedule
    for officer in s.officers:
        OfficerTimeBlock.objects.create(officer=officer,start_time=s.start+timedelta(hours=1),end_time=s.start+timedelta(hours=2),kind="break",created_by=s.user)
    solution=make_run(s,[],minimum=1)
    assert solution["constraints_violated"]
    assert solution["time_periods"][1]["assigned_officers"]==0
    assert solution["time_periods"][1]["reserve_officers"]==0
    assert solution["time_periods"][1]["staffing_shortages"][s.node.pk]==1
    assert s.client.post("/api/deployments/preview-optimization/",s.payload,format="json").status_code==409


def test_review_detects_profile_eligibility_and_resolved_incident_changes(schedule):
    s=schedule
    make_run(s,[],minimum=1)
    response=s.client.post("/api/deployments/publish-optimization/",s.payload,format="json")
    assert response.status_code==201,response.data
    path=f"/api/deployments/review/?date={s.day}&shift=morning"
    assert not s.client.get(path).data["needs_review"]
    s.node.signal_status="out_of_order";s.node.save()
    assigned=Deployment.objects.filter(status="assigned").first().officer
    assigned.status="unavailable";assigned.save()
    Incident.objects.create(bottleneck=s.node,reported_by=s.user,description="Cleared obstruction",severity="minor",status="resolved",incident_type="collision",timestamp=timezone.now())
    reasons=str(s.client.get(path).data["issues"])
    assert "profile changed" in reasons and "eligible" in reasons and "Incident changed" in reasons


def test_field_observations_capture_comparison_and_remain_immutable(schedule):
    s=schedule
    at=s.start+timedelta(minutes=30)
    s.node.area_name="Prime State";s.node.save()
    with patch("deployments.operations.timezone.now",return_value=at):
        response=s.client.post("/api/deployments/observations/",{"bottleneck":s.node.pk,"observed_at":at.isoformat(),
            "actual_officers":0,"traffic":"free","note":"Observed clear flow","required_officers":99},format="json")
    assert response.status_code==201,response.data
    assert response.data["required_officers"]==1 and response.data["scheduled_officers"]==1
    assert response.data["actual_officers"]==0 and response.data["area_name"]=="Prime State"
    s.node.min_officers_required=3;s.node.save()
    assert FieldObservation.objects.get().required_officers==1
    assert len(s.client.get(f"/api/deployments/observations/?date={s.day}").data)==1


def test_future_observation_and_dispatcher_writes_rejected(schedule):
    s=schedule
    payload={"bottleneck":s.node.pk,"observed_at":s.start.isoformat(),"actual_officers":0,"traffic":"free"}
    assert s.client.post("/api/deployments/observations/",payload,format="json").status_code==400
    dispatcher=get_user_model().objects.create_user(username="readonly-dispatcher")
    s.client.force_authenticate(dispatcher)
    for endpoint in ["observations", "time-blocks"]:
        assert s.client.post(f"/api/deployments/{endpoint}/",payload,format="json").status_code==403
    assert s.client.get(f"/api/deployments/review/?date={s.day}").status_code==200
