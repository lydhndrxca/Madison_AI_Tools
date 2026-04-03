"""Gemini / Multiview image generation routes."""

from __future__ import annotations

import asyncio
import io
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=16)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str
    mode: str = "quality"              # "quality" or "speed"
    aspect_ratio: str = "1:1"
    base_image_b64: Optional[str] = None
    ref_images_b64: Optional[dict[str, str]] = None
    model_id: Optional[str] = None
    style_guidance: Optional[str] = None


class GenerateResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class MultiviewGenerateRequest(BaseModel):
    prompt: str = ""                    # optional when base_image_b64 is set (image-driven views)
    dimension: str = "square"           # "square", "portrait", "landscape"
    mode: str = "quality"
    base_image_b64: Optional[str] = None
    views: Optional[list[str]] = None   # which views to generate (None = all)
    model_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DIM_TO_ASPECT = {
    "square": "1:1",
    "portrait": "9:16",
    "landscape": "16:9",
}

_VIEW_PROMPTS = {
    "threequarter": "Generate a 3/4 front-left view",
    "front": "Generate a front view",
    "back": "Generate a back view",
    "side": "Generate a side view (left profile)",
    "top": "Generate a top-down view",
    "bottom": "Generate a bottom-up view",
}


def _image_size_from_mode(mode: str) -> str:
    return "4K" if mode == "quality" else "1K"


def _do_generate(
    prompt: str,
    mode: str,
    aspect: str,
    base_b64: str | None,
    ref_b64s: dict[str, str] | None,
    model_id: str | None = None,
) -> GenerateResponse:
    api_key = core.get_api_key()
    if not api_key:
        return GenerateResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    contents: list = []
    if base_b64:
        contents.append(core.b64_to_image(base_b64))
    if ref_b64s:
        for label, b64 in ref_b64s.items():
            contents.append(core.b64_to_image(b64))
    contents.append(prompt)

    model_info = core.get_model_info(model_id)
    image_size = _image_size_from_mode(mode)

    try:
        if model_info["multimodal"]:
            result = core.gemini_generate_image(
                api_key, contents,
                aspect_ratio=aspect,
                image_size=image_size,
                cancel_event=cancel,
                model_id=model_id,
            )
        else:
            result = core.imagen_generate(
                api_key, prompt,
                aspect_ratio=aspect,
                image_size=image_size,
            )
    except RuntimeError as e:
        return GenerateResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return GenerateResponse(error="Generation failed — no image returned")

    tool = "Multiview" if "view" in prompt.lower() else "Gemini"
    core.save_generated_image(result, tool, generation_type="generate",
                              metadata={"prompt": prompt})

    return GenerateResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=GenerateResponse)
async def generate(body: GenerateRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating image..."})
    prompt = body.prompt
    if body.style_guidance:
        prompt = f"{prompt}\n\n--- Style Library Guidance ---\n{body.style_guidance}"
    result = await loop.run_in_executor(
        _pool,
        _do_generate,
        prompt,
        body.mode,
        body.aspect_ratio,
        body.base_image_b64,
        body.ref_images_b64,
        body.model_id,
    )
    await manager.broadcast("status", {"message": result.error or "Image generated"})
    return result


@router.post("/multiview/generate", response_model=GenerateResponse)
async def multiview_generate(body: GenerateRequest):
    """Generate a single multiview image (same as generate but with multiview aspect)."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _pool,
        _do_generate,
        body.prompt,
        body.mode,
        _DIM_TO_ASPECT.get(body.aspect_ratio, body.aspect_ratio),
        body.base_image_b64,
        body.ref_images_b64,
        body.model_id,
    )
    return result


class MultiviewAllResponse(BaseModel):
    images: dict[str, Optional[str]] = {}
    errors: dict[str, str] = {}


def _multiview_one_sync(
    api_key: str,
    view: str,
    prompt: str,
    aspect: str,
    image_size: str,
    base_image_b64: Optional[str],
    model_id: Optional[str],
    cancel,
) -> tuple[str, Optional[str], Optional[str], int, int]:
    """Sync worker: returns (view_key, image_b64 or None, error or None, width, height)."""
    view_prompt = _VIEW_PROMPTS.get(view, f"Generate a {view} view")
    user = (prompt or "").strip()
    if user:
        full_prompt = f"{user}\n\n{view_prompt} of the same subject on a plain background. Match the reference image when provided."
    else:
        # Image-only: analyze Main Stage reference, no user text required
        full_prompt = (
            "Analyze the reference image carefully. Recreate the same subject with matching proportions, "
            "materials, colors, and design intent.\n\n"
            f"{view_prompt} on a plain neutral studio background. Stay consistent with the reference."
        )
    contents: list = []
    # Decode a fresh image per view — reusing one PIL image across Gemini calls can break later views.
    if base_image_b64:
        contents.append(core.b64_to_image(base_image_b64))
    contents.append(full_prompt)
    try:
        result = core.gemini_generate_image(
            api_key, contents,
            aspect_ratio=aspect, image_size=image_size, cancel_event=cancel,
            model_id=model_id,
        )
        if result:
            meta_prompt = (prompt or "").strip() or "(image-only multiview)"
            core.save_generated_image(result, "Multiview", view_name=view,
                                      generation_type="multiview", metadata={"prompt": meta_prompt})
            return view, core.image_to_b64(result), None, result.width, result.height
        return view, None, "No image returned", 0, 0
    except RuntimeError as e:
        return view, None, str(e), 0, 0


@router.post("/multiview/generate-all", response_model=MultiviewAllResponse)
async def multiview_generate_all(body: MultiviewGenerateRequest):
    """Generate all (or selected) multiview angles."""
    api_key = core.get_api_key()
    if not api_key:
        return MultiviewAllResponse(errors={"_global": "No API key configured"})

    has_image = bool(body.base_image_b64 and str(body.base_image_b64).strip())
    has_text = bool(body.prompt and body.prompt.strip())
    if not has_image and not has_text:
        return MultiviewAllResponse(
            errors={"_global": "Add a reference image on Main Stage, or type a prompt (or both)."},
        )

    aspect = _DIM_TO_ASPECT.get(body.dimension, "1:1")
    image_size = _image_size_from_mode(body.mode)
    views = body.views or list(_VIEW_PROMPTS.keys())

    from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    results: dict[str, str | None] = {}
    errors: dict[str, str] = {}

    await manager.broadcast("status", {"message": f"Multiview: generating {len(views)} angle(s)..."})
    loop = asyncio.get_event_loop()
    try:
        for view in views:
            if cancel.is_set():
                errors[view] = "Cancelled"
                continue
            view_key, b64, err, iw, ih = await loop.run_in_executor(
                _pool,
                _multiview_one_sync,
                api_key,
                view,
                body.prompt,
                aspect,
                image_size,
                body.base_image_b64,
                body.model_id,
                cancel,
            )
            if b64:
                results[view_key] = b64
                await manager.broadcast("image", {"view": view_key, "width": iw, "height": ih})
            elif err:
                errors[view_key] = err
    finally:
        release_cancel_event(cancel)

    ok_count = sum(1 for v in results.values() if v)
    await manager.broadcast(
        "status",
        {"message": f"Multiview: {ok_count}/{len(views)} done" + (f" — errors: {len(errors)}" if errors else "")},
    )
    return MultiviewAllResponse(images=results, errors=errors)
