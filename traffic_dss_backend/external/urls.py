from django.urls import path

from .views import AnalyticsTrendsView, TomTomTileProxyView, TomTomTrafficTileProxyView, TrafficRealtimeView, WeatherCurrentView

urlpatterns = [
    path("weather/current/", WeatherCurrentView.as_view(), name="weather-current"),
    path("traffic/real-time/", TrafficRealtimeView.as_view(), name="traffic-realtime"),
    path("analytics/trends/", AnalyticsTrendsView.as_view(), name="analytics-trends"),
    path("maps/tomtom/<int:z>/<int:x>/<int:y>.png", TomTomTileProxyView.as_view(), name="maps-tomtom-tile"),
    path("maps/tomtom-traffic/<int:z>/<int:x>/<int:y>.png", TomTomTrafficTileProxyView.as_view(), name="maps-tomtom-traffic-tile"),
]
