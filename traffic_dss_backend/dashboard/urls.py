from django.urls import path

from .views import (
    ActiveIncidentsView,
    DashboardBottleneckManageView,
    DashboardBottlenecksView,
    DashboardKPIsView,
    DashboardMapDataView,
    DashboardOfficerManageView,
    DashboardOfficersView,
    QuickOptimizeView,
)

urlpatterns = [
    path("kpis/", DashboardKPIsView.as_view(), name="dashboard-kpis"),
    path("bottlenecks/", DashboardBottlenecksView.as_view(), name="dashboard-bottlenecks"),
    path("bottlenecks/manage/", DashboardBottleneckManageView.as_view(), name="dashboard-bottleneck-create"),
    path("bottlenecks/manage/<str:bottleneck_id>/", DashboardBottleneckManageView.as_view(), name="dashboard-bottleneck-delete"),
    path("officers/", DashboardOfficersView.as_view(), name="dashboard-officers"),
    path("officers/manage/", DashboardOfficerManageView.as_view(), name="dashboard-officer-create"),
    path("officers/manage/<int:officer_id>/", DashboardOfficerManageView.as_view(), name="dashboard-officer-update-delete"),
    path("incidents/active/", ActiveIncidentsView.as_view(), name="dashboard-incidents-active"),
    path("map-data/", DashboardMapDataView.as_view(), name="dashboard-map-data"),
    path("quick-optimize/", QuickOptimizeView.as_view(), name="dashboard-quick-optimize"),
]
