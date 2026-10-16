"""ASGI entry point for the isolated public demo; local development is unchanged."""
from config.asgi import application as base_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings

from core.ws_auth import JWTAuthMiddleware
from config.routing import websocket_urlpatterns


class AuthenticatedWebSocket:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if not scope['user'].is_authenticated:
            await send({'type': 'websocket.close', 'code': 4401})
            return
        return await self.application(scope, receive, send)


application = ProtocolTypeRouter({
    'http': base_application.application_mapping['http'],
    'websocket': OriginValidator(
        JWTAuthMiddleware(AuthenticatedWebSocket(URLRouter(websocket_urlpatterns))),
        settings.CORS_ALLOWED_ORIGINS,
    ),
})
