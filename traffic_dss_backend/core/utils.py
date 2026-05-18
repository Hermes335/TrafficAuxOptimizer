from django.utils import timezone

from .models import AuditLog


def write_audit_log(user, action: str, resource: str, changes: dict):
    try:
        if user and not user.is_authenticated:
            user = None

        AuditLog.objects.create(
            user=user if user and user.is_authenticated else None,
            action=action,
            resource=resource,
            changes=changes,
            timestamp=timezone.now(),
        )
    except Exception:
        pass
