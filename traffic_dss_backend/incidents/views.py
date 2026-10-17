import hashlib
import json
import uuid
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db import IntegrityError, transaction
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle

from core.models import Bottleneck, Incident
from core.realtime import broadcast
from core.serializers import IncidentSerializer, IncidentCreateSerializer
from core.mutations import record_mutation
from deployments.services import lock_schedule
from core.utils import write_audit_log
from .photos import legacy_photo_name, private_photo_storage, sanitize_photo


def incident_event(incident, event):
    transaction.on_commit(lambda: broadcast("incidents_live", "incident_event", {
        "event": event, "id": incident.id, "severity": incident.severity,
        "bottleneck_id": incident.bottleneck_id, "timestamp": incident.updated_at.isoformat(),
    }))


def receipt(incident, response_status):
    return Response({"id": incident.pk, "reference": str(incident.reference), "status": incident.status}, status=response_status)


class IncidentMetaView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({
            "incident_types": [{"value": value, "label": label} for value, label in Incident.TYPES],
            "severities": [{"value": value, "label": label} for value, label in Incident.SEVERITIES],
            "statuses": [{"value": value, "label": label} for value, label in Incident.STATUSES],
        })


class IncidentLocationsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(list(Bottleneck.objects.filter(is_deleted=False, is_archived=False)
                             .order_by("name", "id").values("id", "name", "latitude", "longitude")))


class SubmissionKeySerializer(serializers.Serializer):
    submission_key = serializers.UUIDField(required=False)


class IncidentReportView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [AnonRateThrottle, ScopedRateThrottle]
    throttle_scope = "incident_report"

    def get_throttles(self):
        self.throttle_scope = "incident_report_staff" if self.request.user.is_authenticated else "incident_report"
        return super().get_throttles()

    def post(self, request):
        actor = request.user if request.user.is_authenticated else None
        serializer = IncidentCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        key_input = SubmissionKeySerializer(data=request.data)
        key_input.is_valid(raise_exception=True)
        key = key_input.validated_data.get("submission_key")
        photo_data, suffix = (None, None)
        if request.FILES.get("photo"):
            photo_data, suffix = sanitize_photo(request.FILES["photo"])
        values = serializer.validated_data
        fingerprint_data = {**values, "bottleneck": getattr(values.get("bottleneck"), "pk", None),
                            "actor": actor.pk if actor else None,
                            "photo": hashlib.sha256(photo_data).hexdigest() if photo_data else None}
        fingerprint = hashlib.sha256(json.dumps(fingerprint_data, sort_keys=True).encode()).hexdigest()
        existing = Incident.objects.filter(submission_key=key).first() if key else None
        if existing:
            return self.replay(existing, fingerprint)

        photo_path = ""
        storage = private_photo_storage()
        try:
            with transaction.atomic():
                if actor:
                    lock_schedule()
                if photo_data:
                    photo_path = storage.save(f"incident-photos/{uuid.uuid4().hex}{suffix}", ContentFile(photo_data))
                incident = serializer.save(
                    reported_by=actor, source="staff" if actor else "public",
                    status="active" if actor else "pending", photo_path=photo_path,
                    submission_key=key, submission_fingerprint=fingerprint,
                )
                if actor:
                    record_mutation(actor, "create", "incident", {"incident_id": incident.id}, "incident_reported")
                    incident_event(incident, "incident_reported")
                else:
                    # Pending submissions do not change operational inputs or
                    # emit active incident events before a staff review.
                    write_audit_log(None, "submit", "incident", {"incident_id": incident.id, "status": "pending"})
        except IntegrityError:
            if photo_path:
                storage.delete(photo_path)
            existing = Incident.objects.filter(submission_key=key).first() if key else None
            if existing:
                return self.replay(existing, fingerprint)
            raise
        except Exception:
            if photo_path:
                storage.delete(photo_path)
            raise
        return receipt(incident, status.HTTP_201_CREATED)

    @staticmethod
    def replay(incident, fingerprint):
        if incident.submission_fingerprint != fingerprint or incident.is_deleted:
            return Response({"detail": "This submission key was already used for a different report. Start a new report."}, status=409)
        return receipt(incident, status.HTTP_200_OK)


class IncidentListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Incident.objects.filter(is_deleted=False).exclude(status__in=["pending", "rejected"])
        severity = request.query_params.get("severity")
        state = request.query_params.get("status")
        if severity:
            queryset = queryset.filter(severity=severity)
        if state:
            queryset = queryset.filter(status=state)
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset.order_by("-timestamp", "-pk"), request, view=self)
        return paginator.get_paginated_response(IncidentSerializer(page, many=True).data)


class IncidentReviewListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Incident.objects.filter(is_deleted=False, status="pending", source="public").order_by("timestamp", "pk")
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(IncidentSerializer(page, many=True).data)


class ReviewDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])


class IncidentReviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, incident_id):
        decision = ReviewDecisionSerializer(data=request.data)
        decision.is_valid(raise_exception=True)
        lock_schedule()
        incident = Incident.objects.select_for_update().filter(pk=incident_id, is_deleted=False).first()
        if not incident:
            return Response({"detail": "Incident not found."}, status=404)
        if incident.status != "pending" or incident.source != "public":
            return Response({"detail": "This report has already been reviewed or is not awaiting review."}, status=409)
        approved = decision.validated_data["decision"] == "approve"
        incident.status = "active" if approved else "rejected"
        incident.reviewed_by = request.user
        incident.reviewed_at = timezone.now()
        incident.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
        changes = {"incident_id": incident.id, "status": incident.status}
        if approved:
            record_mutation(request.user, "approve", "incident", changes, "incident_reported")
            incident_event(incident, "incident_reported")
        else:
            write_audit_log(request.user, "reject", "incident", changes)
        return Response(IncidentSerializer(incident).data)


class IncidentPhotoView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, incident_id):
        incident = Incident.objects.filter(pk=incident_id, is_deleted=False).first()
        if not incident:
            raise Http404
        legacy_name = legacy_photo_name(incident.photo_url)
        if not incident.photo_path and not legacy_name:
            raise Http404
        try:
            if incident.photo_path:
                photo = private_photo_storage().open(incident.photo_path, "rb")
                content_type = "image/png" if incident.photo_path.endswith(".png") else "image/jpeg"
            else:
                with FileSystemStorage(location=settings.MEDIA_ROOT).open(legacy_name, "rb") as original:
                    data, suffix = sanitize_photo(original)
                photo = BytesIO(data)
                content_type = "image/png" if suffix == ".png" else "image/jpeg"
        except (FileNotFoundError, serializers.ValidationError):
            raise Http404
        response = FileResponse(photo, content_type=content_type)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class IncidentUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def put(self, request, incident_id: int):
        lock_schedule()
        incident = Incident.objects.select_for_update().filter(pk=incident_id, is_deleted=False).first()
        if not incident:
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = IncidentCreateSerializer(incident, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        incident = serializer.save()
        record_mutation(request.user, "update", "incident", {"incident_id": incident.id}, "incident_updated")
        return Response(IncidentSerializer(incident).data)


class IncidentResolveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def put(self, request, incident_id: int):
        lock_schedule()
        incident = Incident.objects.select_for_update().filter(pk=incident_id, is_deleted=False).first()
        if not incident:
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
        if incident.status in {"pending", "rejected"}:
            return Response({"detail": "Public submissions must be approved before they can be resolved."}, status=409)
        incident.status = "resolved"
        incident.resolved_time = timezone.now()
        incident.save(update_fields=["status", "resolved_time", "updated_at"])
        record_mutation(request.user, "update", "incident", {"incident_id": incident.id, "status": "resolved"}, "incident_resolved")
        incident_event(incident, "incident_resolved")
        return Response(IncidentSerializer(incident).data)


class IncidentDeleteView(APIView):
    permission_classes = [permissions.IsAdminUser]

    @transaction.atomic
    def delete(self, request, incident_id: int):
        lock_schedule()
        incident = Incident.objects.select_for_update().filter(pk=incident_id, is_deleted=False).first()
        if not incident:
            return Response({"detail": "Incident not found."}, status=status.HTTP_404_NOT_FOUND)
        incident.is_deleted = True
        incident.save(update_fields=["is_deleted", "updated_at"])
        if incident.status in {"pending", "rejected"}:
            write_audit_log(request.user, "delete", "incident", {"incident_id": incident.id})
        else:
            record_mutation(request.user, "delete", "incident", {"incident_id": incident.id}, "incident_resolved")
        return Response(status=status.HTTP_204_NO_CONTENT)
