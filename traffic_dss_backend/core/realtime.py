from __future__ import annotations

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def broadcast(group_name: str, event_type: str, data: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": event_type,
            "data": data,
        },
    )
