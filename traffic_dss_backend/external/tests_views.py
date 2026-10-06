import gzip
from datetime import timedelta
from io import BytesIO
from unittest.mock import Mock

import pytest
import requests
from urllib3.response import HTTPResponse as ProviderResponse
from django.core.cache import cache
from django.utils import timezone
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


@pytest.mark.django_db
def test_weather_and_traffic_api_mark_aged_observations_stale(settings):
    settings.TRAFFIC_MAX_INPUT_AGE = 900
    settings.WEATHER_MAX_INPUT_AGE = 1800
    now = timezone.now()
    node = Bottleneck.objects.create(id="B-AGE", name="Age Check", latitude=10.72, longitude=122.56, district="Iloilo")
    traffic = TrafficData.objects.create(bottleneck=node, timestamp=now, observed_at=now,
        source="tomtom", data_status="live", is_stale=False)
    weather = WeatherData.objects.create(timestamp=now, observed_at=now,
        source="openmeteo", data_status="fallback", is_stale=False)
    client = APIClient()
    assert client.get("/api/traffic/real-time/").json()[0]["is_stale"] is False
    assert client.get("/api/weather/current/").json()["is_stale"] is False

    TrafficData.objects.filter(pk=traffic.pk).update(observed_at=now - timedelta(minutes=16))
    WeatherData.objects.filter(pk=weather.pk).update(observed_at=now - timedelta(minutes=31))
    traffic_response = client.get("/api/traffic/real-time/").json()[0]
    weather_response = client.get("/api/weather/current/").json()
    assert traffic_response["source"] == "tomtom" and traffic_response["is_stale"] is True
    assert weather_response["source"] == "openmeteo" and weather_response["is_stale"] is True


def test_vector_traffic_proxy_does_not_label_decoded_content_as_gzip(settings, monkeypatch):
    settings.TOMTOM_API_KEY = "test-provider-key"
    protobuf = b"\x1a\x0e\x0a\x0cTraffic flow"
    provider = requests.Response()
    provider.status_code = 200
    provider.headers["Content-Encoding"] = "gzip"
    provider.raw = ProviderResponse(
        body=BytesIO(gzip.compress(protobuf)),
        headers={"Content-Encoding": "gzip"},
        preload_content=False,
    )
    get = Mock(return_value=provider)
    monkeypatch.setattr("external.views.requests.get", get)

    response = APIClient().get("/api/maps/tomtom-traffic-vector/14/13769/7701.pbf")

    assert response.status_code == 200
    assert response.content == protobuf
    assert response["Content-Type"] == "application/x-protobuf"
    assert "Content-Encoding" not in response
    assert response["Cache-Control"] == "public, max-age=60"
    url = get.call_args.args[0]
    assert url.endswith("/flow/relative/14/13769/7701.pbf")
    params = get.call_args.kwargs["params"]
    assert params["roadTypes"] == "[0,1,2,3,4,5,6,7,8]"
    assert "traffic_level" in params["tags"]


@pytest.mark.parametrize("tile", ["23/0/0", "14/16384/0", "14/0/16384"])
def test_vector_traffic_proxy_rejects_invalid_coordinates(settings, monkeypatch, tile):
    settings.TOMTOM_API_KEY = "test-provider-key"
    get = Mock()
    monkeypatch.setattr("external.views.requests.get", get)
    response = APIClient().get(f"/api/maps/tomtom-traffic-vector/{tile}.pbf")
    assert response.status_code == 400
    get.assert_not_called()


def test_vector_traffic_proxy_reports_missing_configuration(settings, monkeypatch):
    settings.TOMTOM_API_KEY = ""
    get = Mock()
    monkeypatch.setattr("external.views.requests.get", get)
    response = APIClient().get("/api/maps/tomtom-traffic-vector/14/13769/7701.pbf")
    assert response.status_code == 503
    get.assert_not_called()


@pytest.mark.parametrize("endpoint", [
    "tomtom/14/13769/7701.png",
    "tomtom-traffic/14/13769/7701.png",
    "tomtom-traffic-vector/14/13769/7701.pbf",
])
def test_tile_failures_do_not_expose_provider_key(settings, monkeypatch, endpoint):
    settings.TOMTOM_API_KEY = "private-test-key"
    get = Mock(side_effect=requests.RequestException("Provider URL contained key=private-test-key"))
    monkeypatch.setattr("external.views.requests.get", get)
    response = APIClient().get(f"/api/maps/{endpoint}")
    assert response.status_code == 502
    assert "private-test-key" not in response.json()["detail"]


@pytest.fixture
def raster_provider(settings, monkeypatch):
    settings.TOMTOM_API_KEY = "raster-test-key"
    cache.clear()
    provider = requests.Response()
    provider.status_code = 200
    provider._content = b"\x89PNG\r\n\x1a\nexample-png-content"
    get = Mock(return_value=provider)
    monkeypatch.setattr("external.views.requests.get", get)
    return get, provider


RASTER_URL = "/api/maps/tomtom-traffic/14/13770/7701.png?style=relative0"


def test_raster_traffic_retries_transient_failure_and_caches_only_fresh_tiles(raster_provider, monkeypatch, caplog):
    caplog.set_level("INFO", logger="external_apis")
    monkeypatch.setattr("external.views.logger.handlers", [caplog.handler])
    get, provider = raster_provider
    get.side_effect = [requests.ReadTimeout("key=raster-test-key"), provider, provider]
    now = timezone.now()
    monkeypatch.setattr("external.views.timezone.now", lambda: now)
    response = APIClient().get(RASTER_URL)
    assert response.status_code == 200 and response.content == provider.content
    assert get.call_count == 2
    assert "retrying" in caplog.text
    assert not any(record.levelname == "WARNING" and "Traffic tile transport failure" in record.message for record in caplog.records)
    assert get.call_args_list[0].args[0].startswith("https://api.tomtom.com/")
    assert get.call_args_list[1].args[0].startswith("https://a.api.tomtom.com/")
    assert response["Cache-Control"] == "public, max-age=120"
    monkeypatch.setattr("external.views.timezone.now", lambda: now + timedelta(seconds=35))
    cached = APIClient().get(RASTER_URL)
    assert cached.status_code == 200 and get.call_count == 2
    assert cached["Cache-Control"] == "public, max-age=85"
    monkeypatch.setattr("external.views.timezone.now", lambda: now + timedelta(seconds=121))
    assert APIClient().get(RASTER_URL).status_code == 200
    assert get.call_count == 3


def test_raster_timeout_is_bounded_and_not_cached(raster_provider, caplog, monkeypatch):
    monkeypatch.setattr("external.views.logger.handlers", [caplog.handler])
    get, provider = raster_provider
    get.side_effect = [requests.Timeout("key=raster-test-key"), requests.Timeout(), provider]
    response = APIClient().get(RASTER_URL)
    assert response.status_code == 504 and get.call_count == 2
    assert any(record.levelname == "WARNING" and "tile unavailable" in record.message for record in caplog.records)
    assert "raster-test-key" not in response.content.decode()
    assert response["Cache-Control"] == "no-store"
    assert APIClient().get(RASTER_URL).status_code == 200
    assert get.call_count == 3


@pytest.mark.parametrize("status", [401, 403, 429])
def test_raster_access_or_quota_failure_is_not_retried(raster_provider, status):
    get, provider = raster_provider
    provider.status_code = status
    assert APIClient().get(RASTER_URL).status_code == status
    assert get.call_count == 1


def test_raster_transient_provider_error_is_retried(raster_provider):
    get, provider = raster_provider
    unavailable = requests.Response()
    unavailable.status_code = 503
    get.side_effect = [unavailable, provider]
    assert APIClient().get(RASTER_URL).status_code == 200
    assert get.call_count == 2


def test_raster_rejects_invalid_provider_content_without_caching(raster_provider):
    get, provider = raster_provider
    provider._content = b"<html>upstream error</html>"
    assert APIClient().get(RASTER_URL).status_code == 502
    assert APIClient().get(RASTER_URL).status_code == 502
    assert get.call_count == 2


def test_raster_cache_outage_does_not_hide_live_tiles(raster_provider, monkeypatch):
    _, provider = raster_provider
    monkeypatch.setattr("external.views.cache.get", Mock(side_effect=ConnectionError()))
    monkeypatch.setattr("external.views.cache.set", Mock(side_effect=ConnectionError()))
    response = APIClient().get(RASTER_URL)
    assert response.status_code == 200 and response.content == provider.content


@pytest.mark.parametrize("tile", ["23/0/0", "14/16384/0", "14/0/16384"])
def test_raster_traffic_proxy_rejects_invalid_coordinates(raster_provider, tile):
    get, _ = raster_provider
    assert APIClient().get(f"/api/maps/tomtom-traffic/{tile}.png").status_code == 400
    get.assert_not_called()
