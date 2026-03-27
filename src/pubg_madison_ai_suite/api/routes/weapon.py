"""Weapon Generator API routes."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class WeaponGenerateRequest(BaseModel):
    prompt: str
    weapon_name: str = ""
    components: Optional[dict[str, str]] = None
    material_finish: str = ""
    condition: str = ""
    view_type: str = "main"
    reference_image_b64: Optional[str] = None
    edit_prompt: Optional[str] = None
    ref_images_b64: Optional[dict[str, str]] = None
    mode: str = "quality"
    model_id: Optional[str] = None


class WeaponResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None


class WeaponTextRequest(BaseModel):
    prompt: str
    image_b64: Optional[str] = None


class WeaponTextResponse(BaseModel):
    text: Optional[str] = None
    error: Optional[str] = None


class WeaponMultiviewRequest(BaseModel):
    prompt: str
    views: Optional[list[str]] = None
    reference_image_b64: Optional[str] = None
    mode: str = "quality"


class WeaponMultiviewResponse(BaseModel):
    images: dict[str, Optional[str]] = {}
    errors: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

_VIEW_PROMPTS = {
    "threequarter": "3/4 front-left angle",
    "front": "front profile",
    "back": "back profile",
    "side": "left side profile",
    "top": "top-down view",
    "bottom": "bottom-up view",
}


def _build_weapon_prompt(req: WeaponGenerateRequest) -> str:
    parts = []
    if req.weapon_name:
        parts.append(f"Weapon: {req.weapon_name}")
    if req.components:
        comp_lines = [f"  {k}: {v}" for k, v in req.components.items() if v]
        if comp_lines:
            parts.append("Components:\n" + "\n".join(comp_lines))
    if req.material_finish:
        parts.append(f"Material/Finish: {req.material_finish}")
    if req.condition:
        parts.append(f"Condition: {req.condition}")
    header = "\n".join(parts)
    if header:
        return f"{header}\n\n{req.prompt}"
    return req.prompt


# ---------------------------------------------------------------------------
# Sync workers
# ---------------------------------------------------------------------------

def _do_generate(req: WeaponGenerateRequest) -> WeaponResponse:
    api_key = core.get_api_key()
    if not api_key:
        return WeaponResponse(error="No API key configured")

    from pubg_madison_ai_suite.api.server import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    prompt = _build_weapon_prompt(req)
    aspect = "16:9"
    image_size = "4K" if req.mode == "quality" else "1K"

    contents: list = []

    if req.reference_image_b64:
        contents.append(core.b64_to_image(req.reference_image_b64))
    if req.ref_images_b64:
        for label, b64 in req.ref_images_b64.items():
            if b64:
                contents.append(core.b64_to_image(b64))

    if req.edit_prompt and req.reference_image_b64:
        contents.append(f"{prompt}\n\nApply these modifications: {req.edit_prompt}")
    elif req.view_type != "main" and req.reference_image_b64:
        view_label = _VIEW_PROMPTS.get(req.view_type, req.view_type)
        contents.append(
            f"Using the reference weapon image, generate a {view_label} of this weapon:\n{prompt}"
        )
    else:
        contents.append(
            f"Generate a detailed weapon concept art on a plain background:\n{prompt}"
        )

    model_info = core.get_model_info(req.model_id)

    try:
        if model_info["multimodal"]:
            result = core.gemini_generate_image(
                api_key, contents,
                aspect_ratio=aspect, image_size=image_size, cancel_event=cancel,
                model_id=req.model_id,
            )
        else:
            text_prompt = contents[-1] if isinstance(contents[-1], str) else prompt
            result = core.imagen_generate(
                api_key, text_prompt,
                aspect_ratio=aspect, image_size=image_size,
            )
    except RuntimeError as e:
        return WeaponResponse(error=str(e))
    finally:
        release_cancel_event(cancel)

    if result is None:
        return WeaponResponse(error="Generation failed")

    gen_type = "edit" if req.edit_prompt else "generate"
    core.save_generated_image(
        result, "Weapon Generator", view_name=req.view_type,
        generation_type=gen_type,
        metadata={"prompt": req.prompt, "weapon_name": req.weapon_name,
                  "material_finish": req.material_finish, "condition": req.condition},
    )

    return WeaponResponse(
        image_b64=core.image_to_b64(result),
        width=result.width,
        height=result.height,
    )


def _do_text_ai(prompt: str, image_b64: str | None) -> WeaponTextResponse:
    api_key = core.get_api_key()
    if not api_key:
        return WeaponTextResponse(error="No API key")

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-pro")
        parts: list = []
        if image_b64:
            parts.append(core.b64_to_image(image_b64))
        parts.append(prompt)
        resp = model.generate_content(parts)
        return WeaponTextResponse(text=resp.text)
    except Exception as e:
        return WeaponTextResponse(error=str(e))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=WeaponResponse)
async def generate(body: WeaponGenerateRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Generating weapon..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Weapon generated"})
    return result


@router.post("/edit", response_model=WeaponResponse)
async def edit(body: WeaponGenerateRequest):
    if not body.edit_prompt:
        return WeaponResponse(error="edit_prompt required")
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": "Applying weapon edits..."})
    result = await loop.run_in_executor(_pool, _do_generate, body)
    await manager.broadcast("status", {"message": result.error or "Edit applied"})
    return result


@router.post("/extract-attributes", response_model=WeaponTextResponse)
async def extract_attributes(body: WeaponTextRequest):
    prompt = (
        "Analyze this weapon image. List each component (Receiver, Barrel, Stock, Grip, "
        "Magazine, Optic, Muzzle, Markings) on its own line with a brief description. "
        "Then add DESCRIPTION: followed by a full description of the weapon."
    )
    if body.image_b64:
        prompt = f"{prompt}"
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_text_ai, prompt, body.image_b64)


@router.post("/enhance", response_model=WeaponTextResponse)
async def enhance(body: WeaponTextRequest):
    prompt = (
        f"Enhance and expand this weapon description with specific tactical details, "
        f"materials, and visual characteristics:\n\n{body.prompt}"
    )
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_text_ai, prompt, None)


@router.post("/multiview/generate-all", response_model=WeaponMultiviewResponse)
async def multiview_generate_all(body: WeaponMultiviewRequest):
    api_key = core.get_api_key()
    if not api_key:
        return WeaponMultiviewResponse(errors={"_global": "No API key"})

    from pubg_madison_ai_suite.api.server import reset_cancel_event, release_cancel_event
    cancel = reset_cancel_event()

    image_size = "4K" if body.mode == "quality" else "1K"
    views = body.views or list(_VIEW_PROMPTS.keys())
    base_img = core.b64_to_image(body.reference_image_b64) if body.reference_image_b64 else None

    results: dict[str, str | None] = {}
    errors: dict[str, str] = {}

    try:
        for view in views:
            if cancel.is_set():
                errors[view] = "Cancelled"
                continue

            view_desc = _VIEW_PROMPTS.get(view, view)
            full_prompt = f"{body.prompt}\n\nGenerate a {view_desc} of the weapon on a plain background."
            contents: list = []
            if base_img:
                contents.append(base_img)
            contents.append(full_prompt)

            try:
                result = core.gemini_generate_image(
                    api_key, contents,
                    aspect_ratio="16:9", image_size=image_size, cancel_event=cancel,
                )
                if result:
                    core.save_generated_image(result, "Weapon Generator", view_name=view,
                                              generation_type="multiview", metadata={"prompt": body.prompt})
                    results[view] = core.image_to_b64(result)
                    await manager.broadcast("image", {"view": view, "width": result.width, "height": result.height})
                else:
                    errors[view] = "No image returned"
            except RuntimeError as e:
                errors[view] = str(e)
    finally:
        release_cancel_event(cancel)

    return WeaponMultiviewResponse(images=results, errors=errors)
