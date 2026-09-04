import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from core.assignment_scoring import score_candidate_officer
from core.models import Bottleneck, Incident, Officer


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


@pytest.mark.django_db
def test_deployment_assignment_uses_default_shift_window_when_times_missing():
    user = get_user_model().objects.create_user(username="assigner", password="pass12345")
    officer = Officer.objects.create(
        name="Test Officer",
        badge_number="TEST-ASSIGN-001",
        shift="morning",
        status="available",
    )
    bottleneck = Bottleneck.objects.create(
        id="B-002",
        name="Test Bottleneck 2",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
        tsi=0.8,
        min_officers_required=2,
        max_officers_allowed=5,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(
        "/api/deployments/assign/",
        {
            "officer": officer.id,
            "bottleneck": bottleneck.id,
            "shift": "morning",
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["officer"] == officer.id
    assert response.json()["bottleneck"] == bottleneck.id


@pytest.mark.django_db
def test_dashboard_required_officers_increases_with_tsi_and_incident_pressure():
    user = get_user_model().objects.create_user(username="viewer", password="pass12345")
    bottleneck = Bottleneck.objects.create(
        id="B-003",
        name="High Pressure Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
        tsi=0.9,
        min_officers_required=2,
        max_officers_allowed=5,
    )
    Incident.objects.create(
        bottleneck=bottleneck,
        incident_type="collision",
        severity="critical",
        description="Critical incident",
        reported_by=user,
        timestamp=timezone.now(),
        status="active",
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/dashboard/bottlenecks/")
    assert response.status_code == 200
    bottleneck_payload = next(item for item in response.json() if item["id"] == bottleneck.id)
    assert bottleneck_payload["required_officers"] >= 3


@pytest.mark.django_db
def test_dashboard_includes_operational_alerts_and_coverage_status():
    user = get_user_model().objects.create_user(username="opsviewer", password="pass12345")
    bottleneck = Bottleneck.objects.create(
        id="B-004",
        name="Coverage Risk Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
        tsi=0.75,
        min_officers_required=2,
        max_officers_allowed=4,
    )
    Incident.objects.create(
        bottleneck=bottleneck,
        incident_type="collision",
        severity="major",
        description="Major incident",
        reported_by=user,
        timestamp=timezone.now(),
        status="active",
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/dashboard/bottlenecks/")
    assert response.status_code == 200

    bottleneck_payload = next(item for item in response.json() if item["id"] == bottleneck.id)
    assert "coverage_status" in bottleneck_payload
    assert bottleneck_payload["coverage_status"] in {"warning", "critical"}
    assert "operational_alerts" in bottleneck_payload
    assert bottleneck_payload["staffing_gap"] >= 0


@pytest.mark.django_db
def test_assignment_score_prefers_available_and_proximate_officer():
    bottleneck = Bottleneck.objects.create(
        id="B-005",
        name="Scored Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
        tsi=0.8,
        min_officers_required=2,
        max_officers_allowed=4,
    )
    near = Officer.objects.create(
        name="Near Officer",
        badge_number="BADGE-NEAR-01",
        shift="morning",
        status="available",
        skills=["traffic"],
        current_latitude=10.7205,
        current_longitude=122.5625,
    )
    far = Officer.objects.create(
        name="Far Officer",
        badge_number="BADGE-FAR-01",
        shift="morning",
        status="available",
        skills=["traffic"],
        current_latitude=10.7000,
        current_longitude=122.5400,
    )

    near_score = score_candidate_officer(near, bottleneck)
    far_score = score_candidate_officer(far, bottleneck)

    assert near_score > far_score
    assert near_score >= 50


@pytest.mark.django_db
def test_dashboard_data_quality_report_flags_placeholder_records():
    user = get_user_model().objects.create_user(username="qualitycheck", password="pass12345")
    Officer.objects.create(
        name="Test Badge Officer",
        badge_number="TEST-0001",
        shift="morning",
        status="available",
    )
    Bottleneck.objects.create(
        id="B-006",
        name="Low Quality Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=1000,
        longitude=2000,
        tsi=1.5,
        min_officers_required=2,
        max_officers_allowed=4,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/dashboard/data-quality/")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_issues"] >= 2
    assert payload["issue_counts"]["placeholder_badge"] >= 1


@pytest.mark.django_db
def test_active_officer_cap_blocks_excess_assignments():
    user = get_user_model().objects.create_user(username="capcheck", password="pass12345")
    bottleneck = Bottleneck.objects.create(
        id="B-007",
        name="Capacity Check Bottleneck",
        district="Iloilo",
        road_priority_weight=1.0,
        bottleneck_type="intersection",
        latitude=10.7202,
        longitude=122.5621,
    )

    for index in range(60):
        Officer.objects.create(
            name=f"Officer {index}",
            badge_number=f"CAP-{index:03d}",
            shift="morning" if index % 2 == 0 else "afternoon",
            status="available",
        )

    extra_officer = Officer.objects.create(
        name="Extra Officer",
        badge_number="CAP-EXTRA-001",
        shift="morning",
        status="available",
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(
        "/api/deployments/assign/",
        {
            "officer": extra_officer.id,
            "bottleneck": bottleneck.id,
            "shift": "morning",
        },
        format="json",
    )

    assert response.status_code == 400, response.json()
    assert "60" in response.json()["detail"]
