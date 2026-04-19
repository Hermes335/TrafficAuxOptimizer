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


@shared_task
def fetch_traffic_data():
    created = 0
    source_counts = {"tomtom": 0, "osm_overpass": 0, "cache": 0}
    critical_alerts = 0
    now = timezone.now()

    bottlenecks = Bottleneck.objects.filter(is_deleted=False)
    for bottleneck in bottlenecks:
        snapshot = None
        try:
            snapshot = fetch_tomtom_traffic(bottleneck.latitude, bottleneck.longitude)
            source_counts["tomtom"] += 1
        except ProviderError:
            try:
                snapshot = fetch_osm_overpass_traffic(bottleneck.latitude, bottleneck.longitude)
                source_counts["osm_overpass"] += 1
            except ProviderError:
                cached = cache.get(f"{TRAFFIC_CACHE_KEY}:{bottleneck.id}")
                if cached:
                    snapshot = cached
                    source_counts["cache"] += 1

        if not snapshot:
            continue

        cache.set(f"{TRAFFIC_CACHE_KEY}:{bottleneck.id}", snapshot, timeout=60 * 30)
        TrafficData.objects.create(
            bottleneck=bottleneck,
            timestamp=now,
            traffic_severity_index=float(snapshot.get("tsi", 0.0)),
            vehicle_count=int(snapshot.get("vehicle_count", 0)),
            avg_speed=float(snapshot.get("current_speed", 0.0)),
        )
        created += 1

        if float(snapshot.get("tsi", 0.0)) >= 0.80:
            critical_alerts += 1
            _broadcast_dashboard_alert(
                {
                    "event": "tsi_threshold_exceeded",
                    "bottleneck_id": bottleneck.id,
                    "bottleneck_name": bottleneck.name,
                    "tsi": round(float(snapshot.get("tsi", 0.0)), 3),
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
        return {"status": "failed", "timestamp": now.isoformat(), "source": source}

    cache.set(WEATHER_CACHE_KEY, snapshot, timeout=60 * 60)
    weather = WeatherData.objects.create(
        timestamp=now,
        condition=snapshot.get("condition", "clear"),
        temperature=float(snapshot.get("temperature", 30.0)),
        precipitation=float(snapshot.get("precipitation", 0.0)),
        weather_impact_factor=float(snapshot.get("weather_impact_factor", 1.0)),
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
        "weather_impact_factor": weather.weather_impact_factor,
    }


@shared_task
def cleanup_old_data():
    cutoff = timezone.now() - timedelta(days=90)
    traffic_qs = TrafficData.objects.filter(timestamp__lt=cutoff)
    weather_qs = WeatherData.objects.filter(timestamp__lt=cutoff)
    deleted = traffic_qs.update(is_deleted=True) + weather_qs.update(is_deleted=True)
    return {"status": "ok", "soft_deleted": deleted}
