"""Remaining-shift continuity and saved score explanations, using isolated data."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.models import Bottleneck, Deployment, Officer, OfficerTimeBlock
from core.tests_review_fixes import schedule
from deployments.services import ScheduleConflict, publish, schedule_version, validate_planning_origins
from optimization.engine import GeneticDeploymentOptimizer
from optimization.planning import planning_window
from optimization.scheduling import run_schedule, search_count
from optimization.scoring import accumulate_breakdown
from optimization.tasks import capture_inputs, run_optimization
from optimization.travel import transfer_seconds_available


pytestmark = pytest.mark.django_db


def params(s, **extra):
    return {"shift": "morning", "mode": "operational", "operational_date": str(s.day),
            "population_size": 50, "generations": 50, **extra}


def run_now(s, moment):
    s.run.status = "queued"
    s.run.parameters = params(s)
    s.run.save()
    with patch("django.utils.timezone.now", return_value=moment):
        run_optimization(s.run.run_id)
    s.run.refresh_from_db()
    return s.run.result_data


def total_from_breakdown(value):
    return (sum(row["contribution"] for row in value["components"])
            + value["incident_bonus"]["contribution"] + value["constraint_adjustment"] + value["rounding_adjustment"])


def test_planning_window_allows_review_and_keeps_shadow_and_future_shifts_whole(schedule):
    s = schedule
    now = s.start+timedelta(hours=3, seconds=12)
    assert planning_window(params(s), now) == (s.start+timedelta(hours=3, minutes=3), s.end)
    assert planning_window(params(s, mode="shadow"), now) == (s.start, s.end)
    assert planning_window(params(s), s.start-timedelta(hours=1)) == (s.start, s.end)
    assert planning_window(params(s), s.end)[0] >= s.end


def test_capture_uses_current_post_but_not_future_replacement_assignments(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    Deployment.objects.create(officer=s.officers[1], bottleneck=s.node, shift="morning",
        start_time=now+timedelta(minutes=20), end_time=s.end)
    officers, nodes, _ = capture_inputs(params(s), now=now)
    by_id = {row["id"]: row for row in officers}
    cutoff = now+timedelta(minutes=2)
    assert by_id[s.officers[0].pk]["initial_position"]["end"] == cutoff.isoformat()
    assert by_id[s.officers[0].pk]["initial_position"]["deployment_id"] == s.old.pk
    assert "initial_position" not in by_id[s.officers[1].pk]
    assert datetime.fromisoformat(nodes[0]["staffing_windows"][0]["start_time"]) == cutoff
    assert by_id[s.officers[0].pk]["travel_ready_times"]
    shadow, shadow_nodes, _ = capture_inputs(params(s, mode="shadow"), now=now)
    assert not any(row.get("initial_position") for row in shadow)
    assert datetime.fromisoformat(shadow_nodes[0]["staffing_windows"][0]["start_time"]) == s.start


def test_committed_post_before_cutover_is_honored_without_claiming_it_is_current(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    s.old.end_time = now+timedelta(seconds=30)
    s.old.save()
    destination = Bottleneck.objects.create(id="PREFIX-B", name="B", latitude=s.node.latitude,
        longitude=s.node.longitude, min_officers_required=1, max_officers_allowed=2)
    committed = Deployment.objects.create(officer=s.officers[0], bottleneck=destination, shift="morning",
        start_time=now+timedelta(minutes=1), end_time=s.end)
    officers, _, _ = capture_inputs(params(s), now=now)
    origin = next(row for row in officers if row["id"] == s.officers[0].pk)["initial_position"]
    assert origin["deployment_id"] == committed.pk
    assert origin["node_id"] == destination.pk
    assert origin["source"] == "published_before_cutover"
    assert datetime.fromisoformat(origin["end"]) == now+timedelta(minutes=2)


def test_capture_keeps_recent_completed_origin_and_breaks_before_the_horizon(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    s.old.end_time, s.old.status = now-timedelta(minutes=3), "completed"
    s.old.save()
    OfficerTimeBlock.objects.create(officer=s.officers[0], kind="break", start_time=now-timedelta(minutes=3),
        end_time=now+timedelta(minutes=1), created_by=s.user)
    officers, _, _ = capture_inputs(params(s), now=now)
    person = next(row for row in officers if row["id"] == s.officers[0].pk)
    release = datetime.fromisoformat(person["initial_position"]["end"])
    assert release == now-timedelta(minutes=3)
    assert len(person["time_blocks"]) == 1
    assert transfer_seconds_available(person, release, now+timedelta(minutes=2)) == 60


def test_merged_breaks_are_not_transfer_time():
    start = datetime.fromisoformat("2099-01-01T08:00:00+08:00")
    person = {"time_blocks": [{"start_time": (start+timedelta(minutes=a)).isoformat(),
        "end_time": (start+timedelta(minutes=b)).isoformat(), "kind": "break"} for a, b in [(0, 10), (5, 20)]]}
    assert transfer_seconds_available(person, start, start+timedelta(minutes=25)) == 5*60


def test_later_release_can_transfer_within_the_same_staffing_period_without_repeated_search(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    Officer.objects.exclude(pk=s.officers[0].pk).update(status="unavailable")
    s.node.min_officers_required = 0
    s.node.staffing_periods = [{"start": "06:00", "end": "10:00", "required": 1}]
    s.node.save()
    target = Bottleneck.objects.create(id="LATER-B", name="Later destination", latitude=s.node.latitude+0.025,
        longitude=s.node.longitude, min_officers_required=0, max_officers_allowed=2,
        staffing_periods=[{"start": "10:00", "end": "14:00", "required": 1}])
    officers, nodes, _ = capture_inputs(params(s), now=now)
    original = GeneticDeploymentOptimizer.run
    searches = []

    def observe(self, *args, **kwargs):
        searches.append(kwargs["bottlenecks"])
        return original(self, *args, **kwargs)

    with patch.object(GeneticDeploymentOptimizer, "run", observe):
        result = run_schedule(officers=officers, bottlenecks=nodes, parameters=params(s))
    assert search_count(nodes, officers) == 2 and len(searches) == 2
    for solution in result.top_solutions:
        later = [row for row in solution["assignments"] if row["bottleneck_id"] == target.pk]
        assert later
        assert s.start+timedelta(hours=4) < datetime.fromisoformat(later[0]["start_time"]) < s.start+timedelta(hours=4, minutes=20)
        assert solution["constraints_violated"]  # A real temporary gap is reported, never hidden.
        assert total_from_breakdown(solution["score_breakdown"]) == pytest.approx(solution["fitness"])
    assert len(result.generation_fitness) <= 2*50


def test_worker_saves_remaining_window_readiness_origins_and_exact_final_score(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    data = run_now(s, now)
    assert s.run.status == "completed"
    snapshot = data["input_snapshot"]
    assert datetime.fromisoformat(snapshot["planning_window"]["start_time"]) == now+timedelta(minutes=2)
    assert snapshot["planning_window"]["baseline_revision"]
    assert snapshot["readiness"]["checked_at"] == snapshot["captured_at"]
    solution = data["top_solutions"][0]
    assert {row["officer_id"] for row in solution["assignments"]} == {s.officers[0].pk}
    assert all(datetime.fromisoformat(row["start_time"]) >= now+timedelta(minutes=2) for row in solution["assignments"])
    assert total_from_breakdown(solution["score_breakdown"]) == pytest.approx(data["best_fitness"])
    assert solution["score_breakdown"]["basis"] == "time_weighted_final_assignments"


def test_publication_preserves_the_published_prefix_until_the_saved_cutover(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    data = run_now(s, now)
    cutoff = datetime.fromisoformat(data["input_snapshot"]["planning_window"]["start_time"])
    payload = {**s.payload, "expected_revision": schedule_version("morning", s.day),
        "input_override_reason": "Controlled verification of the captured inputs"}
    with patch("django.utils.timezone.now", return_value=now):
        preview = publish(s.user, payload, preview=True)
        assert preview["start_time"] == cutoff
        assert Deployment.objects.count() == 1
        result = publish(s.user, {**payload, "expected_revision": preview["expected_revision"]})
    assert result["created"] == 1
    s.old.refresh_from_db()
    assert s.old.start_time == s.start and s.old.end_time == cutoff and s.old.status == "assigned"
    suffix = Deployment.objects.get(source="optimized")
    assert suffix.start_time == cutoff and suffix.end_time == s.end


def test_delayed_publication_cannot_backdate_release_for_a_transfer(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    cutoff = now+timedelta(minutes=2)
    destination = Bottleneck.objects.create(id="MOVE-B", name="B", latitude=s.node.latitude+0.04,
        longitude=s.node.longitude, min_officers_required=1, max_officers_allowed=1)
    candidate = Deployment(officer=s.officers[0], bottleneck=destination, shift="morning",
        start_time=cutoff+timedelta(minutes=10), end_time=s.end)
    snapshot = {"planning_window": {"start_time": cutoff.isoformat()}, "weather": {"impact_factor": 1}}
    validate_planning_origins(snapshot, [candidate], cutoff, now)
    with pytest.raises(ScheduleConflict, match="cannot backdate"):
        validate_planning_origins(snapshot, [candidate], now+timedelta(minutes=7), now+timedelta(minutes=7))


def test_publication_rechecks_recent_completed_origins_and_breaks(schedule):
    s = schedule
    now = s.start+timedelta(hours=3)
    s.old.end_time, s.old.status = now-timedelta(minutes=1), "completed"
    s.old.save()
    destination = Bottleneck.objects.create(id="BREAK-B", name="B", latitude=s.node.latitude+0.04,
        longitude=s.node.longitude, min_officers_required=1, max_officers_allowed=1)
    candidate = Deployment(officer=s.officers[0], bottleneck=destination, shift="morning",
        start_time=now+timedelta(minutes=10), end_time=s.end)
    OfficerTimeBlock.objects.create(officer=s.officers[0], kind="break", start_time=s.old.end_time,
        end_time=now+timedelta(minutes=5), created_by=s.user)
    with pytest.raises(ScheduleConflict, match="cannot backdate"):
        validate_planning_origins({"planning_window": {"start_time": now.isoformat()}}, [candidate], now, now)


@pytest.mark.parametrize("change", ["outside", "gap"])
def test_invalid_saved_remaining_window_cannot_publish(schedule, change):
    s = schedule
    now = s.start+timedelta(hours=3)
    run_now(s, now)
    if change == "outside":
        s.run.result_data["input_snapshot"]["planning_window"]["start_time"] = (s.start-timedelta(minutes=1)).isoformat()
    else:
        s.run.result_data["top_solutions"][0]["time_periods"][0]["start_time"] = (now+timedelta(minutes=3)).isoformat()
    s.run.save()
    with patch("django.utils.timezone.now", return_value=now), pytest.raises(ScheduleConflict):
        publish(s.user, {**s.payload, "input_override_reason": "Controlled manual input verification"}, preview=True)
    s.old.refresh_from_db()
    assert s.old.end_time == s.end


def test_ended_operational_worker_never_falls_back_to_an_untimed_search(schedule):
    s = schedule
    s.run.status, s.run.parameters = "queued", params(s)
    s.run.save()
    with patch("django.utils.timezone.now", return_value=s.end), patch.object(GeneticDeploymentOptimizer, "run") as search:
        with pytest.raises(ValueError, match="No planning time"):
            run_optimization(s.run.run_id)
        search.assert_not_called()
    s.run.refresh_from_db()
    assert s.run.status == "failed"


def test_static_breakdown_explains_incident_bonus_and_constraints_without_changing_fitness():
    engine = GeneticDeploymentOptimizer(seed=1)
    people = [{"id": 1}, {"id": 2}]
    nodes = [{"id": "A", "latitude": 10.72, "longitude": 122.56, "tsi": 0,
        "road_priority_weight": 1, "min_officers_required": 1, "staffing_target": 1, "max_officers_allowed": 2}]
    weights = engine._clamp_parameters({})
    bonus = {0: {"priority_boost": 1, "incident_count": 1}}
    good = engine._evaluate([0, -1], people, nodes, 1, weights, bonus, explain=True)
    bad = engine._evaluate([0, 0], people, nodes, 1, weights, bonus, explain=True)
    assert good["fitness"] > 100
    assert good["score_breakdown"]["incident_bonus"]["contribution"] == 15
    assert bad["score_breakdown"]["constraint_adjustment"] < 0
    for row in (good, bad):
        assert total_from_breakdown(row["score_breakdown"]) == pytest.approx(row["fitness"])
    aggregate = accumulate_breakdown(None, good["score_breakdown"], 0.25)
    aggregate = accumulate_breakdown(aggregate, bad["score_breakdown"], 0.75)
    assert total_from_breakdown(aggregate) == pytest.approx(good["fitness"]*0.25+bad["fitness"]*0.75)
    assert aggregate["total"] == pytest.approx(good["fitness"]*0.25+bad["fitness"]*0.75)
