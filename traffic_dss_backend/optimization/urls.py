from django.urls import path
from .exports import RecommendationExportView

from .views import (
    OptimizationCancelView,
    OptimizationConfigureView,
    OptimizationHistoryView,
    OptimizationResultsView,
    OptimizationStartView,
    OptimizationStatusView,
)

urlpatterns = [
    path("export/<str:run_id>/", RecommendationExportView.as_view(), name="optimization-export"),
    path("configure/", OptimizationConfigureView.as_view(), name="optimization-configure"),
    path("start/", OptimizationStartView.as_view(), name="optimization-start"),
    path("cancel/<str:run_id>/", OptimizationCancelView.as_view(), name="optimization-cancel"),
    path("status/<str:run_id>/", OptimizationStatusView.as_view(), name="optimization-status"),
    path("results/<str:run_id>/", OptimizationResultsView.as_view(), name="optimization-results"),
    path("history/", OptimizationHistoryView.as_view(), name="optimization-history"),
]
