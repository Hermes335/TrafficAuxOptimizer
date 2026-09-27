from django.utils import timezone
from rest_framework import serializers

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

    def validate(self, data):
        low = data.get("min_officers_required", getattr(self.instance, "min_officers_required", 1))
        high = data.get("max_officers_allowed", getattr(self.instance, "max_officers_allowed", 4))
        if low < 1 or high < low:
            raise serializers.ValidationError({"max_officers_allowed": "Capacity must be at least the positive minimum staffing."})
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

    def validate(self, data):
        status = data.get("status", getattr(self.instance, "status", "available"))
        eligible = {"available", "deployed"}
        if status == "deployed" and (not self.instance or self.instance.status != "deployed"):
            raise serializers.ValidationError({"status": "Deployed status is managed by the schedule."})
        if status in eligible and (not self.instance or self.instance.status not in eligible):
            roster = Officer.objects.filter(is_deleted=False, status__in=eligible)
            if self.instance:
                roster = roster.exclude(pk=self.instance.pk)
            if roster.count() >= 60:
                raise serializers.ValidationError({"status": "The active roster is limited to 60 officers."})
        if self.instance and (status not in eligible or data.get("shift", self.instance.shift) != self.instance.shift):
            if self.instance.deployments.filter(is_deleted=False, status="assigned", end_time__gt=timezone.now()).exists():
                raise serializers.ValidationError({"status": "Cancel outstanding assignments before changing eligibility or shift."})
        return data

    class Meta:
        model = Officer
        read_only_fields = ["is_deleted"]
        fields = [
            "id",
            "name",
            "badge_number",
            "shift",
            "status",
            "skills",
            "current_latitude",
            "current_longitude",
            "created_at",
            "updated_at",
            "is_deleted",
        ]

class IncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = "__all__"


class DeploymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Deployment
        fields = "__all__"


class OptimizationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = OptimizationRun
        fields = "__all__"


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

    def validate(self, data):
        node = data.get("bottleneck", getattr(self.instance, "bottleneck", None))
        if node and (node.is_deleted or node.is_archived):
            raise serializers.ValidationError({"bottleneck": "Select an active bottleneck."})
        if not self.instance and not node and (data.get("latitude") is None or data.get("longitude") is None):
            raise serializers.ValidationError("A location or bottleneck is required.")
        if node:
            data.setdefault("latitude", node.latitude)
            data.setdefault("longitude", node.longitude)
        return data

    class Meta:
        model = Incident
        fields = [
            "bottleneck",
            "incident_type",
            "severity",
            "description",
            "photo_url",
            "latitude",
            "longitude",
        ]

    def create(self, validated_data):
        user = self.context.get("request").user if self.context.get("request") else None
        if user and user.is_authenticated:
            validated_data["reported_by"] = user
        validated_data.setdefault("timestamp", timezone.now())
        return super().create(validated_data)


class IncidentResponseSerializer(serializers.ModelSerializer):
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
        ]
