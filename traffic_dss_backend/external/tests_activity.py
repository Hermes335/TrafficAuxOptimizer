import time
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import Bottleneck, TrafficData
from external.activity import ACTIVITY_KEY, POLL_KEY, RESUME_KEY, record_traffic_activity, traffic_viewers_active
from external.tasks import fetch_traffic_data


@pytest.fixture(autouse=True)
def activity_settings(settings):
    settings.TRAFFIC_POLL_ONLY_WHEN_ACTIVE = True
    settings.TRAFFIC_ACTIVITY_TIMEOUT = 180
    cache.delete_many([ACTIVITY_KEY, POLL_KEY, RESUME_KEY])
    yield
    cache.delete_many([ACTIVITY_KEY, POLL_KEY, RESUME_KEY])


@pytest.fixture
def signed_in():
    user = get_user_model().objects.create_user(username="traffic-viewer", password="test-password")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer " + str(RefreshToken.for_user(user).access_token))
    return client


def junction():
    return Bottleneck.objects.create(id="activity-junction", name="Test junction",
                                    latitude=10.72, longitude=122.56)


@pytest.mark.django_db
def test_idle_poll_does_not_contact_any_traffic_provider_or_write_observations():
    junction()
    with patch("external.tasks.fetch_tomtom_traffic") as tomtom, patch("external.tasks.fetch_osm_overpass_traffic") as fallback:
        assert fetch_traffic_data() == {"status": "paused", "reason": "no_active_viewers", "created": 0}
    tomtom.assert_not_called()
    fallback.assert_not_called()
    assert TrafficData.objects.count() == 0


@pytest.mark.django_db
def test_authenticated_activity_resumes_once_and_renews_shared_presence(signed_in):
    with patch("external.tasks.fetch_traffic_data.delay") as resume:
        assert signed_in.post("/api/traffic/activity/").status_code == 204
        assert traffic_viewers_active()
        assert signed_in.post("/api/traffic/activity/").status_code == 204
    resume.assert_called_once_with()


@pytest.mark.django_db
def test_anonymous_health_and_authenticated_dashboard_reads_do_not_keep_polling_alive(signed_in):
    assert APIClient().post("/api/traffic/activity/").status_code == 401
    assert APIClient().get("/api/health/").status_code == 200
    assert signed_in.get("/api/dashboard/bottlenecks/").status_code == 200
    assert not traffic_viewers_active()


@pytest.mark.django_db
def test_presence_expires_after_last_viewer_stops_sending_heartbeats():
    assert record_traffic_activity()
    with patch("time.time", return_value=time.time() + 181), patch("external.tasks.fetch_tomtom_traffic") as tomtom:
        assert not traffic_viewers_active()
        assert fetch_traffic_data()["status"] == "paused"
        tomtom.assert_not_called()


@pytest.mark.django_db
def test_another_viewer_heartbeat_extends_presence_without_clearing_other_users(signed_in):
    assert record_traffic_activity()
    now = time.time()
    with patch("time.time", return_value=now + 120), patch("external.tasks.fetch_traffic_data.delay"):
        assert signed_in.post("/api/traffic/activity/").status_code == 204
    with patch("time.time", return_value=now + 181):
        assert traffic_viewers_active()


@pytest.mark.django_db
def test_active_poll_collects_and_duplicate_queued_poll_uses_no_extra_quota():
    junction()
    record_traffic_activity()
    with patch("external.tasks.fetch_tomtom_traffic", return_value={"tsi": 0.25, "current_speed": 25, "vehicle_count": 75}) as tomtom, patch("external.tasks._broadcast_dashboard_alert"):
        assert fetch_traffic_data()["created"] == 1
        assert fetch_traffic_data() == {"status": "skipped", "reason": "poll_not_due", "created": 0}
    tomtom.assert_called_once()
    assert TrafficData.objects.count() == 1


@pytest.mark.django_db
def test_cache_failure_pauses_poll_and_returns_retryable_activity_error(signed_in):
    with patch("external.activity.cache.get", side_effect=ConnectionError), patch("external.tasks.fetch_tomtom_traffic") as tomtom:
        assert fetch_traffic_data()["status"] == "paused"
        assert signed_in.post("/api/traffic/activity/").status_code == 503
        tomtom.assert_not_called()


@pytest.mark.django_db
def test_resume_broker_failure_does_not_break_the_app(signed_in):
    with patch("external.tasks.fetch_traffic_data.delay", side_effect=ConnectionError):
        assert signed_in.post("/api/traffic/activity/").status_code == 204
    assert traffic_viewers_active()
    assert not cache.get(RESUME_KEY)
