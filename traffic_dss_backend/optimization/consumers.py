from time import monotonic

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class OptimizationProgressConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return
        self._message_window_started = monotonic()
        self._message_count = 0
        self.run_id = self.scope["url_route"]["kwargs"]["run_id"]
        self.group_name = f"optimization_{self.run_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"event": "connected", "scope": "optimization", "run_id": self.run_id})

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
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
            await self.send_json({"event": "pong", "run_id": self.run_id})

    async def optimization_event(self, event):
        await self.send_json(event["data"])
