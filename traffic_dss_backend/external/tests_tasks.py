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
    assert result["source"] == "openmeteo"
    assert result["data_status"] == "fallback"
    assert result["available"] is True
    assert result["is_stale"] is False
    assert WeatherData.objects.count() == 1
    assert WeatherData.objects.first().weather_impact_factor == 1.35
    assert WeatherData.objects.first().data_status == "fallback"


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
    assert result["sources"]["osm_overpass"] == 1
    assert TrafficData.objects.count() == 1
    row = TrafficData.objects.first()
    assert row.traffic_severity_index == pytest.approx(0.52)
    assert row.source == "osm_overpass"
    assert row.data_status == "fallback"


@pytest.mark.django_db
def test_weather_provider_success_is_live():
    with patch("external.tasks.fetch_pagasa_weather", return_value={
        "source": "pagasa",
        "condition": "clear",
        "temperature": 30.0,
        "precipitation": 0.0,
        "weather_impact_factor": 1.0,
    }):
        result = fetch_weather_data()

    assert result["source"] == "pagasa"
    assert result["data_status"] == "live"
    assert result["available"] is True
    assert result["is_stale"] is False


@pytest.mark.django_db
def test_cached_weather_is_marked_stale():
    from django.core.cache import cache

    cache.set("external:weather:last", {
        "source": "pagasa",
        "condition": "clear",
        "temperature": 28.0,
        "precipitation": 0.0,
        "weather_impact_factor": 1.0,
        "fetched_at": "2026-09-19T00:00:00+00:00",
    })
    with patch("external.tasks.fetch_pagasa_weather", side_effect=ProviderError("down")), patch(
        "external.tasks.fetch_openmeteo_weather", side_effect=ProviderError("down")
    ):
        result = fetch_weather_data()

    assert result["source"] == "cache"
    assert result["data_status"] == "cached"
    assert result["is_stale"] is True
    assert WeatherData.objects.first().fetched_at.year == 2026


@pytest.mark.django_db
def test_no_weather_data_is_unavailable():
    from django.core.cache import cache

    cache.delete("external:weather:last")
    with patch("external.tasks.fetch_pagasa_weather", side_effect=ProviderError("down")), patch(
        "external.tasks.fetch_openmeteo_weather", side_effect=ProviderError("down")
    ):
        result = fetch_weather_data()

    assert result["data_status"] == "unavailable"
    assert result["available"] is False
