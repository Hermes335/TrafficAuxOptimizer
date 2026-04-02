from __future__ import annotations

import logging
import time
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger("external_apis")


class ProviderError(Exception):
    pass


def request_with_backoff(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict:
    delay_seconds = 1.0
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            logger.warning("Provider request failed", extra={"url": url, "attempt": attempt, "error": str(exc)})
            if attempt < 3:
                time.sleep(delay_seconds)
                delay_seconds *= 2

    raise ProviderError(f"Provider request failed after retries: {last_error}")


def _weather_condition_to_wif(condition: str) -> tuple[str, float]:
    value = (condition or "").lower()
    if "thunder" in value or "storm" in value:
        return "severe", 2.0
    if "heavy" in value:
        return "heavy_rain", 1.65
    if "moderate" in value:
        return "moderate_rain", 1.35
    if "rain" in value or "drizzle" in value:
        return "light_rain", 1.15
    return "clear", 1.0


def fetch_pagasa_weather() -> dict:
    endpoint = getattr(settings, "PAGASA_API_ENDPOINT", "")
    if not endpoint:
        raise ProviderError("PAGASA_API_ENDPOINT is not configured")

    payload = request_with_backoff(endpoint)
    weather_text = str(payload.get("condition") or payload.get("weather") or "clear")
    condition, wif = _weather_condition_to_wif(weather_text)
    return {
        "source": "pagasa",
        "condition": condition,
        "temperature": float(payload.get("temperature", 30.0)),
        "precipitation": float(payload.get("precipitation", payload.get("rainfall", 0.0))),
        "weather_impact_factor": wif,
        "raw": payload,
    }


def fetch_openweather_weather() -> dict:
    api_key = getattr(settings, "OPENWEATHERMAP_API_KEY", "")
    lat = float(getattr(settings, "ILOILO_LATITUDE", 10.7202))
    lng = float(getattr(settings, "ILOILO_LONGITUDE", 122.5621))
    if not api_key:
        raise ProviderError("OPENWEATHERMAP_API_KEY is not configured")

    payload = request_with_backoff(
        "https://api.openweathermap.org/data/3.0/onecall",
        params={
            "lat": lat,
            "lon": lng,
            "exclude": "minutely,hourly,daily,alerts",
            "appid": api_key,
            "units": "metric",
        },
    )
    current = payload.get("current", {})
    weather = current.get("weather", [])
    weather_text = weather[0].get("description", "clear") if weather else "clear"
    condition, wif = _weather_condition_to_wif(weather_text)

    return {
        "source": "openweathermap",
        "condition": condition,
        "temperature": float(current.get("temp", 30.0)),
        "precipitation": float(current.get("rain", {}).get("1h", 0.0)) if isinstance(current.get("rain"), dict) else 0.0,
        "weather_impact_factor": wif,
        "raw": payload,
    }


def fetch_tomtom_traffic(lat: float, lng: float) -> dict:
    api_key = getattr(settings, "TOMTOM_API_KEY", "")
    if not api_key:
        raise ProviderError("TOMTOM_API_KEY is not configured")

    payload = request_with_backoff(
        "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json",
        params={
            "key": api_key,
            "point": f"{lat},{lng}",
            "unit": "KMPH",
        },
    )
    flow = payload.get("flowSegmentData", {})
    current_speed = float(flow.get("currentSpeed", 0.0))
    free_flow = max(1.0, float(flow.get("freeFlowSpeed", current_speed or 1.0)))
    tsi = max(0.0, min(1.0, 1.0 - (current_speed / free_flow)))

    return {
        "source": "tomtom",
        "current_speed": current_speed,
        "free_flow_speed": free_flow,
        "tsi": tsi,
        "vehicle_count": int(max(0, (1.0 - tsi) * 100)),
        "raw": payload,
    }


def fetch_osm_overpass_traffic(lat: float, lng: float) -> dict:
    query = f"[out:json];way(around:300,{lat},{lng})[highway];out tags;"
    payload = request_with_backoff("https://overpass-api.de/api/interpreter", params={"data": query})
    elements = payload.get("elements", [])
    road_count = len(elements)
    assumed_speed = max(12.0, 35.0 - min(20.0, road_count * 0.2))
    free_flow = 40.0
    tsi = max(0.0, min(1.0, 1.0 - (assumed_speed / free_flow)))

    return {
        "source": "osm_overpass",
        "current_speed": assumed_speed,
        "free_flow_speed": free_flow,
        "tsi": tsi,
        "vehicle_count": max(10, road_count * 3),
        "raw": payload,
    }
