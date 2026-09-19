from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from core.models import Bottleneck, TrafficData, WeatherData

from .clients import (
    ProviderError,
    fetch_openmeteo_weather,
    fetch_osm_overpass_traffic,
    fetch_pagasa_weather,
    fetch_tomtom_traffic,
)


TRAFFIC_CACHE_KEY = "external:traffic:last"
WEATHER_CACHE_KEY = "external:weather:last"


def _broadcast_dashboard_alert(payload: dict):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        "dashboard_live",
        {
            "type": "dashboard_event",
            "data": payload,
        },
    )


def _fetch_single_traffic(bottleneck):
    """Fetch traffic data for a single bottleneck. Called in parallel."""
    snapshot = None
    source = None
    data_status = "unavailable"
    try:
        snapshot = fetch_tomtom_traffic(bottleneck.latitude, bottleneck.longitude)
        source = "tomtom"
        data_status = "live"
    except ProviderError:
        try:
            snapshot = fetch_osm_overpass_traffic(bottleneck.latitude, bottleneck.longitude)
            source = "osm_overpass"
            data_status = "fallback"
        except ProviderError:
            cached = cache.get(f"{TRAFFIC_CACHE_KEY}:{bottleneck.id}")
            if cached:
                snapshot = cached
                source = "cache"
                data_status = "cached"
    return bottleneck, snapshot, source, data_status


@shared_task
def fetch_traffic_data():
    created = 0
    source_counts = {"tomtom": 0, "osm_overpass": 0, "cache": 0}
    critical_alerts = 0
    now = timezone.now()

    bottlenecks = list(Bottleneck.objects.filter(is_deleted=False))

    updated_bottlenecks = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_fetch_single_traffic, b): b for b in bottlenecks}
        for future in as_completed(futures):
            bottleneck, snapshot, source, data_status = future.result()
            if not snapshot:
                continue

            if source:
                source_counts[source] += 1

            tsi_val = float(snapshot.get("tsi", 0.0))
            if source != "cache":
                snapshot = {**snapshot, "fetched_at": now.isoformat()}
            else:
                snapshot = {**snapshot, "data_status": "cached", "is_stale": True}
            cache.set(f"{TRAFFIC_CACHE_KEY}:{bottleneck.id}", snapshot, timeout=60 * 30)
            fetched_at = snapshot.get("fetched_at", now)
            if isinstance(fetched_at, str):
                fetched_at = timezone.datetime.fromisoformat(fetched_at)
            if timezone.is_naive(fetched_at):
                fetched_at = timezone.make_aware(fetched_at)
            observed_at = snapshot.get("observed_at")
            if isinstance(observed_at, str):
                observed_at = timezone.datetime.fromisoformat(observed_at)
            if observed_at and timezone.is_naive(observed_at):
                observed_at = timezone.make_aware(observed_at)
            TrafficData.objects.create(
                bottleneck=bottleneck,
                timestamp=now,
                traffic_severity_index=tsi_val,
                vehicle_count=int(snapshot.get("vehicle_count", 0)),
                avg_speed=float(snapshot.get("current_speed", 0.0)),
                source=source or "unknown",
                data_status=data_status,
                is_synthetic=False,
                is_stale=data_status == "cached",
                fetched_at=fetched_at,
                observed_at=observed_at,
            )

            # Update bottleneck TSI so dashboard map dots reflect real traffic
            bottleneck.tsi = tsi_val
            bottleneck.updated_at = now  # bulk_update doesn't trigger auto_now
            updated_bottlenecks.append(bottleneck)
            created += 1

            if tsi_val >= 0.80:
                critical_alerts += 1
                _broadcast_dashboard_alert(
                    {
                        "event": "tsi_threshold_exceeded",
                        "bottleneck_id": bottleneck.id,
                        "bottleneck_name": bottleneck.name,
                        "tsi": round(tsi_val, 3),
                        "timestamp": now.isoformat(),
                    }
                )

    # Bulk update all bottleneck TSI values
    if updated_bottlenecks:
        Bottleneck.objects.bulk_update(updated_bottlenecks, ["tsi", "updated_at"])

        # Notify dashboard to refresh bottleneck data
        _broadcast_dashboard_alert(
            {
                "event": "bottlenecks_updated",
                "count": len(updated_bottlenecks),
                "timestamp": now.isoformat(),
            }
        )

    return {
        "status": "ok",
        "timestamp": now.isoformat(),
        "created": created,
        "critical_alerts": critical_alerts,
            "sources": source_counts,
    }


@shared_task
def fetch_weather_data():
    now = timezone.now()
    snapshot = None
    source = ""

    try:
        snapshot = fetch_pagasa_weather()
        source = "pagasa"
    except ProviderError:
        try:
            snapshot = fetch_openmeteo_weather()
            source = "openmeteo"
        except ProviderError:
            snapshot = cache.get(WEATHER_CACHE_KEY)
            source = "cache" if snapshot else "none"

    if not snapshot:
        return {
            "status": "failed",
            "timestamp": now.isoformat(),
            "source": source,
            "data_status": "unavailable",
            "available": False,
            "is_synthetic": False,
            "is_stale": False,
            "observed_at": None,
            "fetched_at": None,
        }

    data_status = "cached" if source == "cache" else ("fallback" if source == "openmeteo" else "live")
    fetched_at = snapshot.get("fetched_at", now)
    if isinstance(fetched_at, str):
        fetched_at = timezone.datetime.fromisoformat(fetched_at)
    if timezone.is_naive(fetched_at):
        fetched_at = timezone.make_aware(fetched_at)
    snapshot = {**snapshot, "fetched_at": fetched_at.isoformat(), "data_status": data_status, "is_stale": data_status == "cached"}
    cache.set(WEATHER_CACHE_KEY, snapshot, timeout=60 * 60)
    weather = WeatherData.objects.create(
        timestamp=now,
        condition=snapshot.get("condition", "clear"),
        temperature=float(snapshot.get("temperature", 30.0)),
        precipitation=float(snapshot.get("precipitation", 0.0)),
        weather_impact_factor=float(snapshot.get("weather_impact_factor", 1.0)),
        source=source,
        data_status=data_status,
        is_synthetic=False,
        is_stale=data_status == "cached",
        fetched_at=fetched_at,
        observed_at=None,
    )

    previous = WeatherData.objects.filter(is_deleted=False).exclude(pk=weather.pk).order_by("-timestamp").first()
    previous_wif = float(previous.weather_impact_factor) if previous else weather.weather_impact_factor
    if abs(weather.weather_impact_factor - previous_wif) >= 0.25:
        _broadcast_dashboard_alert(
            {
                "event": "weather_wif_shift",
                "weather_impact_factor": weather.weather_impact_factor,
                "previous_weather_impact_factor": previous_wif,
                "timestamp": now.isoformat(),
            }
        )

    return {
        "status": "ok",
        "timestamp": now.isoformat(),
        "source": source,
        "data_status": data_status,
        "available": True,
        "is_synthetic": False,
        "is_stale": data_status == "cached",
        "fetched_at": fetched_at.isoformat(),
        "weather_impact_factor": weather.weather_impact_factor,
    }


@shared_task
def cleanup_old_data():
    cutoff = timezone.now() - timedelta(days=90)
    traffic_qs = TrafficData.objects.filter(timestamp__lt=cutoff)
    weather_qs = WeatherData.objects.filter(timestamp__lt=cutoff)
    deleted = traffic_qs.update(is_deleted=True) + weather_qs.update(is_deleted=True)
    return {"status": "ok", "soft_deleted": deleted}
