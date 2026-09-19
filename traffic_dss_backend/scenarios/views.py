from rest_framework import permissions, status
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination

from core.models import Scenario
from core.serializers import ScenarioSerializer
from core.utils import write_audit_log


class ScenarioListCreateView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def get(self, request):
		queryset = Scenario.objects.filter(is_deleted=False).order_by("-is_default", "name")
		paginator = PageNumberPagination()
		page = paginator.paginate_queryset(queryset, request, view=self)
		return paginator.get_paginated_response(ScenarioSerializer(page, many=True).data)

	def post(self, request):
		serializer = ScenarioSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		scenario = serializer.save()
		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "create", "scenario", {"scenario_id": scenario.id})
		return Response(ScenarioSerializer(scenario).data, status=status.HTTP_201_CREATED)


class ScenarioDetailView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def get(self, request, scenario_id: int):
		scenario = Scenario.objects.filter(pk=scenario_id, is_deleted=False).first()
		if not scenario:
			return Response({"detail": "Scenario not found."}, status=status.HTTP_404_NOT_FOUND)
		return Response(ScenarioSerializer(scenario).data)

	def put(self, request, scenario_id: int):
		scenario = Scenario.objects.filter(pk=scenario_id, is_deleted=False).first()
		if not scenario:
			return Response({"detail": "Scenario not found."}, status=status.HTTP_404_NOT_FOUND)
		serializer = ScenarioSerializer(scenario, data=request.data, partial=True)
		serializer.is_valid(raise_exception=True)
		scenario = serializer.save()
		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "update", "scenario", {"scenario_id": scenario.id})
		return Response(ScenarioSerializer(scenario).data)
