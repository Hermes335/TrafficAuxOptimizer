from django.db import DatabaseError
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination

from core.models import Deployment, ScheduleRevision
from core.permissions import IsSupervisor, SupervisorWrite
from core.operational_time import shift_window
from core.serializers import DeploymentSerializer
from .services import save_assignment, publish, clear_schedule, ScheduleConflict

_default_shift_window = shift_window


class ScheduleWriteView(APIView):
    permission_classes = [IsSupervisor]

    def handle_exception(self, exc):
        if isinstance(exc, DatabaseError):
            exc = ScheduleConflict("The schedule could not be saved. No changes were committed; refresh and retry.")
        return super().handle_exception(exc)


class DeploymentScheduleView(ScheduleWriteView):
    permission_classes = [SupervisorWrite]

    def get(self, request):
        from core.operational_time import operational_date
        from rest_framework import serializers
        day = serializers.DateField().run_validation(request.query_params.get("date", str(operational_date())))
        start, _ = shift_window("morning", day)
        _, end = shift_window("afternoon", day)
        queryset = Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"], start_time__lt=end, end_time__gt=start).select_related("officer", "bottleneck").order_by("start_time", "id")
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response([{
            "id": d.id, "officer": d.officer.badge_number, "officer_name": d.officer.name,
            "bottleneck": d.bottleneck_id, "shift": d.shift, "start_time": d.start_time,
            "end_time": d.end_time, "assignment_type": d.assignment_type, "status": d.status,
            "officer_id": d.officer_id, "bottleneck_name": d.bottleneck.name, "area_name": d.bottleneck.area_name,
            "updated_at": d.updated_at.isoformat(), "override_reason": d.override_reason,
        } for d in page])

    def delete(self, request):
        from rest_framework import serializers
        raw = request.query_params.get("date")
        day = serializers.DateField().run_validation(raw) if raw else None
        return Response({"cleared": clear_schedule(request.user, request.query_params.get("shift"), day)})


class DeploymentAssignView(ScheduleWriteView):
    def post(self, request):
        deployment = save_assignment(request.user, request.data)
        return Response(DeploymentSerializer(deployment).data, status=status.HTTP_201_CREATED)


class DeploymentUpdateView(ScheduleWriteView):
    def put(self, request, deployment_id):
        deployment = save_assignment(request.user, request.data, deployment_id)
        return Response(DeploymentSerializer(deployment).data)


class OfficerDeploymentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, officer_id):
        deployments = Deployment.objects.filter(officer_id=officer_id, is_deleted=False).order_by("-start_time")
        return Response(DeploymentSerializer(deployments, many=True).data)


class DeploymentPublishOptimizationView(ScheduleWriteView):
    def post(self, request):
        return Response(publish(request.user, request.data), status=status.HTTP_201_CREATED)


class DeploymentPreviewView(ScheduleWriteView):
    def post(self, request):
        return Response(publish(request.user, request.data, preview=True))


class ScheduleRevisionView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "operational_read"

    def get(self, request):
        from rest_framework import serializers
        queryset = ScheduleRevision.objects.select_related("run", "actor").order_by("-published_at", "-pk")
        if request.query_params.get("date"):
            queryset = queryset.filter(operational_date=serializers.DateField().run_validation(request.query_params["date"]))
        if request.query_params.get("shift"):
            queryset = queryset.filter(shift=serializers.ChoiceField(choices=["morning", "afternoon"]).run_validation(request.query_params["shift"]))
        paginator = PageNumberPagination()
        paginator.page_size = 10
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response([{"id": row.pk, "run_id": row.run.run_id,
            "operational_date": row.operational_date, "shift": row.shift, "published_at": row.published_at,
            "effective_start": row.effective_start, "effective_end": row.effective_end, "published_by": row.actor.username,
            "previous_assignments": row.previous_assignments, "assignments": row.assignments} for row in page])
