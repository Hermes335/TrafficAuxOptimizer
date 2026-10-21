from django.utils import timezone
from rest_framework import serializers
from .skills import normalize_skills

from .models import (
    AuditLog,
    Bottleneck,
    Deployment,
    Incident,
    Officer,
    OptimizationRun,
    POI,
    TrafficData,
    WeatherData,
)


class FiniteFloatField(serializers.FloatField):
    def to_internal_value(self, data):
        import math
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            raise serializers.ValidationError("Must be a finite number.")
        return value


class BottleneckSerializer(serializers.ModelSerializer):
    latitude = FiniteFloatField(min_value=-90, max_value=90)
    longitude = FiniteFloatField(min_value=-180, max_value=180)

    tsi = FiniteFloatField(min_value=0, max_value=1, required=False)
    road_priority_weight = FiniteFloatField(min_value=0, required=False)
    min_officers_required = serializers.IntegerField(min_value=0, required=False)
    max_officers_allowed = serializers.IntegerField(min_value=0, required=False)

    def validate(self, data):
        low = data.get("min_officers_required", getattr(self.instance, "min_officers_required", 2))
        high = data.get("max_officers_allowed", getattr(self.instance, "max_officers_allowed", 5))
        if high < low:
            raise serializers.ValidationError({"max_officers_allowed": "Capacity must be at least the normal minimum staffing."})
        signal = data.get("signal_status", getattr(self.instance, "signal_status", "unknown"))
        if signal == "working" and high < 1:
            raise serializers.ValidationError({"max_officers_allowed": "Working traffic lights require capacity for at least 1 officer."})
        from .staffing import validate_staffing_periods
        periods = data.get("staffing_periods", getattr(self.instance, "staffing_periods", []))
        try:
            validate_staffing_periods(periods, high)
        except ValueError as exc:
            raise serializers.ValidationError({"staffing_periods": str(exc)})
        return data

    class Meta:
        model = Bottleneck
        read_only_fields = ["is_deleted"]
        fields = [
            "id",
            "name",
            "latitude",
            "longitude",
            "road_priority_weight",
            "tsi",
            "heatmap_tsi",
            "min_officers_required",
            "max_officers_allowed",
            "area_name", "signal_status", "staffing_periods",
            "is_archived",
            "district",
            "bottleneck_type",
            "created_at",
            "updated_at",
            "is_deleted",
        ]



class OfficerSerializer(serializers.ModelSerializer):
    current_latitude = FiniteFloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    current_longitude = FiniteFloatField(required=False, allow_null=True, min_value=-180, max_value=180)

    def _stamp_location(self, validated_data):
        from .officer_locations import valid_coordinates

        # A roster edit is not a location observation. Only explicit coordinate
        # submissions can establish when the saved planning position was recorded.
        if "current_latitude" not in validated_data and "current_longitude" not in validated_data:
            return validated_data
        latitude = validated_data.get("current_latitude", getattr(self.instance, "current_latitude", None))
        longitude = validated_data.get("current_longitude", getattr(self.instance, "current_longitude", None))
        validated_data["current_location_recorded_at"] = (
            timezone.now() if valid_coordinates(latitude, longitude) else None
        )
        return validated_data

    def create(self, validated_data):
        return super().create(self._stamp_location(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._stamp_location(validated_data))

    def validate_skills(self, value):
        if not isinstance(value, list) or any(not isinstance(tag, str) for tag in value):
            raise serializers.ValidationError("Provide skills as a list of text labels.")
        if len(value) > 50:
            raise serializers.ValidationError("Provide no more than 50 skill labels.")
        if any(not tag.strip() or len(tag.strip()) > 100 for tag in value):
            raise serializers.ValidationError("Each skill must contain 1–100 characters.")
        return normalize_skills(value)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["skills"] = normalize_skills(instance.skills)
        return data

    def validate(self, data):
        status = data.get("status", getattr(self.instance, "status", "available"))
        eligible = {"available", "deployed"}
        if status == "deployed" and (not self.instance or self.instance.status != "deployed"):
            raise serializers.ValidationError({"status": "Deployed status is managed by the schedule."})
        if self.instance and (status not in eligible or data.get("shift", self.instance.shift) != self.instance.shift):
            if self.instance.deployments.filter(is_deleted=False, status="assigned", end_time__gt=timezone.now()).exists():
                raise serializers.ValidationError({"status": "Cancel outstanding assignments before changing eligibility or shift."})
        return data

    class Meta:
        model = Officer
        read_only_fields = ["is_deleted", "current_location_recorded_at"]
        fields = [
            "id",
            "name",
            "badge_number",
            "shift",
            "status",
            "skills",
            "current_latitude",
            "current_longitude",
            "current_location_recorded_at",
            "created_at",
            "updated_at",
            "is_deleted",
        ]

class IncidentSerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()

    def get_photo_url(self, incident):
        from incidents.photos import legacy_photo_name
        if incident.photo_path or legacy_photo_name(incident.photo_url):
            return f"/api/incidents/{incident.pk}/photo/"
        return ""

    class Meta:
        model = Incident
        exclude = ["photo_path", "submission_key", "submission_fingerprint"]


class DeploymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Deployment
        fields = "__all__"


class OptimizationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = OptimizationRun
        fields = "__all__"


class OptimizationHistorySerializer(serializers.ModelSerializer):
    result_data = serializers.SerializerMethodField()
    fitness_scores = serializers.SerializerMethodField()
    generations_completed = serializers.SerializerMethodField()
    publication_state = serializers.SerializerMethodField()

    class Meta:
        model = OptimizationRun
        fields = ["id", "run_id", "timestamp", "updated_at", "status", "parameters", "result_data", "fitness_scores", "generations_completed", "created_by", "publication_state"]

    def get_publication_state(self, run):
        from deployments.provenance import PublicationProvenance
        provenance = self.context.get("publication_provenance")
        return (provenance or PublicationProvenance(runs=[run])).for_run(run)

    def get_result_data(self, run):
        result = run.result_data if isinstance(run.result_data, dict) else {}
        top = result.get("top_solutions") or []
        if not isinstance(top, list) or not top or not isinstance(top[0], dict):
            top = []
        return {"synthetic_data_used": result.get("synthetic_data_used", []),
                "best_fitness": top[0].get("fitness") if top else None,
                "error": result.get("error"), "mode": run.parameters.get("mode", "operational")}

    def get_fitness_scores(self, run):
        return run.fitness_scores[-1:] if run.fitness_scores else []

    def get_generations_completed(self, run):
        return len(run.fitness_scores or [])


class TrafficDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrafficData
        fields = "__all__"


class WeatherDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeatherData
        fields = "__all__"


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"


class POISerializer(serializers.ModelSerializer):
    latitude = FiniteFloatField(min_value=-90, max_value=90)
    longitude = FiniteFloatField(min_value=-180, max_value=180)
    priority_boost = FiniteFloatField(min_value=0, max_value=10, required=False)

    class Meta:
        model = POI
        fields = [
            "id",
            "poi_id",
            "name",
            "category",
            "latitude",
            "longitude",
            "icon_url",
            "is_active",
            "priority_boost",
            "created_at",
            "updated_at",
        ]


class IncidentCreateSerializer(serializers.ModelSerializer):
    latitude = FiniteFloatField(min_value=-90, max_value=90, required=False, allow_null=True)
    longitude = FiniteFloatField(min_value=-180, max_value=180, required=False, allow_null=True)
    description = serializers.CharField(max_length=5000, trim_whitespace=True)

    def validate(self, data):
        if self.instance and self.instance.status in {"pending", "rejected"}:
            raise serializers.ValidationError("Public submissions must be approved before they can be edited.")
        if self.initial_data.get("photo_url"):
            raise serializers.ValidationError({"photo_url": "Upload a photo through the report form."})
        node = data.get("bottleneck", getattr(self.instance, "bottleneck", None))
        if node and (node.is_deleted or node.is_archived):
            raise serializers.ValidationError({"bottleneck": "Select an active bottleneck."})
        explicit_coordinates = "latitude" in data or "longitude" in data
        if explicit_coordinates:
            if data.get("latitude") is None or data.get("longitude") is None:
                raise serializers.ValidationError("Provide both latitude and longitude for the selected pin.")
            # Keep the location association when a form resends an unchanged
            # pin. Six-decimal coordinate fields may round by half a unit.
            if self.instance and "bottleneck" not in data:
                previous_latitude = self.instance.latitude
                previous_longitude = self.instance.longitude
                if node:
                    previous_latitude = node.latitude if previous_latitude is None else previous_latitude
                    previous_longitude = node.longitude if previous_longitude is None else previous_longitude
                moved = (previous_latitude is None or previous_longitude is None or
                         abs(data["latitude"] - previous_latitude) > 0.0000005 or
                         abs(data["longitude"] - previous_longitude) > 0.0000005)
                if moved:
                    data["bottleneck"] = None
        elif node and (not self.instance or "bottleneck" in data):
            data["latitude"], data["longitude"] = node.latitude, node.longitude
        elif not self.instance or ("bottleneck" in data and node is None and
                                   (self.instance.latitude is None or self.instance.longitude is None)):
            raise serializers.ValidationError("A location or bottleneck is required.")
        return data

    class Meta:
        model = Incident
        fields = [
            "bottleneck",
            "incident_type",
            "severity",
            "description",
            "latitude",
            "longitude",
        ]

    def create(self, validated_data):
        user = self.context.get("request").user if self.context.get("request") else None
        if user and user.is_authenticated:
            validated_data["reported_by"] = user
        validated_data.setdefault("timestamp", timezone.now())
        return super().create(validated_data)


class IncidentResponseSerializer(IncidentSerializer):
    latitude = FiniteFloatField(required=False, allow_null=True)
    longitude = FiniteFloatField(required=False, allow_null=True)

    class Meta:
        model = Incident
        fields = [
            "id",
            "bottleneck",
            "incident_type",
            "severity",
            "description",
            "photo_url",
            "timestamp",
            "status",
            "resolved_time",
            "is_archived",
            "latitude",
            "longitude",
            "reported_by",
            "created_at",
            "updated_at",
            "source",
            "reference",
            "reviewed_by",
            "reviewed_at",
        ]
