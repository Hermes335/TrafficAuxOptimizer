from django.urls import path

from .views import IncidentDeleteView, IncidentListView, IncidentMetaView, IncidentReportView, IncidentResolveView

urlpatterns = [
    path("meta/", IncidentMetaView.as_view(), name="incident-meta"),
    path("report/", IncidentReportView.as_view(), name="incident-report"),
    path("", IncidentListView.as_view(), name="incident-list"),
    path("<int:incident_id>/resolve/", IncidentResolveView.as_view(), name="incident-resolve"),
    path("<int:incident_id>/", IncidentDeleteView.as_view(), name="incident-delete"),
]
