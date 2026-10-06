import pytest
from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from core.operational_time import shift_window
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.assignment_scoring import score_candidate_officer
from core.models import Bottleneck, Deployment, Incident, Officer, OptimizationRun, POI


@pytest.mark.django_db
def test_login_throttle_allows_configured_rate_then_returns_429():
    cache.clear()
    user = get_user_model().objects.create_user(username="throttle-user", password="pass12345")
    client = APIClient()

    responses = [client.post("/api/auth/login/", {"username": user.username, "password": "pass12345"}, format="json") for _ in range(11)]

    assert [response.status_code for response in responses[:10]] == [200] * 10
    assert responses[10].status_code == 429
    assert responses[10].data["detail"]


@pytest.mark.django_db
def test_login_authentication_behavior_remains_valid():
    cache.clear()
    user = get_user_model().objects.create_user(username="auth-behavior-user", password="pass12345")
    response = APIClient().post(
        "/api/auth/login/",
        {"username": user.username, "password": "pass12345"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["access"]
    assert response.data["refresh"]
    assert response.data["user"]["username"] == user.username


@pytest.mark.django_db
def test_token_refresh_is_scoped_and_valid_refresh_still_succeeds():
    cache.clear()
    user = get_user_model().objects.create_user(username="refresh-user", password="pass12345")
    client = APIClient()
    login_response = client.post(
        "/api/auth/login/",
        {"username": user.username, "password": "pass12345"},
        format="json",
    )
    assert login_response.status_code == 200

    refresh_response = client.post(
        "/api/auth/refresh/",
        {"refresh": login_response.data["refresh"]},
        format="json",
    )

    assert refresh_response.status_code == 200
    assert refresh_response.data["access"]


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
def test_dashboard_bottlenecks_use_default_pagination_and_page_navigation():
    for index in range(101):
        Bottleneck.objects.create(
            id=f"PAG-{index:03d}",
            name=f"Paginated Bottleneck {index}",
            district="Iloilo",
            latitude=10.72,
            longitude=122.56,
        )

    client = APIClient()
    first_page = client.get("/api/dashboard/bottlenecks/")
    second_page = client.get("/api/dashboard/bottlenecks/?page=2")
    empty_page = client.get("/api/dashboard/bottlenecks/?page=999")

    assert first_page.status_code == 200
    assert first_page.json()["count"] == 101
    assert len(first_page.json()["results"]) == 100
    assert first_page.json()["next"]
    assert second_page.json()["previous"]
    assert len(second_page.json()["results"]) == 1
    assert empty_page.status_code == 404


@pytest.mark.django_db
def test_incident_pagination_preserves_filter_and_ordering():
    user = get_user_model().objects.create_user(username="incident-page", password="pass12345")
    bottleneck = Bottleneck.objects.create(
        id="PAG-INC",
        name="Incident Pagination",
        district="Iloilo",
        latitude=10.72,
        longitude=122.56,
    )
    newer = Incident.objects.create(
        bottleneck=bottleneck,
        incident_type="collision",
        severity="minor",
        description="Newer",
        reported_by=user,
        timestamp=timezone.now(),
    )
    older = Incident.objects.create(
        bottleneck=bottleneck,
        incident_type="collision",
        severity="minor",
        description="Older",
        reported_by=user,
        timestamp=timezone.now() - timedelta(minutes=1),
    )
    Incident.objects.create(
        bottleneck=bottleneck,
        incident_type="collision",
        severity="major",
        description="Filtered out",
        reported_by=user,
        timestamp=timezone.now(),
    )

    response = APIClient().get("/api/incidents/?severity=minor")
    empty_response = APIClient().get("/api/incidents/?severity=critical")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["results"]] == [newer.id, older.id]
    assert empty_response.json()["count"] == 0
    assert empty_response.json()["results"] == []


@pytest.mark.django_db
def test_poi_list_uses_default_pagination():
    for index in range(101):
        POI.objects.create(
            poi_id=f"PAG-POI-{index:03d}",
            name=f"Paginated POI {index}",
            category="other",
            latitude=10.72,
            longitude=122.56,
        )

    response = APIClient().get("/api/dashboard/pois/?page=2")

    assert response.status_code == 200
    assert response.json()["count"] == 101
    assert len(response.json()["results"]) == 1


@pytest.mark.django_db
def test_deployment_list_returns_paginated_results():
    user = get_user_model().objects.create_user(username="list-page", password="pass12345")
    officer = Officer.objects.create(
        name="List Officer",
        badge_number="PAG-LIST-001",
        shift="morning",
    )
    bottleneck = Bottleneck.objects.create(
        id="PAG-LIST-BN",
        name="List Bottleneck",
        district="Iloilo",
        latitude=10.72,
        longitude=122.56,
    )
    Deployment.objects.create(
        officer=officer,
        bottleneck=bottleneck,
        shift="morning",
        start_time=shift_window("morning")[0],
        end_time=shift_window("morning")[1],
    )

    client = APIClient()
    client.force_authenticate(user=user)
    deployment_response = client.get("/api/deployments/schedule/")

    assert deployment_response.status_code == 200
    assert deployment_response.json()["count"] == 1
    assert len(deployment_response.json()["results"]) == 1


@pytest.mark.django_db
@patch("optimization.tasks.run_optimization.apply_async")
def test_quick_optimize_enqueue_success_returns_queued(mock_delay):
    user = get_user_model().objects.create_user(username="quick-success", password="pass12345")
    user.groups.add(Group.objects.get(name="supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post("/api/dashboard/quick-optimize/", {"shift": "morning"}, format="json")

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    run = OptimizationRun.objects.get(run_id=response.json()["run_id"])
    assert run.status == "queued"
    assert run.result_data == {}
    mock_delay.assert_called_once_with(args=[run.run_id], task_id=run.task_id)


@pytest.mark.django_db
@patch("optimization.tasks.run_optimization.apply_async", side_effect=RuntimeError("broker unavailable"))
def test_quick_optimize_enqueue_failure_returns_503_and_marks_run_failed(mock_delay, caplog):
    user = get_user_model().objects.create_user(username="quick-failure", password="pass12345")
    user.groups.add(Group.objects.get(name="supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)

    with caplog.at_level("ERROR", logger="optimization"):
        response = client.post("/api/dashboard/quick-optimize/", {"shift": "afternoon"}, format="json")

    assert response.status_code == 503
    assert response.json()["status"] == "failed"
    assert "queued" not in response.json()["detail"].lower()
    run = OptimizationRun.objects.get(run_id=response.json()["run_id"])
    assert run.status == "failed"
    assert run.result_data["error"] == "Background queue unavailable."
    assert run.result_data["enqueue_error"] == "broker unavailable"
    assert "Failed to enqueue optimization" in caplog.text
    mock_delay.assert_called_once_with(args=[run.run_id], task_id=run.task_id)


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
    from datetime import timedelta
    from core.operational_time import operational_date
    user = get_user_model().objects.create_user(username="assigner", password="pass12345")
    user.groups.add(Group.objects.get(name="supervisor"))
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
            "operational_date": str(operational_date() + timedelta(days=1)),
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["officer"] == officer.id
    assert response.json()["bottleneck"] == bottleneck.id


@pytest.mark.django_db
def test_bottleneck_create_then_update_persists():
    user = get_user_model().objects.create_user(username="bottleneck-editor", password="pass12345")
    user.groups.add(Group.objects.get(name="supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)

    create_response = client.post(
        "/api/dashboard/bottlenecks/manage/",
        {
            "id": "B-TEST-PERSIST",
            "name": "Persisted Bottleneck",
            "latitude": 10.7202,
            "longitude": 122.5621,
            "district": "Iloilo City",
            "bottleneck_type": "intersection",
            "road_priority_weight": 1.0,
        },
        format="json",
    )
    assert create_response.status_code == 201, create_response.json()

    update_response = client.put(
        "/api/dashboard/bottlenecks/manage/B-TEST-PERSIST/",
        {"name": "Updated Bottleneck", "latitude": 10.721, "longitude": 122.563},
        format="json",
    )
    assert update_response.status_code == 200, update_response.json()
    assert update_response.json()["name"] == "Updated Bottleneck"


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
    bottleneck_payload = next(item for item in response.json()["results"] if item["id"] == bottleneck.id)
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

    bottleneck_payload = next(item for item in response.json()["results"] if item["id"] == bottleneck.id)
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
def test_active_officer_cap_blocks_roster_expansion():
    user = get_user_model().objects.create_user(username="capcheck", password="pass12345")
    user.groups.add(Group.objects.get(name="supervisor"))
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

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post("/api/dashboard/officers/manage/", {
        "name": "Extra Officer", "badge_number": "CAP-EXTRA-001",
        "shift": "morning", "status": "available",
    }, format="json")

    assert response.status_code == 400, response.json()
    assert "60" in response.json()["status"][0]
    assert Officer.objects.filter(is_deleted=False).count() == 60



@pytest.mark.django_db
def test_dashboard_pois_allow_anonymous_reads_but_reject_writes_without_mutation():
    poi = POI.objects.create(
        poi_id="POI-PUBLIC-001",
        name="Public Hospital",
        category="hospital",
        latitude=10.7202,
        longitude=122.5621,
    )
    client = APIClient()
    initial_rows = list(POI.objects.order_by("pk").values())

    response = client.get("/api/dashboard/pois/")
    assert response.status_code == 200
    assert any(item["poi_id"] == poi.poi_id for item in response.json()["results"])

    create_response = client.post(
        "/api/dashboard/pois/",
        {
            "poi_id": "POI-UNAUTHORIZED-001",
            "name": "Unauthorized School",
            "category": "school",
            "latitude": 10.7203,
            "longitude": 122.5622,
        },
        format="json",
    )
    assert create_response.status_code == 401, create_response.json()
    assert list(POI.objects.order_by("pk").values()) == initial_rows

    update_response = client.put(
        f"/api/dashboard/pois/{poi.poi_id}/",
        {"name": "Unauthorized Update"},
        format="json",
    )
    assert update_response.status_code == 401, update_response.json()
    assert list(POI.objects.order_by("pk").values()) == initial_rows

    delete_response = client.delete(f"/api/dashboard/pois/{poi.poi_id}/")
    assert delete_response.status_code == 401, delete_response.content
    assert list(POI.objects.order_by("pk").values()) == initial_rows


@pytest.mark.django_db
def test_dashboard_pois_authenticated_create_update_and_soft_delete():
    user = get_user_model().objects.create_user(username="poi-manager", password="pass12345")
    client = APIClient()
    client.force_authenticate(user=user)
    payload = {
        "poi_id": "POI-MANAGED-001",
        "name": "Managed Hospital",
        "category": "hospital",
        "latitude": 10.7202,
        "longitude": 122.5621,
    }

    create_response = client.post("/api/dashboard/pois/", payload, format="json")
    assert create_response.status_code == 201, create_response.json()
    poi = POI.objects.get(pk=create_response.json()["id"])
    for field, value in payload.items():
        assert getattr(poi, field) == value
    assert poi.is_deleted is False

    update_response = client.put(
        f"/api/dashboard/pois/{poi.poi_id}/",
        {"name": "Updated Hospital", "priority_boost": 1.5},
        format="json",
    )
    assert update_response.status_code == 200, update_response.json()
    poi.refresh_from_db()
    assert poi.name == "Updated Hospital"
    assert poi.priority_boost == 1.5

    delete_response = client.delete(f"/api/dashboard/pois/{poi.poi_id}/")
    assert delete_response.status_code == 204, delete_response.content
    poi.refresh_from_db()
    assert poi.is_deleted is True
    assert POI.objects.filter(pk=poi.pk).exists()

    list_response = client.get("/api/dashboard/pois/")
    assert list_response.status_code == 200
    assert all(item["poi_id"] != poi.poi_id for item in list_response.json()["results"])


@pytest.mark.django_db
def test_dashboard_incident_create_defaults_timestamp_and_update_preserves_it():
    user = get_user_model().objects.create_user(username="dashboard-reporter", password="pass12345")
    client = APIClient()
    client.force_authenticate(user=user)
    payload = {
        "incident_type": "collision",
        "severity": "minor",
        "description": "Dashboard incident without a timestamp",
        "latitude": 10.7202,
        "longitude": 122.5621,
    }

    before_create = timezone.now()
    create_response = client.post("/api/dashboard/incidents/", payload, format="json")
    after_create = timezone.now()
    assert create_response.status_code == 201, create_response.json()
    incident = Incident.objects.get(pk=create_response.json()["id"])
    assert timezone.is_aware(incident.timestamp)
    assert before_create <= incident.timestamp <= after_create
    assert incident.reported_by_id == user.id
    assert create_response.json()["reported_by"] == user.id
    original_timestamp = incident.timestamp
    response_timestamp = create_response.json()["timestamp"]
    assert response_timestamp is not None

    update_response = client.put(
        f"/api/dashboard/incidents/{incident.id}/",
        {"description": "Updated dashboard incident", "severity": "major"},
        format="json",
    )
    assert update_response.status_code == 200, update_response.json()
    incident.refresh_from_db()
    assert incident.description == "Updated dashboard incident"
    assert incident.severity == "major"
    assert incident.timestamp == original_timestamp
    assert incident.reported_by_id == user.id
    assert update_response.json()["timestamp"] == response_timestamp


@pytest.mark.django_db
def test_logout_blacklists_refresh_token():
    """Test that logout blacklists the refresh token and it cannot be used again."""
    cache.clear()
    user = get_user_model().objects.create_user(username="logout-user", password="pass12345")
    client = APIClient()
    
    # Login to get tokens
    login_response = client.post(
        "/api/auth/login/",
        {"username": user.username, "password": "pass12345"},
        format="json",
    )
    assert login_response.status_code == 200
    refresh_token = login_response.data["refresh"]
    access_token = login_response.data["access"]
    
    # Verify refresh token works before logout
    refresh_response = client.post(
        "/api/auth/refresh/",
        {"refresh": refresh_token},
        format="json",
    )
    assert refresh_response.status_code == 200
    assert refresh_response.data["access"]
    
    # Logout with the refresh token
    logout_response = client.post(
        "/api/auth/logout/",
        {"refresh": refresh_token},
        format="json",
    )
    assert logout_response.status_code == 204
    
    # Attempt to use the blacklisted refresh token
    refresh_after_logout = client.post(
        "/api/auth/refresh/",
        {"refresh": refresh_token},
        format="json",
    )
    assert refresh_after_logout.status_code == 401
    assert "blacklisted" in str(refresh_after_logout.data).lower() or "invalid" in str(refresh_after_logout.data).lower()


@pytest.mark.django_db(transaction=True)
def test_audit_log_database_failure_logged():
    """Audit failures outside a transaction are logged without raising."""
    from core.utils import write_audit_log
    from django.db import DatabaseError
    from unittest.mock import patch
    
    user = get_user_model().objects.create_user(username="audit-user", password="pass12345")
    
    # Mock AuditLog.objects.create to raise DatabaseError
    with patch("core.utils.AuditLog.objects.create", side_effect=DatabaseError("DB connection failed")):
        with patch("core.utils.logging.getLogger") as mock_get_logger:
            mock_logger = mock_get_logger.return_value
            
            # This should not raise an exception
            write_audit_log(user, "test_action", "test_resource", {"key": "value"})
            
            # Verify warning was logged
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args
            assert "Failed to write audit log" in str(call_args)
