"""Image editing endpoints: inpaint, smart-select, smart-erase, outpaint, remove-bg, style-transfer, history."""

from __future__ import annotations

import base64
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional, Any

from fastapi import APIRouter
from PIL import Image
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.cancel import reset_cancel_event, release_cancel_event

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class InpaintRequest(BaseModel):
    image_b64: str
    mask_composite_b64: str
    prompt: str = ""
    model_id: Optional[str] = None
    ref_images: list[str] = []
    style_context: str = ""

class SmartSelectRequest(BaseModel):
    image_b64: str
    subject: str
    model_id: Optional[str] = None

class SmartEraseRequest(BaseModel):
    image_b64: str
    mask_composite_b64: str
    model_id: Optional[str] = None
    ref_images: list[str] = []
    style_context: str = ""

class OutpaintRequest(BaseModel):
    image_b64: str
    direction: str = "right"
    expand_px: int = 256
    prompt: str = ""
    model_id: Optional[str] = None
    ref_images: list[str] = []
    style_context: str = ""

class RemoveBgRequest(BaseModel):
    image_b64: str
    replacement: str = ""

class StyleTransferRequest(BaseModel):
    image_b64: str
    style_preset: str = "oil"
    custom_prompt: str = ""
    model_id: Optional[str] = None
    ref_images: list[str] = []
    style_context: str = ""

class ImageResponse(BaseModel):
    image_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    error: Optional[str] = None

class SmartSelectResponse(BaseModel):
    mask_b64: Optional[str] = None
    width: int = 0
    height: int = 0
    # Legacy bounding-box fields (kept for compatibility)
    shape: str = "rect"
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")

def _ref_images(b64_list: list[str]) -> list[Any]:
    """Decode reference images for inclusion in Gemini contents."""
    refs = []
    for b64 in b64_list:
        if b64:
            try:
                refs.append(_decode(b64))
            except Exception:
                pass
    return refs

def _style_suffix(ctx: str) -> str:
    """Build a style instruction suffix from style context."""
    if not ctx or not ctx.strip():
        return ""
    return (
        f"\n\nIMPORTANT STYLE CONTEXT — the result must match the session's established visual style:\n{ctx.strip()}"
    )

def _respond(img: Image.Image | None, tool: str) -> ImageResponse:
    if img is None:
        return ImageResponse(error="Generation failed — no image returned")
    saved = core.save_generated_image(img, "Character Generator", generation_type=tool)
    return ImageResponse(image_b64=core.image_to_b64(img), width=img.width, height=img.height)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/inpaint", response_model=ImageResponse)
async def inpaint(req: InpaintRequest):
    cancel = reset_cancel_event()
    try:
        api_key = core.get_api_key()
        if not api_key:
            return ImageResponse(error="No API key configured")
        original = _decode(req.image_b64)
        composite = _decode(req.mask_composite_b64)
        prompt = (
            f"You are given two images. The first is the original. The second has areas painted in BRIGHT GREEN — "
            f"these are the regions to edit. {req.prompt or 'Seamlessly fill the green-highlighted areas to match the surrounding image.'}. "
            f"Return a single edited image that looks natural. Do not add text or labels."
            f"{_style_suffix(req.style_context)}"
        )
        refs = _ref_images(req.ref_images)
        contents: list = [original, composite] + refs + [prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        return _respond(result, "inpaint")
    finally:
        release_cancel_event(cancel)


@router.post("/smart-select", response_model=SmartSelectResponse)
async def smart_select(req: SmartSelectRequest):
    cancel = reset_cancel_event()
    try:
        api_key = core.get_api_key()
        if not api_key:
            return SmartSelectResponse(error="No API key configured")

        original = _decode(req.image_b64)
        w, h = original.size
        print(f"[SmartSelect] Generating mask for \"{req.subject}\" on {w}x{h} image")

        prompt = (
            f'Create a precise segmentation mask for "{req.subject}" in this image. '
            f"Return a single image that is a black and white mask — the EXACT same dimensions as the input. "
            f"White (pure #FFFFFF) pixels mark the selected region. Black (#000000) pixels mark everything else. "
            f"The mask must tightly follow the contours of the subject with pixel-level accuracy. "
            f"No grey, no antialiasing, no gradients — only pure black and pure white. "
            f"Do not add any text, labels, or annotations."
        )
        contents: list = [original, prompt]
        mask_img = core.gemini_generate_image(
            api_key, contents, cancel_event=cancel,
            model_id=req.model_id or "gemini-2.0-flash-exp-image-generation",
        )
        if mask_img is None:
            return SmartSelectResponse(error="Failed to generate selection mask")

        # Resize mask to match original if Gemini returned different dimensions
        if mask_img.size != (w, h):
            mask_img = mask_img.resize((w, h), Image.LANCZOS)

        # Threshold to pure black/white
        grey = mask_img.convert("L")
        bw = grey.point(lambda p: 255 if p > 128 else 0, mode="1").convert("L")

        mask_b64 = core.image_to_b64(bw, fmt="PNG")
        print(f"[SmartSelect] Mask generated: {bw.size[0]}x{bw.size[1]}")
        return SmartSelectResponse(
            mask_b64=mask_b64,
            width=bw.size[0],
            height=bw.size[1],
        )
    except Exception as e:
        print(f"[SmartSelect] Error: {e}")
        return SmartSelectResponse(error=str(e))
    finally:
        release_cancel_event(cancel)


@router.post("/smart-erase", response_model=ImageResponse)
async def smart_erase(req: SmartEraseRequest):
    cancel = reset_cancel_event()
    try:
        api_key = core.get_api_key()
        if not api_key:
            return ImageResponse(error="No API key configured")
        original = _decode(req.image_b64)
        composite = _decode(req.mask_composite_b64)
        prompt = (
            "You are given two images. The first is the original. The second has objects painted in BRIGHT GREEN. "
            "Remove the green-highlighted objects completely and seamlessly inpaint the area to match the surroundings. "
            "Return a single clean image with no text or labels."
            f"{_style_suffix(req.style_context)}"
        )
        refs = _ref_images(req.ref_images)
        contents: list = [original, composite] + refs + [prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        return _respond(result, "smart_erase")
    finally:
        release_cancel_event(cancel)


@router.post("/outpaint", response_model=ImageResponse)
async def outpaint(req: OutpaintRequest):
    cancel = reset_cancel_event()
    try:
        api_key = core.get_api_key()
        if not api_key:
            return ImageResponse(error="No API key configured")
        original = _decode(req.image_b64)
        w, h = original.size
        px = req.expand_px
        d = req.direction

        if d == "all":
            new_w, new_h = w + px * 2, h + px * 2
            offset = (px, px)
        elif d == "left":
            new_w, new_h = w + px, h
            offset = (px, 0)
        elif d == "right":
            new_w, new_h = w + px, h
            offset = (0, 0)
        elif d == "top":
            new_w, new_h = w, h + px
            offset = (0, px)
        elif d == "bottom":
            new_w, new_h = w, h + px
            offset = (0, 0)
        else:
            new_w, new_h = w + px, h
            offset = (0, 0)

        expanded = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 255))
        expanded.paste(original, offset)

        dir_label = {"left": "to the left", "right": "to the right", "top": "upward",
                     "bottom": "downward", "all": "in all directions"}.get(d, d)
        user_context = req.prompt.strip() if req.prompt else ""

        prompt = (
            f"I am giving you TWO images.\n\n"
            f"IMAGE 1 (first image): The original scene — this is the source of truth for lighting, "
            f"perspective, color palette, art style, and scene context.\n\n"
            f"IMAGE 2 (second image): The same scene placed on a larger canvas. The original content "
            f"is preserved exactly, and the new areas are filled with solid black.\n\n"
            f"YOUR TASK: Generate a SINGLE final image at the dimensions of Image 2 ({new_w}x{new_h}). "
            f"Keep the original scene content PIXEL-PERFECT — do not alter, recolor, crop, or distort it. "
            f"Fill the black regions {dir_label} with a NATURAL, SEAMLESS extension of the existing scene. "
            f"The extension must:\n"
            f"- Match the exact same lighting direction, intensity, and color temperature\n"
            f"- Continue the same perspective, vanishing points, and depth of field\n"
            f"- Extend surfaces, textures, and patterns that are cut off at the edges\n"
            f"- Feel like the camera simply captured a wider frame — NOT like something was pasted on\n"
        )
        if user_context:
            prompt += (
                f"\nThe user wants the extended area to include: {user_context}. "
                f"Integrate this into the scene naturally — it must look like it belongs in the same "
                f"world, same moment, same photograph. Match the rendering style exactly.\n"
            )
        prompt += (
            f"\nReturn ONE image. No text, no labels, no borders, no artifacts at the seam."
            f"{_style_suffix(req.style_context)}"
        )

        refs = _ref_images(req.ref_images)
        contents: list = [original, expanded] + refs + [prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        return _respond(result, "outpaint")
    finally:
        release_cancel_event(cancel)


@router.post("/remove-bg", response_model=ImageResponse)
async def remove_bg(req: RemoveBgRequest):
    if not req.image_b64:
        return ImageResponse(error="No image provided")
    try:
        img_bytes = base64.b64decode(req.image_b64)
    except Exception as e:
        return ImageResponse(error=f"Invalid image data: {e}")

    # Try rembg first (local, fast, produces true transparency)
    try:
        from rembg import remove as rembg_remove
        print("[RemoveBG] Using rembg (local)...")
        result_bytes = rembg_remove(img_bytes)
        result = Image.open(io.BytesIO(result_bytes)).convert("RGBA")

        # Hard-threshold alpha to eliminate soft falloff
        import numpy as np
        arr = np.array(result)
        alpha = arr[:, :, 3]
        alpha = np.where(alpha > 128, 255, 0).astype(np.uint8)
        arr[:, :, 3] = alpha
        result = Image.fromarray(arr, "RGBA")

        print(f"[RemoveBG] Success: {result.width}x{result.height}")
        return _respond(result, "remove_bg")
    except ImportError:
        print("[RemoveBG] rembg not installed, falling back to Gemini API")
    except Exception as e:
        print(f"[RemoveBG] rembg failed: {e}, falling back to Gemini API")

    # Gemini API fallback
    try:
        api_key = core.get_api_key()
        if not api_key:
            return ImageResponse(error="rembg failed and no API key configured for fallback")
        original = _decode(req.image_b64)
        replacement = req.replacement or "a solid flat white background"
        prompt = (
            f"Remove the background from the subject in this image and replace it with {replacement}. "
            f"Keep the subject exactly as-is — do not change, crop, or modify it. Return a single image."
        )
        contents: list = [original, prompt]
        result = core.gemini_generate_image(api_key, contents)
        if result is None:
            return ImageResponse(error="Background removal failed — Gemini returned no image")
        return _respond(result, "remove_bg")
    except Exception as e:
        return ImageResponse(error=f"Background removal failed: {e}")


class SaveHistoryRequest(BaseModel):
    image_path: str
    history_json: str

class LoadHistoryRequest(BaseModel):
    image_path: str


@router.post("/save-history")
async def save_history(req: SaveHistoryRequest):
    try:
        p = Path(req.image_path)
        if not p.exists():
            return {"ok": False, "error": "Image file not found"}
        hist_path = p.with_suffix(".history.json")
        hist_path.write_text(req.history_json, encoding="utf-8")
        return {"ok": True, "path": str(hist_path)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/load-history")
async def load_history(req: LoadHistoryRequest):
    try:
        p = Path(req.image_path)
        hist_path = p.with_suffix(".history.json")
        if not hist_path.exists():
            return {"found": False, "history": None}
        data = json.loads(hist_path.read_text(encoding="utf-8"))
        return {"found": True, "history": data}
    except Exception as e:
        return {"found": False, "error": str(e)}


@router.post("/style-transfer", response_model=ImageResponse)
async def style_transfer(req: StyleTransferRequest):
    cancel = reset_cancel_event()
    try:
        api_key = core.get_api_key()
        if not api_key:
            return ImageResponse(error="No API key configured")
        original = _decode(req.image_b64)
        style_desc = req.custom_prompt or req.style_preset
        prompt = (
            f"Transform this image into the following visual style: {style_desc}. "
            f"Maintain the exact same composition, pose, and subject placement. "
            f"Only change the visual rendering style. Return a single image, no text."
            f"{_style_suffix(req.style_context)}"
        )
        refs = _ref_images(req.ref_images)
        contents: list = [original] + refs + [prompt]
        result = core.gemini_generate_image(api_key, contents, cancel_event=cancel, model_id=req.model_id)
        return _respond(result, "style_transfer")
    finally:
        release_cancel_event(cancel)
