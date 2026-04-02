from rest_framework import permissions, status
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Bottleneck, Deployment, Officer
from core.realtime import broadcast
from core.serializers import DeploymentSerializer
from core.utils import write_audit_log


class DeploymentScheduleView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		queryset = Deployment.objects.filter(is_deleted=False).select_related("officer", "bottleneck").order_by("start_time")
		data = [
			{
				"id": d.id,
				"officer": d.officer.badge_number,
				"officer_name": d.officer.name,
				"bottleneck": d.bottleneck.id,
				"shift": d.shift,
				"start_time": d.start_time,
				"end_time": d.end_time,
				"assignment_type": d.assignment_type,
				"status": d.status,
			}
			for d in queryset
		]
		return Response(data)


class DeploymentAssignView(APIView):
	permission_classes = [permissions.AllowAny]

	def post(self, request):
		officer = Officer.objects.filter(pk=request.data.get("officer"), is_deleted=False).first()
		bottleneck = Bottleneck.objects.filter(pk=request.data.get("bottleneck"), is_deleted=False).first()
		if not officer or not bottleneck:
			return Response({"detail": "Invalid officer or bottleneck."}, status=status.HTTP_400_BAD_REQUEST)

		serializer = DeploymentSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		deployment = serializer.save(officer=officer, bottleneck=bottleneck)
		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "create", "deployment", {"deployment_id": deployment.id})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "deployment_changed",
				"deployment_id": deployment.id,
				"officer": officer.badge_number,
				"bottleneck_id": bottleneck.id,
				"status": deployment.status,
				"timestamp": deployment.created_at.isoformat(),
			},
		)
		return Response(DeploymentSerializer(deployment).data, status=status.HTTP_201_CREATED)


class DeploymentUpdateView(APIView):
	permission_classes = [permissions.AllowAny]

	def put(self, request, deployment_id: int):
		deployment = Deployment.objects.filter(pk=deployment_id, is_deleted=False).first()
		if not deployment:
			return Response({"detail": "Deployment not found."}, status=status.HTTP_404_NOT_FOUND)
		serializer = DeploymentSerializer(deployment, data=request.data, partial=True)
		serializer.is_valid(raise_exception=True)
		deployment = serializer.save()
		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "update", "deployment", {"deployment_id": deployment.id})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "deployment_changed",
				"deployment_id": deployment.id,
				"officer": deployment.officer.badge_number,
				"bottleneck_id": deployment.bottleneck.id,
				"status": deployment.status,
				"timestamp": deployment.updated_at.isoformat(),
			},
		)
		return Response(DeploymentSerializer(deployment).data)


class OfficerDeploymentView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request, officer_id: int):
		deployments = Deployment.objects.filter(officer_id=officer_id, is_deleted=False).order_by("-start_time")
		return Response(DeploymentSerializer(deployments, many=True).data)
