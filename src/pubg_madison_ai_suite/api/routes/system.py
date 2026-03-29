"""System routes: health, API key, model selection, cancel, Photoshop integration."""

from __future__ import annotations

import base64
import json
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

# ---------------------------------------------------------------------------
# Voice Director — function-calling command endpoint
# ---------------------------------------------------------------------------

class VoiceCommandRequest(BaseModel):
    audio_b64: str
    mime_type: str = "audio/webm"
    lang: str = "en-US"
    active_page: str = ""
    has_image: bool = False
    active_tab: str = "main"


_GLOBAL_TOOLS: list[dict] = [
    {
        "name": "navigate",
        "description": "Switch to a different tool page in the application.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "page": {
                    "type": "STRING",
                    "description": "Target page id",
                    "enum": ["character", "prop", "environment", "uilab", "gemini", "multiview", "weapon", "style-library", "generated-images", "favorites", "prompt-builder", "history"],
                }
            },
            "required": ["page"],
        },
    },
    {
        "name": "cancel",
        "description": "Cancel the currently running generation or operation.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "none",
        "description": "The user is not giving a command — they are thinking aloud, making a comment, or saying something unrelated to the tool. Use this when no action is needed.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "transcript": {"type": "STRING", "description": "What the user said"},
            },
        },
    },
]

_CHARACTER_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate a character image based on current settings.", "parameters": {"type": "OBJECT", "properties": {"description": {"type": "STRING", "description": "Optional override for the character description"}, "count": {"type": "INTEGER", "description": "Number of images to generate (1-5)"}}}},
    {"name": "edit_image", "description": "Apply an edit to the currently displayed image using a text prompt.", "parameters": {"type": "OBJECT", "properties": {"edit_prompt": {"type": "STRING", "description": "What to change in the image"}}, "required": ["edit_prompt"]}},
    {"name": "extract_attributes", "description": "Extract character attributes from the current image or description.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "enhance_description", "description": "Enhance and expand the current character description with more detail.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "randomize", "description": "Randomize all character fields to create a new random character.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "quick_generate", "description": "Randomize a character and immediately generate an image.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_all_views", "description": "Generate front, back, side, and 3/4 views of the character.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_selected_view", "description": "Generate only the currently selected view tab or a named view.", "parameters": {"type": "OBJECT", "properties": {"view": {"type": "STRING", "description": "View name: front, back, side, or 3/4"}}}},
    {"name": "set_field", "description": "Set a character form field to a specific value without generating.", "parameters": {"type": "OBJECT", "properties": {"field": {"type": "STRING", "description": "Field name: description, age, race, gender, or build"}, "value": {"type": "STRING", "description": "Value to set"}}, "required": ["field", "value"]}},
    {"name": "show_xml", "description": "Show the XML data for the current character.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "send_to_photoshop", "description": "Send the current image to Adobe Photoshop.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "save_image", "description": "Save the current image to disk.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "reset", "description": "Clear and reset the entire session.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_PROP_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate a prop image based on current settings.", "parameters": {"type": "OBJECT", "properties": {"description": {"type": "STRING", "description": "Optional override for the prop description"}}}},
    {"name": "extract_attributes", "description": "Extract prop attributes from the current image or description.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "enhance_description", "description": "Enhance the current prop description.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "randomize", "description": "Randomize all prop fields.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_all_views", "description": "Generate all views of the prop.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_selected_view", "description": "Generate only the currently selected view.", "parameters": {"type": "OBJECT", "properties": {"view": {"type": "STRING", "description": "View name"}}}},
    {"name": "set_field", "description": "Set a prop form field.", "parameters": {"type": "OBJECT", "properties": {"field": {"type": "STRING", "description": "Field: description, prop_name, prop_type, setting, condition, or scale"}, "value": {"type": "STRING", "description": "Value"}}, "required": ["field", "value"]}},
    {"name": "show_xml", "description": "Show XML data.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "send_to_photoshop", "description": "Send current image to Photoshop.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "save_image", "description": "Save current image.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "reset", "description": "Clear and reset session.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_ENV_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate an environment image based on current settings.", "parameters": {"type": "OBJECT", "properties": {"description": {"type": "STRING", "description": "Optional override for the environment description"}}}},
    {"name": "extract_attributes", "description": "Extract environment attributes.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "enhance_description", "description": "Enhance the current environment description.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "randomize", "description": "Randomize all environment fields.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "reimagine", "description": "Reimagine the environment from screenshots with a new style.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_all_views", "description": "Generate all environment views.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_selected_view", "description": "Generate only the selected view.", "parameters": {"type": "OBJECT", "properties": {"view": {"type": "STRING", "description": "View name"}}}},
    {"name": "set_field", "description": "Set an environment form field.", "parameters": {"type": "OBJECT", "properties": {"field": {"type": "STRING", "description": "Field: description, env_name, biome, game_context, time_of_day, season_weather, or env_scale"}, "value": {"type": "STRING", "description": "Value"}}, "required": ["field", "value"]}},
    {"name": "show_xml", "description": "Show XML data.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "send_to_photoshop", "description": "Send current image to Photoshop.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "save_image", "description": "Save current image.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "reset", "description": "Clear and reset session.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_UILAB_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate UI elements based on current settings.", "parameters": {"type": "OBJECT", "properties": {"prompt": {"type": "STRING", "description": "Optional prompt override"}, "element_type": {"type": "STRING", "description": "Element type: icon, button, panel, scrollbar, font, number, avatar, emote"}}}},
    {"name": "clear_gallery", "description": "Clear all generated results in the gallery.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "reset", "description": "Clear and reset session.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_GEMINI_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate an image from a prompt.", "parameters": {"type": "OBJECT", "properties": {"prompt": {"type": "STRING", "description": "Image description prompt"}}}},
]

_MULTIVIEW_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate an image from a prompt.", "parameters": {"type": "OBJECT", "properties": {"prompt": {"type": "STRING", "description": "Image description prompt"}}}},
    {"name": "generate_all_views", "description": "Generate all views at once.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_selected_view", "description": "Generate only the currently selected view.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_WEAPON_TOOLS: list[dict] = [
    {"name": "generate", "description": "Generate a weapon image.", "parameters": {"type": "OBJECT", "properties": {"description": {"type": "STRING", "description": "Optional weapon description override"}}}},
    {"name": "extract_attributes", "description": "Extract weapon attributes.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "enhance_description", "description": "Enhance the weapon description.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "generate_all_views", "description": "Generate all weapon views.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "send_to_photoshop", "description": "Send current image to Photoshop.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "save_image", "description": "Save current image.", "parameters": {"type": "OBJECT", "properties": {}}},
]

_EDITOR_TOOLS: list[dict] = [
    {"name": "inpaint", "description": "Edit or modify the current image using a text prompt. Use for changes like 'make the armor more weathered' or 'add a scar'.", "parameters": {"type": "OBJECT", "properties": {"prompt": {"type": "STRING", "description": "What to change or add in the image"}}, "required": ["prompt"]}},
    {"name": "remove_background", "description": "Remove the background from the current image.", "parameters": {"type": "OBJECT", "properties": {"replacement": {"type": "STRING", "description": "What to replace the background with (default: transparent)"}}}},
    {"name": "style_transfer", "description": "Apply an artistic style to the current image.", "parameters": {"type": "OBJECT", "properties": {"style": {"type": "STRING", "description": "Style to apply, e.g. 'oil painting', 'watercolor', 'pixel art', 'anime'"}}, "required": ["style"]}},
    {"name": "outpaint", "description": "Extend the canvas in a direction to show more of the scene.", "parameters": {"type": "OBJECT", "properties": {"direction": {"type": "STRING", "description": "Direction to extend: left, right, top, bottom, or all", "enum": ["left", "right", "top", "bottom", "all"]}, "prompt": {"type": "STRING", "description": "Optional description of what should fill the extended area"}}, "required": ["direction"]}},
    {"name": "smart_select", "description": "Select a specific object or region in the image by name.", "parameters": {"type": "OBJECT", "properties": {"subject": {"type": "STRING", "description": "What to select, e.g. 'the helmet', 'the left hand', 'the background'"}}, "required": ["subject"]}},
]

_PAGE_TOOLS: dict[str, list[dict]] = {
    "character": _CHARACTER_TOOLS,
    "prop": _PROP_TOOLS,
    "environment": _ENV_TOOLS,
    "uilab": _UILAB_TOOLS,
    "gemini": _GEMINI_TOOLS,
    "multiview": _MULTIVIEW_TOOLS,
    "weapon": _WEAPON_TOOLS,
}


@router.post("/voice-command")
async def voice_command(body: VoiceCommandRequest):
    api_key = core.get_api_key()
    if not api_key:
        return {"action": "none", "params": {}, "spoken_text": "", "error": "No API key configured"}

    try:
        audio_bytes = base64.b64decode(body.audio_b64)
    except Exception:
        return {"action": "none", "params": {}, "spoken_text": "", "error": "Invalid audio data"}

    tools = list(_GLOBAL_TOOLS)
    page_tools = _PAGE_TOOLS.get(body.active_page, [])
    tools.extend(page_tools)
    if body.has_image:
        tools.extend(_EDITOR_TOOLS)

    context = (
        f"You are a Voice Director for an AI concept art application. "
        f"The user is on the '{body.active_page}' tool page, viewing the '{body.active_tab}' tab. "
        f"{'An image is currently loaded.' if body.has_image else 'No image is loaded yet.'} "
        f"Listen to the audio and determine the user's intent. "
        f"Call the most appropriate function. If the user is just talking, thinking aloud, "
        f"or saying something that is not a command, call the 'none' function with a transcript."
    )

    audio_part = {
        "inlineData": {
            "mimeType": body.mime_type,
            "data": base64.b64encode(audio_bytes).decode() if isinstance(audio_bytes, bytes) else body.audio_b64,
        }
    }

    try:
        result = core.rest_generate_with_tools(
            api_key,
            "gemini-2.0-flash",
            [audio_part, context],
            tools,
            timeout=30,
        )
    except Exception as exc:
        return {"action": "none", "params": {}, "spoken_text": "", "error": str(exc)}

    if "functionCall" in result:
        fc = result["functionCall"]
        return {
            "action": fc.get("name", "none"),
            "params": fc.get("args", {}),
            "spoken_text": fc.get("args", {}).get("transcript", ""),
        }
    return {
        "action": "none",
        "params": {},
        "spoken_text": result.get("text", ""),
        "message": result.get("text", ""),
    }


# ---------------------------------------------------------------------------
# AI Review (Prompt Builder)
# ---------------------------------------------------------------------------

class AiReviewRequest(BaseModel):
    section_name: str = ""
    block_count: int = 0
    block_types: list[str] = []
    prompt_output: str = ""
    tools: list[str] = []


# ---------------------------------------------------------------------------
# User settings backup / restore
# ---------------------------------------------------------------------------

_BACKUP_PRIMARY = core.CONFIG_ROOT / "user_settings_backup.json"
_BACKUP_FALLBACK = Path.home() / ".madison_ai" / "settings_backup.json"


def _write_backup(data: dict) -> None:
    for p in (_BACKUP_PRIMARY, _BACKUP_FALLBACK):
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass


def _read_backup() -> dict | None:
    for p in (_BACKUP_PRIMARY, _BACKUP_FALLBACK):
        try:
            if p.is_file():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
    return None


class SettingsBackupRequest(BaseModel):
    data: dict


@router.get("/settings-backup")
async def get_settings_backup():
    backup = _read_backup()
    if backup is None:
        return {"ok": False, "data": {}}
    return {"ok": True, "data": backup}


@router.post("/settings-backup")
async def save_settings_backup(body: SettingsBackupRequest):
    try:
        _write_backup(body.data)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


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
            "You are reviewing a user-created sidebar panel for an AI concept art tool.\n"
            f"Panel name: {body.section_name}\n"
            f"Target tools: {', '.join(body.tools)}\n"
            f"Block count: {body.block_count}, types: {', '.join(body.block_types)}\n\n"
            f"The prompt text this panel produces:\n---\n{body.prompt_output}\n---\n\n"
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
