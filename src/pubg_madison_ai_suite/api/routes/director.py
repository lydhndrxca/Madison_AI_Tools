"""AI Art Director — conversational art feedback with configurable persona.

Endpoints:
  POST /chat          — SSE streaming chat with the art director
  POST /generate-persona — Auto-generate persona from a name
  GET  /transcripts   — List saved transcript sessions
  GET  /transcripts/{id} — Fetch a single transcript
  POST /transcripts   — Save a transcript session
  DELETE /transcripts/{id} — Delete a transcript
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api import core

router = APIRouter()

_TRANSCRIPTS_DIR = Path.home() / ".madison_ai" / "director_transcripts"


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PersonaConfig(BaseModel):
    name: str = "Art Director"
    description: str = ""
    philosophy: str = ""
    likes: str = ""
    dislikes: str = ""


class ChatRequest(BaseModel):
    message: str
    image_b64: Optional[str] = None
    conversation_history: list[dict[str, str]] = Field(default_factory=list)
    persona: PersonaConfig = Field(default_factory=PersonaConfig)
    context_images: list[dict[str, str]] = Field(default_factory=list)
    attributes_context: str = ""
    system_prompt: str = ""
    verbosity: str = "medium"
    mode: str = "fast"


class PersonaGenRequest(BaseModel):
    name: str


class TranscriptSaveRequest(BaseModel):
    messages: list[dict[str, Any]]
    images: list[str] = Field(default_factory=list)
    title: str = ""
    tool: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_system_prompt(req: ChatRequest) -> str:
    """Assemble the system instruction from persona + context."""
    if req.system_prompt.strip():
        prompt = req.system_prompt.strip()
    else:
        prompt = (
            "You are an AI Art Director embedded in a concept art tool. "
            "You observe the artist's work and provide insightful, constructive, "
            "and actionable art direction. You speak with authority and taste, "
            "referencing composition, color theory, silhouette, mood, and storytelling."
        )

    p = req.persona
    if p.description.strip():
        prompt += f"\n\n--- PERSONA ---\n{p.description}"
    if p.philosophy.strip():
        prompt += f"\n\n--- DESIGN PHILOSOPHY ---\n{p.philosophy}"
    if p.likes.strip():
        prompt += f"\n\n--- LIKES ---\n{p.likes}"
    if p.dislikes.strip():
        prompt += f"\n\n--- DISLIKES ---\n{p.dislikes}"

    verbosity_map = {
        "brief": "Respond very concisely — a few sentences at most. Be direct and punchy.",
        "medium": "Respond in moderate detail — a short paragraph. Be clear and conversational.",
        "detailed": "Respond in depth — multiple paragraphs when warranted. Be thorough and analytical.",
    }
    prompt += f"\n\n--- COMMUNICATION STYLE ---\n{verbosity_map.get(req.verbosity, verbosity_map['medium'])}"

    prompt += (
        "\n\n--- RESPONSE FORMAT ---\n"
        "When giving art direction, organize your feedback into clearly labeled categories using "
        "markdown bold headers like **Category Name**: followed by the suggestion. "
        "For example:\n"
        "**Color Palette**: Use warmer earth tones to ground the character.\n"
        "**Silhouette**: The shoulder armor could be more asymmetric for visual interest.\n\n"
        "Each bold-headed line is a discrete, actionable suggestion the artist can choose to apply. "
        "Keep each suggestion focused on one concept."
    )

    if req.attributes_context.strip():
        prompt += f"\n\n--- CURRENT CHARACTER/ASSET CONTEXT ---\n{req.attributes_context}"

    return prompt


def _select_model(mode: str) -> str:
    if mode == "deep":
        return "gemini-2.5-pro"
    return "gemini-2.0-flash"


def _stream_chat(api_key: str, model: str, system_prompt: str, contents: list[dict]) -> Any:
    """Generator that yields SSE events from Gemini streamGenerateContent."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
        f":streamGenerateContent?alt=sse"
    )
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    body: dict[str, Any] = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
    }

    try:
        with requests.post(url, json=body, headers=headers, stream=True, timeout=180) as resp:
            if resp.status_code != 200:
                err_text = resp.text[:500]
                yield f"data: {json.dumps({'error': f'Gemini {resp.status_code}: {err_text}'})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
                return

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data: "):
                    payload = line[6:]
                    try:
                        chunk = json.loads(payload)
                        if "usageMetadata" in chunk:
                            core._extract_usage_and_track(chunk, model, "art_director")
                        for cand in chunk.get("candidates", []):
                            for part in cand.get("content", {}).get("parts", []):
                                if "text" in part:
                                    yield f"data: {json.dumps({'token': part['text']})}\n\n"
                    except json.JSONDecodeError:
                        pass

    except requests.exceptions.Timeout:
        yield f"data: {json.dumps({'error': 'Request timed out'})}\n\n"
    except Exception as exc:
        yield f"data: {json.dumps({'error': str(exc)[:300]})}\n\n"

    yield f"data: {json.dumps({'done': True})}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/chat")
async def chat(req: ChatRequest):
    api_key = core.get_api_key()
    if not api_key:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": "No API key configured. Set your Gemini API key in Settings."})
    model = _select_model(req.mode)
    system_prompt = _build_system_prompt(req)

    contents: list[dict] = []

    for turn in req.conversation_history:
        role = turn.get("role", "user")
        parts: list[dict] = [{"text": turn.get("text", "")}]
        if turn.get("image_b64"):
            parts.insert(0, {
                "inlineData": {"mimeType": "image/png", "data": turn["image_b64"][:50_000_000]}
            })
        contents.append({"role": role, "parts": parts})

    user_parts: list[dict] = []
    if req.image_b64:
        user_parts.append({
            "inlineData": {"mimeType": "image/png", "data": req.image_b64[:50_000_000]}
        })
    for ctx_img in req.context_images:
        b64 = ctx_img.get("b64", "")
        if b64:
            user_parts.append({"inlineData": {"mimeType": "image/png", "data": b64[:50_000_000]}})
    user_parts.append({"text": req.message})
    contents.append({"role": "user", "parts": user_parts})

    return StreamingResponse(
        _stream_chat(api_key, model, system_prompt, contents),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/generate-persona")
async def generate_persona(req: PersonaGenRequest):
    api_key = core.get_api_key()
    prompt = (
        f'Research the creative figure "{req.name}" and generate a detailed art director '
        f"persona based on their known artistic style, preferences, and philosophy.\n\n"
        f"Return ONLY valid JSON with these exact keys (all values must be strings, NOT arrays):\n"
        f'{{"name": "...", "description": "A 2-3 sentence description of their creative identity", '
        f'"philosophy": "Their design philosophy and what drives their creative choices", '
        f'"likes": "A comma-separated list of visual elements, techniques, themes they love", '
        f'"dislikes": "A comma-separated list of things they avoid or react against in design"}}'
    )

    result = core.rest_generate_text(api_key, "gemini-2.0-flash", prompt, timeout=30, cost_category="art_director")
    if not result:
        raise HTTPException(500, "Failed to generate persona")

    cleaned = result.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        persona = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(500, f"Gemini returned invalid JSON: {cleaned[:200]}")

    for field in ("likes", "dislikes", "description", "philosophy"):
        val = persona.get(field)
        if isinstance(val, list):
            persona[field] = ", ".join(str(v) for v in val)

    return persona


# ---------------------------------------------------------------------------
# Transcripts CRUD
# ---------------------------------------------------------------------------

@router.get("/transcripts")
async def list_transcripts():
    _TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for f in sorted(_TRANSCRIPTS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            items.append({
                "id": f.stem,
                "title": data.get("title", "Untitled"),
                "tool": data.get("tool", ""),
                "created_at": data.get("created_at", ""),
                "message_count": len(data.get("messages", [])),
                "preview": (data.get("messages", [{}])[0].get("text", ""))[:120] if data.get("messages") else "",
                "has_images": len(data.get("images", [])) > 0,
            })
        except Exception:
            pass
    return {"transcripts": items}


@router.get("/transcripts/{tid}")
async def get_transcript(tid: str):
    if ".." in tid or "/" in tid or "\\" in tid or "\x00" in tid:
        raise HTTPException(400, "Invalid transcript ID")
    fpath = _TRANSCRIPTS_DIR / f"{tid}.json"
    if not fpath.exists():
        raise HTTPException(404, "Transcript not found")
    try:
        data = json.loads(fpath.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(500, "Failed to read transcript")
    return data


@router.post("/transcripts")
async def save_transcript(req: TranscriptSaveRequest):
    _TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    tid = f"{int(time.time())}_{uuid.uuid4().hex[:8]}"
    data = {
        "id": tid,
        "title": req.title or f"Session {time.strftime('%Y-%m-%d %H:%M')}",
        "tool": req.tool,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "messages": req.messages,
        "images": req.images[:20],
    }
    fpath = _TRANSCRIPTS_DIR / f"{tid}.json"
    fpath.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return {"id": tid}


@router.delete("/transcripts/{tid}")
async def delete_transcript(tid: str):
    fpath = _TRANSCRIPTS_DIR / f"{tid}.json"
    if fpath.exists():
        fpath.unlink()
    return {"ok": True}
