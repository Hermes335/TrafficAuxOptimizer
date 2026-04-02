from rest_framework import serializers

from .models import (
    AuditLog,
    Bottleneck,
    Deployment,
    Incident,
    Officer,
    OptimizationRun,
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
