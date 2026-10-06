from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
import csv
from io import StringIO

import pytest
from django.utils import timezone

from core.models import Bottleneck, Deployment
from core.serializers import BottleneckSerializer
from core.staffing import required_staffing, staffing_windows
from core.tests_review_fixes import schedule
from deployments.services import schedule_version, save_assignment, ScheduleConflict
from optimization.tasks import run_optimization
from optimization.engine import GeneticDeploymentOptimizer
from optimization.scheduling import run_schedule

pytestmark = pytest.mark.django_db


def period(start, end, required, **extra):
    return {"start": start, "end": end, "required": required, **extra}


def make_run(s, periods, minimum=0):
    s.node.min_officers_required = minimum
    s.node.staffing_periods = periods
    s.node.save()
    s.run.status = "queued"
    s.run.parameters.update({"population_size":50, "generations":50})
    s.run.save()
    run_optimization(s.run.run_id)
    s.run.refresh_from_db()
    s.payload.update(expected_revision=schedule_version("morning",s.day),
                     input_override_reason="Controlled test with manually verified inputs")
    return s.run.result_data["top_solutions"][0]


def test_zero_normal_staffing_and_time_boundaries(schedule):
    s=schedule
    s.node.min_officers_required=0
    s.node.staffing_periods=[period("07:00","09:00",2,days=[s.day.weekday()])]
    assert required_staffing(s.node,at=s.start)==0
    assert required_staffing(s.node,at=s.start+timedelta(hours=1))==2
    assert required_staffing(s.node,at=s.start+timedelta(hours=3))==0
    assert required_staffing(s.node,at=s.start+timedelta(days=1,hours=1))==0
    assert required_staffing(s.node,[SimpleNamespace(severity="critical")],s.start)==1
    assert [w["required"] for w in staffing_windows(s.node,s.start,s.end)]==[0,2,0]


@pytest.mark.parametrize("periods,cap", [
    ([period("07:00","09:00",2),period("08:00","10:00",1)],4),
    ([period("07:00","09:00",-1)],4),([period("07:00","09:00",5)],4),
    ([period("09:00","07:00",2)],4),([period("07:01","09:00",2)],4),
    ([period("07:00","09:00",2,days=[])],4),([period("07:00","09:00",True)],4),
])
def test_invalid_staffing_profiles_rejected(schedule,periods,cap):
    serializer=BottleneckSerializer(schedule.node,data={"staffing_periods":periods,"max_officers_allowed":cap},partial=True)
    assert not serializer.is_valid() and "staffing_periods" in serializer.errors


def test_zero_capacity_and_distinct_weekday_periods_are_valid(schedule):
    serializer=BottleneckSerializer(schedule.node,data={"min_officers_required":0,"max_officers_allowed":0,
        "staffing_periods":[period("07:00","09:00",0,days=[0]),period("07:00","09:00",0,days=[1])]},partial=True)
    assert serializer.is_valid(),serializer.errors


def test_optimizer_excludes_zero_demand_locations_from_coverage():
    nodes=[{"id":"FREE","name":"Free","latitude":10.7,"longitude":122.5,"min_officers_required":0,"staffing_target":0,"max_officers_allowed":5},
           {"id":"NEED","name":"Needed","latitude":10.7,"longitude":122.5,"min_officers_required":2,"staffing_target":2,"max_officers_allowed":5}]
    result=GeneticDeploymentOptimizer(seed=2).run([{"id":i} for i in range(5)],nodes,{"population_size":50,"generations":50})
    for solution in result.top_solutions:
        assert len(solution["assignments"])==2
        assert all(a["bottleneck_id"]=="NEED" for a in solution["assignments"])
        assert solution["coverage_efficiency"]==100 and not solution["constraints_violated"]
    empty=GeneticDeploymentOptimizer(seed=2).run([],nodes[:1],{"population_size":50,"generations":50})
    assert empty.status=="completed" and empty.top_solutions[0]["assignments"]==[]


def test_timed_worker_publication_and_coverage_use_same_requirements(schedule):
    s=schedule
    solution=make_run(s,[period("07:00","09:00",2,label="Peak"),period("10:00","14:00",1,label="Normal")])
    assert s.run.status=="completed"
    assert s.run.result_data["input_snapshot"]["schema_version"]==4
    assert [p["assigned_officers"] for p in solution["time_periods"]]==[0,2,0,1]
    assert not solution["constraints_violated"]
    preview=s.client.post("/api/deployments/preview-optimization/",s.payload,format="json")
    assert preview.status_code==200,preview.data
    s.payload["expected_revision"]=preview.data["expected_revision"]
    response=s.client.post("/api/deployments/publish-optimization/",s.payload,format="json")
    assert response.status_code==201,response.data
    rows=list(Deployment.objects.filter(status="assigned",is_deleted=False))
    for hour,expected in [(6,0),(7,2),(8,2),(9,0),(10,1),(13,1)]:
        instant=s.start+timedelta(hours=hour-6)
        assert sum(d.start_time<=instant<d.end_time for d in rows)==expected
    kpis=s.client.get(f"/api/dashboard/kpis/?date={s.day}&shift=morning").data
    assert kpis["required_staffing"]==1 and kpis["assigned_staffing"]==1
    assert kpis["coverage_efficiency"]==100 and kpis["shortages"]==0
    retry=s.client.post("/api/deployments/publish-optimization/",s.payload,format="json")
    assert retry.status_code==201 and Deployment.objects.filter(status="assigned").count()==len(rows)
    export=s.client.get(f"/api/optimization/export/{s.run.run_id}/")
    records=list(csv.DictReader(StringIO(export.content.decode())))
    assert [int(r["App_Recommended_Officers"]) for r in records]==[0,2,0,1]


def test_all_zero_recommendation_can_release_future_schedule(schedule):
    s=schedule
    solution=make_run(s,[])
    assert solution["assignments"]==[] and not solution["constraints_violated"]
    response=s.client.post("/api/deployments/publish-optimization/",s.payload,format="json")
    assert response.status_code==201,response.data
    assert response.data["created"]==0
    s.old.refresh_from_db()
    assert s.old.status=="cancelled"
    assert s.client.get(f"/api/dashboard/kpis/?date={s.day}&shift=morning").data["coverage_efficiency"]==100


def test_new_demand_blocks_old_zero_plan_without_mutation(schedule):
    s=schedule
    make_run(s,[])
    s.node.staffing_periods=[period("07:00","08:00",1)]
    s.node.save()
    response=s.client.post("/api/deployments/publish-optimization/",s.payload,format="json")
    assert response.status_code==409
    s.old.refresh_from_db()
    assert s.old.status=="assigned" and s.run.publications.count()==0


def test_timed_plan_cannot_hide_a_gap_or_extend_a_zero_period(schedule):
    s=schedule
    make_run(s,[period("07:00","09:00",1)])
    s.run.result_data["top_solutions"][0]["assignments"][0]["end_time"]=s.end.isoformat()
    s.run.save()
    response=s.client.post("/api/deployments/preview-optimization/",s.payload,format="json")
    assert response.status_code==409 and "staffing_gaps" in response.data


def test_completed_history_survives_mid_shift_edit(schedule):
    s=schedule
    now=s.start+timedelta(hours=1)
    with patch("deployments.services.timezone.now",return_value=now):
        saved=save_assignment(s.user,{"officer":s.officers[0].pk,"bottleneck":s.node.pk,"shift":"morning",
            "start_time":now.isoformat(),"end_time":(now+timedelta(hours=1)).isoformat(),"override_reason":"Supervisor releases this post early"},s.old.pk)
    s.old.refresh_from_db()
    assert s.old.end_time==now and s.old.status=="completed"
    assert saved.pk!=s.old.pk and saved.start_time==now


def test_manual_edits_reject_stale_versions_and_backdating(schedule):
    s=schedule
    with pytest.raises(ScheduleConflict,match="changed"):
        save_assignment(s.user,{"expected_updated_at":"old-version"},s.old.pk)
    with patch("deployments.services.timezone.now",return_value=s.start+timedelta(hours=1)):
        with pytest.raises(ScheduleConflict,match="present or future"):
            save_assignment(s.user,{"officer":s.officers[1].pk,"bottleneck":s.node.pk,"shift":"morning",
                "start_time":s.start.isoformat(),"end_time":s.end.isoformat()})


def test_active_assignment_edit_requires_travel_from_previous_post(schedule):
    s=schedule
    other=Bottleneck.objects.create(id="TRANSFER",name="Next intersection",latitude=s.node.latitude+0.01,
        longitude=s.node.longitude,min_officers_required=0,max_officers_allowed=4)
    now=s.start+timedelta(hours=1)
    payload={"bottleneck":other.pk,"start_time":now.isoformat(),"end_time":s.end.isoformat(),"override_reason":"Supervisor requests temporary reassignment"}
    with patch("deployments.services.timezone.now",return_value=now):
        with pytest.raises(ScheduleConflict,match="travel gap"):
            save_assignment(s.user,payload,s.old.pk)
        s.old.refresh_from_db()
        assert s.old.status=="assigned" and s.old.end_time==s.end
        payload["start_time"]=(now+timedelta(minutes=30)).isoformat()
        saved=save_assignment(s.user,payload,s.old.pk)
    assert saved.bottleneck_id==other.pk
    s.old.refresh_from_db()
    assert s.old.end_time==now and s.old.status=="completed"


def test_scheduler_leaves_travel_gap_when_changing_intersection(schedule):
    s=schedule
    midpoint=s.start+timedelta(hours=1)
    later=midpoint+timedelta(minutes=30)
    nodes=[]
    for name,lat,windows in [
        ("A",10.7,[(s.start,midpoint,1),(midpoint,s.end,0)]),
        ("B",10.71,[(s.start,later,0),(later,s.end,1)])]:
        nodes.append({"id":name,"name":name,"latitude":lat,"longitude":122.5,"tsi":0,"max_officers_allowed":2,
            "staffing_windows":[{"start_time":left.isoformat(),"end_time":right.isoformat(),"required":count,"reason":"Test"} for left,right,count in windows]})
    result=run_schedule(officers=[{"id":1}],bottlenecks=nodes,parameters={"population_size":50,"generations":50},seed=2)
    assert not result.top_solutions[0]["constraints_violated"]
    assignments=result.top_solutions[0]["assignments"]
    assert len(assignments)==2 and assignments[0]["end_time"]==midpoint.isoformat() and assignments[1]["start_time"]==later.isoformat()
    nodes[1]["staffing_windows"][0]["end_time"]=midpoint.isoformat()
    nodes[1]["staffing_windows"][1]["start_time"]=midpoint.isoformat()
    result=run_schedule(officers=[{"id":1}],bottlenecks=nodes,parameters={"population_size":50,"generations":50},seed=2)
    assert result.top_solutions[0]["constraints_violated"]


def test_location_api_saves_and_returns_staffing_profile(schedule):
    s=schedule
    response=s.client.put(f"/api/dashboard/bottlenecks/manage/{s.node.pk}/",{
        "area_name":"Prime State","signal_status":"working","min_officers_required":0,
        "staffing_periods":[period("07:00","09:00",1)]},format="json")
    assert response.status_code==200,response.data
    s.node.refresh_from_db()
    assert s.node.min_officers_required==0 and s.node.area_name=="Prime State"
    rows=s.client.get(f"/api/dashboard/bottlenecks/?date={s.day}&shift=morning").data["results"]
    assert [w["required"] for w in rows[0]["staffing_windows"]]==[0,1,0]
