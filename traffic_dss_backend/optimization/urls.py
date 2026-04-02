from django.urls import path

from .views import (
    OptimizationConfigureView,
    OptimizationHistoryView,
    OptimizationResultsView,
    OptimizationStartView,
    OptimizationStatusView,
)

urlpatterns = [
    path("configure/", OptimizationConfigureView.as_view(), name="optimization-configure"),
    path("start/", OptimizationStartView.as_view(), name="optimization-start"),
    path("status/<str:run_id>/", OptimizationStatusView.as_view(), name="optimization-status"),
    path("results/<str:run_id>/", OptimizationResultsView.as_view(), name="optimization-results"),
    path("history/", OptimizationHistoryView.as_view(), name="optimization-history"),
]
