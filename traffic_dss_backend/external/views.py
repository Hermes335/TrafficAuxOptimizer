from django.core.cache import cache
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import TrafficData, WeatherData
from core.serializers import TrafficDataSerializer, WeatherDataSerializer


class WeatherCurrentView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		weather = WeatherData.objects.filter(is_deleted=False).order_by("-timestamp").first()
		if not weather:
			try:
				cached = cache.get("external:weather:last")
				if cached:
					return Response(cached)
			except Exception:
				pass
			return Response(
				{
					"timestamp": timezone.now().isoformat(),
					"condition": "clear",
					"temperature": 30.0,
					"precipitation": 0.0,
					"weather_impact_factor": 1.0,
				}
			)
		return Response(WeatherDataSerializer(weather).data)


class TrafficRealtimeView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		rows = TrafficData.objects.filter(is_deleted=False).order_by("-timestamp")[:100]
		if not rows:
			try:
				cached_rows = []
				for key in cache.iter_keys("external:traffic:last:*") if hasattr(cache, "iter_keys") else []:
					value = cache.get(key)
					if value:
						cached_rows.append(value)
				if cached_rows:
					return Response(cached_rows)
			except Exception:
				pass
			return Response(
				[
					{
						"timestamp": timezone.now().isoformat(),
						"traffic_severity_index": 0.28,
						"vehicle_count": 34,
						"avg_speed": 31.0,
					},
					{
						"timestamp": timezone.now().isoformat(),
						"traffic_severity_index": 0.41,
						"vehicle_count": 48,
						"avg_speed": 27.5,
					},
				]
			)
		return Response(TrafficDataSerializer(rows, many=True).data)


class AnalyticsTrendsView(APIView):
	permission_classes = [permissions.AllowAny]

	def get(self, request):
		series = (
			TrafficData.objects.filter(is_deleted=False)
			.order_by("-timestamp")
			.values("timestamp", "traffic_severity_index", "avg_speed")[:30]
		)
		if not series:
			return Response(
				{
					"trends": [
						{"timestamp": timezone.now().isoformat(), "traffic_severity_index": 0.25, "avg_speed": 32.0},
						{"timestamp": timezone.now().isoformat(), "traffic_severity_index": 0.33, "avg_speed": 29.0},
					],
				}
			)
		return Response({"trends": list(series)})
