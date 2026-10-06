from django.core.cache import cache
from django.conf import settings
from hashlib import sha256
import logging
import requests
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse

from core.models import TrafficData, WeatherData
from core.serializers import TrafficDataSerializer, WeatherDataSerializer


logger = logging.getLogger("external_apis")
TRAFFIC_TILE_TTL = 120


def _traffic_png(content, fetched_at):
	response = HttpResponse(content, content_type="image/png")
	remaining = max(0, TRAFFIC_TILE_TTL - int((timezone.now() - fetched_at).total_seconds()))
	response["Cache-Control"] = f"public, max-age={remaining}"
	return response


def _is_stale(record, max_age_seconds):
	observed_at = record.observed_at or record.timestamp
	return record.is_stale or (timezone.now() - observed_at).total_seconds() > max_age_seconds


def _provenance(record, max_age_seconds):
	return {
		"source": record.source,
		"data_status": record.data_status,
		"available": True,
		"is_synthetic": record.is_synthetic,
		"is_stale": _is_stale(record, max_age_seconds),
		"observed_at": record.observed_at.isoformat() if record.observed_at else None,
		"fetched_at": record.fetched_at.isoformat() if record.fetched_at else None,
	}


def _unavailable(source="none"):
	return {
		"source": source,
		"data_status": "unavailable",
		"available": False,
		"is_synthetic": False,
		"is_stale": False,
		"observed_at": None,
		"fetched_at": None,
	}


class WeatherCurrentView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		if not weather:
			try:
				cached = cache.get("external:weather:last")
				if cached:
					return Response({**cached, "data_status": "cached", "available": True, "is_synthetic": False, "is_stale": True, "source": "cache"})
			except Exception:
				pass
			return Response({**_unavailable(), "timestamp": None, "condition": None, "temperature": None, "precipitation": None, "weather_impact_factor": None})
		return Response({**WeatherDataSerializer(weather).data, **_provenance(weather, settings.WEATHER_MAX_INPUT_AGE)})


class TrafficRealtimeView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		rows = list(TrafficData.objects.filter(is_deleted=False).order_by("-timestamp")[:100])
		if not rows:
			try:
				cached_rows = []
				for key in cache.iter_keys("external:traffic:last:*") if hasattr(cache, "iter_keys") else []:
					value = cache.get(key)
					if value:
						cached_rows.append({
							**value,
							"source": "cache",
							"data_status": "cached",
							"available": True,
							"is_synthetic": False,
							"is_stale": True,
						})
				if cached_rows:
					return Response(cached_rows)
			except Exception:
				pass
			return Response({"data": [], "metadata": _unavailable()})
		payload = TrafficDataSerializer(rows, many=True).data
		for record, item in zip(rows, payload):
			item["is_stale"] = _is_stale(record, settings.TRAFFIC_MAX_INPUT_AGE)
		return Response(payload)


class TomTomTileProxyView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request, z: int, x: int, y: int):
		api_key = getattr(settings, "TOMTOM_API_KEY", "")
		if not api_key:
			return Response({"detail": "TOMTOM_API_KEY is not configured."}, status=503)

		allowed_styles = {"basic/main", "basic/night", "hybrid/main", "labels/light", "labels/dark"}
		style = request.query_params.get("style", "basic/main")
		if style not in allowed_styles:
			return Response({"detail": f"Invalid style. Allowed: {allowed_styles}"}, status=400)
		url = f"https://api.tomtom.com/map/1/tile/{style}/{z}/{x}/{y}.png"

		try:
			response = requests.get(url, params={"key": api_key}, timeout=10)
		except requests.RequestException:
			return Response({"detail": "TomTom tile request failed."}, status=502)

		if response.status_code != 200:
			return Response({"detail": "TomTom tile provider error."}, status=response.status_code)

		content_type = response.headers.get("Content-Type", "image/png")
		proxy_response = HttpResponse(response.content, content_type=content_type)
		proxy_response["Cache-Control"] = "public, max-age=300"
		return proxy_response


class TomTomTrafficTileProxyView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request, z: int, x: int, y: int):
		api_key = getattr(settings, "TOMTOM_API_KEY", "")
		if not api_key:
			return Response({"detail": "TOMTOM_API_KEY is not configured."}, status=503)

		limit = (1 << z) - 1 if 0 <= z <= 22 else -1
		if limit < 0 or not 0 <= x <= limit or not 0 <= y <= limit:
			return Response({"detail": "Invalid traffic tile coordinates."}, status=400)
		allowed_styles = {"relative0", "relative", "absolute", "relative0-dark", "relative-delay", "reduced-sensitivity"}
		style = request.query_params.get("style", "relative0")
		if style not in allowed_styles:
			return Response({"detail": f"Invalid style. Allowed: {allowed_styles}"}, status=400)
		url = f"https://api.tomtom.com/traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png"
		key_id = sha256(api_key.encode()).hexdigest()[:16]
		cache_key = f"traffic-tile:png:v1:{key_id}:{style}:{z}:{x}:{y}"
		# Cache failure must not prevent a live tile request when Redis is down.
		try:
			cached = cache.get(cache_key)
		except Exception:
			cached = None
		if cached and (timezone.now() - cached[1]).total_seconds() < TRAFFIC_TILE_TTL:
			return _traffic_png(*cached)

		# A fresh connection can recover from a transient TLS/read failure. Keep the
		# retry bounded, and do not retry access denials or quota responses.
		for attempt in range(2):
			# TomTom's tile aliases can recover a connection that failed on the
			# primary host. Keep the same tile/style and server-side credential.
			attempt_url = url if attempt == 0 else url.replace("https://api.tomtom.com/", "https://a.api.tomtom.com/")
			try:
				response = requests.get(attempt_url, params={"key": api_key}, timeout=10)
			except requests.RequestException as exc:
				if attempt == 0:
					logger.info("Traffic tile transport failure (%s), z=%s x=%s y=%s attempt=1; retrying", type(exc).__name__, z, x, y)
					continue
				logger.warning("Traffic tile transport failure (%s), z=%s x=%s y=%s attempt=2; tile unavailable", type(exc).__name__, z, x, y)
				status = 504 if isinstance(exc, requests.Timeout) else 502
				return Response({"detail": "Traffic provider timed out. Retry the traffic layer." if status == 504 else "Traffic provider could not be reached. Retry the traffic layer."}, status=status, headers={"Cache-Control": "no-store"})
			if response.status_code in {502, 503, 504} and attempt == 0:
				continue
			if response.status_code != 200:
				logger.warning("Traffic tile provider status=%s z=%s x=%s y=%s", response.status_code, z, x, y)
				return Response({"detail": "TomTom traffic tile provider error."}, status=response.status_code, headers={"Cache-Control": "no-store"})
			if not response.content.startswith(b"\x89PNG\r\n\x1a\n"):
				return Response({"detail": "Traffic provider returned an invalid tile."}, status=502, headers={"Cache-Control": "no-store"})
			fetched_at = timezone.now()
			try:
				cache.set(cache_key, (response.content, fetched_at), timeout=TRAFFIC_TILE_TTL)
			except Exception:
				pass
			return _traffic_png(response.content, fetched_at)


class TomTomTrafficVectorTileProxyView(APIView):
	"""Proxy detailed flow geometry without exposing the provider API key."""
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request, z: int, x: int, y: int):
		api_key = getattr(settings, "TOMTOM_API_KEY", "")
		if not api_key:
			return Response({"detail": "TOMTOM_API_KEY is not configured."}, status=503)
		limit = (1 << z) - 1 if 0 <= z <= 22 else -1
		if limit < 0 or not 0 <= x <= limit or not 0 <= y <= limit:
			return Response({"detail": "Invalid traffic tile coordinates."}, status=400)
		url = f"https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf"
		params = {
			"key": api_key,
			"roadTypes": "[0,1,2,3,4,5,6,7,8]",
			"tags": "[road_type,traffic_level,traffic_road_coverage,left_hand_traffic,road_closure]",
			"margin": "0.1",
		}
		try:
			response = requests.get(url, params=params, headers={"Accept-Encoding": "gzip"}, timeout=10)
		except requests.RequestException:
			return Response({"detail": "TomTom traffic vector tile request failed."}, status=502)
		if response.status_code != 200:
			return Response({"detail": "TomTom traffic tile provider error."}, status=response.status_code)
		proxy_response = HttpResponse(response.content, content_type="application/x-protobuf")
		proxy_response["Cache-Control"] = "public, max-age=60"
		# Requests already decompresses response.content. Forwarding Content-Encoding
		# would make the browser try to decompress the plain protobuf a second time.
		return proxy_response
