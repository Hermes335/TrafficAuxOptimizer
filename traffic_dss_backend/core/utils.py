from django.utils import timezone

from .models import AuditLog


def write_audit_log(user, action: str, resource: str, changes: dict):
    if not user or not user.is_authenticated:
        return

    AuditLog.objects.create(
        user=user,
        action=action,
        resource=resource,
        changes=changes,
        timestamp=timezone.now(),
    )
