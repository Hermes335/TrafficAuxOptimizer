from __future__ import annotations

import json

from django.conf import settings
from redis import Redis
from redis.exceptions import RedisError


def _redis_client() -> Redis | None:
    try:
        return Redis.from_url(settings.REDIS_URL, decode_responses=True)
    except Exception:
        return None


def progress_key(run_id: str) -> str:
    return f"optimization:progress:{run_id}"


def save_progress(run_id: str, payload: dict) -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        client.set(progress_key(run_id), json.dumps(payload), ex=24 * 60 * 60)
    except RedisError:
        return


def load_progress(run_id: str) -> dict | None:
    client = _redis_client()
    if client is None:
        return None
    try:
        raw = client.get(progress_key(run_id))
    except RedisError:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None
