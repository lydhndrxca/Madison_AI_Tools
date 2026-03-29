"""Shared image generation core extracted from the tool modules.

This avoids duplicating _rest_generate / fallback logic across three files.
The original tool code still works standalone; this module is used by the API layer.
"""

from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path
from threading import Event
from typing import Any, Optional

import requests
from PIL import Image


# ---------------------------------------------------------------------------
# Model registry (mirrors suite.py IMAGE_MODELS)
# ---------------------------------------------------------------------------

IMAGE_MODELS = [
    {
        "id": "gemini-3-pro-image-preview",
        "label": "Nano Banana Pro",
        "resolution": "4K — 2048sq / 5504x3072 / 3072x5504",
        "time_estimate": "~40-90s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": True,
        "description": "Studio-quality, complex layouts, precise text rendering",
    },
    {
        "id": "gemini-3.1-flash-image-preview",
        "label": "Nano Banana 2",
        "resolution": "4K — 2048sq / 5504x3072 / 3072x5504",
        "time_estimate": "~20-60s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": True,
        "description": "High-volume, fast iteration, image search grounding",
    },
    {
        "id": "gemini-2.5-flash-image",
        "label": "Gemini 2.5 Flash",
        "resolution": "1K — 1024sq / 1408x768 / 768x1408",
        "time_estimate": "~3-8s",
        "multimodal": True,
        "api": "genai",
        "supports_4k": False,
        "description": "Quick drafts, rapid iteration, lowest latency",
    },
    {
        "id": "imagen-4.0-ultra-generate-001",
        "label": "Imagen 4 Ultra",
        "resolution": "2K — 2048sq / 2816x1536 / 1536x2816",
        "time_estimate": "~15-30s",
        "multimodal": False,
        "api": "imagen",
        "supports_4k": False,
        "description": "Maximum fidelity, photorealistic output",
    },
    {
        "id": "imagen-4.0-generate-001",
        "label": "Imagen 4 Standard",
        "resolution": "2K — 2048sq / 2816x1536 / 1536x2816",
        "time_estimate": "~5-10s",
        "multimodal": False,
        "api": "imagen",
        "supports_4k": False,
        "description": "Balanced quality and speed",
    },
    {
        "id": "imagen-4.0-fast-generate-001",
        "label": "Imagen 4 Fast",
        "resolution": "1K — 1024sq / 1408x768 / 768x1408",
        "time_estimate": "~2-5s",
        "multimodal": False,
        "api": "imagen",
        "supports_4k": False,
        "description": "Rapid prototyping, fastest Imagen",
    },
]

DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview"

# Project-local config (same location the old Tkinter app uses)
_PACKAGE_DIR = Path(__file__).resolve().parent.parent  # pubg_madison_ai_suite/
_PROJECT_ROOT = _PACKAGE_DIR.parents[1]                # c:\Dev\Madison_AI_Tools
CONFIG_ROOT = _PROJECT_ROOT / "config"


def _keys_path() -> Path:
    """Return the keys.json path, checking project-local first."""
    local = CONFIG_ROOT / "keys.json"
    if local.exists():
        return local
    home_cfg = Path.home() / ".madison_ai" / "keys.json"
    if home_cfg.exists():
        return home_cfg
    return local  # default to project-local for writes


def _read_keys_data() -> dict:
    import json
    kp = _keys_path()
    if kp.exists():
        try:
            return json.loads(kp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# ---------------------------------------------------------------------------
# Key / model helpers
# ---------------------------------------------------------------------------

def get_api_key() -> str:
    for env_var in ["GEMINI_API_KEY", "GOOGLE_API_KEY", "PUBG_API_KEY"]:
        key = os.environ.get(env_var, "").strip()
        if key:
            return key
    data = _read_keys_data()
    for field in ["gemini_api_key", "google_api_key", "api_key", "default"]:
        val = data.get(field, "")
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def set_api_key(key: str) -> None:
    os.environ["GEMINI_API_KEY"] = key
    os.environ["GOOGLE_API_KEY"] = key
    import json
    kp = CONFIG_ROOT / "keys.json"
    kp.parent.mkdir(parents=True, exist_ok=True)
    data = _read_keys_data()
    data["gemini_api_key"] = key
    kp.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_image_model() -> str:
    val = os.environ.get("PUBG_IMAGE_MODEL", "").strip()
    if val:
        return val
    data = _read_keys_data()
    return data.get("image_model", DEFAULT_IMAGE_MODEL)


def set_image_model(model_id: str) -> None:
    os.environ["PUBG_IMAGE_MODEL"] = model_id
    import json
    kp = CONFIG_ROOT / "keys.json"
    kp.parent.mkdir(parents=True, exist_ok=True)
    data = _read_keys_data()
    data["image_model"] = model_id
    kp.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_model_info(model_id: str | None = None) -> dict:
    if model_id is None:
        model_id = get_image_model()
    for m in IMAGE_MODELS:
        if m["id"] == model_id:
            return m
    return IMAGE_MODELS[0]


# ---------------------------------------------------------------------------
# Image encoding / decoding
# ---------------------------------------------------------------------------

def image_to_b64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_image(data: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data)))


def image_to_inline_data(img: Image.Image) -> dict:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {
        "inlineData": {
            "mimeType": "image/png",
            "data": base64.b64encode(buf.getvalue()).decode(),
        }
    }


# ---------------------------------------------------------------------------
# REST-based Gemini text/JSON generation (no SDK, avoids _rust DLL issues)
# ---------------------------------------------------------------------------

def rest_generate_json(
    api_key: str,
    model_name: str,
    contents_raw: list,
    timeout: int = 120,
    cancel_event: Event | None = None,
) -> dict | None:
    """REST call to Gemini that returns parsed JSON text (no image output)."""
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    parts: list[dict] = []
    for item in contents_raw:
        if isinstance(item, str):
            parts.append({"text": item})
        elif isinstance(item, Image.Image):
            parts.append(image_to_inline_data(item))
        elif isinstance(item, dict) and "mime_type" in item and "data" in item:
            parts.append({"inlineData": {
                "mimeType": item["mime_type"],
                "data": base64.b64encode(item["data"]).decode() if isinstance(item["data"], bytes) else item["data"],
            }})
        elif isinstance(item, dict):
            parts.append(item)

    body: dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
        },
    }

    resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "text" in part:
                import json as _json
                try:
                    parsed = _json.loads(part["text"])
                except (ValueError, _json.JSONDecodeError):
                    print(f"[rest_generate_json] Non-JSON response text: {part['text'][:200]}")
                    return None
                if isinstance(parsed, list):
                    return parsed[0] if parsed else {}
                return parsed
    return None


def rest_generate_text(
    api_key: str,
    model_name: str,
    prompt: str,
    timeout: int = 120,
    cancel_event: Event | None = None,
) -> str | None:
    """REST call to Gemini that returns plain text (no SDK)."""
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    body: dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
    }

    resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "text" in part:
                return part["text"]
    return None


def rest_generate_text_multimodal(
    api_key: str,
    model_name: str,
    contents_raw: list,
    timeout: int = 120,
    cancel_event: Event | None = None,
) -> str | None:
    """REST call to Gemini with mixed content (images + text) returning plain text."""
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    parts: list[dict] = []
    for item in contents_raw:
        if isinstance(item, str):
            parts.append({"text": item})
        elif isinstance(item, Image.Image):
            parts.append(image_to_inline_data(item))
        elif isinstance(item, dict):
            parts.append(item)

    body: dict[str, Any] = {
        "contents": [{"parts": parts}],
    }

    resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled by user")
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "text" in part:
                return part["text"]
    return None


# ---------------------------------------------------------------------------
# REST-based Gemini image generation (extracted & unified)
# ---------------------------------------------------------------------------

def rest_generate(
    api_key: str,
    model_name: str,
    contents_raw: list,
    gen_config: dict,
    timeout: int = 180,
    max_retries: int = 2,
    cancel_event: Event | None = None,
) -> Image.Image | None:
    """Direct REST call to Gemini generateContent with retry and cancel."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    parts: list[dict] = []
    for item in contents_raw:
        if isinstance(item, str):
            parts.append({"text": item})
        elif isinstance(item, Image.Image):
            parts.append(image_to_inline_data(item))
        elif isinstance(item, dict):
            parts.append(item)

    body: dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": gen_config,
    }

    for attempt in range(max_retries + 1):
        if cancel_event and cancel_event.is_set():
            raise RuntimeError("Cancelled by user")
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                data = resp.json()
                for cand in data.get("candidates", []):
                    for part in cand.get("content", {}).get("parts", []):
                        if "inlineData" in part:
                            img_bytes = base64.b64decode(part["inlineData"]["data"])
                            return Image.open(io.BytesIO(img_bytes)).convert("RGBA")
                return None
            if resp.status_code in (500, 503) and attempt < max_retries:
                time.sleep(5)
                continue
            print(f"[REST] {model_name} returned {resp.status_code}: {resp.text[:200]}")
            return None
        except requests.Timeout:
            if attempt < max_retries:
                time.sleep(3)
                continue
            return None
        except RuntimeError:
            raise
        except Exception as e:
            print(f"[REST] {model_name} error: {e}")
            return None
    return None


# ---------------------------------------------------------------------------
# High-level generate with model / resolution fallback
# ---------------------------------------------------------------------------

_4K_MODELS = {"gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"}
_SIZE_CHAIN_4K = ["4K", "2K", "1K", None]
_SIZE_CHAIN_1K = ["1K", None]


def gemini_generate_image(
    api_key: str,
    contents: list,
    aspect_ratio: str = "1:1",
    image_size: str = "4K",
    cancel_event: Event | None = None,
    model_id: str | None = None,
) -> Image.Image | None:
    """Generate an image with aggressive model/resolution fallback."""
    if not model_id:
        model_id = get_image_model()
    model_name = model_id if model_id.startswith("gemini-") else "gemini-3-pro-image-preview"

    def _try(model: str, size: str | None) -> Image.Image | None:
        cfg: dict[str, Any] = {"responseModalities": ["TEXT", "IMAGE"]}
        if size:
            cfg["imageConfig"] = {"imageSize": size, "aspectRatio": aspect_ratio}
        return rest_generate(api_key, model, contents, cfg, cancel_event=cancel_event)

    if model_name in _4K_MODELS:
        alt = "gemini-3.1-flash-image-preview" if model_name == "gemini-3-pro-image-preview" else "gemini-3-pro-image-preview"
        for sz in _SIZE_CHAIN_4K:
            result = _try(model_name, sz)
            if result:
                return result
        for sz in _SIZE_CHAIN_4K:
            result = _try(alt, sz)
            if result:
                return result
    else:
        for sz in _SIZE_CHAIN_1K:
            result = _try(model_name, sz)
            if result:
                return result

    return None


# ---------------------------------------------------------------------------
# Imagen generation via google.genai SDK
# ---------------------------------------------------------------------------

def imagen_generate(
    api_key: str,
    prompt: str,
    aspect_ratio: str = "1:1",
    image_size: str | None = "2K",
) -> Image.Image | None:
    """Generate via Imagen models using the google.genai SDK."""
    try:
        from google import genai
        from google.genai.types import GenerateImagesConfig
    except ImportError:
        print("[Imagen] google-genai SDK not installed")
        return None

    model_id = get_image_model()
    candidates = []
    if not model_id.startswith("gemini-"):
        candidates.append(model_id)
    candidates += [
        "imagen-4.0-generate-001",
        "imagen-4.0-ultra-generate-001",
        "imagen-4.0-fast-generate-001",
    ]
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    client = genai.Client(api_key=api_key)

    for mid in unique:
        try:
            cfg_kwargs: dict[str, Any] = {
                "aspect_ratio": aspect_ratio,
                "number_of_images": 1,
                "safety_filter_level": "BLOCK_ONLY_HIGH",
                "person_generation": "ALLOW_ADULT",
            }
            info = get_model_info(mid)
            if info.get("supports_4k") is False and image_size:
                cfg_kwargs["image_size"] = min(image_size, "2K")
            resp = client.models.generate_images(
                model=mid,
                prompt=prompt,
                config=GenerateImagesConfig(**cfg_kwargs),
            )
            if resp and resp.generated_images:
                img_bytes = resp.generated_images[0].image.image_bytes
                return Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        except Exception as e:
            print(f"[Imagen] {mid} failed: {e}")
            continue

    return None


# ---------------------------------------------------------------------------
# Auto-save generated images to dated folders
# ---------------------------------------------------------------------------

_SAVE_ROOT: Path | None = None
_SAVE_FOLDER_CONFIG = CONFIG_ROOT / "save_folder.txt"


def _get_save_root() -> Path:
    global _SAVE_ROOT
    if _SAVE_ROOT:
        return _SAVE_ROOT
    # Check for user-configured save folder
    if _SAVE_FOLDER_CONFIG.is_file():
        try:
            custom = _SAVE_FOLDER_CONFIG.read_text(encoding="utf-8").strip()
            if custom and Path(custom).is_dir():
                _SAVE_ROOT = Path(custom)
                return _SAVE_ROOT
        except Exception:
            pass
    _SAVE_ROOT = _PROJECT_ROOT / "ALL GENERATED IMAGES"
    _SAVE_ROOT.mkdir(parents=True, exist_ok=True)
    return _SAVE_ROOT


def get_save_folder() -> str:
    """Return the current save folder path."""
    return str(_get_save_root())


def set_save_folder(folder_path: str) -> str:
    """Set a custom save folder. Returns the resolved path."""
    global _SAVE_ROOT
    p = Path(folder_path)
    p.mkdir(parents=True, exist_ok=True)
    _SAVE_ROOT = p
    CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
    _SAVE_FOLDER_CONFIG.write_text(str(p), encoding="utf-8")
    return str(p)


def reset_save_folder() -> str:
    """Reset to default save folder."""
    global _SAVE_ROOT
    _SAVE_ROOT = None
    if _SAVE_FOLDER_CONFIG.is_file():
        _SAVE_FOLDER_CONFIG.unlink()
    return str(_get_save_root())


def save_generated_image(
    image: Image.Image,
    tool_name: str,
    view_name: str = "main",
    generation_type: str = "generate",
    metadata: dict | None = None,
) -> str | None:
    """Save a generated image to ALL GENERATED IMAGES/<tool>/<date>/ with JSON metadata.

    Returns the saved file path as a string, or None on error.
    """
    import json as _json
    from datetime import datetime
    from uuid import uuid4

    try:
        root = _get_save_root() / tool_name
        date_dir = root / datetime.now().strftime("%Y-%m-%d")
        date_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        uid = uuid4().hex[:8]
        filename = f"auto_{timestamp}_{uid}_{view_name}_{generation_type}.png"
        image_path = date_dir / filename

        image.save(image_path, "PNG")

        meta = {
            "timestamp": datetime.now().isoformat(),
            "tool": tool_name,
            "view": view_name,
            "generation_type": generation_type,
            "image_file": filename,
            "width": image.width,
            "height": image.height,
            "model": get_image_model(),
        }
        if metadata:
            meta.update(metadata)

        with open(image_path.with_suffix(".json"), "w", encoding="utf-8") as f:
            _json.dump(meta, f, indent=2, ensure_ascii=False)

        # Append to generation history timeline
        _append_history_entry(meta, image, image_path)

        return str(image_path)
    except Exception as e:
        print(f"[AutoSave] Failed: {e}")
        return None


def _append_history_entry(meta: dict, image: Image.Image, image_path: Path) -> None:
    """Append a JSONL entry to .history/<date>.jsonl for the generation timeline."""
    import json as _json
    from datetime import datetime

    try:
        hist_dir = _get_save_root() / ".history"
        hist_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        hist_file = hist_dir / f"{today}.jsonl"

        thumb = image.copy()
        thumb.thumbnail((128, 128))
        thumb_b64 = image_to_b64(thumb, "PNG")

        import uuid as _uuid
        raw_id = meta.get("image_file", "").replace(".png", "")
        entry = {
            "id": raw_id if raw_id else _uuid.uuid4().hex[:12],
            "timestamp": meta.get("timestamp", datetime.now().isoformat()),
            "tool": meta.get("tool", ""),
            "view": meta.get("view", ""),
            "generation_type": meta.get("generation_type", ""),
            "model": meta.get("model", ""),
            "prompt": meta.get("description", meta.get("prompt", "")),
            "image_path": str(image_path),
            "thumbnail_b64": thumb_b64,
            "width": meta.get("width", 0),
            "height": meta.get("height", 0),
        }

        with open(hist_file, "a", encoding="utf-8") as f:
            f.write(_json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[History] Failed to log: {e}")
