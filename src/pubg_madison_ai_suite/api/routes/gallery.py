"""Gallery endpoints: browse generated images on disk."""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image

from pubg_madison_ai_suite.api import core

router = APIRouter()

THUMB_SIZE = 160
_thumb_executor = ThreadPoolExecutor(max_workers=4)


def _save_root() -> Path:
    return Path(core.get_save_folder())


# ---------------------------------------------------------------------------
# Tree
# ---------------------------------------------------------------------------

@router.get("/tree")
async def gallery_tree():
    root = _save_root()
    tools = []
    _exts = {".png", ".jpg", ".jpeg", ".webp"}
    if root.is_dir():
        for tool_dir in sorted(root.iterdir()):
            if not tool_dir.is_dir():
                continue
            dates = []
            for date_dir in sorted(tool_dir.iterdir(), reverse=True):
                if not date_dir.is_dir():
                    continue
                count = sum(1 for f in date_dir.iterdir() if f.suffix.lower() in _exts)
                if count > 0:
                    dates.append({"date": date_dir.name, "count": count})
            if dates:
                tools.append({"name": tool_dir.name, "dates": dates})
    return {"root": str(root), "tools": tools}


# ---------------------------------------------------------------------------
# Thumbnail helpers
# ---------------------------------------------------------------------------

THUMB_DIR_NAME = ".thumbs"


def _ensure_thumb(image_path: Path) -> Path | None:
    """Create a thumbnail on disk if missing/stale. Returns the thumb file path."""
    thumb_dir = image_path.parent / THUMB_DIR_NAME
    thumb_file = thumb_dir / (image_path.stem + ".thumb.jpg")

    try:
        src_mtime = image_path.stat().st_mtime
    except OSError:
        return None

    if thumb_file.is_file():
        try:
            if thumb_file.stat().st_mtime >= src_mtime:
                return thumb_file
        except OSError:
            pass

    try:
        img = Image.open(image_path)
        w, h = img.size
        thumb = img.copy()
        thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        if thumb.mode == "RGBA":
            thumb = thumb.convert("RGB")
        thumb_dir.mkdir(exist_ok=True)
        thumb.save(str(thumb_file), format="JPEG", quality=75)
        meta_file = thumb_dir / (image_path.stem + ".meta")
        meta_file.write_text(f"{w},{h}")
        return thumb_file
    except Exception:
        return None


def _read_image_meta(image_path: Path) -> dict:
    """Read width/height from cached .meta file or open the image."""
    thumb_dir = image_path.parent / THUMB_DIR_NAME
    meta_file = thumb_dir / (image_path.stem + ".meta")
    if meta_file.is_file():
        try:
            parts = meta_file.read_text().strip().split(",")
            if len(parts) == 2:
                return {"w": int(parts[0]), "h": int(parts[1])}
        except Exception:
            pass
    try:
        img = Image.open(image_path)
        w, h = img.size
        img.close()
        return {"w": w, "h": h}
    except Exception:
        return {"w": 0, "h": 0}


# ---------------------------------------------------------------------------
# Image listing — returns metadata only, no thumbnails in JSON
# ---------------------------------------------------------------------------

def _build_image_entry(f: Path) -> dict | None:
    """Build a single image entry dict (runs in thread pool)."""
    meta = {}
    json_path = f.with_suffix(".json")
    if json_path.is_file():
        try:
            meta = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    _ensure_thumb(f)

    dims = _read_image_meta(f)
    return {
        "filename": f.name,
        "width": meta.get("width", dims["w"]),
        "height": meta.get("height", dims["h"]),
        "model": meta.get("model", ""),
        "view": meta.get("view", ""),
        "generation_type": meta.get("generation_type", ""),
        "timestamp": meta.get("timestamp", ""),
        "prompt": meta.get("description", meta.get("prompt", "")),
    }


def _validate_segment(seg: str) -> bool:
    """Reject path segments that could escape the gallery root."""
    return ".." not in seg and "/" not in seg and "\\" not in seg and seg.strip() != ""


@router.get("/images")
async def gallery_images(tool: str = Query(...), date: str = Query(...)):
    """Return image metadata (no thumbnails). Thumbnails are fetched via /thumb."""
    if not _validate_segment(tool) or not _validate_segment(date):
        return {"images": []}
    folder = _save_root() / tool / date
    if not folder.is_dir():
        return {"images": []}
    _exts = {".png", ".jpg", ".jpeg", ".webp"}
    files = sorted(
        [f for f in folder.iterdir() if f.suffix.lower() in _exts],
        reverse=True,
    )

    import asyncio
    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(_thumb_executor, _build_image_entry, f) for f in files]
    )
    return {"images": [r for r in results if r is not None]}


# ---------------------------------------------------------------------------
# Thumbnail endpoint — serves a single thumbnail as binary image
# ---------------------------------------------------------------------------

@router.get("/thumb")
async def gallery_thumb(tool: str = Query(...), date: str = Query(...), filename: str = Query(...)):
    """Serve a single thumbnail as JPEG binary. Browser can <img src> this directly."""
    if not _validate_segment(tool) or not _validate_segment(date):
        return Response(status_code=400, content=b"Invalid parameters")
    if ".." in filename or "/" in filename or "\\" in filename:
        return Response(status_code=400, content=b"Invalid filename")

    image_path = _save_root() / tool / date / filename
    if not image_path.is_file():
        return Response(status_code=404, content=b"Not found")

    thumb_path = _ensure_thumb(image_path)
    if thumb_path and thumb_path.is_file():
        return Response(
            content=thumb_path.read_bytes(),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # Fallback: generate in memory
    try:
        img = Image.open(image_path)
        img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        if img.mode == "RGBA":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return Response(
            content=buf.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception:
        return Response(status_code=500, content=b"Thumbnail generation failed")


# ---------------------------------------------------------------------------
# Full image
# ---------------------------------------------------------------------------

@router.get("/image")
async def gallery_image(tool: str = Query(...), date: str = Query(...), filename: str = Query(...)):
    if not _validate_segment(tool) or not _validate_segment(date):
        return {"error": "Invalid parameters", "image_b64": ""}
    if ".." in filename or "/" in filename or "\\" in filename:
        return {"error": "Invalid filename", "image_b64": ""}
    file_path = _save_root() / tool / date / filename
    if not file_path.is_file():
        return {"error": "File not found", "image_b64": ""}
    try:
        raw = file_path.read_bytes()
        b64 = base64.b64encode(raw).decode()

        meta = {}
        json_sidecar = file_path.with_suffix(".json")
        if json_sidecar.is_file():
            try:
                meta = json.loads(json_sidecar.read_text(encoding="utf-8"))
            except Exception:
                pass

        return {"image_b64": b64, "filename": filename, "meta": meta}
    except Exception as e:
        return {"error": str(e), "image_b64": ""}


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

class DeleteRequest(BaseModel):
    tool: str
    date: str
    filenames: list[str]


@router.post("/delete")
async def gallery_delete(body: DeleteRequest):
    if not _validate_segment(body.tool) or not _validate_segment(body.date):
        return {"ok": False, "deleted": 0, "error": "Invalid tool or date segment"}
    deleted = 0
    for fn in body.filenames:
        if ".." in fn or "/" in fn or "\\" in fn:
            continue
        fp = _save_root() / body.tool / body.date / fn
        if fp.is_file():
            fp.unlink(missing_ok=True)
            deleted += 1
            json_sidecar = fp.with_suffix(".json")
            if json_sidecar.is_file():
                json_sidecar.unlink(missing_ok=True)
            history_sidecar = fp.with_name(fp.stem + ".history.json")
            if history_sidecar.is_file():
                history_sidecar.unlink(missing_ok=True)
            thumb_dir = fp.parent / THUMB_DIR_NAME
            for ext in (".thumb.jpg", ".thumb.png", ".meta"):
                cached = thumb_dir / (fp.stem + ext)
                if cached.is_file():
                    cached.unlink(missing_ok=True)
    return {"ok": True, "deleted": deleted}


# ---------------------------------------------------------------------------
# Open folder
# ---------------------------------------------------------------------------

@router.post("/open-folder")
async def gallery_open_folder(tool: str = "", date: str = ""):
    if tool and not _validate_segment(tool):
        return {"ok": False, "error": "Invalid tool segment"}
    if date and not _validate_segment(date):
        return {"ok": False, "error": "Invalid date segment"}
    target = _save_root()
    if tool:
        target = target / tool
    if date:
        target = target / date
    if not target.is_dir():
        target = _save_root()
    try:
        if sys.platform == "win32":
            os.startfile(str(target))
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return {"ok": True, "path": str(target)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
