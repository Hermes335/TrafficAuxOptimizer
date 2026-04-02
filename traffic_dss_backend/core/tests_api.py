import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Bottleneck, Incident


@pytest.mark.django_db
def test_health_endpoint():
    client = APIClient()
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.django_db
def test_dashboard_kpis_authenticated():
    user = get_user_model().objects.create_user(username="tester", password="pass12345")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/dashboard/kpis/")
    assert response.status_code == 200
    assert "coverage_efficiency" in response.json()


@pytest.mark.django_db
def test_incident_reporting_flow():
    user = get_user_model().objects.create_user(username="reporter", password="pass12345")
    bottleneck = Bottleneck.objects.create(
        id="B-001",
        name="Test Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    payload = {
        "bottleneck": bottleneck.id,
        "incident_type": "collision",
        "severity": "minor",
        "description": "Test incident",
    }
    response = client.post("/api/incidents/report/", payload)
    assert response.status_code == 201

    incident = Incident.objects.get(pk=response.json()["id"])
    incident.timestamp = timezone.now()
    incident.save(update_fields=["timestamp"])

    resolve_response = client.put(f"/api/incidents/{incident.id}/resolve/")
    assert resolve_response.status_code == 200
    assert resolve_response.json()["status"] == "resolved"
