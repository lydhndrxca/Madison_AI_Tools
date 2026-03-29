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


# ---------------------------------------------------------------------------
# Voice transcription via Gemini
# ---------------------------------------------------------------------------

class TranscribeRequest(BaseModel):
    audio_b64: str
    mime_type: str = "audio/webm"
    lang: str = "en-US"
    context: str = ""


@router.post("/transcribe")
async def transcribe(body: TranscribeRequest):
    api_key = core.get_api_key()
    if not api_key:
        return {"text": "", "error": "No API key configured"}
    try:
        audio_part = {
            "inlineData": {
                "mimeType": body.mime_type,
                "data": body.audio_b64,
            }
        }
        lang_name = body.lang.split("-")[0] if body.lang else "en"

        context_hint = ""
        if body.context.strip():
            context_hint = (
                f"\nFor spelling/context clues only (do NOT repeat this), "
                f"the speaker was recently saying: \"{body.context.strip()}\"\n"
            )

        prompt = (
            f"You are a professional speech-to-text transcriber for {lang_name}.\n"
            f"{context_hint}"
            "Transcribe ONLY what you actually hear in the audio clip below.\n\n"
            "Rules:\n"
            "- Produce ONLY the transcribed text. No timestamps, no speaker labels, no commentary.\n"
            "- ONLY transcribe words that are actually spoken in the audio. Never guess, invent, or repeat previous context.\n"
            "- Clean up filler words (uh, um, like, you know) — remove them unless they carry meaning.\n"
            "- Remove false starts and repeated stutters (e.g. 'don't don't do' → 'don't do').\n"
            "- Fix obvious mishearings using surrounding context (e.g. 'are true' likely means 'our tool').\n"
            "- Preserve the speaker's intended meaning exactly — do not rephrase or summarize.\n"
            "- Use proper capitalization, punctuation, and natural sentence structure.\n"
            "- Proper nouns and technical terms should be spelled correctly when inferable from context.\n"
            "- If the audio is completely silent or fully unintelligible, return ONLY an empty string.\n"
            "- Do NOT add any preamble like 'Here is the transcription:' — output ONLY the text.\n"
            "- CRITICAL: Never output text from the context hint above. Only transcribe what is in the audio."
        )
        result = core.rest_generate_text_multimodal(
            api_key, "gemini-2.0-flash", [audio_part, prompt], timeout=30,
        )
        text = (result or "").strip()
        if text.lower().startswith("here is") or text.lower().startswith("the transcription"):
            first_newline = text.find("\n")
            if first_newline > 0:
                text = text[first_newline:].strip()
        return {"text": text}
    except Exception as e:
        return {"text": "", "error": str(e)}


# ---------------------------------------------------------------------------
# Photoshop integration
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# AI Review (Prompt Builder gut-check)
# ---------------------------------------------------------------------------

class AiReviewRequest(BaseModel):
    section_name: str = ""
    block_count: int = 0
    block_types: list[str] = []
    prompt_output: str = ""
    tools: list[str] = []


@router.post("/ai-review")
async def ai_review(body: AiReviewRequest):
    api_key = core.get_api_key()
    if not api_key:
        return {"text": "No API key configured — cannot perform AI review."}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        prompt = (
            "You are reviewing a user-created prompt section for an AI concept art tool.\n"
            f"Section name: {body.section_name}\n"
            f"Target tools: {', '.join(body.tools)}\n"
            f"Block count: {body.block_count}, types: {', '.join(body.block_types)}\n\n"
            f"The prompt text this section produces:\n---\n{body.prompt_output}\n---\n\n"
            "Give a brief, friendly gut-check (3-5 sentences):\n"
            "- Is the prompt clear and likely to produce good results?\n"
            "- Any suggestions for improvement?\n"
            "- Any potential issues (conflicting instructions, vague terms)?\n"
            "Keep it concise and constructive."
        )

        resp = model.generate_content(prompt)
        return {"text": resp.text}
    except Exception as exc:
        return {"text": f"AI review failed: {exc}"}
