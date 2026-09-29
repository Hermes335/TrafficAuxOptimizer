"""Consistent audit and committed realtime notifications for API mutations."""
from django.db import transaction
from .realtime import broadcast
from .utils import write_audit_log


def record_mutation(actor, action, resource, changes, event):
    write_audit_log(actor, action, resource, changes)
    transaction.on_commit(lambda: broadcast("dashboard_live", "dashboard_event", {
        "event": event, **{k: v for k, v in changes.items() if k.endswith("_id")},
    }))
