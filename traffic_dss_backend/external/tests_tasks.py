from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from core.models import Bottleneck, TrafficData, WeatherData
from external.clients import ProviderError
from external.tasks import fetch_traffic_data, fetch_weather_data


@pytest.mark.django_db
def test_fetch_weather_data_uses_fallback_and_persists():
    with patch("external.tasks.fetch_pagasa_weather", side_effect=ProviderError("pagasa down")), patch(
        "external.tasks.fetch_openmeteo_weather",
        return_value={
            "condition": "moderate_rain",
            "temperature": 27.2,
            "precipitation": 4.2,
            "weather_impact_factor": 1.35,
        },
    ):
        result = fetch_weather_data()

    assert result["status"] == "ok"
    assert WeatherData.objects.count() == 1
    assert WeatherData.objects.first().weather_impact_factor == 1.35


@pytest.mark.django_db
def test_fetch_traffic_data_fallback_to_osm_and_persist():
    user = get_user_model().objects.create_user(username="owner", password="pass12345")
    _ = user
    Bottleneck.objects.create(
        id="B-001",
        name="Main",
        latitude=10.7202,
        longitude=122.5621,
        road_priority_weight=1.2,
        district="Iloilo",
        bottleneck_type="intersection",
    )

    with patch("external.tasks.fetch_tomtom_traffic", side_effect=ProviderError("tomtom down")), patch(
        "external.tasks.fetch_osm_overpass_traffic",
        return_value={
            "tsi": 0.52,
            "vehicle_count": 55,
            "current_speed": 18.0,
        },
    ):
        result = fetch_traffic_data()

    assert result["status"] == "ok"
    assert TrafficData.objects.count() == 1
    row = TrafficData.objects.first()
    assert row.traffic_severity_index == pytest.approx(0.52)
