"""User Library API routes.

Personal reference library for organizing UI assets.
Each folder is a directory with images — no guidance text or trained subfolders.
"""

from __future__ import annotations

import base64
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
MAX_IMAGES_PER_FOLDER = 50
META_FILENAME = "meta.json"

_LIBRARY_DIR: Optional[Path] = None


def _lib_dir() -> Path:
    global _LIBRARY_DIR
    if _LIBRARY_DIR is None:
        _LIBRARY_DIR = Path(__file__).resolve().parents[4] / "USER_LIBRARY"
        _LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    return _LIBRARY_DIR


def _image_files(folder_path: Path) -> List[Path]:
    if not folder_path.is_dir():
        return []
    return sorted(
        f for f in folder_path.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED_EXTS
    )


def _read_meta(folder: str) -> Dict[str, Any]:
    meta_path = _lib_dir() / folder / META_FILENAME
    if meta_path.is_file():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    now = datetime.now(timezone.utc).isoformat()
    return {"name": folder, "created_at": now, "updated_at": now}


def _write_meta(folder: str, meta: Dict[str, Any]) -> None:
    folder_path = _lib_dir() / folder
    folder_path.mkdir(parents=True, exist_ok=True)
    meta_path = folder_path / META_FILENAME
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


def _get_thumbnail_b64(folder: str) -> Optional[str]:
    images = _image_files(_lib_dir() / folder)
    if not images:
        return None
    data = images[0].read_bytes()
    ext = images[0].suffix.lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "bmp": "image/bmp", "webp": "image/webp"}.get(ext.lstrip("."), "image/png")
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


# ── List all folders ──────────────────────────────────────────────

class FolderInfo(BaseModel):
    name: str
    image_count: int
    thumbnail: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


@router.get("/folders")
def list_folders() -> List[FolderInfo]:
    base = _lib_dir()
    if not base.is_dir():
        return []
    folders = sorted(
        d.name for d in base.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )
    result = []
    for name in folders:
        meta = _read_meta(name)
        count = len(_image_files(base / name))
        thumb = _get_thumbnail_b64(name)
        result.append(FolderInfo(
            name=name,
            image_count=count,
            thumbnail=thumb,
            created_at=meta.get("created_at", ""),
            updated_at=meta.get("updated_at", ""),
        ))
    return result


# ── Create folder ─────────────────────────────────────────────────

class CreateFolderReq(BaseModel):
    name: str


@router.post("/folders")
def create_folder(req: CreateFolderReq) -> FolderInfo:
    name = req.name.strip()
    folder = _lib_dir() / name
    folder.mkdir(parents=True, exist_ok=True)
    meta_path = folder / META_FILENAME
    if not meta_path.exists():
        now = datetime.now(timezone.utc).isoformat()
        _write_meta(name, {"name": name, "created_at": now, "updated_at": now})
    meta = _read_meta(name)
    return FolderInfo(
        name=name,
        image_count=0,
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
    )


# ── Delete folder ─────────────────────────────────────────────────

@router.delete("/folders/{folder_name}")
def delete_folder(folder_name: str) -> dict:
    folder = _lib_dir() / folder_name
    if folder.is_dir():
        shutil.rmtree(folder)
    return {"ok": True}


# ── Rename folder ─────────────────────────────────────────────────

class RenameFolderReq(BaseModel):
    new_name: str


@router.patch("/folders/{folder_name}")
def rename_folder(folder_name: str, req: RenameFolderReq) -> FolderInfo:
    old_path = _lib_dir() / folder_name
    new_name = req.new_name.strip()
    new_path = _lib_dir() / new_name
    if old_path.is_dir() and not new_path.exists():
        old_path.rename(new_path)
        meta = _read_meta(new_name)
        meta["name"] = new_name
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        _write_meta(new_name, meta)
    meta = _read_meta(new_name)
    count = len(_image_files(_lib_dir() / new_name))
    return FolderInfo(
        name=new_name,
        image_count=count,
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
    )


# ── List images in folder ─────────────────────────────────────────

class ImageInfo(BaseModel):
    filename: str
    data_url: str


@router.get("/folders/{folder_name}/images")
def list_images(folder_name: str) -> List[ImageInfo]:
    base = _lib_dir() / folder_name
    result = []
    for p in _image_files(base):
        data = p.read_bytes()
        ext = p.suffix.lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                "bmp": "image/bmp", "webp": "image/webp"}.get(ext, "image/png")
        data_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        result.append(ImageInfo(filename=p.name, data_url=data_url))
    return result


# ── Add images (base64 upload) ────────────────────────────────────

class AddImageReq(BaseModel):
    filename: str
    data_url: str


@router.post("/folders/{folder_name}/images")
def add_images(folder_name: str, images: List[AddImageReq]) -> dict:
    folder_path = _lib_dir() / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)
    current = _image_files(folder_path)
    remaining = MAX_IMAGES_PER_FOLDER - len(current)
    added = 0
    for img in images[:remaining]:
        header, _, b64data = img.data_url.partition(",")
        if not b64data:
            continue
        raw = base64.b64decode(b64data)
        fname = img.filename
        dst = folder_path / fname
        if dst.exists():
            stem = Path(fname).stem
            ext = Path(fname).suffix
            for i in range(1, 999):
                dst = folder_path / f"{stem}_{i}{ext}"
                if not dst.exists():
                    break
        dst.write_bytes(raw)
        added += 1
    return {"ok": True, "added": added}


# ── Remove image ──────────────────────────────────────────────────

@router.delete("/folders/{folder_name}/images/{filename}")
def remove_image(folder_name: str, filename: str) -> dict:
    path = _lib_dir() / folder_name / filename
    if path.is_file():
        path.unlink()
    return {"ok": True}
