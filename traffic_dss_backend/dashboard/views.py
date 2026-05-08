from django.db.models import Avg, Count
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Bottleneck, Incident, Officer, OptimizationRun, TrafficData, WeatherData
from core.serializers import BottleneckSerializer, OfficerSerializer
from core.utils import write_audit_log


def _generate_next_bottleneck_id() -> str:
	existing_ids = (
		Bottleneck.objects.filter(is_deleted=False, id__regex=r"^B-\d{3}$")
		.values_list("id", flat=True)
	)
	max_number = 0
	for raw_id in existing_ids:
		try:
			max_number = max(max_number, int(raw_id.split("-")[1]))
		except (IndexError, ValueError):
			continue
	return f"B-{max_number + 1:03d}"


class DashboardKPIsView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		active_deployments = Bottleneck.objects.filter(is_deleted=False).count()
		total_officers = Officer.objects.filter(is_deleted=False).count()
		active_officers = Officer.objects.filter(is_deleted=False, status="deployed").count()
		critical_incidents = Incident.objects.filter(is_deleted=False, status="active", severity="critical").count()
		recent_weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		avg_tsi = TrafficData.objects.filter(is_deleted=False).aggregate(value=Avg("traffic_severity_index"))["value"] or 0.0

		coverage_efficiency = max(0, min(100, 90 - (critical_incidents * 5)))
		avg_response_time = round(8 + (avg_tsi * 10), 1)
		resource_utilization = 0 if total_officers == 0 else round((active_officers / total_officers) * 100, 1)
		weather_correlation = float(getattr(recent_weather, "weather_impact_factor", 1.0))

		return Response(
			{
				"coverage_efficiency": coverage_efficiency,
				"avg_response_time": avg_response_time,
				"resource_utilization": resource_utilization,
				"weather_correlation": weather_correlation,
				"active_officers": active_officers,
				"total_officers": total_officers,
			}
		)


class DashboardBottlenecksView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		bottlenecks = Bottleneck.objects.filter(is_deleted=False).order_by("id")
		rows = []
		for b in bottlenecks:
			latest_traffic = b.traffic_data.filter(is_deleted=False).order_by("-timestamp").first()
			active_incident = b.incidents.filter(is_deleted=False, status="active").order_by("-timestamp").first()
			deployments = b.deployments.filter(is_deleted=False, status="assigned").select_related("officer")
			assigned = deployments.first().officer.badge_number if deployments.exists() else None
			tsi_val = latest_traffic.traffic_severity_index if latest_traffic else 0.0
			status_value = "normal"
			if active_incident or tsi_val >= 0.8:
				status_value = "critical"
			elif tsi_val >= 0.4:
				status_value = "warning"
			rows.append(
				{
					"id": b.id,
					"name": b.name,
					"latitude": b.latitude,
					"longitude": b.longitude,
					"status": status_value,
					"tsi": round(latest_traffic.traffic_severity_index, 2) if latest_traffic else 0.0,
					"assigned_officer": assigned,
				}
			)
		return Response(rows)


class DashboardOfficersView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		officers = Officer.objects.filter(is_deleted=False).order_by("name")
		return Response(OfficerSerializer(officers, many=True).data)


class DashboardBottleneckManageView(APIView):
	permission_classes = [permissions.AllowAny]

	def post(self, request):
		payload = request.data or {}
		name = str(payload.get("name", "")).strip()
		if not name:
			return Response({"detail": "Bottleneck name is required."}, status=status.HTTP_400_BAD_REQUEST)

		bottleneck_id = str(payload.get("id", "")).strip() or _generate_next_bottleneck_id()
		serializer = BottleneckSerializer(
			data={
				"id": bottleneck_id,
				"name": name,
				"latitude": payload.get("latitude"),
				"longitude": payload.get("longitude"),
				"district": str(payload.get("district", "Unassigned")).strip() or "Unassigned",
				"bottleneck_type": str(payload.get("bottleneck_type", "other")).strip() or "other",
				"road_priority_weight": payload.get("road_priority_weight", 1.0),
			}
		)
		serializer.is_valid(raise_exception=True)
		created = serializer.save()

		return Response(BottleneckSerializer(created).data, status=status.HTTP_201_CREATED)

	def put(self, request, bottleneck_id: str):
		bottleneck = Bottleneck.objects.filter(id=bottleneck_id, is_deleted=False).first()
		if not bottleneck:
			return Response({"detail": "Bottleneck not found."}, status=status.HTTP_404_NOT_FOUND)

		payload = request.data or {}
		allowed_fields = {
			"name": payload.get("name", bottleneck.name),
			"latitude": payload.get("latitude", bottleneck.latitude),
			"longitude": payload.get("longitude", bottleneck.longitude),
			"district": payload.get("district", bottleneck.district),
			"bottleneck_type": payload.get("bottleneck_type", bottleneck.bottleneck_type),
			"road_priority_weight": payload.get("road_priority_weight", bottleneck.road_priority_weight),
		}

		serializer = BottleneckSerializer(bottleneck, data=allowed_fields, partial=True)
		serializer.is_valid(raise_exception=True)
		updated = serializer.save()
		return Response(BottleneckSerializer(updated).data)

	def delete(self, request, bottleneck_id: str):
		bottleneck = Bottleneck.objects.filter(id=bottleneck_id, is_deleted=False).first()
		if not bottleneck:
			return Response({"detail": "Bottleneck not found."}, status=status.HTTP_404_NOT_FOUND)

		has_active_incidents = bottleneck.incidents.filter(
			is_deleted=False,
			status__in=["active", "investigating"],
		).exists()
		has_active_deployments = bottleneck.deployments.filter(is_deleted=False, status="assigned").exists()

		if has_active_incidents or has_active_deployments:
			return Response(
				{"detail": "Cannot remove bottleneck with active incidents or deployments."},
				status=status.HTTP_400_BAD_REQUEST,
			)

		bottleneck.is_deleted = True
		bottleneck.save(update_fields=["is_deleted", "updated_at"])
		return Response(status=status.HTTP_204_NO_CONTENT)


class DashboardOfficerManageView(APIView):
	permission_classes = [permissions.AllowAny]

	def post(self, request):
		payload = request.data or {}
		serializer = OfficerSerializer(data=payload)
		serializer.is_valid(raise_exception=True)
		created = serializer.save()
		return Response(OfficerSerializer(created).data, status=status.HTTP_201_CREATED)

	def put(self, request, officer_id: int):
		officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
		if not officer:
			return Response({"detail": "Officer not found."}, status=status.HTTP_404_NOT_FOUND)

		serializer = OfficerSerializer(officer, data=request.data or {}, partial=True)
		serializer.is_valid(raise_exception=True)
		updated = serializer.save()
		return Response(OfficerSerializer(updated).data)

	def delete(self, request, officer_id: int):
		officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
		if not officer:
			return Response({"detail": "Officer not found."}, status=status.HTTP_404_NOT_FOUND)

		has_active_assignments = officer.deployments.filter(is_deleted=False, status="assigned").exists()
		if has_active_assignments:
			return Response(
				{"detail": "Cannot remove officer with active deployments."},
				status=status.HTTP_400_BAD_REQUEST,
			)

		officer.is_deleted = True
		officer.save(update_fields=["is_deleted", "updated_at"])
		return Response(status=status.HTTP_204_NO_CONTENT)


class ActiveIncidentsView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		incidents = (
			Incident.objects.filter(is_deleted=False, status="active")
			.select_related("bottleneck")
			.order_by("-timestamp")[:50]
		)
		data = [
			{
				"id": i.id,
				"text": f"{i.severity.title()}: {i.description} - {i.bottleneck.id} {i.bottleneck.name}",
				"type": "critical" if i.severity == "critical" else ("major" if i.severity == "major" else "minor"),
			}
			for i in incidents
		]
		return Response(data)


class DashboardMapDataView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		counts = TrafficData.objects.filter(is_deleted=False).values("bottleneck_id").annotate(items=Count("id"))
		return Response({"markers": list(counts), "timestamp": timezone.now().isoformat()})


class QuickOptimizeView(APIView):
	permission_classes = [permissions.AllowAny]

	def post(self, request):
		payload = request.data or {}
		created_by = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if created_by is None:
			created_by = get_user_model().objects.create_user(username="desktop-runner")
		run = OptimizationRun.objects.create(
			run_id=f"opt-{timezone.now().strftime('%Y%m%d%H%M%S%f')}",
			timestamp=timezone.now(),
			status="queued",
			parameters={
				"mode": "quick",
				"shift": payload.get("shift", "afternoon"),
			},
			fitness_scores=[],
			result_data={},
			created_by=created_by,
		)
		write_audit_log(created_by, "create", "optimization_run", {"run_id": run.run_id, "mode": "quick"})
		return Response({"run_id": run.run_id, "status": run.status}, status=status.HTTP_202_ACCEPTED)
