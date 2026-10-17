from django.urls import path

from .views import (IncidentDeleteView, IncidentListView, IncidentLocationsView, IncidentMetaView,
                    IncidentPhotoView, IncidentReportView, IncidentResolveView, IncidentReviewListView,
                    IncidentReviewView, IncidentUpdateView)

urlpatterns = [
    path("meta/", IncidentMetaView.as_view(), name="incident-meta"),
    path("locations/", IncidentLocationsView.as_view(), name="incident-locations"),
    path("report/", IncidentReportView.as_view(), name="incident-report"),
    path("review/", IncidentReviewListView.as_view(), name="incident-review-list"),
    path("", IncidentListView.as_view(), name="incident-list"),
    path("<int:incident_id>/review/", IncidentReviewView.as_view(), name="incident-review"),
    path("<int:incident_id>/photo/", IncidentPhotoView.as_view(), name="incident-photo"),
    path("<int:incident_id>/update/", IncidentUpdateView.as_view(), name="incident-update"),
    path("<int:incident_id>/resolve/", IncidentResolveView.as_view(), name="incident-resolve"),
    path("<int:incident_id>/", IncidentDeleteView.as_view(), name="incident-delete"),
]
