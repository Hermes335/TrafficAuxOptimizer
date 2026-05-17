from django.utils import timezone

from .models import AuditLog


def write_audit_log(user, action: str, resource: str, changes: dict):
    if user and not user.is_authenticated:
        user = None

    AuditLog.objects.create(
        user=user,
        action=action,
        resource=resource,
        changes=changes,
        timestamp=timezone.now(),
    )
