from django.urls import path
from .operations import TimeBlockView, ObservationView, ScheduleReviewView

from .views import (
    DeploymentPreviewView,
    DeploymentAssignView,
    DeploymentPublishOptimizationView,
    DeploymentScheduleView,
    DeploymentUpdateView,
    OfficerDeploymentView,
    ScheduleRevisionView,
)

urlpatterns = [
    path("review/", ScheduleReviewView.as_view()),
    path("time-blocks/", TimeBlockView.as_view()),
    path("observations/", ObservationView.as_view()),
    path("revisions/", ScheduleRevisionView.as_view(), name="schedule-revisions"),
    path("preview-optimization/", DeploymentPreviewView.as_view(), name="deployment-preview"),
    path("schedule/", DeploymentScheduleView.as_view(), name="deployment-schedule"),
    path("assign/", DeploymentAssignView.as_view(), name="deployment-assign"),
    path("publish-optimization/", DeploymentPublishOptimizationView.as_view(), name="deployment-publish-optimization"),
    path("<int:deployment_id>/update/", DeploymentUpdateView.as_view(), name="deployment-update"),
    path("officer/<int:officer_id>/", OfficerDeploymentView.as_view(), name="officer-deployments"),
]
