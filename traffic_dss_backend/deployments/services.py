"""All schedule mutations share validation and a serialized transaction.

Lock order is bottlenecks, then officers, then deployments. The small operational
roster is locked as a unit so overlapping batches cannot race capacity checks.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from core.models import Bottleneck, Deployment, Officer, OptimizationRun
from core.operational_time import MANILA, operational_date, shift_window
from core.realtime import broadcast
from core.utils import write_audit_log


class ScheduleConflict(APIException):
    status_code = 409
    default_detail = "The proposed schedule is no longer valid."


class AssignmentInput(serializers.Serializer):
    officer = serializers.IntegerField(min_value=1)
    bottleneck = serializers.CharField()
    shift = serializers.ChoiceField(choices=["morning", "afternoon"])
    operational_date = serializers.DateField(required=False)
    start_time = serializers.DateTimeField(required=False)
    end_time = serializers.DateTimeField(required=False)
    assignment_type = serializers.ChoiceField(choices=["static", "mobile", "response"], default="static")
    status = serializers.ChoiceField(choices=["assigned", "completed", "cancelled"], default="assigned")

    def validate(self, data):
        if ("start_time" in data) != ("end_time" in data):
            raise serializers.ValidationError("Provide both start_time and end_time.")
        day = data.pop("operational_date", None)
        if "start_time" in data:
            local_day = data["start_time"].astimezone(MANILA).date()
            if day and day != local_day:
                raise serializers.ValidationError({"operational_date": "Does not match start_time in Asia/Manila."})
            day = local_day
        start, end = shift_window(data["shift"], day or operational_date())
        data.setdefault("start_time", start)
        data.setdefault("end_time", end)
        if not start <= data["start_time"] < data["end_time"] <= end:
            raise serializers.ValidationError({"end_time": "Times must increase and fall inside the selected Manila shift."})
        return data


def lock_schedule():
    nodes = {b.pk: b for b in Bottleneck.objects.select_for_update().order_by("pk")}
    officers = {o.pk: o for o in Officer.objects.select_for_update().order_by("pk")}
    return nodes, officers


def sync_officer_status():
    now = timezone.now()
    active = Deployment.objects.filter(is_deleted=False, status="assigned", start_time__lte=now, end_time__gt=now)
    ids = active.values_list("officer_id", flat=True)
    Officer.objects.filter(is_deleted=False, status="deployed").exclude(pk__in=ids).update(status="available", updated_at=now)
    Officer.objects.filter(is_deleted=False, status="available", pk__in=ids).update(status="deployed", updated_at=now)


def validate_entries(entries, excluded_ids, nodes, officers):
    existing = list(Deployment.objects.filter(is_deleted=False, status="assigned").exclude(pk__in=excluded_ids))
    candidates = []
    for entry in entries:
        officer = officers.get(entry["officer"])
        node = nodes.get(entry["bottleneck"])
        if not officer or officer.is_deleted or not node or node.is_deleted or node.is_archived:
            raise ScheduleConflict("An officer or bottleneck is missing, deleted, or archived. Re-run optimization.")
        if entry["status"] == "assigned":
            if officer.status not in {"available", "deployed"} or officer.shift != entry["shift"]:
                raise ScheduleConflict(f"Officer {officer.badge_number} is not eligible for this shift.")
        candidates.append(Deployment(officer=officer, bottleneck=node, **{k: v for k, v in entry.items() if k not in {"officer", "bottleneck"}}))
    scheduled = existing + [d for d in candidates if d.status == "assigned"]
    for candidate in candidates:
        if candidate.status != "assigned":
            continue
        for other in scheduled:
            if other is candidate:
                continue
            if other.officer_id == candidate.officer_id and other.start_time < candidate.end_time and candidate.start_time < other.end_time:
                raise ScheduleConflict(f"Officer {candidate.officer.badge_number} has an overlapping assignment.")
        events = []
        for other in scheduled:
            if other.bottleneck_id == candidate.bottleneck_id and other.start_time < candidate.end_time and other.end_time > candidate.start_time:
                events.extend([(max(other.start_time, candidate.start_time), 1), (min(other.end_time, candidate.end_time), -1)])
        count = 0
        for _, delta in sorted(events):
            count += delta
            if count > max(1, candidate.bottleneck.max_officers_allowed):
                raise ScheduleConflict(f"Capacity exceeded at {candidate.bottleneck.name}.")
    return candidates


def schedule_event(actor, action, changes):
    write_audit_log(actor, action, "deployment_schedule", changes)
    transaction.on_commit(lambda: broadcast("dashboard_live", "dashboard_event", {
        "event": "deployment_changed", "timestamp": timezone.now().isoformat(), **changes,
    }))


@transaction.atomic
def save_assignment(actor, payload, deployment_id=None):
    nodes, officers = lock_schedule()
    old = None
    if deployment_id:
        old = Deployment.objects.filter(pk=deployment_id, is_deleted=False).first()
        if not old:
            raise ScheduleConflict("Deployment not found.")
        defaults = {k: getattr(old, k) for k in ["shift", "start_time", "end_time", "assignment_type", "status"]}
        payload = {**defaults, "officer": old.officer_id, "bottleneck": old.bottleneck_id, **payload}
    serializer = AssignmentInput(data=payload)
    serializer.is_valid(raise_exception=True)
    candidate = validate_entries([serializer.validated_data], [old.pk] if old else [], nodes, officers)[0]
    if old and old.status in {"cancelled", "completed"} and candidate.status != old.status:
        raise ScheduleConflict("Completed or cancelled deployments cannot be reactivated. Create a new assignment.")
    if candidate.status == "completed" and candidate.end_time > timezone.now():
        raise ScheduleConflict("A deployment cannot be completed before its end time.")
    if old:
        candidate.pk = old.pk
        candidate.created_at = old.created_at
        candidate.source = old.source
    candidate.save()
    sync_officer_status()
    schedule_event(actor, "update" if old else "create", {"deployment_id": candidate.pk})
    return candidate


@transaction.atomic
def publish(actor, payload, preview=False):
    nodes, officers = lock_schedule()
    run = OptimizationRun.objects.filter(run_id=payload.get("run_id"), is_deleted=False).first()
    if not run or run.status != "completed":
        raise ScheduleConflict("Select a completed optimization run.")
    if not isinstance(run.result_data, dict):
        raise ScheduleConflict("Invalid optimization result.")
    if run.result_data.get("synthetic_data_used"):
        raise ScheduleConflict("Simulated results cannot be published. Run again with operational inputs.")
    shift = (run.parameters or {}).get("shift")
    if shift not in {"morning", "afternoon"}:
        raise ScheduleConflict("The run has no valid operational shift. Run optimization again.")
    if payload.get("shift", shift) != shift:
        raise ScheduleConflict("Publication shift must match the optimization run.")
    solutions = (run.result_data or {}).get("top_solutions")
    if not isinstance(solutions, list) or not solutions or not isinstance(solutions[0], dict):
        raise ScheduleConflict("Invalid optimization result.")
    if solutions[0].get("constraints_violated"):
        raise ScheduleConflict("The saved solution violates staffing constraints. Re-run optimization.")
    assignments = solutions[0].get("assignments")
    if not isinstance(assignments, list) or not assignments:
        raise ScheduleConflict("The result contains no assignments.")
    entries = []
    for item in assignments:
        if not isinstance(item, dict):
            raise ScheduleConflict("Invalid assignment in optimization result.")
        serializer = AssignmentInput(data={
            **{k: payload[k] for k in ["operational_date", "start_time", "end_time", "assignment_type"] if k in payload},
            "shift": shift, "officer": item.get("officer_id"), "bottleneck": item.get("bottleneck_id"),
        })
        if not serializer.is_valid():
            raise ScheduleConflict({"detail": "Invalid proposed assignment.", "errors": serializer.errors})
        entries.append(serializer.validated_data)
    first = entries[0]
    replace = payload.get("replace_existing", True)
    if not isinstance(replace, bool):
        raise serializers.ValidationError({"replace_existing": "Must be a boolean."})
    old = list(Deployment.objects.filter(is_deleted=False, status="assigned", shift=shift,
        start_time__lt=first["end_time"], end_time__gt=first["start_time"])) if replace else []
    candidates = validate_entries(entries, [d.pk for d in old], nodes, officers)
    result = {"run_id": run.run_id, "shift": shift, "start_time": first["start_time"], "end_time": first["end_time"],
        "operational_date": first["start_time"].astimezone(MANILA).date(), "created": len(candidates), "skipped": [],
        "staff_added": sorted(set(d.officer_id for d in candidates) - set(d.officer_id for d in old)),
        "staff_removed": sorted(set(d.officer_id for d in old) - set(d.officer_id for d in candidates)),
        "replaced": len(old), "conflicts": []}
    if preview:
        return result
    Deployment.objects.filter(pk__in=[d.pk for d in old]).update(is_deleted=True, status="cancelled", updated_at=timezone.now())
    for candidate in candidates:
        candidate.source = "optimized"
        candidate.save()
    sync_officer_status()
    schedule_event(actor, "publish", {"run_id": run.run_id, "created": len(candidates)})
    return result


@transaction.atomic
def clear_schedule(actor, shift=None, day=None):
    lock_schedule()
    if shift and shift not in {"morning", "afternoon"}:
        raise serializers.ValidationError({"shift": "Unknown shift."})
    queryset = Deployment.objects.filter(is_deleted=False, status="assigned")
    start, _ = shift_window("morning", day)
    _, end = shift_window("afternoon", day)
    queryset = queryset.filter(start_time__lt=end, end_time__gt=start)
    if shift:
        queryset = queryset.filter(shift=shift)
    count = queryset.update(is_deleted=True, status="cancelled", updated_at=timezone.now())
    sync_officer_status()
    schedule_event(actor, "clear", {"cleared": count})
    return count
