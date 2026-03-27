"""WebSocket manager for broadcasting progress and console output."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, msg_type: str, data: dict[str, Any]) -> None:
        payload = json.dumps({"type": msg_type, "data": data})
        stale: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(ws)

    def broadcast_sync(self, msg_type: str, data: dict[str, Any]) -> None:
        """Fire-and-forget broadcast from sync code (runs in the event loop)."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(msg_type, data))
        except RuntimeError:
            pass


manager = ConnectionManager()
