from django.urls import path

from .views import (
    ActiveIncidentsView,
    DashboardBottlenecksView,
    DashboardKPIsView,
    DashboardMapDataView,
    QuickOptimizeView,
)

urlpatterns = [
    path("kpis/", DashboardKPIsView.as_view(), name="dashboard-kpis"),
    path("bottlenecks/", DashboardBottlenecksView.as_view(), name="dashboard-bottlenecks"),
    path("incidents/active/", ActiveIncidentsView.as_view(), name="dashboard-incidents-active"),
    path("map-data/", DashboardMapDataView.as_view(), name="dashboard-map-data"),
    path("quick-optimize/", QuickOptimizeView.as_view(), name="dashboard-quick-optimize"),
]
