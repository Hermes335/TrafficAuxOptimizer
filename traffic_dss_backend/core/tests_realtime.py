import pytest
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework_simplejwt.tokens import AccessToken

from config.asgi import application


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
async def test_dashboard_websocket_connects_and_pongs():
    user = await sync_to_async(get_user_model().objects.create_user)(username="ws-user", password="pass12345")
    token = str(AccessToken.for_user(user))
    communicator = WebsocketCommunicator(application, f"/ws/dashboard/?token={token}")
    connected, _ = await communicator.connect()
    assert connected

    connected_message = await communicator.receive_json_from()
    assert connected_message["event"] == "connected"

    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        "dashboard_live",
        {
            "type": "dashboard_event",
            "data": {"event": "incident_reported", "id": 99},
        },
    )

    broadcast_message = await communicator.receive_json_from()
    assert broadcast_message["event"] == "incident_reported"

    await communicator.send_json_to({"type": "ping"})
    pong = await communicator.receive_json_from()
    assert pong["event"] == "pong"

    await communicator.disconnect()

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_lifecycle_producer_preserves_event_name_through_dashboard_consumer():
    from core.tasks import _broadcast_incident_event
    user = await sync_to_async(get_user_model().objects.create_user)(username="lifecycle-ws")
    token = str(AccessToken.for_user(user))
    communicator = WebsocketCommunicator(application, f"/ws/dashboard/?token={token}")
    connected, _ = await communicator.connect()
    assert connected
    await communicator.receive_json_from()
    await sync_to_async(_broadcast_incident_event)("incident_updated", {"id": 7, "status": "resolved"})
    event = await communicator.receive_json_from()
    assert event["event"] == "incident_updated" and event["id"] == 7
    await communicator.disconnect()
