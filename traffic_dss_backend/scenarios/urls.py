from django.urls import path

from .views import ScenarioDetailView, ScenarioListCreateView

urlpatterns = [
    path("", ScenarioListCreateView.as_view(), name="scenario-list-create"),
    path("<int:scenario_id>/", ScenarioDetailView.as_view(), name="scenario-detail"),
]
