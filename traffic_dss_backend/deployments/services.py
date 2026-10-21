"""All schedule mutations share validation and a serialized transaction.

Lock order is bottlenecks, then officers, then deployments. The small operational
roster is locked as a unit so overlapping batches cannot race capacity checks.
"""
import json
from copy import copy
from hashlib import sha256
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from core.models import Bottleneck, Deployment, Incident, Officer, OfficerTimeBlock, OptimizationRun, ScheduleRevision
from core.operational_time import MANILA, operational_date, shift_window
from core.realtime import broadcast
from core.utils import write_audit_log
from core.staffing import required_staffing, staffing_windows
from core.skills import SKILL_POLICY_VERSION, normalize_skills, preferred_skills_for, skill_match
from datetime import datetime, timedelta
from geopy.distance import geodesic
from optimization.input_policy import input_issues
from optimization.travel import transfer_seconds_available


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
    override_reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

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
    released = Officer.objects.filter(is_deleted=False, status="deployed").exclude(pk__in=ids).update(status="available", updated_at=now)
    activated = Officer.objects.filter(is_deleted=False, status="available", pk__in=ids).update(status="deployed", updated_at=now)
    return released + activated


def schedule_version(shift, day):
    start, end = shift_window(shift, day)
    rows = list(Deployment.objects.filter(shift=shift, start_time__lt=end, end_time__gt=start).order_by("pk").values(
        "id", "officer_id", "bottleneck_id", "start_time", "end_time", "status", "assignment_type", "source", "revision_id", "is_deleted", "updated_at"))
    return sha256(json.dumps(rows, cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()


def assignment_snapshot(row):
    return {"deployment_id": row.pk, "officer_id": row.officer_id, "officer_name": row.officer.name,
            "badge_number": row.officer.badge_number, "bottleneck_id": row.bottleneck_id,
            "bottleneck_name": row.bottleneck.name, "start_time": row.start_time.isoformat(),
            "end_time": row.end_time.isoformat(), "status": row.status, "source": row.source,
            "assignment_type": row.assignment_type, "override_reason": row.override_reason}


def validate_entries(entries, excluded_ids, nodes, officers, preserved=()):
    existing = list(Deployment.objects.filter(is_deleted=False, status="assigned").exclude(pk__in=excluded_ids).select_related("bottleneck"))
    existing.extend(preserved)
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
        if OfficerTimeBlock.objects.filter(officer_id=candidate.officer_id, is_deleted=False,
                start_time__lt=candidate.end_time, end_time__gt=candidate.start_time).exists():
            raise ScheduleConflict("Officer has a break or travel reservation in this time window.")
        for other in scheduled:
            if other is candidate:
                continue
            if other.officer_id == candidate.officer_id and other.start_time < candidate.end_time and candidate.start_time < other.end_time:
                raise ScheduleConflict(f"Officer {candidate.officer.badge_number} has an overlapping assignment.")
            if other.officer_id == candidate.officer_id and other.bottleneck_id != candidate.bottleneck_id:
                earlier, later = (other, candidate) if other.end_time <= candidate.start_time else (candidate, other)
                distance = geodesic((earlier.bottleneck.latitude, earlier.bottleneck.longitude),
                                    (later.bottleneck.latitude, later.bottleneck.longitude)).km
                travel_seconds = distance / max(8, 28 * (1 - later.bottleneck.tsi)) * 3600
                blocks = [{"start_time": block.start_time.isoformat(), "end_time": block.end_time.isoformat(), "kind": block.kind}
                    for block in OfficerTimeBlock.objects.filter(officer_id=candidate.officer_id, is_deleted=False,
                        kind="break", start_time__lt=later.start_time, end_time__gt=earlier.end_time)]
                if transfer_seconds_available({"time_blocks": blocks}, earlier.end_time, later.start_time) < travel_seconds:
                    raise ScheduleConflict(f"Officer {candidate.officer.badge_number} needs a travel gap before changing intersections.")
        events = []
        for other in scheduled:
            if other.bottleneck_id == candidate.bottleneck_id and other.start_time < candidate.end_time and other.end_time > candidate.start_time:
                events.extend([(max(other.start_time, candidate.start_time), 1), (min(other.end_time, candidate.end_time), -1)])
        count = 0
        for _, delta in sorted(events):
            count += delta
            if count > max(0, candidate.bottleneck.max_officers_allowed):
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
    now = timezone.now()
    explicit_start = "start_time" in payload
    old = None
    if deployment_id:
        old = Deployment.objects.filter(pk=deployment_id, is_deleted=False).first()
        if not old:
            raise ScheduleConflict("Deployment not found.")
        if old.status in {"completed", "cancelled"} or old.end_time <= now:
            raise ScheduleConflict("Elapsed, completed or cancelled assignments cannot be edited.")
        if payload.get("expected_updated_at") and payload["expected_updated_at"] != old.updated_at.isoformat():
            raise ScheduleConflict("This assignment changed. Refresh the Gantt chart and try again.")
        defaults = {k: getattr(old, k) for k in ["shift", "start_time", "end_time", "assignment_type", "status"]}
        payload = {**defaults, "officer": old.officer_id, "bottleneck": old.bottleneck_id, **payload}
    before_snapshot = assignment_snapshot(old) if old else None
    serializer = AssignmentInput(data=payload)
    serializer.is_valid(raise_exception=True)
    if serializer.validated_data["status"] == "assigned" and serializer.validated_data["start_time"] < now:
        # Tolerate the current minute chosen in the editor, but never backdate work.
        if explicit_start and (now - serializer.validated_data["start_time"]).total_seconds() > 60:
            raise ScheduleConflict("Choose a start time in the present or future.")
        serializer.validated_data["start_time"] = now
        if serializer.validated_data["end_time"] <= now:
            raise ScheduleConflict("This shift has ended. Choose a future date and time.")
    preserved = []
    if old and old.start_time < now:
        elapsed = copy(old)
        elapsed.end_time = now
        preserved.append(elapsed)
    candidate = validate_entries([serializer.validated_data], [old.pk] if old else [], nodes, officers, preserved)[0]
    # Require a reason only where this edit increases excess or creates/worsens a shortage.
    affected = {candidate.bottleneck_id} | ({old.bottleneck_id} if old else set())
    deviations = []
    for node_id in affected:
        node = nodes[node_id]
        left = max(now, min(candidate.start_time, old.start_time if old else candidate.start_time))
        right = max(candidate.end_time, old.end_time if old else candidate.end_time)
        if left >= right: continue
        existing = list(Deployment.objects.filter(bottleneck_id=node_id, is_deleted=False, status="assigned", start_time__lt=right, end_time__gt=left))
        incidents = Incident.objects.filter(bottleneck_id=node_id, is_deleted=False, status__in=["active", "investigating"])
        moments = {left, candidate.start_time, candidate.end_time}
        moments.update(t for d in existing for t in (d.start_time, d.end_time))
        moments.update(datetime.fromisoformat(w["start_time"]) for w in staffing_windows(node, left, right, incidents))
        for at in sorted(t for t in moments if left <= t < right):
            before = sum(d.start_time <= at < d.end_time for d in existing)
            after = before - int(bool(old and old.bottleneck_id == node_id and old.start_time <= at < old.end_time))
            after += int(candidate.status == "assigned" and candidate.bottleneck_id == node_id and candidate.start_time <= at < candidate.end_time)
            required = required_staffing(node, incidents, at)
            if (after > required and after > before) or (after < required and after < before):
                deviations.append(f"{node.name}: {after} scheduled / {required} required")
                break
    if deviations and len(candidate.override_reason.strip()) < 10:
        raise ScheduleConflict({"detail": "Explain this staffing override (at least 10 characters).", "staffing_deviations": deviations})
    if old and old.status in {"cancelled", "completed"} and candidate.status != old.status:
        raise ScheduleConflict("Completed or cancelled deployments cannot be reactivated. Create a new assignment.")
    if candidate.status == "completed" and candidate.end_time > timezone.now():
        raise ScheduleConflict("A deployment cannot be completed before its end time.")
    if old:
        candidate.source = old.source
        candidate.revision_id = old.revision_id
        if old.start_time < now:
            old.end_time = now
            old.status = "completed"
            old.save(update_fields=["end_time", "status", "updated_at"])
            candidate.start_time = max(now, candidate.start_time)
        else:
            candidate.pk = old.pk
            candidate.created_at = old.created_at
    candidate.save()
    sync_officer_status()
    schedule_event(actor, "update" if old else "create", {"deployment_id": candidate.pk,
        "override_reason": candidate.override_reason, "staffing_deviations": deviations,
        "previous_assignment": before_snapshot, "assignment": assignment_snapshot(candidate),
        "preserved_assignments": [assignment_snapshot(old)] if old and preserved else []})
    return candidate


def publication_skill_warnings(snapshot, candidates, current_nodes, officers):
    """Skill advice is rechecked without turning preferences into eligibility rules."""
    if not snapshot.get("skill_policy_version"):
        return ["Skills were not assessed for this saved run. Re-run optimization to include skill preferences."]
    warnings = []
    if snapshot["skill_policy_version"] != SKILL_POLICY_VERSION:
        warnings.append("The skill preference policy changed since this run. Re-run optimization to use the current policy.")
    saved_officers = {row.get("id"): row for row in snapshot.get("officers", []) if isinstance(row, dict)}
    saved_nodes = {row.get("id"): row for row in snapshot.get("bottlenecks", []) if isinstance(row, dict)}
    nodes = {node.pk: node for node in current_nodes}
    incidents = list(Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]))
    preferences = {node.pk: preferred_skills_for(node, incidents) for node in current_nodes}
    checked_officers, checked_nodes, checked_pairs = set(), set(), set()
    for candidate in candidates:
        officer, node = officers[candidate.officer_id], nodes[candidate.bottleneck_id]
        saved_officer = saved_officers.get(officer.pk, {})
        saved_node = saved_nodes.get(node.pk, {})
        if officer.pk not in checked_officers:
            checked_officers.add(officer.pk)
            if "skills" not in saved_officer:
                warnings.append(f"The saved skill record for officer {officer.badge_number} is unavailable. Review their current skills.")
            elif set(normalize_skills(saved_officer["skills"])) != set(normalize_skills(officer.skills)):
                warnings.append(f"Skills recorded for officer {officer.badge_number} changed since optimization. Review the assignment or run optimization again.")
        if node.pk not in checked_nodes:
            checked_nodes.add(node.pk)
            if "preferred_skills" not in saved_node:
                warnings.append(f"Saved skill preferences for {node.name} are unavailable. Review the current preferences.")
            elif normalize_skills(saved_node["preferred_skills"]) != preferences[node.pk]:
                warnings.append(f"Preferred skills at {node.name} changed since optimization. Review the assignment or run optimization again.")
        pair = (officer.pk, node.pk)
        if pair not in checked_pairs:
            checked_pairs.add(pair)
            if skill_match(officer.skills, preferences[node.pk])["status"] == "no_recorded_match":
                warnings.append(f"Officer {officer.badge_number} has no recorded match for the preferred skills at {node.name}. This preference does not prevent assignment.")
    return warnings


def validate_planning_origins(snapshot, candidates, cutover, now):
    """Publication cannot count travel that would have happened before actual release."""
    if not snapshot.get("planning_window"):
        return
    first = {}
    for candidate in sorted(candidates, key=lambda row: row.start_time):
        first.setdefault(candidate.officer_id, candidate)
    day_start = cutover.astimezone(MANILA).replace(hour=0, minute=0, second=0, microsecond=0)
    sources = Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"],
        officer_id__in=first, start_time__gte=day_start, start_time__lte=now, end_time__gte=now-timedelta(hours=2)
        ).select_related("bottleneck").order_by("officer_id", "-start_time", "-pk")
    checked = set()
    wif = float((snapshot.get("weather") or {}).get("impact_factor") or 1)
    for source in sources:
        if source.officer_id in checked:
            continue
        checked.add(source.officer_id)
        candidate = first[source.officer_id]
        if source.bottleneck_id == candidate.bottleneck_id:
            continue
        release = source.end_time if source.status == "completed" or source.end_time <= now else min(source.end_time, cutover)
        distance = geodesic((source.bottleneck.latitude, source.bottleneck.longitude),
                            (candidate.bottleneck.latitude, candidate.bottleneck.longitude)).km
        needed = distance/max(8, 28*(1-candidate.bottleneck.tsi))*3600*wif
        blocks = [{"start_time": block.start_time.isoformat(), "end_time": block.end_time.isoformat(), "kind": block.kind}
            for block in OfficerTimeBlock.objects.filter(officer_id=source.officer_id, is_deleted=False, kind="break",
                start_time__lt=candidate.start_time, end_time__gt=release)]
        if transfer_seconds_available({"time_blocks": blocks}, release, candidate.start_time) < needed:
            raise ScheduleConflict("The current deployment leaves insufficient travel time before the proposed move. Run optimization again; publication cannot backdate an officer's release.")


@transaction.atomic
def publish(actor, payload, preview=False):
    nodes, officers = lock_schedule()
    key = payload.get("idempotency_key")
    fingerprint = sha256(json.dumps({"actor": actor.pk, "payload": dict(payload)},
        cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()
    if not preview:
        if not isinstance(key, str) or not 8 <= len(key) <= 64:
            raise serializers.ValidationError({"idempotency_key": "Provide a publication request key (8–64 characters)."})
        previous = ScheduleRevision.objects.filter(idempotency_key=key).first()
        if previous:
            if previous.request_fingerprint != fingerprint:
                raise ScheduleConflict("This publication key was already used for a different request.")
            return previous.response
    run = OptimizationRun.objects.filter(run_id=payload.get("run_id"), is_deleted=False).first()
    if not run or run.status != "completed":
        raise ScheduleConflict("Select a completed optimization run.")
    if not isinstance(run.result_data, dict):
        raise ScheduleConflict("Invalid optimization result.")
    if run.result_data.get("synthetic_data_used"):
        raise ScheduleConflict("Simulated results cannot be published. Run again with operational inputs.")
    if run.parameters.get("mode") == "shadow":
        raise ScheduleConflict("Shadow recommendations cannot be published. Export the recommendation for comparison.")
    snapshot = run.result_data.get("input_snapshot")
    if not isinstance(snapshot, dict) or not snapshot.get("bottlenecks"):
        raise ScheduleConflict("This run has no verified input snapshot. Run optimization again.")
    if any(node.get("provenance", {}).get("is_synthetic") for node in snapshot["bottlenecks"]) or snapshot.get("weather", {}).get("is_synthetic"):
        raise ScheduleConflict("Simulated inputs cannot be published, including with a supervisor override.")
    day = serializers.DateField().run_validation(payload.get("operational_date", run.parameters.get("operational_date")))
    if str(day) != run.parameters.get("operational_date") or snapshot.get("operational_date") != str(day):
        raise ScheduleConflict("Publication date must match the recommendation's operational date. Run optimization for the selected date.")
    now = timezone.now()
    issues = input_issues(snapshot, now)
    reason = payload.get("input_override_reason", "")
    if not isinstance(reason, str):
        raise serializers.ValidationError({"input_override_reason": "Provide a text reason."})
    reason = reason.strip()
    if issues and len(reason) < 10:
        raise ScheduleConflict({"detail": "Inputs are stale or unverified. Refresh inputs and re-run, or record a supervisor override reason.", "input_issues": issues})
    shift = (run.parameters or {}).get("shift")
    if shift not in {"morning", "afternoon"}:
        raise ScheduleConflict("The run has no valid operational shift. Run optimization again.")
    if payload.get("shift", shift) != shift:
        raise ScheduleConflict("Publication shift must match the optimization run.")
    shift_start, shift_end = shift_window(shift, day)
    if shift_end <= now:
        raise ScheduleConflict("This shift has ended. Publication cannot backdate operational assignments.")
    version = schedule_version(shift, day)
    if not preview and payload.get("expected_revision") != version:
        raise ScheduleConflict("The schedule changed or has not been reviewed. Request a fresh publication preview.")
    solutions = (run.result_data or {}).get("top_solutions")
    if not isinstance(solutions, list) or not solutions or not isinstance(solutions[0], dict):
        raise ScheduleConflict("Invalid optimization result.")
    if solutions[0].get("constraints_violated"):
        raise ScheduleConflict("The saved solution violates staffing constraints. Re-run optimization.")
    assignments = solutions[0].get("assignments")
    timed = snapshot.get("schema_version", 0) >= 4
    planning_start = shift_start
    saved_window = snapshot.get("planning_window")
    if saved_window is not None:
        try:
            if not isinstance(saved_window, dict):
                raise ValueError("Invalid window")
            planning_start = serializers.DateTimeField().run_validation(saved_window.get("start_time"))
            planning_end = serializers.DateTimeField().run_validation(saved_window.get("end_time"))
            if not shift_start <= planning_start < shift_end or planning_end != shift_end:
                raise ValueError("Invalid planning bounds")
        except (ValueError, TypeError, serializers.ValidationError):
            raise ScheduleConflict("The saved planning window is invalid. Run optimization again.")
    if not isinstance(assignments, list) or (not assignments and not timed):
        raise ScheduleConflict("The result contains no assignments.")
    if timed:
        if "start_time" in payload or "end_time" in payload:
            raise ScheduleConflict("Timed recommendations use their saved assignment windows. Edit the published Gantt schedule instead.")
        periods = solutions[0].get("time_periods")
        if not isinstance(periods, list) or not periods:
            raise ScheduleConflict("The timed recommendation has no staffing periods. Run optimization again.")
        cursor = planning_start
        for period in periods:
            if not isinstance(period, dict):
                raise ScheduleConflict("Invalid staffing period.")
            try:
                left = serializers.DateTimeField().run_validation(period.get("start_time"))
                right = serializers.DateTimeField().run_validation(period.get("end_time"))
            except serializers.ValidationError:
                raise ScheduleConflict("Invalid staffing period times.")
            if left != cursor or not left < right <= shift_end:
                raise ScheduleConflict("Staffing periods must cover the saved planning window without gaps or overlaps.")
            cursor = right
        if cursor != shift_end:
            raise ScheduleConflict("Staffing periods do not cover the entire shift.")
    effective_start, effective_end = max(planning_start, now), shift_end
    entries = []
    for item in assignments:
        if not isinstance(item, dict):
            raise ScheduleConflict("Invalid assignment in optimization result.")
        serializer = AssignmentInput(data={
            **{k: payload[k] for k in ["operational_date", "start_time", "end_time", "assignment_type"] if k in payload},
            "operational_date": str(day),
            **({"start_time": item.get("start_time"), "end_time": item.get("end_time")} if timed else {}),
            "shift": shift, "officer": item.get("officer_id"), "bottleneck": item.get("bottleneck_id"),
        })
        if not serializer.is_valid():
            raise ScheduleConflict({"detail": "Invalid proposed assignment.", "errors": serializer.errors})
        if saved_window is not None and serializer.validated_data["start_time"] < planning_start:
            raise ScheduleConflict("A proposed assignment starts before its saved planning window. Run optimization again.")
        serializer.validated_data["start_time"] = max(serializer.validated_data["start_time"], now)
        if serializer.validated_data["end_time"] <= serializer.validated_data["start_time"]:
            if timed:
                continue
            raise ScheduleConflict("The proposed assignment window has ended.")
        entries.append(serializer.validated_data)
    first = {"start_time": effective_start, "end_time": effective_end} if timed else entries[0]
    replace = payload.get("replace_existing", True)
    if not isinstance(replace, bool):
        raise serializers.ValidationError({"replace_existing": "Must be a boolean."})
    old = list(Deployment.objects.filter(is_deleted=False, status="assigned", shift=shift,
        start_time__lt=first["end_time"], end_time__gt=first["start_time"])) if replace else []
    preserved = []
    for row in old:
        if row.start_time < first["start_time"]:
            prefix = copy(row)
            prefix.end_time = first["start_time"]
            preserved.append(prefix)
        if row.end_time > first["end_time"]:
            tail = copy(row)
            tail.start_time = first["end_time"]
            preserved.append(tail)
    candidates = validate_entries(entries, [d.pk for d in old], nodes, officers, preserved)
    validate_planning_origins(snapshot, candidates, first["start_time"], now)
    current_nodes = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).prefetch_related(
        Prefetch("incidents", queryset=Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]), to_attr="publication_incidents")))
    if {n.pk for n in current_nodes} != {n.get("id") for n in snapshot["bottlenecks"]}:
        raise ScheduleConflict("The active locations changed. Run optimization again.")
    retained = list(Deployment.objects.filter(is_deleted=False, status="assigned", shift=shift,
        start_time__lt=first["end_time"], end_time__gt=first["start_time"]).exclude(pk__in=[d.pk for d in old]))
    gaps = []
    for node in current_nodes:
        rows = [d for d in retained + candidates if d.bottleneck_id == node.pk]
        moments = {first["start_time"], first["end_time"]}
        for window in staffing_windows(node, first["start_time"], first["end_time"], node.publication_incidents):
            moments.update([datetime.fromisoformat(window["start_time"]), datetime.fromisoformat(window["end_time"])])
        for row in rows:
            moments.update([max(first["start_time"], row.start_time), min(first["end_time"], row.end_time)])
        for moment in sorted(moments)[:-1]:
            count = sum(d.start_time <= moment < d.end_time for d in rows)
            required = required_staffing(node, node.publication_incidents, moment)
            if count < required or ((timed or node.signal_status in {"working", "out_of_order"}) and count > required):
                gaps.append(f"{node.name} at {moment.astimezone(MANILA):%H:%M}: {count} proposed / {required} required.")
    if gaps:
        raise ScheduleConflict({"detail": "Current staffing requirements are not met. Re-run optimization.", "staffing_gaps": gaps})
    skill_warnings = publication_skill_warnings(snapshot, candidates, current_nodes, officers)
    before_rows = [assignment_snapshot(d) for d in old]
    for candidate in candidates:
        candidate.source = "optimized"
    after_rows = [assignment_snapshot(d) for d in candidates]
    old_pairs = {(d.officer_id, d.bottleneck_id, d.start_time.isoformat(), d.end_time.isoformat()) for d in old}
    new_pairs = {(d.officer_id, d.bottleneck_id, d.start_time.isoformat(), d.end_time.isoformat()) for d in candidates}
    result = {"run_id": run.run_id, "shift": shift, "start_time": first["start_time"], "end_time": first["end_time"],
        "operational_date": first["start_time"].astimezone(MANILA).date(), "created": len(candidates), "skipped": [],
        "staff_added": sorted(set(d.officer_id for d in candidates) - set(d.officer_id for d in old)),
        "staff_removed": sorted(set(d.officer_id for d in old) - set(d.officer_id for d in candidates)),
        "replaced": len(old), "replace_existing": replace, "conflicts": [], "expected_revision": version,
        "captured_at": snapshot.get("captured_at"), "input_issues": issues, "skill_warnings": skill_warnings,
        "time_periods": solutions[0].get("time_periods", []),
        "added_assignments": [d for d in after_rows if (d["officer_id"], d["bottleneck_id"], d["start_time"], d["end_time"]) not in old_pairs],
        "removed_assignments": [d for d in before_rows if (d["officer_id"], d["bottleneck_id"], d["start_time"], d["end_time"]) not in new_pairs]}
    if preview:
        return result
    json_result = json.loads(json.dumps(result, cls=DjangoJSONEncoder))
    revision = ScheduleRevision.objects.create(run=run, actor=actor, operational_date=day, shift=shift,
        published_at=now, effective_start=first["start_time"], effective_end=first["end_time"],
        idempotency_key=key, request_fingerprint=fingerprint, previous_assignments=before_rows,
        assignments=after_rows, response=json_result)
    for row in old:
        # Preserve elapsed service and any unaffected future tail.
        if row.end_time > first["end_time"]:
            Deployment.objects.create(officer=row.officer, bottleneck=row.bottleneck, shift=row.shift,
                start_time=first["end_time"], end_time=row.end_time, assignment_type=row.assignment_type,
                source=row.source, revision_id=row.revision_id)
        if row.start_time < first["start_time"]:
            row.end_time = first["start_time"]
            row.status = "completed" if row.end_time <= now else "assigned"
        else:
            row.status = "cancelled"
        row.save(update_fields=["end_time", "status", "updated_at"])
    for candidate in candidates:
        candidate.source = "optimized"
        candidate.revision = revision
        candidate.save()
    sync_officer_status()
    json_result["revision_id"] = revision.pk
    revision.response = json_result
    revision.assignments = [assignment_snapshot(candidate) for candidate in candidates]
    revision.save(update_fields=["response", "assignments"])
    schedule_event(actor, "publish", {"run_id": run.run_id, "revision_id": revision.pk,
        "created": len(candidates), "input_override_reason": reason, "input_issues": issues, "skill_warnings": skill_warnings,
        "previous_assignments": before_rows, "assignments": after_rows})
    return json_result


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
    rows = list(queryset.select_related("officer", "bottleneck"))
    before = [assignment_snapshot(row) for row in rows]
    now = timezone.now()
    for row in rows:
        if row.start_time < now:
            row.end_time = min(row.end_time, now)
            row.status = "completed"
        else:
            row.status = "cancelled"
        row.save(update_fields=["end_time", "status", "updated_at"])
    count = len(rows)
    sync_officer_status()
    if count:
        schedule_event(actor, "clear", {"cleared": count, "previous_assignments": before})
    return count
