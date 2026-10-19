"""Short-lived, shared presence for background traffic polling."""
from django.conf import settings
from django.core.cache import cache

ACTIVITY_KEY = "external:traffic:active-viewer:v1"
POLL_KEY = "external:traffic:poll-started:v1"
RESUME_KEY = "external:traffic:resume-queued:v1"


def traffic_viewers_active():
    # Missing/unavailable Redis must conserve quota rather than start polling.
    try:
        return bool(cache.get(ACTIVITY_KEY))
    except Exception:
        return False


def record_traffic_activity():
    cache.set(ACTIVITY_KEY, True, timeout=settings.TRAFFIC_ACTIVITY_TIMEOUT)
    return traffic_viewers_active()


def background_traffic_allowed():
    return not settings.TRAFFIC_POLL_ONLY_WHEN_ACTIVE or traffic_viewers_active()


def claim_traffic_poll():
    if not settings.TRAFFIC_POLL_ONLY_WHEN_ACTIVE:
        return True
    try:
        return bool(cache.add(POLL_KEY, True, timeout=300))
    except Exception:
        return False
