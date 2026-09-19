from django.utils import timezone
from django.db import DatabaseError, IntegrityError, OperationalError, DataError
import logging

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
    except (DatabaseError, IntegrityError, OperationalError, DataError):
        logger = logging.getLogger(__name__)
        logger.warning("Failed to write audit log", exc_info=True)
