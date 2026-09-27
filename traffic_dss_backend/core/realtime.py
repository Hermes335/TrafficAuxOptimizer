import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def broadcast(group_name, event_type, data):
    try:
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.group_send)(group_name, {"type": event_type, "data": data})
    except Exception:
        logging.getLogger(__name__).exception("Live update unavailable for %s", group_name)
