from types import SimpleNamespace

from channels.security.websocket import OriginValidator
from channels.testing import WebsocketCommunicator
import pytest

from config.demo_asgi import AuthenticatedWebSocket


async def accept_websocket(scope, receive, send):
    await receive()
    await send({'type': 'websocket.accept'})
    await receive()


@pytest.mark.asyncio
@pytest.mark.parametrize('authenticated,origin,expected', [
    (False, 'https://demo.example.com', False),
    (True, 'https://unapproved.example.com', False),
    (True, 'https://demo.example.com', True),
])
async def test_public_demo_websockets_require_login_and_approved_origin(authenticated, origin, expected):
    application = OriginValidator(
        AuthenticatedWebSocket(accept_websocket), ['https://demo.example.com'],
    )
    socket = WebsocketCommunicator(application, '/ws/dashboard/', headers=[
        (b'origin', origin.encode('ascii')),
    ])
    socket.scope['user'] = SimpleNamespace(is_authenticated=authenticated)
    connected, _ = await socket.connect()
    assert connected is expected
    await socket.disconnect()
