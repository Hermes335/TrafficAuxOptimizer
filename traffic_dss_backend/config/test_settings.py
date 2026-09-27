"""Isolated regression environment; never connects to the operational database/cache."""
import os
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["DJANGO_ENV"] = "development"
os.environ["SECRET_KEY"] = "isolated-test-signing-key-of-at-least-32-characters"
os.environ["JWT_SECRET_KEY"] = "isolated-test-jwt-key-of-at-least-32-characters"
from .settings import *  # noqa: F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
