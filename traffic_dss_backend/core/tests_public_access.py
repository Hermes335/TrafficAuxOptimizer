"""Public reporting must not expose the staff dashboard, photos, or mutations."""
from unittest.mock import AsyncMock, patch

import pytest
from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Bottleneck, Incident, Officer, POI
from dashboard.consumers import DashboardConsumer
from incidents.consumers import IncidentConsumer


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_request_counters():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def private_records():
    user = get_user_model().objects.create_user(username="private-staff", password="test-password")
    node = Bottleneck.objects.create(id="PRIVATE-LOCATION", name="Location name", district="Iloilo",
                                    latitude=10.72, longitude=122.56, tsi=0.8)
    officer = Officer.objects.create(name="Private officer identity", badge_number="PRIVATE-BADGE", shift="morning")
    incident = Incident.objects.create(bottleneck=node, reported_by=user, timestamp=timezone.now(),
                                      description="Private incident description", severity="major", latitude=node.latitude,
                                      longitude=node.longitude)
    poi = POI.objects.create(poi_id="PRIVATE-POI", name="Private POI name", category="other",
                             latitude=node.latitude, longitude=node.longitude)
    return {"user": user, "node": node, "incident": incident, "officer": officer, "poi": poi}


PRIVATE_READ_PATHS = [
    "/api/dashboard/kpis/",
    "/api/dashboard/data-quality/",
    "/api/dashboard/bottlenecks/",
    "/api/dashboard/officers/",
    "/api/dashboard/incidents/active/",
    "/api/dashboard/incidents/",
    "/api/dashboard/incidents/{incident_id}/",
    "/api/dashboard/map-data/",
    "/api/dashboard/pois/",
    "/api/dashboard/pois/PRIVATE-POI/",
    "/api/weather/current/",
    "/api/traffic/real-time/",
    "/api/maps/tomtom/14/13769/7701.png",
    "/api/maps/tomtom-traffic/14/13769/7701.png",
    "/api/maps/tomtom-traffic-vector/14/13769/7701.pbf",
    "/api/incidents/",
    "/api/incidents/review/",
    "/api/incidents/{incident_id}/photo/",
    "/api/deployments/schedule/",
    "/api/deployments/revisions/",
    "/api/optimization/history/",
]


@pytest.mark.parametrize("path", PRIVATE_READ_PATHS)
@pytest.mark.parametrize("authorization", [None, "Bearer malformed-token"])
def test_operational_reads_reject_anonymous_or_invalid_sessions(private_records, path, authorization):
    incident = private_records["incident"]
    client = APIClient()
    if authorization:
        client.credentials(HTTP_AUTHORIZATION=authorization)
    with patch("external.views.requests.get") as provider:
        response = client.get(path.format(incident_id=incident.pk))
    assert response.status_code == 401, (path, response.content)
    assert "detail" in response.json() and "results" not in response.json()
    assert "Private officer identity" not in response.content.decode()
    assert "Private incident description" not in response.content.decode()
    provider.assert_not_called()


@pytest.mark.parametrize("method,path,payload", [
    ("post", "/api/dashboard/incidents/", {"description": "Unauthorized incident"}),
    ("put", "/api/dashboard/incidents/{incident_id}/", {"description": "Unauthorized edit"}),
    ("delete", "/api/dashboard/incidents/{incident_id}/", {}),
    ("post", "/api/incidents/{incident_id}/review/", {"decision": "approve"}),
    ("post", "/api/incidents/{incident_id}/review/", {"decision": "reject"}),
    ("put", "/api/incidents/{incident_id}/update/", {"description": "Unauthorized edit"}),
    ("put", "/api/incidents/{incident_id}/resolve/", {}),
    ("delete", "/api/incidents/{incident_id}/", {}),
    ("post", "/api/dashboard/pois/", {"name": "Unauthorized POI"}),
    ("put", "/api/dashboard/pois/PRIVATE-POI/", {"name": "Unauthorized POI edit"}),
    ("delete", "/api/dashboard/pois/PRIVATE-POI/", {}),
    ("post", "/api/dashboard/bottlenecks/manage/", {"name": "Unauthorized location"}),
    ("put", "/api/dashboard/bottlenecks/manage/PRIVATE-LOCATION/", {"name": "Unauthorized location edit"}),
    ("post", "/api/dashboard/officers/manage/", {"name": "Unauthorized officer"}),
    ("post", "/api/dashboard/quick-optimize/", {"shift": "morning"}),
    ("post", "/api/dashboard/traffic/sample/", {}),
])
def test_only_reporting_can_mutate_incidents_without_authentication(private_records, method, path, payload):
    initial_incidents = list(Incident.objects.values())
    initial_locations = list(Bottleneck.objects.values())
    initial_pois = list(POI.objects.values())
    initial_officers = list(Officer.objects.values())
    with patch("optimization.tasks.run_optimization.apply_async") as enqueue:
        response = getattr(APIClient(), method)(path.format(incident_id=private_records["incident"].pk), payload, format="json")
    assert response.status_code == 401, (method, path, response.content)
    assert list(Incident.objects.values()) == initial_incidents
    assert list(Bottleneck.objects.values()) == initial_locations
    assert list(POI.objects.values()) == initial_pois
    assert list(Officer.objects.values()) == initial_officers
    enqueue.assert_not_called()


def test_public_location_picker_exposes_only_active_names_and_coordinates(private_records):
    for suffix, flags in [("ARCHIVED", {"is_archived": True}), ("DELETED", {"is_deleted": True})]:
        Bottleneck.objects.create(id=suffix, name=suffix, district="Iloilo", latitude=10.7, longitude=122.5, **flags)
    response = APIClient().get("/api/incidents/locations/")
    assert response.status_code == 200
    assert response.json() == [{"id": "PRIVATE-LOCATION", "name": "Location name", "latitude": 10.72, "longitude": 122.56}]
    assert "PRIVATE-BADGE" not in response.content.decode()
    assert "tsi" not in response.content.decode()


def test_public_metadata_and_report_submission_work_without_a_session(private_records):
    client = APIClient()
    metadata = client.get("/api/incidents/meta/")
    assert metadata.status_code == 200
    assert {item["value"] for item in metadata.json()["incident_types"]} >= {"collision", "flooding"}
    response = client.post("/api/incidents/report/", {
        "latitude": 10.721, "longitude": 122.563, "incident_type": "collision",
        "severity": "major", "description": "Public report at the selected map pin",
    })
    assert response.status_code == 201, response.data
    assert set(response.json()) == {"id", "reference", "status"}
    assert response.json()["status"] == "pending"
    saved = Incident.objects.get(pk=response.json()["id"])
    assert saved.reported_by is None and saved.source == "public"
    assert (saved.latitude, saved.longitude) == (10.721, 122.563)
    assert client.get(f"/api/dashboard/incidents/{saved.pk}/").status_code == 401
    assert client.get("/api/incidents/review/").status_code == 401


def test_legacy_media_path_cannot_bypass_photo_authentication(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    photo = tmp_path / "incident-photos" / "test.jpg"
    photo.parent.mkdir()
    photo.write_bytes(b"private legacy photo")
    response = APIClient().get("/media/incident-photos/test.jpg")
    assert response.status_code == 404
    assert b"private legacy photo" not in response.content


@pytest.mark.parametrize("consumer_type", [DashboardConsumer, IncidentConsumer])
def test_anonymous_websocket_cannot_subscribe_to_staff_updates(consumer_type):
    consumer = consumer_type()
    consumer.scope = {"user": AnonymousUser()}
    consumer.channel_name = "anonymous-test-channel"
    consumer.channel_layer = AsyncMock()
    consumer.close = AsyncMock()
    consumer.accept = AsyncMock()
    consumer.send_json = AsyncMock()
    async_to_sync(consumer.connect)()
    consumer.close.assert_awaited_once_with(code=4401)
    consumer.channel_layer.group_add.assert_not_called()
    consumer.accept.assert_not_called()
    consumer.send_json.assert_not_called()
    async_to_sync(consumer.disconnect)(4401)
    consumer.channel_layer.group_discard.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/ws/dashboard/", "/ws/incidents/"])
@pytest.mark.parametrize("query", ["", "?token=malformed-token"])
async def test_websocket_middleware_rejects_missing_or_invalid_tokens(path, query):
    from config.asgi import application
    socket = WebsocketCommunicator(application, path + query)
    connected, close_code = await socket.connect()
    assert connected is False
    assert close_code == 4401
    await socket.disconnect()
