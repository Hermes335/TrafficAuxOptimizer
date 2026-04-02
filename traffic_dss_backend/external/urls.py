from django.urls import path

from .views import AnalyticsTrendsView, TrafficRealtimeView, WeatherCurrentView

urlpatterns = [
    path("weather/current/", WeatherCurrentView.as_view(), name="weather-current"),
    path("traffic/real-time/", TrafficRealtimeView.as_view(), name="traffic-realtime"),
    path("analytics/trends/", AnalyticsTrendsView.as_view(), name="analytics-trends"),
]
