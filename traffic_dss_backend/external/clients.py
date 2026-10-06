from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlsplit

import requests
from django.conf import settings

logger = logging.getLogger("external_apis")


class ProviderError(Exception):
    pass


def request_with_backoff(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict:
    delay_seconds = 1.0
    provider = urlsplit(url).hostname or "unknown"
    failure = "unknown"

    for attempt in range(1, 4):
        status = None
        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            status = response.status_code
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            failure = type(exc).__name__
            transient = isinstance(exc, (requests.Timeout, requests.ConnectionError)) or (
                status is not None and (status == 408 or status >= 500)
            )
            retry = transient and attempt < 3
            # Exception text and request URLs may contain API keys. Include only
            # safe diagnostics in the message: the console formatter drops extra.
            log = logger.info if retry else logger.warning
            log("Provider request failed provider=%s reason=%s status=%s attempt=%s/3 retry=%s",
                provider, failure, status if status is not None else "none", attempt, retry)
            if retry:
                time.sleep(delay_seconds)
                delay_seconds *= 2
            else:
                break

    raise ProviderError(f"Provider {provider} failed: {failure}, status={status}, attempts={attempt}") from None


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


def _open_meteo_code_to_weather(code: int) -> tuple[str, float]:
    mapping: dict[int, tuple[str, float]] = {
        0: ("clear", 1.0),
        1: ("partly_cloudy", 1.02),
        2: ("partly_cloudy", 1.03),
        3: ("cloudy", 1.05),
        45: ("fog", 1.12),
        48: ("fog", 1.14),
        51: ("light_rain", 1.1),
        53: ("light_rain", 1.12),
        55: ("moderate_rain", 1.22),
        56: ("freezing_drizzle", 1.18),
        57: ("freezing_drizzle", 1.25),
        61: ("light_rain", 1.2),
        63: ("moderate_rain", 1.35),
        65: ("heavy_rain", 1.65),
        66: ("freezing_rain", 1.4),
        67: ("freezing_rain", 1.55),
        71: ("light_snow", 1.2),
        73: ("snow", 1.35),
        75: ("heavy_snow", 1.55),
        77: ("snow_grains", 1.25),
        80: ("shower_rain", 1.18),
        81: ("shower_rain", 1.32),
        82: ("heavy_shower_rain", 1.5),
        85: ("shower_snow", 1.28),
        86: ("heavy_shower_snow", 1.45),
        95: ("severe", 2.0),
        96: ("severe", 2.15),
        99: ("severe", 2.25),
    }

    return mapping.get(code, ("clear", 1.0))


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


def fetch_openmeteo_weather() -> dict:
    lat = float(getattr(settings, "ILOILO_LATITUDE", 10.7202))
    lng = float(getattr(settings, "ILOILO_LONGITUDE", 122.5621))

    payload = request_with_backoff(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lng,
            "current": "temperature_2m,precipitation,weather_code",
            "timezone": "auto",
        },
    )
    current = payload.get("current", {})
    weather_code = int(current.get("weather_code", -1))
    condition, wif = _open_meteo_code_to_weather(weather_code)

    return {
        "source": "openmeteo",
        "condition": condition,
        "temperature": float(current.get("temperature_2m", 30.0)),
        "precipitation": float(current.get("precipitation", 0.0)),
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
