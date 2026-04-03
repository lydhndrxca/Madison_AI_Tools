"""Veo video generation routes.

Supports text-to-video and image-to-video via Google's Veo models
(Veo 3.1, 3.1 Fast, 3.1 Lite, 3.0, 3.0 Fast, 2.0).
Reference images (up to 3) and first+last frame interpolation on Veo 3.1.
"""

from __future__ import annotations

import asyncio
import base64
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from pubg_madison_ai_suite.api import core
from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()
_pool = ThreadPoolExecutor(max_workers=4)

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

VEO_MODELS = [
    {
        "id": "veo-3.1-generate-preview",
        "label": "Veo 3.1",
        "description": "Flagship — 4K, native audio, reference images, interpolation, video extension. Best quality, slowest.",
        "resolutions": ["720p", "1080p", "4k"],
        "durations": [4, 6, 8],
        "has_audio": True,
        "supports_refs": True,
        "supports_interpolation": True,
        "status": "Preview",
    },
    {
        "id": "veo-3.1-fast-generate-preview",
        "label": "Veo 3.1 Fast",
        "description": "Same quality tier as 3.1 at roughly half the latency. Up to 1080p. Refs + interpolation.",
        "resolutions": ["720p", "1080p"],
        "durations": [4, 6, 8],
        "has_audio": True,
        "supports_refs": True,
        "supports_interpolation": True,
        "status": "Preview",
    },
    {
        "id": "veo-3.1-lite-generate-preview",
        "label": "Veo 3.1 Lite",
        "description": "Most cost-effective — same speed as Fast at ~50% cost. Up to 1080p. Refs + interpolation.",
        "resolutions": ["720p", "1080p"],
        "durations": [4, 6, 8],
        "has_audio": True,
        "supports_refs": True,
        "supports_interpolation": True,
        "status": "Preview",
    },
    {
        "id": "veo-3.0-generate-001",
        "label": "Veo 3",
        "description": "Stable production model with native audio. 720p only. No refs or interpolation.",
        "resolutions": ["720p"],
        "durations": [4, 6, 8],
        "has_audio": True,
        "supports_refs": False,
        "supports_interpolation": False,
        "status": "Stable",
    },
    {
        "id": "veo-3.0-fast-generate-001",
        "label": "Veo 3 Fast",
        "description": "Faster stable variant of Veo 3. 720p only. No refs or interpolation.",
        "resolutions": ["720p"],
        "durations": [4, 6, 8],
        "has_audio": True,
        "supports_refs": False,
        "supports_interpolation": False,
        "status": "Stable",
    },
    {
        "id": "veo-2.0-generate-001",
        "label": "Veo 2",
        "description": "Previous generation — no audio, up to 2 videos per request. 5–8s clips. No refs.",
        "resolutions": [],
        "durations": [5, 6, 8],
        "has_audio": False,
        "supports_refs": False,
        "supports_interpolation": False,
        "status": "Stable",
    },
]

_VEO31_IDS = {m["id"] for m in VEO_MODELS if m.get("supports_refs")}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ReferenceImageSlot(BaseModel):
    image_b64: str
    description: str = ""


class GenerateVideoRequest(BaseModel):
    prompt: str
    model_id: str = "veo-3.1-generate-preview"
    aspect_ratio: str = "16:9"
    resolution: str = "720p"
    duration_seconds: int = 8
    image_b64: Optional[str] = None
    last_frame_b64: Optional[str] = None
    reference_images: Optional[list[ReferenceImageSlot]] = None
    style_guidance: Optional[str] = None


class VideoResult(BaseModel):
    video_b64: Optional[str] = None
    mime_type: str = "video/mp4"
    duration_seconds: int = 0
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_image_b64(raw: str) -> bytes:
    if "," in raw:
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


# ---------------------------------------------------------------------------
# Sync worker
# ---------------------------------------------------------------------------

def _do_generate_video(req: GenerateVideoRequest) -> VideoResult:
    api_key = core.get_api_key()
    if not api_key:
        return VideoResult(error="No API key configured. Set your Gemini key in Settings.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return VideoResult(error="google-genai SDK not installed. Run: pip install google-genai")

    client = genai.Client(api_key=api_key)

    model_info = next((m for m in VEO_MODELS if m["id"] == req.model_id), None)
    if not model_info:
        return VideoResult(error=f"Unknown model: {req.model_id}")

    has_image = bool(req.image_b64)
    has_refs = bool(req.reference_images and req.model_id in _VEO31_IDS)
    has_last_frame = bool(req.last_frame_b64 and req.model_id in _VEO31_IDS)

    duration = req.duration_seconds
    resolution = req.resolution

    # Enforce API constraints: 1080p/4k and reference images require 8s
    if resolution in ("1080p", "4k") or has_refs:
        duration = 8

    # Clamp duration to model's supported values
    supported_durations = model_info.get("durations", [8])
    if duration not in supported_durations:
        duration = supported_durations[-1]

    config_kwargs: dict = {
        "aspect_ratio": req.aspect_ratio,
        "duration_seconds": duration,
    }

    # person_generation: Veo 3.x text-only = allow_all (only valid option),
    # image/interpolation/refs = allow_adult (only valid option).
    # Veo 2 text = allow_all, image = allow_adult.
    if has_image or has_refs or has_last_frame:
        config_kwargs["person_generation"] = "allow_adult"
    else:
        config_kwargs["person_generation"] = "allow_all"

    # Only send resolution for models that support it
    supported_res = model_info.get("resolutions", [])
    if supported_res:
        if resolution in supported_res:
            config_kwargs["resolution"] = resolution
        else:
            config_kwargs["resolution"] = supported_res[0]

    # Reference images (Veo 3.1 only)
    if has_refs and req.reference_images:
        ref_list = []
        for slot in req.reference_images[:3]:
            if not slot.image_b64:
                continue
            img_bytes = _decode_image_b64(slot.image_b64)
            ref_list.append(types.VideoGenerationReferenceImage(
                image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
                reference_type="asset",
            ))
        if ref_list:
            config_kwargs["reference_images"] = ref_list

    # Last frame / interpolation (Veo 3.1 only)
    if has_last_frame and req.last_frame_b64:
        lf_bytes = _decode_image_b64(req.last_frame_b64)
        config_kwargs["last_frame"] = types.Image(image_bytes=lf_bytes, mime_type="image/png")

    # Build a debug summary (exclude binary blobs)
    debug_config = {k: v for k, v in config_kwargs.items()
                    if k not in ("reference_images", "last_frame")}
    debug_config["model"] = req.model_id
    debug_config["has_image"] = has_image
    debug_config["has_refs"] = has_refs
    debug_config["has_last_frame"] = has_last_frame

    config = types.GenerateVideosConfig(**config_kwargs)

    image_arg = None
    if req.image_b64:
        image_arg = types.Image(
            image_bytes=_decode_image_b64(req.image_b64),
            mime_type="image/png",
        )

    final_prompt = req.prompt
    if req.style_guidance:
        final_prompt = f"{req.prompt}\n\nStyle guidance: {req.style_guidance}"

    try:
        operation = client.models.generate_videos(
            model=req.model_id,
            prompt=final_prompt,
            image=image_arg,
            config=config,
        )

        max_wait = 600
        start = time.time()
        while not operation.done:
            if time.time() - start > max_wait:
                return VideoResult(error="Video generation timed out after 10 minutes.")
            time.sleep(5)
            operation = client.operations.get(operation)

        if not operation.response or not operation.response.generated_videos:
            return VideoResult(error="No video returned from Veo.")

        video_obj = operation.response.generated_videos[0]
        client.files.download(file=video_obj.video)

        video_bytes = video_obj.video.video_bytes
        if not video_bytes:
            return VideoResult(error="Video downloaded but bytes were empty.")

        video_b64 = base64.b64encode(video_bytes).decode("utf-8")
        _save_video(video_bytes, req)

        core.track_cost("veo_video", req.model_id, video_seconds=duration)

        return VideoResult(
            video_b64=video_b64,
            mime_type="video/mp4",
            duration_seconds=duration,
        )

    except Exception as e:
        return VideoResult(error=f"Veo generation failed: {e} | Config sent: {debug_config}")


def _save_video(data: bytes, req: GenerateVideoRequest) -> None:
    """Persist generated video to the gallery save root under Veo/<date>/."""
    import json as _json
    from datetime import datetime

    try:
        save_root = Path(core.get_save_folder())
        date_str = datetime.now().strftime("%Y-%m-%d")
        out_dir = save_root / "Veo" / date_str
        out_dir.mkdir(parents=True, exist_ok=True)

        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        uid = uuid.uuid4().hex[:8]
        video_path = out_dir / f"veo_{ts}_{uid}.mp4"
        video_path.write_bytes(data)

        meta = {
            "timestamp": datetime.now().isoformat(),
            "tool": "Veo",
            "generation_type": "video",
            "media_type": "video",
            "image_file": video_path.name,
            "model": req.model_id,
            "prompt": req.prompt,
            "aspect_ratio": req.aspect_ratio,
            "resolution": req.resolution,
            "duration": req.duration_seconds,
            "has_refs": bool(req.reference_images),
            "has_start_frame": bool(req.image_b64),
            "has_last_frame": bool(req.last_frame_b64),
        }
        meta_path = video_path.with_suffix(".json")
        meta_path.write_text(_json.dumps(meta, indent=2))

        # Generate thumbnail from first frame via ffmpeg
        try:
            import subprocess
            thumb_dir = out_dir / ".thumbs"
            thumb_dir.mkdir(exist_ok=True)
            thumb_file = thumb_dir / (video_path.stem + ".thumb.jpg")
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(video_path), "-vframes", "1",
                 "-vf", "scale=160:-1", str(thumb_file)],
                capture_output=True, timeout=10,
            )
        except Exception:
            pass
    except Exception as e:
        print(f"[Veo Save] Failed: {e}")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/models")
async def list_models():
    return {"models": VEO_MODELS}


@router.post("/generate", response_model=VideoResult)
async def generate_video(body: GenerateVideoRequest):
    loop = asyncio.get_event_loop()
    await manager.broadcast("status", {"message": f"Generating video with {body.model_id}..."})
    result = await loop.run_in_executor(_pool, _do_generate_video, body)
    await manager.broadcast("status", {"message": result.error or "Video generated"})
    return result


# ---------------------------------------------------------------------------
# Enhance prompt
# ---------------------------------------------------------------------------

class EnhancePromptRequest(BaseModel):
    prompt: str
    start_frame_b64: Optional[str] = None
    last_frame_b64: Optional[str] = None
    reference_images: Optional[list[str]] = None  # data-URLs or raw base64


class EnhancePromptResponse(BaseModel):
    prompt: Optional[str] = None
    error: Optional[str] = None


def _b64_to_pil(data: str):
    """Convert a data-URL or raw base64 string to a PIL Image."""
    from PIL import Image as PILImage
    import io

    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    img = PILImage.open(io.BytesIO(raw)).convert("RGB")
    if max(img.size) > 768:
        ratio = 768 / max(img.size)
        img = img.resize(
            (int(img.width * ratio), int(img.height * ratio)),
            PILImage.Resampling.LANCZOS,
        )
    return img


def _do_enhance_prompt(req: EnhancePromptRequest) -> EnhancePromptResponse:
    api_key = core.get_api_key()
    if not api_key:
        return EnhancePromptResponse(error="No API key configured.")
    try:
        instruction = (
            "You are an expert cinematographer and video prompt engineer for AI video generation. "
            "The user has written a video prompt. Enhance it to be more vivid and production-ready.\n\n"
            "Add specificity about:\n"
            "- Camera motion (tracking, dolly, crane, handheld, static)\n"
            "- Lighting and atmosphere (golden hour, overcast, neon, etc.)\n"
            "- Subject action and timing\n"
            "- Cinematic style and mood\n"
            "- Sound design hints (dialogue, ambient, music)\n\n"
            "Keep the same core concept. Return 3-5 sentences max. "
            "Return ONLY the enhanced prompt text, nothing else."
        )

        images: list = []
        labels: list[str] = []
        if req.start_frame_b64:
            try:
                images.append(_b64_to_pil(req.start_frame_b64))
                labels.append("Starting frame")
            except Exception:
                pass
        if req.last_frame_b64:
            try:
                images.append(_b64_to_pil(req.last_frame_b64))
                labels.append("Last frame (end)")
            except Exception:
                pass
        for i, ref_b64 in enumerate(req.reference_images or []):
            if ref_b64:
                try:
                    images.append(_b64_to_pil(ref_b64))
                    labels.append(f"Reference image {chr(65 + i)}")
                except Exception:
                    pass

        if images:
            contents: list = []
            contents.append(instruction + "\n\nThe user has attached reference images. "
                            "Use them to inform the enhanced prompt with visual details "
                            "(colors, composition, subjects, style, mood) you observe.")
            for lbl, img in zip(labels, images):
                contents.append(f"\n[{lbl}]:")
                contents.append(img)
            contents.append(f"\n\nOriginal prompt:\n{req.prompt}")
            result = core.rest_generate_text_multimodal(
                api_key, "gemini-2.5-flash", contents, timeout=30,
                cost_category="veo_enhance",
            )
        else:
            result = core.rest_generate_text(
                api_key, "gemini-2.5-flash",
                instruction + f"\n\nOriginal prompt:\n{req.prompt}",
                timeout=30,
                cost_category="veo_enhance",
            )

        if not result:
            return EnhancePromptResponse(error="No response from Gemini.")
        return EnhancePromptResponse(prompt=result.strip())
    except Exception as e:
        return EnhancePromptResponse(error=str(e))


@router.post("/enhance-prompt", response_model=EnhancePromptResponse)
async def enhance_prompt(body: EnhancePromptRequest):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_pool, _do_enhance_prompt, body)
