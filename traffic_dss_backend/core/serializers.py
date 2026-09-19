from rest_framework import serializers

from .models import (
    AuditLog,
    Bottleneck,
    Deployment,
    Incident,
    Officer,
    OptimizationRun,
    POI,
    Scenario,
    TrafficData,
    WeatherData,
)


class BottleneckSerializer(serializers.ModelSerializer):
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()

    class Meta:
        model = Bottleneck
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
    current_latitude = serializers.FloatField(required=False, allow_null=True)
    current_longitude = serializers.FloatField(required=False, allow_null=True)

    class Meta:
        model = Officer
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


class ScenarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scenario
        fields = "__all__"


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"


class POISerializer(serializers.ModelSerializer):
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
        return super().create(validated_data)


class IncidentResponseSerializer(serializers.ModelSerializer):
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)

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
