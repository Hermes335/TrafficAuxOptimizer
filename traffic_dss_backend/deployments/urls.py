from django.urls import path

from .views import DeploymentAssignView, DeploymentScheduleView, DeploymentUpdateView, OfficerDeploymentView

urlpatterns = [
    path("schedule/", DeploymentScheduleView.as_view(), name="deployment-schedule"),
    path("assign/", DeploymentAssignView.as_view(), name="deployment-assign"),
    path("<int:deployment_id>/update/", DeploymentUpdateView.as_view(), name="deployment-update"),
    path("officer/<int:officer_id>/", OfficerDeploymentView.as_view(), name="officer-deployments"),
]
