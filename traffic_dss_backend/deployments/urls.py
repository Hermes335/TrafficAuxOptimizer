from django.urls import path

from .views import (
    DeploymentPreviewView,
    DeploymentAssignView,
    DeploymentPublishOptimizationView,
    DeploymentScheduleView,
    DeploymentUpdateView,
    OfficerDeploymentView,
)

urlpatterns = [
    path("preview-optimization/", DeploymentPreviewView.as_view(), name="deployment-preview"),
    path("schedule/", DeploymentScheduleView.as_view(), name="deployment-schedule"),
    path("assign/", DeploymentAssignView.as_view(), name="deployment-assign"),
    path("publish-optimization/", DeploymentPublishOptimizationView.as_view(), name="deployment-publish-optimization"),
    path("<int:deployment_id>/update/", DeploymentUpdateView.as_view(), name="deployment-update"),
    path("officer/<int:officer_id>/", OfficerDeploymentView.as_view(), name="officer-deployments"),
]
