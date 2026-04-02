from django.urls import path

from .views import (
    AdminBottleneckCreateView,
    AdminOfficerUpdateView,
    AdminSystemHealthView,
    AuditLogListView,
)

urlpatterns = [
    path("audit-logs/", AuditLogListView.as_view(), name="admin-audit-logs"),
    path("bottlenecks/", AdminBottleneckCreateView.as_view(), name="admin-bottleneck-create"),
    path("officers/<int:officer_id>/", AdminOfficerUpdateView.as_view(), name="admin-officer-update"),
    path("system-health/", AdminSystemHealthView.as_view(), name="admin-system-health"),
]
