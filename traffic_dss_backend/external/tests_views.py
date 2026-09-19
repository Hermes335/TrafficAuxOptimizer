import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from core.models import Bottleneck, TrafficData, WeatherData


@pytest.mark.django_db
def test_weather_api_exposes_live_provenance():
    WeatherData.objects.create(
        timestamp="2026-09-19T00:00:00Z",
        source="pagasa",
        data_status="live",
        fetched_at="2026-09-19T00:00:00Z",
        condition="clear",
        temperature=30,
        precipitation=0,
        weather_impact_factor=1,
    )
    response = APIClient().get("/api/weather/current/")
    assert response.status_code == 200
    assert response.json()["source"] == "pagasa"
    assert response.json()["data_status"] == "live"
    assert response.json()["available"] is True


@pytest.mark.django_db
def test_weather_api_reports_unavailable_without_data():
    cache.delete("external:weather:last")
    response = APIClient().get("/api/weather/current/")
    assert response.status_code == 200
    assert response.json()["data_status"] == "unavailable"
    assert response.json()["available"] is False


@pytest.mark.django_db
def test_trends_api_exposes_cached_provenance():
    bottleneck = Bottleneck.objects.create(
        id="B-TREND",
        name="Trend Test",
        latitude=10.72,
        longitude=122.56,
        district="Iloilo",
    )
    TrafficData.objects.create(
        bottleneck=bottleneck,
        timestamp="2026-09-19T00:00:00Z",
        source="cache",
        data_status="cached",
        is_stale=True,
        fetched_at="2026-09-18T23:00:00Z",
        traffic_severity_index=0.4,
        avg_speed=25,
    )
    response = APIClient().get("/api/analytics/trends/")
    assert response.status_code == 200
    assert response.json()["metadata"]["data_status"] == "cached"
    assert response.json()["metadata"]["is_stale"] is True


@pytest.mark.django_db
def test_traffic_api_exposes_live_provenance_and_unavailable_state():
    bottleneck = Bottleneck.objects.create(
        id="B-TRAFFIC",
        name="Traffic Test",
        latitude=10.72,
        longitude=122.56,
        district="Iloilo",
    )
    TrafficData.objects.create(
        bottleneck=bottleneck,
        timestamp="2026-09-19T00:00:00Z",
        source="tomtom",
        data_status="live",
        fetched_at="2026-09-19T00:00:00Z",
        traffic_severity_index=0.4,
        avg_speed=25,
    )
    response = APIClient().get("/api/traffic/real-time/")
    assert response.status_code == 200
    assert response.json()[0]["source"] == "tomtom"
    assert response.json()[0]["data_status"] == "live"

    TrafficData.objects.all().update(is_deleted=True)
    cache.clear()
    unavailable = APIClient().get("/api/traffic/real-time/")
    assert unavailable.status_code == 200
    assert unavailable.json()["metadata"]["data_status"] == "unavailable"
    assert unavailable.json()["metadata"]["available"] is False