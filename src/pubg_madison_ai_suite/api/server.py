"""FastAPI backend for PUBG Madison AI Suite.

Launched by Electron's main process or run standalone:
    python -m pubg_madison_ai_suite.api.server
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

_pkg_root = Path(__file__).resolve().parents[2]
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from pubg_madison_ai_suite.api.ws import manager
from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event, cancel_all  # noqa: F401
from pubg_madison_ai_suite.api.routes import system, gemini, character, weapon, prop, environment, uilab, editor, styles, gallery, userlib, artboard, prompts, palette, history, queue, export, director, refsearch

app = FastAPI(title="Madison AI Suite API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(gemini.router, prefix="/api/gemini", tags=["gemini"])
app.include_router(character.router, prefix="/api/character", tags=["character"])
app.include_router(weapon.router, prefix="/api/weapon", tags=["weapon"])
app.include_router(prop.router, prefix="/api/prop", tags=["prop"])
app.include_router(environment.router, prefix="/api/env", tags=["environment"])
app.include_router(uilab.router, prefix="/api/uilab", tags=["uilab"])
app.include_router(editor.router, prefix="/api/editor", tags=["editor"])
app.include_router(styles.router, prefix="/api/styles", tags=["styles"])
app.include_router(gallery.router, prefix="/api/gallery", tags=["gallery"])
app.include_router(userlib.router, prefix="/api/userlib", tags=["userlib"])
app.include_router(artboard.router, prefix="/api/artboard", tags=["artboard"])
app.include_router(prompts.router, prefix="/api/prompts", tags=["prompts"])
app.include_router(palette.router, prefix="/api/palette", tags=["palette"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(queue.router, prefix="/api/queue", tags=["queue"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(director.router, prefix="/api/director", tags=["director"])
app.include_router(refsearch.router, prefix="/api/refsearch", tags=["refsearch"])


@app.websocket("/ws/progress")
async def ws_progress(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


if __name__ == "__main__":
    port = int(os.environ.get("MADISON_API_PORT", "8420"))
    print(f"[Madison API] Starting on port {port}")
    host = os.environ.get("MADISON_BIND_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info")
