from django.core.cache import cache
from django.conf import settings
import requests
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse

from core.models import TrafficData, WeatherData
from core.serializers import TrafficDataSerializer, WeatherDataSerializer


def _provenance(record):
	return {
		"source": record.source,
		"data_status": record.data_status,
		"available": True,
		"is_synthetic": record.is_synthetic,
		"is_stale": record.is_stale,
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
		return Response({**WeatherDataSerializer(weather).data, **_provenance(weather)})


class TrafficRealtimeView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		rows = TrafficData.objects.filter(is_deleted=False).order_by("-timestamp")[:100]
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
		return Response(TrafficDataSerializer(rows, many=True).data)


class AnalyticsTrendsView(APIView):
	permission_classes = [permissions.AllowAny]
	throttle_classes = []

	def get(self, request):
		series = (
			TrafficData.objects.filter(is_deleted=False)
			.order_by("-timestamp")
			.values("timestamp", "traffic_severity_index", "avg_speed")[:30]
		)
		if not series:
			return Response({"trends": [], "metadata": _unavailable()})
		latest = TrafficData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		return Response({"trends": list(series), "metadata": _provenance(latest)})


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
		except Exception as exc:
			return Response({"detail": f"TomTom tile request failed: {exc}"}, status=502)

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

		allowed_styles = {"relative0", "relative", "absolute", "reduced"}
		style = request.query_params.get("style", "relative0")
		if style not in allowed_styles:
			return Response({"detail": f"Invalid style. Allowed: {allowed_styles}"}, status=400)
		url = f"https://api.tomtom.com/traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png"

		try:
			response = requests.get(url, params={"key": api_key}, timeout=10)
		except Exception as exc:
			return Response({"detail": f"TomTom traffic tile request failed: {exc}"}, status=502)

		if response.status_code != 200:
			return Response({"detail": "TomTom traffic tile provider error."}, status=response.status_code)

		content_type = response.headers.get("Content-Type", "image/png")
		proxy_response = HttpResponse(response.content, content_type=content_type)
		proxy_response["Cache-Control"] = "public, max-age=120"
		return proxy_response
