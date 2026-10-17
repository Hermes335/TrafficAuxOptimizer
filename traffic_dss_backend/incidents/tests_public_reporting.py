from io import BytesIO
from pathlib import Path
import struct
from unittest.mock import patch
import uuid
import zlib

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image, PngImagePlugin
from rest_framework.test import APIClient

from core.models import AuditLog, Bottleneck, Incident
from core.serializers import IncidentResponseSerializer
from core.tests_review_fixes import schedule
from core.tests_timed_deployment import make_run
from deployments.services import schedule_version
from incidents.photos import MAX_PHOTO_BYTES
from optimization.tasks import capture_inputs


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_photo_storage(settings, tmp_path):
    settings.PRIVATE_MEDIA_ROOT = tmp_path / "private"
    settings.MEDIA_ROOT = tmp_path / "public"
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def staff():
    user = get_user_model().objects.create_user(username="incident-staff", password="pass12345")
    client = APIClient()
    client.force_authenticate(user)
    return client, user


@pytest.fixture
def node():
    return Bottleneck.objects.create(id="PUBLIC-1", name="Report location", district="Iloilo", latitude=10.72, longitude=122.56)


def payload(**changes):
    return {"latitude": 10.7214, "longitude": 122.5638, "incident_type": "collision",
            "severity": "major", "description": "Collision near the pedestrian crossing", **changes}


def photo_bytes():
    output = BytesIO()
    meta = PngImagePlugin.PngInfo()
    meta.add_text("GPS", "Private location metadata")
    Image.new("RGBA", (20, 10), "red").save(output, "PNG", pnginfo=meta)
    return output.getvalue()


def photo(data=None, name="camera.png"):
    return SimpleUploadedFile(name, data if data is not None else photo_bytes(), content_type="image/png")


def pending_report():
    response = APIClient().post("/api/incidents/report/", payload())
    assert response.status_code == 201, response.data
    return Incident.objects.get(pk=response.data["id"])


def test_public_configuration_is_minimal_and_operational_lists_are_private(node):
    Bottleneck.objects.create(id="HIDDEN", name="Hidden", district="Iloilo", latitude=10.7, longitude=122.5, is_archived=True)
    client = APIClient()
    assert client.get("/api/incidents/meta/").status_code == 200
    locations = client.get("/api/incidents/locations/")
    assert locations.status_code == 200
    assert locations.data == [{"id": node.pk, "name": node.name, "latitude": node.latitude, "longitude": node.longitude}]
    for path in ["/api/incidents/", "/api/incidents/review/", "/api/incidents/1/photo/"]:
        assert client.get(path).status_code == 401


def test_public_report_is_pending_unattributed_and_non_operational(staff, django_capture_on_commit_callbacks):
    client, _ = staff
    with patch("core.mutations.broadcast") as dashboard_event, patch("incidents.views.broadcast") as incident_event:
        with django_capture_on_commit_callbacks(execute=True):
            incident = pending_report()
        dashboard_event.assert_not_called()
        incident_event.assert_not_called()
    assert incident.status == "pending" and incident.source == "public"
    assert incident.reported_by is None
    assert incident.latitude == 10.7214 and incident.longitude == 122.5638
    assert AuditLog.objects.get(resource="incident", action="submit").user is None
    assert client.get("/api/dashboard/incidents/").data["results"] == []
    assert client.get("/api/incidents/").data["results"] == []
    queue = client.get("/api/incidents/review/").data
    assert queue["count"] == 1
    assert queue["results"][0]["id"] == incident.pk
    assert not {"photo_path", "submission_key", "submission_fingerprint"}.intersection(queue["results"][0])


def test_staff_report_accepts_exact_pin_and_legacy_bottleneck(staff, node):
    client, user = staff
    exact = client.post("/api/incidents/report/", payload(bottleneck=node.pk))
    assert exact.status_code == 201, exact.data
    incident = Incident.objects.get(pk=exact.data["id"])
    assert incident.status == "active" and incident.source == "staff" and incident.reported_by == user
    assert (incident.latitude, incident.longitude) == (10.7214, 122.5638)
    legacy = client.post("/api/incidents/report/", {
        "bottleneck": node.pk, "incident_type": "flooding", "severity": "minor", "description": "Flooding",
    })
    assert legacy.status_code == 201, legacy.data
    incident = Incident.objects.get(pk=legacy.data["id"])
    assert (incident.latitude, incident.longitude) == (node.latitude, node.longitude)


@pytest.mark.parametrize("changes", [
    {"latitude": "NaN"}, {"longitude": 181}, {"latitude": ""}, {"description": "   "},
    {"description": "x" * 5001}, {"incident_type": "made-up"}, {"severity": "fatal"},
    {"photo_url": "https://example.com/photo.png"}, {"submission_key": "not-a-uuid"},
])
def test_invalid_public_reports_write_nothing(changes, settings):
    response = APIClient().post("/api/incidents/report/", payload(**changes, photo=photo()))
    assert response.status_code == 400, response.data
    assert not Incident.objects.exists()
    assert not Path(settings.PRIVATE_MEDIA_ROOT).exists()


def test_coordinate_only_edit_preserves_or_changes_exact_pin(staff, node):
    client, user = staff
    incident = Incident.objects.create(reported_by=user, timestamp=timezone.now(), severity="minor", description="Original",
                                       bottleneck=node, latitude=10.7214, longitude=122.5638)
    response = client.put(f"/api/incidents/{incident.pk}/update/", {"description": "Edited"}, format="json")
    assert response.status_code == 200
    incident.refresh_from_db()
    assert (incident.latitude, incident.longitude) == (10.7214, 122.5638)
    response = client.put(f"/api/incidents/{incident.pk}/update/", {
        "description": "Same pin", "severity": "critical", "latitude": 10.7214, "longitude": 122.5638,
    }, format="json")
    assert response.status_code == 200
    incident.refresh_from_db()
    assert incident.bottleneck_id == node.pk and incident.severity == "critical"
    response = client.put(f"/api/incidents/{incident.pk}/update/", {"latitude": 10.73, "longitude": 122.58}, format="json")
    assert response.status_code == 200
    incident.refresh_from_db()
    assert incident.bottleneck is None
    assert (incident.latitude, incident.longitude) == (10.73, 122.58)
    response = client.put(f"/api/incidents/{incident.pk}/update/", {
        "bottleneck": node.pk, "latitude": 10.7305, "longitude": 122.581,
    }, format="json")
    assert response.status_code == 200
    incident.refresh_from_db()
    assert incident.bottleneck_id == node.pk
    assert (incident.latitude, incident.longitude) == (10.7305, 122.581)


@pytest.mark.parametrize("legacy_coordinates", [True, False])
def test_resending_rounded_pin_preserves_bottleneck_for_existing_and_legacy_reports(staff, node, legacy_coordinates):
    client, user = staff
    node.latitude, node.longitude = 10.7214004, 122.5638004
    node.save(update_fields=["latitude", "longitude"])
    incident = Incident.objects.create(reported_by=user, timestamp=timezone.now(), severity="minor", description="Original",
                                       bottleneck=node, latitude=None if legacy_coordinates else node.latitude,
                                       longitude=None if legacy_coordinates else node.longitude)
    response = client.put(f"/api/incidents/{incident.pk}/update/", {
        "description": "Rounded pin", "latitude": 10.7214, "longitude": 122.5638,
    }, format="json")
    assert response.status_code == 200
    incident.refresh_from_db()
    assert incident.bottleneck_id == node.pk


def test_submission_key_prevents_duplicate_reports_and_photo_files(settings):
    client = APIClient()
    key = str(uuid.uuid4())
    first = client.post("/api/incidents/report/", payload(submission_key=key, photo=photo()))
    repeat = client.post("/api/incidents/report/", payload(submission_key=key, photo=photo()))
    assert first.status_code == 201 and repeat.status_code == 200
    assert set(first.data) == {"id", "reference", "status"}
    assert first.data == repeat.data
    assert Incident.objects.count() == 1 and AuditLog.objects.filter(action="submit").count() == 1
    assert len(list(Path(settings.PRIVATE_MEDIA_ROOT).rglob("*.png"))) == 1
    conflict = client.post("/api/incidents/report/", payload(submission_key=key, description="Different report"))
    assert conflict.status_code == 409
    assert "id" not in conflict.data


def test_private_photo_is_decoded_metadata_free_and_staff_only(staff, settings):
    response = APIClient().post("/api/incidents/report/", payload(photo=photo(name="../../private-name.png")))
    assert response.status_code == 201, response.data
    incident = Incident.objects.get(pk=response.data["id"])
    assert "private-name" not in incident.photo_path
    assert incident.photo_url == ""
    assert not Path(settings.MEDIA_ROOT).exists()
    stored = Path(settings.PRIVATE_MEDIA_ROOT) / incident.photo_path
    with Image.open(stored) as image:
        assert image.size == (20, 10) and "GPS" not in image.info
    photo_url = f"/api/incidents/{incident.pk}/photo/"
    assert APIClient().get(photo_url).status_code == 401
    client, _ = staff
    photo_response = client.get(photo_url)
    assert photo_response.status_code == 200
    assert photo_response["Content-Type"] == "image/png"
    assert photo_response["Cache-Control"] == "private, no-store"
    assert b"Private location metadata" not in b"".join(photo_response.streaming_content)
    serialized = IncidentResponseSerializer(incident).data
    assert serialized["photo_url"] == photo_url and "photo_path" not in serialized


@pytest.mark.parametrize("invalid_photo", [b"not an image", b"x" * (MAX_PHOTO_BYTES + 1)], ids=["invalid-image", "over-5mb"])
def test_invalid_photo_never_leaves_a_file(invalid_photo, settings):
    response = APIClient().post("/api/incidents/report/", payload(photo=photo(invalid_photo)))
    assert response.status_code == 400
    assert not Incident.objects.exists() and not Path(settings.PRIVATE_MEDIA_ROOT).exists()


def test_oversized_pixel_dimensions_rejected_before_decoding(settings):
    raw = photo_bytes()
    header = struct.pack(">II", 5000, 4001) + raw[24:29]
    oversized = raw[:16] + header + struct.pack(">I", zlib.crc32(b"IHDR" + header)) + raw[33:]
    response = APIClient().post("/api/incidents/report/", payload(photo=photo(oversized)))
    assert response.status_code == 400 and "20 megapixels" in str(response.data)
    assert not Path(settings.PRIVATE_MEDIA_ROOT).exists()


def test_database_failure_rolls_back_incident_and_removes_uploaded_file(settings):
    with patch("incidents.views.write_audit_log", side_effect=RuntimeError("Audit unavailable")):
        with pytest.raises(RuntimeError, match="Audit unavailable"):
            APIClient().post("/api/incidents/report/", payload(photo=photo()))
    assert not Incident.objects.exists()
    assert not list(Path(settings.PRIVATE_MEDIA_ROOT).rglob("*.png"))


def test_approval_commits_operational_events_once_and_keeps_public_attribution(staff, django_capture_on_commit_callbacks):
    incident = pending_report()
    client, user = staff
    path = f"/api/incidents/{incident.pk}/review/"
    assert APIClient().post(path, {"decision": "approve"}, format="json").status_code == 401
    with patch("core.mutations.broadcast") as dashboard_event, patch("incidents.views.broadcast") as incident_event:
        with django_capture_on_commit_callbacks(execute=True):
            approved = client.post(path, {"decision": "approve"}, format="json")
            assert approved.status_code == 200
            dashboard_event.assert_not_called()
            incident_event.assert_not_called()
        dashboard_event.assert_called_once()
        incident_event.assert_called_once()
        assert dashboard_event.call_args.args[2]["event"] == "incident_reported"
        with django_capture_on_commit_callbacks(execute=True):
            assert client.post(path, {"decision": "approve"}, format="json").status_code == 409
        dashboard_event.assert_called_once()
    incident.refresh_from_db()
    assert incident.status == "active" and incident.reported_by is None
    assert incident.reviewed_by == user and incident.reviewed_at is not None
    assert client.get("/api/incidents/review/").data["count"] == 0
    assert client.get("/api/dashboard/incidents/").data["results"][0]["id"] == incident.pk


def test_rejection_stays_non_operational_and_cannot_be_approved_later(staff, django_capture_on_commit_callbacks):
    incident = pending_report()
    client, _ = staff
    path = f"/api/incidents/{incident.pk}/review/"
    assert client.post(path, {"decision": "active"}, format="json").status_code == 400
    with patch("core.mutations.broadcast") as dashboard_event, patch("incidents.views.broadcast") as incident_event:
        with django_capture_on_commit_callbacks(execute=True):
            assert client.post(path, {"decision": "reject"}, format="json").status_code == 200
        dashboard_event.assert_not_called()
        incident_event.assert_not_called()
    incident.refresh_from_db()
    assert incident.status == "rejected"
    assert client.post(path, {"decision": "approve"}, format="json").status_code == 409
    assert client.get("/api/dashboard/incidents/").data["results"] == []


@pytest.mark.parametrize("state", ["pending", "rejected"])
def test_unreviewed_reports_cannot_bypass_review_via_edit_or_resolve(staff, state):
    incident = pending_report()
    Incident.objects.filter(pk=incident.pk).update(status=state)
    client, _ = staff
    for path in [f"/api/incidents/{incident.pk}/update/", f"/api/dashboard/incidents/{incident.pk}/"]:
        response = client.put(path, {"status": "active", "description": "Bypass"}, format="json")
        assert response.status_code == 400
    assert client.put(f"/api/incidents/{incident.pk}/resolve/").status_code == 409
    incident.refresh_from_db()
    assert incident.status == state and incident.description != "Bypass"


def test_legacy_photos_are_only_served_locally_through_authenticated_endpoint(staff, settings):
    client, user = staff
    legacy = Path(settings.MEDIA_ROOT) / "incident-photos" / "old.png"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(photo_bytes())
    incident = Incident.objects.create(reported_by=user, timestamp=timezone.now(), severity="minor", description="Legacy",
                                       photo_url="/media/incident-photos/old.png")
    url = f"/api/incidents/{incident.pk}/photo/"
    assert IncidentResponseSerializer(incident).data["photo_url"] == url
    assert APIClient().get(url).status_code == 401
    response = client.get(url)
    assert response.status_code == 200
    assert b"Private location metadata" not in b"".join(response.streaming_content)
    for unsafe_url in ["https://example.com/pic.png", "/media/incident-photos/%2e%2e/private.txt", "/media/../private.txt"]:
        incident.photo_url = unsafe_url
        incident.save(update_fields=["photo_url"])
        assert IncidentResponseSerializer(incident).data["photo_url"] == ""
        assert client.get(url).status_code == 404


def test_public_submissions_are_rate_limited():
    client = APIClient()
    for _ in range(10):
        assert client.post("/api/incidents/report/", payload()).status_code == 201
    assert client.post("/api/incidents/report/", payload()).status_code == 429


def test_pending_and_rejected_reports_do_not_invalidate_schedule_or_optimizer(schedule):
    s = schedule
    make_run(s, [], minimum=1)
    published = s.client.post("/api/deployments/publish-optimization/", s.payload, format="json")
    assert published.status_code == 201, published.data
    review_path = f"/api/deployments/review/?date={s.day}&shift=morning"
    assert not s.client.get(review_path).data["needs_review"]
    version = schedule_version("morning", s.day)
    params = {"shift": "morning", "operational_date": str(s.day)}
    before = capture_inputs(params)[1]
    response = APIClient().post("/api/incidents/report/", payload(bottleneck=s.node.pk, severity="critical"))
    assert response.status_code == 201
    incident_review = f"/api/incidents/{response.data['id']}/review/"
    assert not s.client.get(review_path).data["needs_review"]
    assert schedule_version("morning", s.day) == version
    assert capture_inputs(params)[1] == before
    assert s.client.post(incident_review, {"decision": "reject"}, format="json").status_code == 200
    assert not s.client.get(review_path).data["needs_review"]
    assert capture_inputs(params)[1] == before

    accepted = APIClient().post("/api/incidents/report/", payload(bottleneck=s.node.pk, severity="critical"))
    assert s.client.post(f"/api/incidents/{accepted.data['id']}/review/", {"decision": "approve"}, format="json").status_code == 200
    assert s.client.get(review_path).data["needs_review"]
    assert capture_inputs(params)[1][0]["staffing_target"] > before[0]["staffing_target"]
