from django.db import transaction
from deployments.services import lock_schedule
from core.realtime import broadcast
from core.staffing import required_staffing, shift_staffing
import logging

from django.db.models import Avg, Count, OuterRef, Prefetch, Subquery, Q
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from math import radians, sin, cos, sqrt, atan2

from core.assignment_scoring import rank_candidates_for_bottleneck
from core.data_quality_checks import get_data_quality_issues
from core.models import Bottleneck, Deployment, Incident, Officer, OptimizationRun, POI, TrafficData, WeatherData
from core.serializers import BottleneckSerializer, OfficerSerializer, IncidentCreateSerializer, IncidentResponseSerializer, POISerializer
from core.mutations import record_mutation
from core.permissions import IsSupervisor, SupervisorWrite


logger = logging.getLogger(__name__)


def _generate_next_bottleneck_id() -> str:
	existing_ids = (
		Bottleneck.objects.filter(id__regex=r"^B-\d{3}$")
		.values_list("id", flat=True)
	)
	max_number = 0
	for raw_id in existing_ids:
		try:
			max_number = max(max_number, int(raw_id.split("-")[1]))
		except (IndexError, ValueError):
			continue
	candidate = f"B-{max_number + 1:03d}"
	if Bottleneck.objects.filter(pk=candidate).exists():
		import uuid
		candidate = f"B-{uuid.uuid4().hex[:6]}"
	return candidate


class DashboardKPIsView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		from core.operational_time import operational_date, shift_window
		from core.staffing import required_staffing
		from rest_framework import serializers
		shift = serializers.ChoiceField(choices=["morning", "afternoon"]).run_validation(request.query_params.get("shift", "afternoon"))
		day = serializers.DateField().run_validation(request.query_params.get("date", str(operational_date())))
		start, end = shift_window(shift, day)
		nodes = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).prefetch_related("incidents"))
		assigned = Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"], shift=shift, start_time__lt=end, end_time__gt=start)
		requirements = {b.id: required_staffing(b, [i for i in b.incidents.all() if not i.is_deleted and i.status in {"active", "investigating"}]) for b in nodes}
		rows = list(assigned)
		counts = {b.id: shift_staffing([d for d in rows if d.bottleneck_id == b.id], requirements[b.id], start, end) for b in nodes}
		required = sum(requirements.values())
		fulfilled = sum(covered for _, covered in counts.values())
		active_officers = Officer.objects.filter(is_deleted=False, shift=shift, status__in=["available", "deployed"]).count()
		deployed = assigned.values("officer").distinct().count()
		weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		return Response({
			"coverage_efficiency": round(100 * fulfilled / required, 1) if required else None,
			"required_staffing": required, "assigned_staffing": round(sum(count for count, _ in counts.values()), 2), "shortages": round(required - fulfilled, 2),
			"avg_response_time": None, "response_time_kind": "unavailable", "response_time_window": {"start": start.isoformat(), "end": end.isoformat()},
			"resource_utilization": round(100 * deployed / active_officers, 1) if active_officers else None,
			"weather_impact_factor": weather.weather_impact_factor if weather else None,
			"deployed_officers": deployed, "active_officers": active_officers, "shift": shift,
			"operational_date": day, "as_of": timezone.now().isoformat(),
		})


class DashboardBottlenecksView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_scope = "public_dashboard"

	def get(self, request):
		from core.operational_time import shift_window, operational_date
		from rest_framework import serializers
		scope_shift = serializers.ChoiceField(choices=["morning", "afternoon"]).run_validation(request.query_params.get("shift", "afternoon"))
		day = serializers.DateField().run_validation(request.query_params.get("date", str(operational_date())))
		scope_start, scope_end = shift_window(scope_shift, day)
		latest_traffic_tsi = TrafficData.objects.filter(
			is_deleted=False,
			bottleneck_id=OuterRef("pk"),
		).order_by("-timestamp").values("traffic_severity_index")[:1]

		bottlenecks = (
			Bottleneck.objects.filter(is_deleted=False, is_archived=False)
			.annotate(latest_tsi=Subquery(latest_traffic_tsi))
			.prefetch_related(
				Prefetch(
					"incidents",
					queryset=Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"]).order_by("-timestamp"),
					to_attr="active_incidents",
				),
				Prefetch(
					"deployments",
					queryset=Deployment.objects.filter(is_deleted=False, status__in=["assigned", "completed"], start_time__lt=scope_end, end_time__gt=scope_start, shift=scope_shift).select_related("officer"),
					to_attr="active_deployments",
				),
			)
			.order_by("id")
		)
		candidate_pool = list(
			Officer.objects.filter(is_deleted=False)
			.order_by("name")
			.prefetch_related(
				Prefetch(
					"deployments",
					queryset=Deployment.objects.filter(is_deleted=False, status="assigned"),
				)
			)
		)
		weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		wif = float(weather.weather_impact_factor) if weather else None

		paginator = PageNumberPagination()
		page = paginator.paginate_queryset(bottlenecks, request, view=self)
		rows = []
		for b in page:
			active_incident = b.active_incidents[0] if getattr(b, "active_incidents", None) else None
			deployments = getattr(b, "active_deployments", [])
			assigned_officers = [
				{"name": d.officer.name, "badge_number": d.officer.badge_number}
				for d in deployments if request.user.is_authenticated
			]
			# Use bottleneck's tsi field if available, otherwise fall back to traffic data
			tsi_val = b.tsi
			status_value = "normal"
			if tsi_val >= 0.8:
				status_value = "critical"
			elif tsi_val >= 0.4:
				status_value = "warning"
			
			required_officers = required_staffing(b, b.active_incidents)
			assigned_count, covered_count = shift_staffing(deployments, required_officers, scope_start, scope_end)
			staffing_gap = max(required_officers - covered_count, 0)
			if assigned_count < required_officers:
				coverage_status = "critical" if active_incident and active_incident.severity == "critical" else "warning"
			elif assigned_count > required_officers:
				coverage_status = "warning"
			elif tsi_val >= 0.8:
				coverage_status = "warning"
			else:
				coverage_status = "healthy"

			operational_alerts = []
			if active_incident:
				operational_alerts.append(f"{active_incident.severity} incident active")
			if assigned_count < required_officers:
				operational_alerts.append(f"Coverage below requirement: {assigned_count}/{required_officers}")
			if tsi_val >= 0.8:
				operational_alerts.append("High TSI pressure detected")
			if assigned_count > required_officers:
				operational_alerts.append("Possible over-assignment across active posts")
			if not operational_alerts:
				operational_alerts.append("Coverage stable")

			candidate_rankings = rank_candidates_for_bottleneck(b, candidate_pool, active_incident=active_incident)
			best_candidate = candidate_rankings[0] if candidate_rankings else None
			if best_candidate is not None and best_candidate["score"] < 50:
				operational_alerts.append("Preferred officer quality below threshold")
			
			rows.append(
				{
					"id": b.id,
					"name": b.name,
					"district": b.district, "bottleneck_type": b.bottleneck_type, "road_priority_weight": b.road_priority_weight,
					"latitude": b.latitude,
					"longitude": b.longitude,
					"status": status_value,
					"tsi": tsi_val,
					"weather_impact_factor": wif,
					"assigned_officers": assigned_officers,
					"deployed_officers": assigned_count,
					"assigned_officer_count": assigned_count,
					"required_officer_count": required_officers,
					"required_officers": required_officers,
					"min_officers_required": b.min_officers_required,
					"max_officers_allowed": b.max_officers_allowed,
					"staffing_gap": staffing_gap,
					"coverage_status": coverage_status,
					"operational_alerts": operational_alerts,
					"best_candidate_score": best_candidate["score"] if best_candidate else None,
					"assigned_officer": assigned_officers[0]["badge_number"] if assigned_officers else None,
				}
			)
		return paginator.get_paginated_response(rows)


class DashboardOfficersView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	throttle_scope = "operational_read"

	def get(self, request):
		officers = Officer.objects.filter(is_deleted=False).order_by("name", "id")
		term = request.query_params.get("search", "").strip()
		if term:
			officers = officers.filter(Q(name__icontains=term) | Q(badge_number__icontains=term))
		for key in ["shift", "status"]:
			value = request.query_params.get(key)
			if value and value != "all":
				officers = officers.filter(**{key: value})
		paginator = PageNumberPagination()
		paginator.page_size_query_param = "page_size"
		paginator.max_page_size = 100
		page = paginator.paginate_queryset(officers, request, view=self)
		return paginator.get_paginated_response(OfficerSerializer(page, many=True).data)


class DashboardDataQualityView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	throttle_classes = []

	def get(self, request):
		quality = get_data_quality_issues()
		return Response(
			{
				"total_issues": quality["total_issues"],
				"issue_counts": quality["issue_counts"],
				"issues": quality["issues"],
				"quality_status": "warning" if quality["total_issues"] else "healthy",
			}
		)


class DashboardBottleneckManageView(APIView):
	permission_classes = [IsSupervisor]

	@transaction.atomic
	def post(self, request):
		lock_schedule()
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
				"tsi": payload.get("tsi", 0.0),
			}
		)
		serializer.is_valid(raise_exception=True)
		created = serializer.save()
		record_mutation(request.user, "create", "bottleneck", {"bottleneck_id": created.pk}, "bottlenecks_updated")

		return Response(BottleneckSerializer(created).data, status=status.HTTP_201_CREATED)

	@transaction.atomic
	def put(self, request, bottleneck_id: str):
		lock_schedule()
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
			"tsi": payload.get("tsi", bottleneck.tsi),
			"min_officers_required": payload.get("min_officers_required", bottleneck.min_officers_required),
			"max_officers_allowed": payload.get("max_officers_allowed", bottleneck.max_officers_allowed),
			"is_archived": payload.get("is_archived", bottleneck.is_archived),
		}

		serializer = BottleneckSerializer(bottleneck, data=allowed_fields, partial=True)
		serializer.is_valid(raise_exception=True)
		updated = serializer.save()
		record_mutation(request.user, "update", "bottleneck", {"bottleneck_id": updated.pk}, "bottlenecks_updated")
		return Response(BottleneckSerializer(updated).data)

	@transaction.atomic
	def delete(self, request, bottleneck_id: str):
		lock_schedule()
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
		record_mutation(request.user, "delete", "bottleneck", {"bottleneck_id": bottleneck.pk}, "bottlenecks_updated")
		return Response(status=status.HTTP_204_NO_CONTENT)


class DashboardOfficerManageView(APIView):
	permission_classes = [IsSupervisor]

	@transaction.atomic
	def post(self, request):
		lock_schedule()
		payload = request.data or {}
		serializer = OfficerSerializer(data=payload)
		serializer.is_valid(raise_exception=True)
		created = serializer.save()
		record_mutation(request.user, "create", "officer", {"officer_id": created.pk}, "officers_updated")
		return Response(OfficerSerializer(created).data, status=status.HTTP_201_CREATED)

	@transaction.atomic
	def put(self, request, officer_id: int):
		lock_schedule()
		officer = Officer.objects.filter(pk=officer_id, is_deleted=False).first()
		if not officer:
			return Response({"detail": "Officer not found."}, status=status.HTTP_404_NOT_FOUND)

		serializer = OfficerSerializer(officer, data=request.data or {}, partial=True)
		serializer.is_valid(raise_exception=True)
		updated = serializer.save()
		record_mutation(request.user, "update", "officer", {"officer_id": updated.pk}, "officers_updated")
		return Response(OfficerSerializer(updated).data)

	@transaction.atomic
	def delete(self, request, officer_id: int):
		lock_schedule()
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
		record_mutation(request.user, "delete", "officer", {"officer_id": officer.pk}, "officers_updated")
		return Response(status=status.HTTP_204_NO_CONTENT)


class ActiveIncidentsView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		incidents = (
			Incident.objects.filter(is_deleted=False, status__in=["active", "investigating"])
			.select_related("bottleneck")
			.order_by("-timestamp", "-id")
		)
		paginator = PageNumberPagination()
		page = paginator.paginate_queryset(incidents, request, view=self)
		data = []
		for i in page:
			lat = i.latitude
			lon = i.longitude
			if lat is None and i.bottleneck:
				lat = i.bottleneck.latitude
				lon = i.bottleneck.longitude
			data.append({
				"id": i.id,
				"text": f"{i.severity.title()}: {i.description} - {i.bottleneck.id if i.bottleneck else 'N/A'} {i.bottleneck.name if i.bottleneck else 'Unknown'}",
				"type": "critical" if i.severity == "critical" else ("major" if i.severity == "major" else "minor"),
				"latitude": lat,
				"longitude": lon,
				"severity": i.severity,
				"incident_type": i.incident_type,
				"description": i.description,
				"timestamp": i.timestamp.isoformat() if i.timestamp else None,
			})
		return paginator.get_paginated_response(data)


class IncidentListCreateView(APIView):
	permission_classes = [permissions.IsAuthenticatedOrReadOnly]

	def get(self, request):
		status_filter = request.query_params.get("status", "active")
		incidents = (
			Incident.objects.filter(is_deleted=False, status=status_filter)
			.select_related("bottleneck", "reported_by")
			.order_by("-timestamp")
		)
		paginator = PageNumberPagination()
		page = paginator.paginate_queryset(incidents, request, view=self)
		return paginator.get_paginated_response(IncidentResponseSerializer(page, many=True).data)

	@transaction.atomic
	def post(self, request):
		lock_schedule()
		serializer = IncidentCreateSerializer(data=request.data, context={"request": request})
		serializer.is_valid(raise_exception=True)
		incident = serializer.save()
		record_mutation(request.user, "create", "incident", {"incident_id": incident.id}, "incident_reported")
		return Response(IncidentResponseSerializer(incident).data, status=status.HTTP_201_CREATED)


class IncidentDetailView(APIView):
	permission_classes = [permissions.IsAuthenticatedOrReadOnly]

	def get(self, request, incident_id):
		incident = Incident.objects.filter(id=incident_id, is_deleted=False).select_related("bottleneck", "reported_by").first()
		if not incident:
			return Response({"detail": "Incident not found"}, status=status.HTTP_404_NOT_FOUND)
		return Response(IncidentResponseSerializer(incident).data)

	@transaction.atomic
	def put(self, request, incident_id):
		lock_schedule()
		incident = Incident.objects.select_for_update().filter(id=incident_id, is_deleted=False).first()
		if not incident:
			return Response({"detail": "Incident not found"}, status=status.HTTP_404_NOT_FOUND)
		serializer = IncidentCreateSerializer(incident, data=request.data, partial=True)
		serializer.is_valid(raise_exception=True)
		incident = serializer.save()
		record_mutation(request.user, "update", "incident", {"incident_id": incident.id}, "incident_updated")
		return Response(IncidentResponseSerializer(incident).data)


class POIListView(APIView):
	permission_classes = [permissions.IsAuthenticatedOrReadOnly]
	throttle_classes = []

	def get(self, request):
		pois = POI.objects.filter(is_deleted=False, is_active=True).order_by("id")
		paginator = PageNumberPagination()
		page = paginator.paginate_queryset(pois, request, view=self)
		return paginator.get_paginated_response(POISerializer(page, many=True).data)

	@transaction.atomic
	def post(self, request):
		data = request.data.copy()
		if not data.get("poi_id"):
			import uuid
			data["poi_id"] = f"POI-{uuid.uuid4().hex[:8]}"
		serializer = POISerializer(data=data)
		if serializer.is_valid():
			poi = serializer.save()
			record_mutation(request.user, "create", "poi", {"poi_id": poi.poi_id}, "pois_updated")
			return Response(POISerializer(poi).data, status=status.HTTP_201_CREATED)
		return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class POIDetailView(APIView):
	permission_classes = [permissions.IsAuthenticatedOrReadOnly]

	@transaction.atomic
	def put(self, request, poi_id):
		poi = POI.objects.filter(poi_id=poi_id, is_deleted=False).first()
		if not poi:
			return Response({"detail": "POI not found."}, status=status.HTTP_404_NOT_FOUND)
		serializer = POISerializer(poi, data=request.data, partial=True)
		if serializer.is_valid():
			poi = serializer.save()
			record_mutation(request.user, "update", "poi", {"poi_id": poi.poi_id}, "pois_updated")
			return Response(POISerializer(poi).data)
		return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

	@transaction.atomic
	def delete(self, request, poi_id):
		poi = POI.objects.filter(poi_id=poi_id, is_deleted=False).first()
		if not poi:
			return Response({"detail": "POI not found."}, status=status.HTTP_404_NOT_FOUND)
		poi.is_deleted = True
		poi.save(update_fields=["is_deleted", "updated_at"])
		record_mutation(request.user, "delete", "poi", {"poi_id": poi.poi_id}, "pois_updated")
		return Response(status=status.HTTP_204_NO_CONTENT)


def _haversine_distance(lat1, lon1, lat2, lon2):
	"""Calculate the great circle distance in kilometers between two points."""
	R = 6371  # Earth's radius in kilometers
	lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
	dlat = lat2 - lat1
	dlon = lon2 - lon1
	a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
	c = 2 * atan2(sqrt(a), sqrt(1 - a))
	return R * c


class TrafficSampleView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		try:
			lat = float(request.query_params.get("lat"))
			lon = float(request.query_params.get("lon"))
		except (TypeError, ValueError):
			return Response({"detail": "Invalid lat/lon parameters"}, status=status.HTTP_400_BAD_REQUEST)

		# Find nearest bottleneck with traffic data
		bottlenecks = Bottleneck.objects.filter(is_deleted=False)
		nearest = None
		min_dist = float("inf")

		for b in bottlenecks:
			dist = _haversine_distance(lat, lon, b.latitude, b.longitude)
			if dist < min_dist:
				min_dist = dist
				nearest = b

		if nearest and min_dist <= 10:  # Within 10km
			latest_traffic = nearest.traffic_data.filter(is_deleted=False).order_by("-timestamp").first()
			if latest_traffic:
				return Response({
					"heatmap_tsi": nearest.heatmap_tsi or latest_traffic.traffic_severity_index,
					"severity_index": min(3, int(latest_traffic.traffic_severity_index * 3)),
					"bottleneck_id": nearest.id,
					"distance_km": round(min_dist, 2),
				})

		return Response({
			"heatmap_tsi": None,
			"severity_index": None,
			"bottleneck_id": None,
			"distance_km": round(min_dist, 2) if nearest else None,
		})


class DashboardMapDataView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		counts = TrafficData.objects.filter(is_deleted=False).values("bottleneck_id").annotate(items=Count("id"))
		return Response({"markers": list(counts), "timestamp": timezone.now().isoformat()})


class QuickOptimizeView(APIView):
	permission_classes = [IsSupervisor]

	def post(self, request):
		from optimization.services import start_run
		run, queued = start_run(request.user, request.data)
		return Response({"run_id": run.run_id, "status": run.status, **({} if queued else {"detail": "Background queue unavailable."})}, status=202 if queued else 503)
