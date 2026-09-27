from django.db import transaction
from deployments.services import lock_schedule
from django.db import connection
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView

from core.models import AuditLog, Bottleneck, Officer
from core.serializers import AuditLogSerializer, BottleneckSerializer, OfficerSerializer
from core.utils import write_audit_log


class AuditLogListView(APIView):
	permission_classes = [permissions.IsAdminUser]

	def get(self, request):
		queryset = AuditLog.objects.filter(is_deleted=False).order_by("-timestamp", "-id")
		paginator = PageNumberPagination()
		paginator.page_size_query_param = "page_size"
		paginator.max_page_size = 100
		page = paginator.paginate_queryset(queryset, request, view=self)
		return paginator.get_paginated_response(AuditLogSerializer(page, many=True).data)


class AdminBottleneckCreateView(APIView):
	permission_classes = [permissions.IsAdminUser]

	@transaction.atomic
	def post(self, request):
		lock_schedule()
		serializer = BottleneckSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		bottleneck = serializer.save()
		write_audit_log(request.user, "create", "bottleneck", {"bottleneck_id": bottleneck.id})
		return Response(BottleneckSerializer(bottleneck).data, status=status.HTTP_201_CREATED)


class AdminOfficerUpdateView(APIView):
	permission_classes = [permissions.IsAdminUser]

	@transaction.atomic
	def put(self, request, officer_id: int):
		lock_schedule()
		officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
		if not officer:
			return Response({"detail": "Officer not found."}, status=status.HTTP_404_NOT_FOUND)
		serializer = OfficerSerializer(officer, data=request.data, partial=True)
		serializer.is_valid(raise_exception=True)
		officer = serializer.save()
		write_audit_log(request.user, "update", "officer", {"officer_id": officer.id})
		return Response(OfficerSerializer(officer).data)


class AdminSystemHealthView(APIView):
	permission_classes = [permissions.IsAdminUser]

	def get(self, request):
		db_ok = True
		try:
			with connection.cursor() as cursor:
				cursor.execute("SELECT 1")
				cursor.fetchone()
		except Exception:
			db_ok = False

		return Response(
			{
				"status": "ok" if db_ok else "degraded",
				"timestamp": timezone.now().isoformat(),
				"database": "ok" if db_ok else "error",
				"queue": "unknown",
			}
		)
