from datetime import timedelta

from rest_framework import permissions, status
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Bottleneck, Deployment, Officer, OptimizationRun
from core.realtime import broadcast
from core.serializers import DeploymentSerializer
from core.utils import write_audit_log


class DeploymentScheduleView(APIView):
	permission_classes = [permissions.IsAuthenticated]

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

	def delete(self, request):
		shift = request.query_params.get("shift")
		if not shift:
			return Response({"detail": "shift query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)
		deleted_count, _ = Deployment.objects.filter(is_deleted=False, shift=shift).update(is_deleted=True, updated_at=timezone.now())
		write_audit_log(request.user, "delete", "deployment_schedule", {"shift": shift, "cleared": deleted_count})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "deployment_schedule_cleared",
				"shift": shift,
				"cleared": deleted_count,
				"timestamp": timezone.now().isoformat(),
			},
		)
		return Response({"cleared": deleted_count, "shift": shift})


class DeploymentAssignView(APIView):
	permission_classes = [permissions.IsAuthenticated]

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
	permission_classes = [permissions.IsAuthenticated]

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
	permission_classes = [permissions.IsAuthenticated]

	def get(self, request, officer_id: int):
		deployments = Deployment.objects.filter(officer_id=officer_id, is_deleted=False).order_by("-start_time")
		return Response(DeploymentSerializer(deployments, many=True).data)


def _default_shift_window(shift: str):
	now = timezone.now()
	base = now.replace(hour=0, minute=0, second=0, microsecond=0)
	if shift == "morning":
		return base + timedelta(hours=6), base + timedelta(hours=14)
	if shift == "night":
		return base + timedelta(hours=22), base + timedelta(days=1, hours=6)
	return base + timedelta(hours=14), base + timedelta(hours=22)


class DeploymentPublishOptimizationView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def post(self, request):
		run_id = str((request.data or {}).get("run_id", "")).strip()
		if not run_id:
			return Response({"detail": "run_id is required."}, status=status.HTTP_400_BAD_REQUEST)

		run = OptimizationRun.objects.filter(run_id=run_id, is_deleted=False).first()
		if not run:
			return Response({"detail": "Optimization run not found."}, status=status.HTTP_404_NOT_FOUND)
		if run.status != "completed":
			return Response({"detail": "Only completed optimization runs can be published."}, status=status.HTTP_400_BAD_REQUEST)

		top_solutions = (run.result_data or {}).get("top_solutions") or []
		if not top_solutions:
			return Response({"detail": "No solution data found for this run."}, status=status.HTTP_400_BAD_REQUEST)

		assignments = (top_solutions[0] or {}).get("assignments") or []
		if not assignments:
			return Response({"detail": "Top solution has no assignments to deploy."}, status=status.HTTP_400_BAD_REQUEST)

		payload = request.data or {}
		shift = str(payload.get("shift") or (run.parameters or {}).get("shift") or "afternoon").strip()
		assignment_type = str(payload.get("assignment_type") or "static").strip()
		status_value = str(payload.get("status") or "assigned").strip()
		replace_existing = bool(payload.get("replace_existing", True))

		start_raw = payload.get("start_time")
		end_raw = payload.get("end_time")
		start_time = parse_datetime(start_raw) if isinstance(start_raw, str) else None
		end_time = parse_datetime(end_raw) if isinstance(end_raw, str) else None
		if not start_time or not end_time:
			start_time, end_time = _default_shift_window(shift)

		if replace_existing:
			Deployment.objects.filter(
				is_deleted=False,
				shift=shift,
				start_time=start_time,
				end_time=end_time,
			).update(is_deleted=True, updated_at=timezone.now())

		created_count = 0
		skipped = []
		for item in assignments:
			officer_id = item.get("officer_id")
			bottleneck_id = item.get("bottleneck_id")
			officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
			bottleneck = Bottleneck.objects.filter(pk=bottleneck_id, is_deleted=False).first()
			if not officer or not bottleneck:
				skipped.append({"officer_id": officer_id, "bottleneck_id": bottleneck_id})
				continue

			Deployment.objects.create(
				officer=officer,
				bottleneck=bottleneck,
				shift=shift,
				start_time=start_time,
				end_time=end_time,
				assignment_type=assignment_type,
				status=status_value,
			)
			created_count += 1

		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")
		write_audit_log(actor, "create", "deployment_batch", {"run_id": run_id, "created": created_count, "skipped": len(skipped)})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "deployment_batch_published",
				"run_id": run_id,
				"created": created_count,
				"skipped": len(skipped),
				"timestamp": timezone.now().isoformat(),
			},
		)

		return Response(
			{
				"run_id": run_id,
				"created": created_count,
				"skipped": skipped,
				"start_time": start_time,
				"end_time": end_time,
				"shift": shift,
			},
			status=status.HTTP_201_CREATED,
		)
