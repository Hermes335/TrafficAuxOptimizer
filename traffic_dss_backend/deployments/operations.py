"""Operational review, officer time reservations and field feedback."""
from datetime import datetime
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import Bottleneck, Deployment, FieldObservation, Incident, Officer, OfficerTimeBlock, ScheduleRevision
from core.operational_time import MANILA, operational_date, shift_window
from core.permissions import SupervisorWrite
from core.staffing import staffing_windows, required_staffing
from .services import lock_schedule, schedule_event, ScheduleConflict


def scope(request):
    day = serializers.DateField().run_validation(request.query_params.get("date", str(operational_date())))
    shift = serializers.ChoiceField(choices=["morning", "afternoon", "all"]).run_validation(request.query_params.get("shift", "all"))
    start = shift_window("afternoon" if shift == "afternoon" else "morning", day)[0]
    end = shift_window("morning" if shift == "morning" else "afternoon", day)[1]
    return day, shift, start, end


class TimeBlockSerializer(serializers.ModelSerializer):
    officer_name = serializers.CharField(source="officer.name", read_only=True)
    badge_number = serializers.CharField(source="officer.badge_number", read_only=True)
    class Meta:
        model = OfficerTimeBlock
        fields = ["id", "officer", "officer_name", "badge_number", "start_time", "end_time", "kind", "note"]

    def validate(self, data):
        officer = data["officer"]
        start, end = data["start_time"], data["end_time"]
        left, right = shift_window(officer.shift, start.astimezone(MANILA).date())
        if officer.is_deleted or officer.status not in {"available", "deployed"}:
            raise serializers.ValidationError("Select an eligible officer.")
        if not left <= start < end <= right or start < timezone.now():
            raise serializers.ValidationError("Choose future times inside the officer's shift.")
        for model in (Deployment, OfficerTimeBlock):
            rows = model.objects.filter(officer=officer, is_deleted=False, start_time__lt=end, end_time__gt=start)
            if model is Deployment:
                rows = rows.filter(status="assigned")
            if rows.exists():
                raise ScheduleConflict("This officer already has an assignment, break or travel reservation at that time. Shorten the assignment first.")
        return data


class TimeBlockView(APIView):
    permission_classes = [SupervisorWrite]

    def get(self, request):
        _, _, start, end = scope(request)
        rows = OfficerTimeBlock.objects.filter(is_deleted=False, start_time__lt=end, end_time__gt=start).select_related("officer").order_by("start_time")
        return Response(TimeBlockSerializer(rows, many=True).data)

    @transaction.atomic
    def post(self, request):
        lock_schedule()
        serializer = TimeBlockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = serializer.save(created_by=request.user)
        schedule_event(request.user, "create", {"time_block_id": row.pk, "kind": row.kind})
        return Response(serializer.data, status=201)

    @transaction.atomic
    def delete(self, request):
        lock_schedule()
        row = OfficerTimeBlock.objects.filter(pk=serializers.IntegerField().run_validation(request.query_params.get("id")), is_deleted=False).first()
        if not row or row.start_time <= timezone.now():
            raise ScheduleConflict("Only future time reservations can be removed.")
        row.is_deleted = True
        row.save(update_fields=["is_deleted", "updated_at"])
        schedule_event(request.user, "delete", {"time_block_id": row.pk})
        return Response(status=204)


class ObservationSerializer(serializers.ModelSerializer):
    bottleneck_name = serializers.CharField(source="bottleneck.name", read_only=True)
    class Meta:
        model = FieldObservation
        fields = ["id", "bottleneck", "bottleneck_name", "area_name", "observed_at", "actual_officers", "traffic", "note", "required_officers", "scheduled_officers", "created_at"]
        read_only_fields = ["area_name", "required_officers", "scheduled_officers", "created_at"]

    def validate(self, data):
        if data["observed_at"] > timezone.now():
            raise serializers.ValidationError("Observations cannot be in the future.")
        if data["bottleneck"].is_deleted or data["bottleneck"].is_archived:
            raise serializers.ValidationError("Select an active intersection.")
        if data["actual_officers"] > 1000:
            raise serializers.ValidationError("Check the observed officer count.")
        return data


class ObservationView(APIView):
    permission_classes = [SupervisorWrite]

    def get(self, request):
        day, _, _, _ = scope(request)
        start = datetime.combine(day, datetime.min.time(), MANILA)
        from datetime import timedelta
        rows = FieldObservation.objects.filter(observed_at__gte=start, observed_at__lt=start+timedelta(days=1)).select_related("bottleneck").order_by("-observed_at")
        return Response(ObservationSerializer(rows, many=True).data)

    @transaction.atomic
    def post(self, request):
        lock_schedule()
        serializer = ObservationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        node, at = serializer.validated_data["bottleneck"], serializer.validated_data["observed_at"]
        incidents = Incident.objects.filter(bottleneck=node, is_deleted=False, status__in=["active", "investigating"])
        scheduled = Deployment.objects.filter(bottleneck=node, is_deleted=False, status__in=["assigned", "completed"], start_time__lte=at, end_time__gt=at).count()
        row = serializer.save(created_by=request.user, area_name=node.area_name,
            required_officers=required_staffing(node, incidents, at), scheduled_officers=scheduled)
        schedule_event(request.user, "create", {"field_observation_id": row.pk})
        return Response(serializer.data, status=201)


class ScheduleReviewView(APIView):
    permission_classes = [SupervisorWrite]

    def get(self, request):
        day, shift, start, end = scope(request)
        start = max(start, timezone.now())
        if start >= end:
            return Response({"needs_review": False, "issues": [], "scope": "Shift ended"})
        rows = list(Deployment.objects.filter(is_deleted=False, status="assigned", start_time__lt=end, end_time__gt=start).select_related("officer", "bottleneck"))
        nodes = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).prefetch_related("incidents"))
        revisions = ScheduleRevision.objects.filter(operational_date=day).select_related("run").order_by("-published_at", "-pk")
        if shift != "all": revisions = revisions.filter(shift=shift)
        latest = {}
        for revision in revisions:
            latest.setdefault(revision.shift, revision)
        issues = []
        def add(node_id, reason, affected=()):
            if not any(i["bottleneck"] == node_id and i["reason"] == reason for i in issues):
                issues.append({"bottleneck": node_id, "reason": reason, "assignment_ids": list(affected)})
        for row in rows:
            if row.officer.is_deleted or row.officer.status not in {"available", "deployed"} or row.officer.shift != row.shift:
                add(row.bottleneck_id, f"Officer {row.officer.badge_number} is no longer eligible.", [row.pk])
            if row.bottleneck.is_deleted or row.bottleneck.is_archived:
                add(row.bottleneck_id, "Intersection is no longer active.", [row.pk])
        for node in nodes:
            assigned = [d for d in rows if d.bottleneck_id == node.pk]
            ids = [d.pk for d in assigned]
            all_incidents = list(node.incidents.all())
            incidents = [i for i in all_incidents if not i.is_deleted and i.status in {"active", "investigating"}]
            for window in staffing_windows(node, start, end, incidents):
                left, right = datetime.fromisoformat(window["start_time"]), datetime.fromisoformat(window["end_time"])
                moments = {left} | {t for d in assigned for t in [d.start_time, d.end_time] if left < t < right}
                for at in sorted(moments):
                    count = sum(d.start_time <= at < d.end_time for d in assigned)
                    if count != window["required"]:
                        add(node.pk, f"{at.astimezone(MANILA):%H:%M}: {count} scheduled / {window['required']} required.", ids)
                        break
            for revision in latest.values():
                if revision.effective_end <= start: continue
                snapshot = revision.run.result_data.get("input_snapshot", {})
                captured = next((n for n in snapshot.get("bottlenecks", []) if n["id"] == node.pk), None)
                if not captured:
                    add(node.pk, "Intersection added since publication.", ids)
                    continue
                fields = {"staffing_periods": node.staffing_periods, "configured_min_officers_required": node.min_officers_required,
                          "max_officers_allowed": node.max_officers_allowed, "signal_status": node.signal_status}
                if any(k in captured and captured[k] != v for k,v in fields.items()):
                    add(node.pk, "Staffing profile changed since publication.", ids)
                # Some platform clocks return identical timestamps for rapid writes.
                # Treat same-tick incident changes conservatively as needing review.
                if any(i.updated_at >= revision.published_at for i in all_incidents):
                    add(node.pk, "Incident changed since publication (including resolved incidents).", ids)
        return Response({"needs_review": bool(issues), "issues": issues, "scope": "Remaining schedule", "checked_at": timezone.now()})
