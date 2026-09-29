"""Bounded operational health probes; test settings never contact live services."""
from datetime import timedelta
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import OuterRef, Subquery
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from config.celery import app
from .models import Bottleneck, TrafficData, WeatherData


def queue_health():
    if settings.CELERY_BROKER_URL.startswith("memory:"):
        return {"queue": "isolated", "workers": "isolated", "scheduler": "isolated"}
    cached = cache.get("queue_health_probe")
    if cached:
        return cached
    result = {"queue": "error", "workers": "unavailable", "scheduler": "unavailable"}
    try:
        with app.connection_for_read(connect_timeout=1) as broker:
            broker.ensure_connection(max_retries=0)
        result["queue"] = "ok"
        result["workers"] = "ok" if app.control.inspect(timeout=1).ping() else "unavailable"
        heartbeat = parse_datetime(cache.get("scheduler_heartbeat") or "")
        if heartbeat and timezone.is_aware(heartbeat) and timezone.now() - heartbeat < timedelta(seconds=180):
            result["scheduler"] = "ok"
    except Exception:
        # Do not expose broker URLs or transport exception details.
        pass
    cache.set("queue_health_probe", result, 15)
    return result


def system_health():
    now = timezone.now()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        executor = MigrationExecutor(connection)
        pending = len(executor.migration_plan(executor.loader.graph.leaf_nodes()))
        database = "ok"
    except Exception:
        database, pending = "error", None
    queue = queue_health()
    providers = {}
    if database == "ok" and pending == 0:
        latest = TrafficData.objects.filter(is_deleted=False, bottleneck_id=OuterRef("pk")).order_by("-timestamp", "-pk")
        nodes = list(Bottleneck.objects.filter(is_deleted=False, is_archived=False).annotate(
            observation_id=Subquery(latest.values("pk")[:1])))
        traffic = TrafficData.objects.in_bulk([node.observation_id for node in nodes if node.observation_id])

        def observation_health(row, limit):
            observed = (row.observed_at or row.timestamp) if row else None
            age = (now - observed).total_seconds() if observed else None
            return {"status": "missing" if not row else "simulated" if row.is_synthetic else "stale" if row.is_stale or age > limit or age < -60 else row.data_status,
                    "observed_at": observed, "age_seconds": age}

        traffic_health = [observation_health(traffic.get(node.observation_id), settings.TRAFFIC_MAX_INPUT_AGE) for node in nodes]
        invalid = [row for row in traffic_health if row["status"] not in {"live", "fallback", "verified", "manual_verified"}]
        observed = [row["observed_at"] for row in traffic_health if row["observed_at"]]
        oldest = min(observed) if observed else None
        providers["traffic"] = {"status": "missing" if not traffic_health else "degraded" if invalid else "fresh",
            "observed_at": oldest, "age_seconds": (now - oldest).total_seconds() if oldest else None,
            "locations_needing_refresh": len(invalid), "total_locations": len(nodes)}
        providers["weather"] = observation_health(WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first(), settings.WEATHER_MAX_INPUT_AGE)
    ready = (database == "ok" and pending == 0 and all(value == "ok" for value in queue.values())
        and bool(providers) and all(row["status"] in {"fresh", "live", "fallback", "verified", "manual_verified"} for row in providers.values()))
    return {"status": "ok" if ready else "degraded", "timestamp": now.isoformat(), "database": database,
            **queue, "pending_migrations": pending, "version": settings.BACKEND_VERSION, "providers": providers}
