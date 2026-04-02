from django.urls import path

from dashboard.consumers import DashboardConsumer
from incidents.consumers import IncidentConsumer
from optimization.consumers import OptimizationProgressConsumer

websocket_urlpatterns = [
    path("ws/dashboard/", DashboardConsumer.as_asgi()),
    path("ws/optimization/<str:run_id>/", OptimizationProgressConsumer.as_asgi()),
    path("ws/incidents/", IncidentConsumer.as_asgi()),
]
