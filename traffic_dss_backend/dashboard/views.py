from django.db.models import Avg, Count
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Bottleneck, Incident, Officer, OptimizationRun, TrafficData, WeatherData
from core.utils import write_audit_log


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
			status_value = "critical" if active_incident else ("warning" if (latest_traffic and latest_traffic.traffic_severity_index > 0.5) else "normal")
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
