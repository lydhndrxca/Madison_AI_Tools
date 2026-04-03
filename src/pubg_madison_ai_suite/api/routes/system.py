"""System routes: health, API key, model selection, cancel, Photoshop integration."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, UploadFile
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
# API cost tracking
# ---------------------------------------------------------------------------

@router.get("/api-costs")
async def get_api_costs():
    return core.get_cost_data()


@router.delete("/api-costs")
async def reset_api_costs():
    core.reset_cost_data()
    return {"ok": True}


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
# Extra API keys (Pexels, Pixabay, etc.)
# ---------------------------------------------------------------------------

_ALLOWED_EXTRA_KEYS = frozenset({
    "pexels_api_key", "pixabay_api_key",
    "meshy_api_key", "hitem3d_access_key", "hitem3d_secret_key",
})


class ExtraKeyRequest(BaseModel):
    name: str
    key: str


@router.get("/extra-keys")
async def get_extra_keys():
    """Return masked status for all optional API keys."""
    result = {}
    for name in _ALLOWED_EXTRA_KEYS:
        val = core.get_extra_key(name)
        masked = val[:4] + "..." + val[-4:] if len(val) > 8 else ("***" if val else "")
        result[name] = {"has_key": bool(val), "key_masked": masked}
    return result


@router.post("/extra-key")
async def set_extra_key(body: ExtraKeyRequest):
    if body.name not in _ALLOWED_EXTRA_KEYS:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": f"Key name '{body.name}' is not allowed. Allowed: {sorted(_ALLOWED_EXTRA_KEYS)}"})
    core.set_extra_key(body.name, body.key)
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
            "- IGNORE distant, faint, or background voices — only transcribe the primary close-mic speaker.\n"
            "- Do NOT add any preamble like 'Here is the transcription:' — output ONLY the text.\n"
            "- CRITICAL: Never output text from the context hint above. Only transcribe what is in the audio."
        )
        result = core.rest_generate_text_multimodal(
            api_key, "gemini-2.0-flash", [audio_part, prompt], timeout=30,
            cost_category="voice_transcription",
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


# ---------------------------------------------------------------------------
# User profile export / import
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parents[4]

_PROFILE_DIRS = {
    "style_library": _PROJECT_ROOT / "STYLE_LIBRARY",
    "user_library": _PROJECT_ROOT / "USER_LIBRARY",
    "artboard_library": _PROJECT_ROOT / "ARTBOARD_LIBRARY",
}


class ProfileExportRequest(BaseModel):
    settings: dict = {}


@router.post("/profile/export")
async def profile_export(body: ProfileExportRequest):
    """Bundle all libraries + settings into a ZIP and stream it back."""
    import io
    import platform
    import zipfile
    from datetime import datetime, timezone

    from fastapi.responses import StreamingResponse

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "machine": platform.node(),
            "contents": [],
        }

        if body.settings:
            settings_json = json.dumps(body.settings, ensure_ascii=False)
            zf.writestr("settings/localStorage.json", settings_json)
            manifest["contents"].append("settings")

        for dir_key, dir_path in _PROFILE_DIRS.items():
            if not dir_path.is_dir():
                continue
            file_count = 0
            for file_path in dir_path.rglob("*"):
                if not file_path.is_file():
                    continue
                arc_name = f"{dir_key}/{file_path.relative_to(dir_path).as_posix()}"
                zf.write(file_path, arc_name)
                file_count += 1
            if file_count > 0:
                manifest["contents"].append(dir_key)

        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    size = buf.seek(0, 2)
    buf.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"madison_profile_{ts}.madison-profile"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(size),
        },
    )



@router.post("/profile/import")
async def profile_import(file: UploadFile = File(...)):
    """Accept a profile ZIP, extract libraries to disk, return settings for localStorage."""
    import io
    import zipfile

    data = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile:
        return {"ok": False, "error": "Invalid profile file"}

    settings: dict = {}
    settings_path = "settings/localStorage.json"
    if settings_path in zf.namelist():
        try:
            settings = json.loads(zf.read(settings_path).decode("utf-8"))
        except Exception:
            pass

    for dir_key, dir_path in _PROFILE_DIRS.items():
        prefix = f"{dir_key}/"
        members = [n for n in zf.namelist() if n.startswith(prefix) and not n.endswith("/")]
        if not members:
            continue
        dir_path.mkdir(parents=True, exist_ok=True)
        for member in members:
            rel = member[len(prefix):]
            target = dir_path / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(member))

    zf.close()
    return {"ok": True, "settings": settings}


@router.post("/ai-review")
async def ai_review(body: AiReviewRequest):
    api_key = core.get_api_key()
    if not api_key:
        return {"text": "No API key configured — cannot perform AI review."}

    try:
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

        result = core.rest_generate_text(
            api_key, "gemini-2.0-flash", prompt, timeout=30,
            cost_category="prompt_review",
        )
        return {"text": result or "No response from AI."}
    except Exception as exc:
        return {"text": f"AI review failed: {exc}"}


# ---------------------------------------------------------------------------
# Bug Report
# ---------------------------------------------------------------------------

_BUG_REPORT_PATH = Path(os.environ.get("PUBG_SUITE_ROOT", Path(__file__).resolve().parents[4])) / "BUG_REPORT.md"


class BugReportEntry(BaseModel):
    description: str
    element: str = ""
    page: str = ""


@router.get("/bug-report")
async def get_bug_report():
    if _BUG_REPORT_PATH.exists():
        return {"content": _BUG_REPORT_PATH.read_text(encoding="utf-8")}
    return {"content": ""}


@router.post("/bug-report")
async def add_bug_report(entry: BugReportEntry):
    from datetime import datetime
    header = ""
    if not _BUG_REPORT_PATH.exists():
        header = "# Bug Report\n\nBugs filed from Debug Mode in Madison AI Suite.\n\n"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    location = f" (page: {entry.page}, element: {entry.element})" if entry.element or entry.page else ""
    block = (
        f"## [ ] Bug — {timestamp}{location}\n\n"
        f"{entry.description}\n\n---\n\n"
    )
    with open(_BUG_REPORT_PATH, "a", encoding="utf-8") as f:
        if header:
            f.write(header)
        f.write(block)
    return {"ok": True}
