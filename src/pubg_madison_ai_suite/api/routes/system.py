"""System routes: health, API key, model selection, cancel, Photoshop integration."""

from __future__ import annotations

import base64
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core

router = APIRouter()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# API key management
# ---------------------------------------------------------------------------

class ApiKeyRequest(BaseModel):
    key: str


@router.get("/api-key")
async def get_api_key():
    key = core.get_api_key()
    masked = key[:4] + "..." + key[-4:] if len(key) > 8 else ("***" if key else "")
    return {"key_masked": masked, "has_key": bool(key)}


@router.post("/api-key")
async def set_api_key(body: ApiKeyRequest):
    core.set_api_key(body.key)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

@router.get("/models")
async def list_models():
    current = core.get_image_model()
    return {
        "models": core.IMAGE_MODELS,
        "current": current,
    }


class ModelRequest(BaseModel):
    model_id: str


@router.post("/model")
async def set_model(body: ModelRequest):
    core.set_image_model(body.model_id)
    return {"ok": True, "model_id": body.model_id}


@router.get("/model")
async def get_model():
    info = core.get_model_info()
    return info


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------

@router.post("/cancel")
async def cancel():
    from pubg_madison_ai_suite.api.cancel import cancel_all
    cancel_all()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Clear cache (temp files from PS sends, etc.)
# ---------------------------------------------------------------------------

@router.post("/clear-cache")
async def clear_cache():
    import shutil
    cleaned = 0
    temp_ps = Path(tempfile.gettempdir()) / "madison_ai_ps"
    if temp_ps.exists():
        shutil.rmtree(temp_ps, ignore_errors=True)
        cleaned += 1
    from pubg_madison_ai_suite.api.cancel import cancel_all
    cancel_all()
    return {"ok": True, "cleaned": cleaned}


# ---------------------------------------------------------------------------
# Save folder management
# ---------------------------------------------------------------------------

@router.get("/save-folder")
async def get_save_folder():
    return {"path": core.get_save_folder()}


class SaveFolderRequest(BaseModel):
    path: str


@router.post("/save-folder")
async def set_save_folder(body: SaveFolderRequest):
    resolved = core.set_save_folder(body.path)
    return {"ok": True, "path": resolved}


@router.post("/reset-save-folder")
async def reset_save_folder():
    resolved = core.reset_save_folder()
    return {"ok": True, "path": resolved}


# ---------------------------------------------------------------------------
# Photoshop integration
# ---------------------------------------------------------------------------

_PHOTOSHOP_SEARCH_PATHS = [
    Path(r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe"),
    Path(r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe"),
    Path(r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe"),
    Path(r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe"),
    Path(r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe"),
    Path(r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe"),
    Path(r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2026\Photoshop.exe"),
    Path(r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2025\Photoshop.exe"),
    Path(r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2024\Photoshop.exe"),
    Path(r"C:\Program Files (x86)\Adobe\Adobe Photoshop 2023\Photoshop.exe"),
]


def _find_photoshop() -> Optional[str]:
    for p in _PHOTOSHOP_SEARCH_PATHS:
        if p.exists():
            return str(p)
    return None


def _send_b64_to_ps(image_b64: str, label: str) -> dict:
    """Save a base64 image to temp and open it in Photoshop (or default editor)."""
    raw = image_b64.split(",", 1)[-1] if "," in image_b64 else image_b64
    img_bytes = base64.b64decode(raw)
    temp_dir = Path(tempfile.gettempdir()) / "madison_ai_ps"
    temp_dir.mkdir(exist_ok=True)
    filename = f"madison_{label}_{os.getpid()}.png"
    filepath = temp_dir / filename
    filepath.write_bytes(img_bytes)

    ps_exe = _find_photoshop()
    if ps_exe:
        subprocess.Popen([ps_exe, str(filepath)], shell=False)
        return {"ok": True, "message": f"Sent {label} to Photoshop", "path": str(filepath)}
    else:
        try:
            os.startfile(str(filepath))
            return {"ok": True, "message": f"Opened {label} with default image editor", "path": str(filepath)}
        except Exception as e:
            return {"ok": False, "message": f"Could not open {label}: {e}", "path": str(filepath)}


class SendToPsRequest(BaseModel):
    images: list[dict]  # each: {"label": str, "image_b64": str}


@router.post("/send-to-ps")
async def send_to_ps(body: SendToPsRequest):
    if not body.images:
        return {"ok": False, "message": "No images provided"}
    results = []
    for item in body.images:
        label = item.get("label", "image")
        b64 = item.get("image_b64", "")
        if not b64:
            results.append({"label": label, "ok": False, "message": "No image data"})
            continue
        result = _send_b64_to_ps(b64, label)
        results.append({"label": label, **result})
    all_ok = all(r.get("ok") for r in results)
    return {"ok": all_ok, "results": results}
