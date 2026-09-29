"""Progress uses the configured cache, including isolated in-memory test caches."""
from django.core.cache import cache


def progress_key(run_id):
    return f"optimization:progress:{run_id}"


def save_progress(run_id, payload):
    try:
        cache.set(progress_key(run_id), payload, 24 * 60 * 60)
    except Exception:
        # The database status and realtime stream remain authoritative.
        pass


def load_progress(run_id):
    try:
        value = cache.get(progress_key(run_id))
        return value if isinstance(value, dict) else None
    except Exception:
        return None
