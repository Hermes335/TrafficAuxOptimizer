from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token = query.get("token", [None])[0]
        scope["user"] = AnonymousUser()

        if token:
            try:
                jwt_auth = JWTAuthentication()
                validated = jwt_auth.get_validated_token(token)
                user = await sync_to_async(jwt_auth.get_user)(validated)
                scope["user"] = user
            except TokenError:
                scope["user"] = AnonymousUser()
            except Exception:
                scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)
