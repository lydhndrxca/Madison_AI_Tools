"""Artboard API routes.

Manages saved artboard presets on disk and real-time collaborative rooms via WebSocket.
"""

from __future__ import annotations

import asyncio
import base64
import json
import secrets
import string
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
META_FILENAME = "board.json"

_LIBRARY_DIR: Optional[Path] = None

CURSOR_COLORS = [
    "#4da6ff", "#ff6b6b", "#51cf66", "#fcc419", "#cc5de8",
    "#ff922b", "#20c997", "#748ffc", "#f06595", "#94d82d",
]


def _lib_dir() -> Path:
    global _LIBRARY_DIR
    if _LIBRARY_DIR is None:
        _LIBRARY_DIR = Path(__file__).resolve().parents[4] / "ARTBOARD_LIBRARY"
        _LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    return _LIBRARY_DIR


# ── Pydantic models ──────────────────────────────────────────────

class ArtboardItemModel(BaseModel):
    id: str
    type: str
    x: float
    y: float
    w: float
    h: float
    rotation: float = 0
    zIndex: int = 0
    content: str = ""
    borderColor: Optional[str] = None
    borderWidth: Optional[float] = None
    fontSize: Optional[float] = None
    fontColor: Optional[str] = None
    backgroundColor: Optional[str] = None


class SaveBoardReq(BaseModel):
    name: str
    items: List[ArtboardItemModel]


class BoardInfo(BaseModel):
    name: str
    item_count: int
    thumbnail: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


class BoardData(BaseModel):
    name: str
    items: List[ArtboardItemModel]
    created_at: str = ""
    updated_at: str = ""


# ── Saved boards (disk) ─────────────────────────────────────────

def _read_board_meta(name: str) -> Dict[str, Any]:
    meta_path = _lib_dir() / name / META_FILENAME
    if meta_path.is_file():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _write_board(name: str, items: list, meta_extra: Optional[Dict[str, Any]] = None) -> None:
    folder = _lib_dir() / name
    folder.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    existing = _read_board_meta(name)
    meta = {
        "name": name,
        "items": items,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
        **(meta_extra or {}),
    }
    with open(folder / META_FILENAME, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


def _get_thumbnail(name: str) -> Optional[str]:
    meta = _read_board_meta(name)
    items = meta.get("items", [])
    for it in items:
        if it.get("type") == "image" and it.get("content", "").startswith("data:image"):
            return it["content"][:200] + "..."
    return None


@router.get("/boards")
def list_boards() -> List[BoardInfo]:
    base = _lib_dir()
    if not base.is_dir():
        return []
    result = []
    for d in sorted(base.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        meta = _read_board_meta(d.name)
        result.append(BoardInfo(
            name=d.name,
            item_count=len(meta.get("items", [])),
            created_at=meta.get("created_at", ""),
            updated_at=meta.get("updated_at", ""),
        ))
    return result


def _safe_board_name(raw: str) -> Optional[str]:
    """Strip dangerous chars from board name. Returns None if invalid."""
    name = raw.strip().replace("..", "").replace("/", "").replace("\\", "").replace("\x00", "")
    return name if name else None


@router.post("/boards")
def save_board(req: SaveBoardReq) -> dict:
    name = _safe_board_name(req.name)
    if not name:
        return {"ok": False, "error": "Name required"}
    _write_board(name, [it.model_dump() for it in req.items])
    return {"ok": True}


@router.get("/boards/{name}")
def load_board(name: str) -> BoardData:
    safe = _safe_board_name(name)
    if not safe:
        return BoardData(name=name, items=[], created_at="", updated_at="")
    meta = _read_board_meta(safe)
    validated_items = []
    for it in meta.get("items", []):
        try:
            validated_items.append(ArtboardItemModel(**it))
        except Exception:
            pass
    return BoardData(
        name=safe,
        items=validated_items,
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
    )


@router.put("/boards/{name}")
def update_board(name: str, req: SaveBoardReq) -> dict:
    safe = _safe_board_name(name)
    if not safe:
        return {"ok": False, "error": "Invalid board name"}
    _write_board(safe, [it.model_dump() for it in req.items])
    return {"ok": True}


@router.delete("/boards/{name}")
def delete_board(name: str) -> dict:
    import shutil
    safe = _safe_board_name(name)
    if not safe:
        return {"ok": False, "error": "Invalid board name"}
    folder = _lib_dir() / safe
    if folder.is_dir():
        shutil.rmtree(folder)
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════
# Real-time collaborative rooms
# ══════════════════════════════════════════════════════════════════

def _gen_code(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))


class UserMeta:
    __slots__ = ("name", "color", "ws", "cursor_x", "cursor_y", "last_cursor")

    def __init__(self, name: str, color: str, ws: WebSocket) -> None:
        self.name = name
        self.color = color
        self.ws = ws
        self.cursor_x: float = 0
        self.cursor_y: float = 0
        self.last_cursor: float = 0

    def to_dict(self) -> dict:
        return {"name": self.name, "color": self.color}


class Room:
    def __init__(self, code: str, name: str, host: str, password: Optional[str], items: list) -> None:
        self.code = code
        self.name = name
        self.host = host
        self.password = password
        self.items: list[dict] = items
        self.users: dict[int, UserMeta] = {}
        self._color_idx = 0
        self.created_at = time.time()

    def next_color(self) -> str:
        c = CURSOR_COLORS[self._color_idx % len(CURSOR_COLORS)]
        self._color_idx += 1
        return c

    async def broadcast(self, msg: dict, exclude_ws: Optional[WebSocket] = None) -> None:
        payload = json.dumps(msg)
        stale: list[int] = []
        for uid, u in self.users.items():
            if u.ws is exclude_ws:
                continue
            try:
                await u.ws.send_text(payload)
            except Exception:
                stale.append(uid)
        for uid in stale:
            self.users.pop(uid, None)

    async def send_to(self, ws: WebSocket, msg: dict) -> None:
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            pass

    def apply_delta(self, delta: dict) -> None:
        dtype = delta.get("type")
        if dtype == "add":
            item = delta.get("item")
            if item:
                self.items.append(item)
        elif dtype == "add_many":
            for it in delta.get("items", []):
                self.items.append(it)
        elif dtype == "remove":
            ids = set(delta.get("ids", []))
            self.items = [i for i in self.items if i.get("id") not in ids]
        elif dtype == "update":
            tid = delta.get("id")
            patch = delta.get("patch", {})
            self.items = [{**i, **patch} if i.get("id") == tid else i for i in self.items]
        elif dtype == "move":
            ids = set(delta.get("ids", []))
            dx, dy = delta.get("dx", 0), delta.get("dy", 0)
            self.items = [{**i, "x": i.get("x", 0) + dx, "y": i.get("y", 0) + dy} if i.get("id") in ids else i for i in self.items]
        elif dtype == "resize":
            tid = delta.get("id")
            w = delta.get("w", 100)
            h = delta.get("h", 100)
            self.items = [{**i, "w": w, "h": h} if i.get("id") == tid else i for i in self.items]
        elif dtype == "reorder":
            zmap = delta.get("zIndexMap", {})
            self.items = [{**i, "zIndex": zmap[i["id"]]} if i.get("id") in zmap else i for i in self.items]
        elif dtype == "clear":
            self.items = []


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create(self, name: str, host: str, password: Optional[str], items: list) -> Room:
        code = _gen_code()
        while code in self.rooms:
            code = _gen_code()
        room = Room(code, name, host, password, items)
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Optional[Room]:
        return self.rooms.get(code)

    def remove(self, code: str) -> None:
        self.rooms.pop(code, None)

    def list_active(self) -> list[dict]:
        return [
            {"code": r.code, "name": r.name, "user_count": len(r.users), "host": r.host}
            for r in self.rooms.values()
        ]


room_manager = RoomManager()


# ── Room REST endpoints ──────────────────────────────────────────

class CreateRoomReq(BaseModel):
    name: str = "Shared Board"
    password: Optional[str] = None
    items: List[ArtboardItemModel] = []


@router.post("/rooms")
def create_room(req: CreateRoomReq) -> dict:
    items_raw = [it.model_dump() for it in req.items]
    room = room_manager.create(req.name, "host", req.password, items_raw)
    return {"code": room.code, "name": room.name}


@router.get("/rooms")
def list_rooms() -> list[dict]:
    return room_manager.list_active()


@router.delete("/rooms/{code}")
def close_room(code: str) -> dict:
    room_manager.remove(code)
    return {"ok": True}


# ── Room WebSocket ───────────────────────────────────────────────

@router.websocket("/ws/{room_code}")
async def ws_artboard(ws: WebSocket, room_code: str, user: str = "Guest", password: str = ""):
    room = room_manager.get(room_code)
    if not room:
        await ws.close(code=4004, reason="Room not found")
        return
    if room.password and room.password != password:
        await ws.close(code=4003, reason="Wrong password")
        return

    await ws.accept()
    uid = id(ws)
    color = room.next_color()
    meta = UserMeta(user, color, ws)
    room.users[uid] = meta

    # Send full sync to joiner
    await room.send_to(ws, {
        "op": "full_sync",
        "items": room.items,
        "users": [u.to_dict() for u in room.users.values()],
    })

    # Notify others
    await room.broadcast({"op": "user_joined", "user": user, "color": color}, exclude_ws=ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            op = msg.get("op")

            if op == "delta":
                actions = msg.get("actions")
                if actions and isinstance(actions, list):
                    for action in actions:
                        room.apply_delta(action)
                    await room.broadcast({"op": "delta", "user": user, "actions": actions}, exclude_ws=ws)
                elif msg.get("type"):
                    room.apply_delta(msg)
                    await room.broadcast({"op": "delta", "user": user, "actions": [msg]}, exclude_ws=ws)

            elif op == "cursor":
                meta.cursor_x = msg.get("x", 0)
                meta.cursor_y = msg.get("y", 0)
                meta.last_cursor = time.time()
                await room.broadcast({"op": "cursor", "user": user, "x": meta.cursor_x, "y": meta.cursor_y, "color": color}, exclude_ws=ws)

            elif op == "full_sync_request":
                await room.send_to(ws, {"op": "full_sync", "items": room.items, "users": [u.to_dict() for u in room.users.values()]})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.users.pop(uid, None)
        await room.broadcast({"op": "user_left", "user": user})
        if len(room.users) == 0:
            room_manager.remove(room_code)
