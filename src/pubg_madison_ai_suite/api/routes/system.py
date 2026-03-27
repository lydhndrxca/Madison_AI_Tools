"""System routes: health, API key, model selection, cancel."""

from __future__ import annotations

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
    from pubg_madison_ai_suite.api.server import cancel_all
    cancel_all()
    return {"ok": True}
