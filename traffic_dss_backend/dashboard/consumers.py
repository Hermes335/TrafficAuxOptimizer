from time import monotonic

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from core.realtime import broadcast


class DashboardConsumer(AsyncJsonWebsocketConsumer):
    group_name = "dashboard_live"

    async def connect(self):
        self._message_window_started = monotonic()
        self._message_count = 0
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"event": "connected", "scope": "dashboard"})

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        now = monotonic()
        if now - self._message_window_started > 10:
            self._message_window_started = now
            self._message_count = 0

        self._message_count += 1
        if self._message_count > 5:
            await self.close(code=4408)
            return

        if content.get("type") == "ping":
            await self.send_json({"event": "pong"})

    async def dashboard_event(self, event):
        await self.send_json(event["data"])

    async def send_live_update(self, data: dict):
        await self.send_json(data)
