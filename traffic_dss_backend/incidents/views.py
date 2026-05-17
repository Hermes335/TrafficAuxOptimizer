from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image
from django.utils import timezone
from rest_framework import permissions, status
from django.contrib.auth import get_user_model
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Bottleneck, Incident
from core.realtime import broadcast
from core.serializers import IncidentSerializer
from core.utils import write_audit_log


class IncidentMetaView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		return Response(
			{
				"incident_types": [{"value": value, "label": label} for value, label in Incident.TYPES],
				"severities": [{"value": value, "label": label} for value, label in Incident.SEVERITIES],
				"statuses": [{"value": value, "label": label} for value, label in Incident.STATUSES],
			}
		)


class IncidentReportView(APIView):
	permission_classes = [permissions.IsAuthenticated]
	parser_classes = [MultiPartParser, FormParser]

	def post(self, request):
		bottleneck_id = request.data.get("bottleneck")
		bottleneck = Bottleneck.objects.filter(id=bottleneck_id, is_deleted=False).first()
		if not bottleneck:
			return Response({"detail": "Invalid bottleneck."}, status=status.HTTP_400_BAD_REQUEST)

		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")

		photo_url = request.data.get("photo_url", "")
		photo_file = request.FILES.get("photo")
		if photo_file:
			base_name = Path(photo_file.name).stem
			suffix = Path(photo_file.name).suffix.lower() or ".jpg"
			storage_path = default_storage.save(f"incident-photos/{timezone.now():%Y%m%d%H%M%S}-{base_name}{suffix}", photo_file)
			photo_url = default_storage.url(storage_path)

			try:
				photo_file.seek(0)
				image = Image.open(photo_file)
				image.thumbnail((320, 320))
				buffer = BytesIO()
				image_format = "PNG" if image.mode in ("RGBA", "LA") else "JPEG"
				if image_format == "JPEG" and image.mode not in ("RGB", "L"):
					image = image.convert("RGB")
				image.save(buffer, format=image_format, optimize=True)
				default_storage.save(
					f"incident-photos/thumbnails/{timezone.now():%Y%m%d%H%M%S}-{base_name}.{'png' if image_format == 'PNG' else 'jpg'}",
					ContentFile(buffer.getvalue()),
				)
			except Exception:
				pass

		incident_type = request.data.get("incident_type", "other")
		severity = request.data.get("severity", "minor")
		valid_types = {t[0] for t in Incident.TYPES}
		valid_severities = {s[0] for s in Incident.SEVERITIES}
		if incident_type not in valid_types:
			return Response({"detail": f"Invalid incident_type. Valid: {valid_types}"}, status=status.HTTP_400_BAD_REQUEST)
		if severity not in valid_severities:
			return Response({"detail": f"Invalid severity. Valid: {valid_severities}"}, status=status.HTTP_400_BAD_REQUEST)

		incident = Incident.objects.create(
			bottleneck=bottleneck,
			incident_type=incident_type,
			severity=severity,
			description=request.data.get("description", ""),
			photo_url=photo_url,
			reported_by=actor,
			timestamp=timezone.now(),
			status="active",
		)
		write_audit_log(actor, "create", "incident", {"incident_id": incident.id})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "incident_reported",
				"id": incident.id,
				"severity": incident.severity,
				"bottleneck_id": bottleneck.id,
				"bottleneck_name": bottleneck.name,
				"timestamp": incident.timestamp.isoformat(),
			},
		)
		broadcast(
			"incidents_live",
			"incident_event",
			{
				"event": "incident_reported",
				"id": incident.id,
				"severity": incident.severity,
				"bottleneck_id": bottleneck.id,
				"timestamp": incident.timestamp.isoformat(),
			},
		)
		return Response(IncidentSerializer(incident).data, status=status.HTTP_201_CREATED)


class IncidentListView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		queryset = Incident.objects.filter(is_deleted=False)
		severity = request.query_params.get("severity")
		state = request.query_params.get("status")
		if severity:
			queryset = queryset.filter(severity=severity)
		if state:
			queryset = queryset.filter(status=state)
		queryset = queryset.order_by("-timestamp")
		return Response(IncidentSerializer(queryset, many=True).data)


class IncidentResolveView(APIView):
	permission_classes = [permissions.IsAuthenticated]

	def put(self, request, incident_id: int):
		incident = Incident.objects.filter(pk=incident_id, is_deleted=False).first()
		if not incident:
			return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)

		actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else get_user_model().objects.order_by("id").first()
		if actor is None:
			actor = get_user_model().objects.create_user(username="desktop-runner")

		incident.status = "resolved"
		incident.save(update_fields=["status", "updated_at"])
		write_audit_log(actor, "update", "incident", {"incident_id": incident.id, "status": "resolved"})
		broadcast(
			"dashboard_live",
			"dashboard_event",
			{
				"event": "incident_resolved",
				"id": incident.id,
				"bottleneck_id": incident.bottleneck_id,
				"timestamp": incident.updated_at.isoformat(),
			},
		)
		broadcast(
			"incidents_live",
			"incident_event",
			{
				"event": "incident_resolved",
				"id": incident.id,
				"bottleneck_id": incident.bottleneck_id,
				"timestamp": incident.updated_at.isoformat(),
			},
		)
		return Response(IncidentSerializer(incident).data)


class IncidentDeleteView(APIView):
	permission_classes = [permissions.IsAdminUser]

	def delete(self, request, incident_id: int):
		incident = Incident.objects.filter(pk=incident_id, is_deleted=False).first()
		if not incident:
			return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
		incident.is_deleted = True
		incident.save(update_fields=["is_deleted", "updated_at"])
		write_audit_log(request.user, "delete", "incident", {"incident_id": incident.id})
		return Response(status=status.HTTP_204_NO_CONTENT)
