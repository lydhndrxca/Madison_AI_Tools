"""Style Library API routes.

Manages a folder-based style library on disk.
Each style is a directory with meta.json + up to 16 reference images.
"""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=2)

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
MAX_IMAGES_PER_FOLDER = 16
META_FILENAME = "meta.json"

_LIBRARY_DIR: Optional[Path] = None


def _lib_dir() -> Path:
    global _LIBRARY_DIR
    if _LIBRARY_DIR is None:
        _LIBRARY_DIR = Path(__file__).resolve().parents[4] / "STYLE_LIBRARY"
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
    return {"name": folder, "guidance_text": "", "created_at": now, "updated_at": now}


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
    import base64 as b64mod
    data = images[0].read_bytes()
    ext = images[0].suffix.lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "bmp": "image/bmp", "webp": "image/webp"}.get(ext.lstrip("."), "image/png")
    return f"data:{mime};base64,{b64mod.b64encode(data).decode()}"


# ── List all folders ──────────────────────────────────────────────

class FolderInfo(BaseModel):
    name: str
    guidance_text: str
    image_count: int
    thumbnail: Optional[str] = None
    created_at: str
    updated_at: str
    category: str = "general"


@router.get("/folders")
def list_folders(category: Optional[str] = None) -> List[FolderInfo]:
    """List style folders, optionally filtered by category.

    category values: "general" (non-UI styles), "ui" (UI element styles), or None (all).
    """
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
        folder_cat = meta.get("category", "general")
        if category is not None:
            if category == "general" and folder_cat == "ui":
                continue
            if category == "ui" and folder_cat != "ui":
                continue
        count = len(_image_files(base / name))
        thumb = _get_thumbnail_b64(name)
        result.append(FolderInfo(
            name=name,
            guidance_text=meta.get("guidance_text", ""),
            image_count=count,
            thumbnail=thumb,
            created_at=meta.get("created_at", ""),
            updated_at=meta.get("updated_at", ""),
            category=folder_cat,
        ))
    return result


# ── Create folder ─────────────────────────────────────────────────

class CreateFolderReq(BaseModel):
    name: str
    category: str = "general"

@router.post("/folders")
def create_folder(req: CreateFolderReq) -> FolderInfo:
    name = req.name.strip()
    folder = _lib_dir() / name
    folder.mkdir(parents=True, exist_ok=True)
    meta_path = folder / META_FILENAME
    if not meta_path.exists():
        now = datetime.now(timezone.utc).isoformat()
        _write_meta(name, {
            "name": name,
            "guidance_text": "",
            "category": req.category,
            "created_at": now,
            "updated_at": now,
        })
    meta = _read_meta(name)
    return FolderInfo(
        name=name,
        guidance_text=meta.get("guidance_text", ""),
        image_count=0,
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
        category=meta.get("category", "general"),
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
        guidance_text=meta.get("guidance_text", ""),
        image_count=count,
        created_at=meta.get("created_at", ""),
        updated_at=meta.get("updated_at", ""),
        category=meta.get("category", "general"),
    )


# ── Update guidance text ──────────────────────────────────────────

class SetCategoryReq(BaseModel):
    category: str

@router.put("/folders/{folder_name}/category")
def set_category(folder_name: str, req: SetCategoryReq) -> dict:
    meta = _read_meta(folder_name)
    meta["category"] = req.category
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_meta(folder_name, meta)
    return {"ok": True}


class GuidanceReq(BaseModel):
    guidance_text: str

@router.put("/folders/{folder_name}/guidance")
def set_guidance(folder_name: str, req: GuidanceReq) -> dict:
    meta = _read_meta(folder_name)
    meta["guidance_text"] = req.guidance_text
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_meta(folder_name, meta)
    return {"ok": True}


# ── List images in folder ─────────────────────────────────────────

class ImageInfo(BaseModel):
    filename: str
    data_url: str
    disabled: bool = False


def _safe_segment(seg: str) -> bool:
    return ".." not in seg and "/" not in seg and "\\" not in seg and "\x00" not in seg and seg.strip() != ""


@router.get("/folders/{folder_name}/images")
def list_images(folder_name: str, subfolder: str = "") -> List[ImageInfo]:
    if not _safe_segment(folder_name) or (subfolder and not _safe_segment(subfolder)):
        return []
    base = _lib_dir() / folder_name
    if subfolder:
        base = base / subfolder
    meta = _read_meta(folder_name)
    disabled_bucket = meta.get("disabled_images", {})
    disabled_key = subfolder or "__root__"
    disabled_set = set(disabled_bucket.get(disabled_key, []))

    result = []
    for p in _image_files(base):
        data = p.read_bytes()
        ext = p.suffix.lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                "bmp": "image/bmp", "webp": "image/webp"}.get(ext, "image/png")
        data_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        result.append(ImageInfo(
            filename=p.name,
            data_url=data_url,
            disabled=p.name in disabled_set,
        ))
    return result


# ── List trained element subfolders ───────────────────────────────

@router.get("/folders/{folder_name}/subfolders")
def list_subfolders(folder_name: str) -> List[str]:
    folder_path = _lib_dir() / folder_name
    if not folder_path.is_dir():
        return []
    result = []
    for sub in sorted(folder_path.iterdir()):
        if sub.is_dir() and sub.name.endswith("_styles"):
            if _image_files(sub):
                result.append(sub.name)
    return result


# ── Add images (base64 upload) ────────────────────────────────────

class AddImageReq(BaseModel):
    filename: str
    data_url: str  # data:image/...;base64,...

@router.post("/folders/{folder_name}/images")
def add_images(folder_name: str, images: List[AddImageReq]) -> dict:
    if not _safe_segment(folder_name):
        return {"ok": False, "error": "Invalid folder name"}
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
def remove_image(folder_name: str, filename: str, subfolder: str = "") -> dict:
    if not _safe_segment(folder_name) or not _safe_segment(filename):
        return {"ok": False, "error": "Invalid name"}
    if subfolder and not _safe_segment(subfolder):
        return {"ok": False, "error": "Invalid subfolder"}
    base = _lib_dir() / folder_name
    if subfolder:
        base = base / subfolder
    path = base / filename
    if path.is_file():
        path.unlink()
    return {"ok": True}


# ── Toggle disabled state ─────────────────────────────────────────

class ToggleDisabledReq(BaseModel):
    filename: str
    subfolder: str = ""

@router.post("/folders/{folder_name}/toggle-disabled")
def toggle_disabled(folder_name: str, req: ToggleDisabledReq) -> dict:
    meta = _read_meta(folder_name)
    bucket = meta.setdefault("disabled_images", {})
    key = req.subfolder or "__root__"
    disabled = set(bucket.get(key, []))
    now_disabled = req.filename not in disabled
    if now_disabled:
        disabled.add(req.filename)
    else:
        disabled.discard(req.filename)
    bucket[key] = sorted(disabled)
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    _write_meta(folder_name, meta)
    return {"ok": True, "disabled": now_disabled}


# ── AI Describe style folder ─────────────────────────────────────

def _describe_style_folder(folder_name: str) -> dict:
    """Load images from a style library folder and ask Gemini to describe the visual style."""
    from PIL import Image as PILImage
    from pubg_madison_ai_suite.api import core

    api_key = core.get_api_key()
    if not api_key:
        return {"ok": False, "error": "No API key configured."}

    folder_path = _lib_dir() / folder_name
    if not folder_path.is_dir():
        return {"ok": False, "error": f"Folder '{folder_name}' not found."}

    meta = _read_meta(folder_name)
    disabled = set(meta.get("disabled_images", {}).get("__root__", []))
    image_paths = [p for p in _image_files(folder_path) if p.name not in disabled]

    if not image_paths:
        return {"ok": False, "error": "No images in this style folder."}

    contents: list = []
    contents.append(
        "You are an expert art director. I'm showing you reference images from a style library. "
        "Write a concise, vivid style description (2-4 sentences) that captures the unified visual "
        "aesthetic across all these images. Cover: rendering technique, color palette, texture quality, "
        "level of detail, mood/atmosphere, and any distinctive artistic traits. "
        "Write it as a directive — something I can paste into a generation prompt, e.g. "
        "'Render in a [style]: [details]...'\n\n"
        "Return ONLY the style description text, nothing else."
    )

    loaded = 0
    for p in image_paths[:8]:
        try:
            img = PILImage.open(p).convert("RGB")
            if max(img.size) > 512:
                ratio = 512 / max(img.size)
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), PILImage.Resampling.LANCZOS)
            contents.append(img)
            loaded += 1
        except Exception:
            continue

    if loaded == 0:
        return {"ok": False, "error": "Could not load any images from the folder."}

    contents.append("Now describe the unified visual style of these images:")

    try:
        description = core.rest_generate_text_multimodal(
            api_key,
            "gemini-2.5-flash",
            contents,
            timeout=60,
            cost_category="style_describe",
        )
        if not description:
            return {"ok": False, "error": "Gemini returned no description."}
        return {"ok": True, "description": description.strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/folders/{folder_name}/describe")
async def describe_folder_style(folder_name: str):
    """Have AI analyze all images in a style folder and generate a text description."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _describe_style_folder, folder_name)
