"""Persona research and enhancement via Gemini text generation."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api.core import get_api_key, rest_generate_text

router = APIRouter()

MODEL = "gemini-2.0-flash"

PERSONA_RESEARCH_INSTRUCTIONS = """Research the creative figure, archetype, or public persona named "{name}".
Write a first-person creative collaborator profile they could use inside Madison AI Tools.

Use exactly these section headers (markdown ##):
## WHO I AM
## HOW I WORK
## MY INSTINCTS
## WHAT I WOULD NEVER DO

Ground the voice in what is publicly known about them or the archetype; if facts are thin, infer carefully and stay in character.
Be specific about craft, taste, and decision style. Keep the total profile concise but vivid (roughly 400–700 words).
Output only the profile text, no preamble."""

PERSONA_ENHANCE_INSTRUCTIONS = """You are expanding a user-defined creative persona into a full first-person profile for Madison AI Tools.

Persona name: {name}
User's description (source of truth): {description}
Optional quirks / constraints: {quirks}

Write in first person as this persona. Use exactly these section headers (markdown ##):
## WHO I AM
## HOW I WORK
## MY INSTINCTS
## WHAT I WOULD NEVER DO

Honor the user's description; use quirks where provided. Be concrete about workflow, taste, and boundaries.
Keep roughly 400–700 words. Output only the profile text, no preamble."""


class ResearchRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)


class EnhanceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    description: str = Field(..., min_length=1, max_length=20_000)
    quirks: str | None = Field(default=None, max_length=10_000)


def _no_key_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "error": "missing_api_key",
            "message": "No Gemini API key configured. Set a key in Settings or GEMINI_API_KEY.",
        },
    )


@router.post("/research")
async def research_persona(body: ResearchRequest):
    api_key = get_api_key()
    if not api_key:
        return _no_key_response()

    name = body.name.strip()
    prompt = PERSONA_RESEARCH_INSTRUCTIONS.format(name=name)

    try:
        profile = rest_generate_text(
            api_key,
            MODEL,
            prompt,
            timeout=120,
            cost_category="persona_research",
        )
    except RuntimeError as e:
        return JSONResponse(
            status_code=502,
            content={"error": "gemini_error", "message": str(e)},
        )

    if not profile or not profile.strip():
        return JSONResponse(
            status_code=502,
            content={"error": "empty_response", "message": "Model returned no text."},
        )

    return {"profile": profile.strip()}


@router.post("/enhance")
async def enhance_persona(body: EnhanceRequest):
    api_key = get_api_key()
    if not api_key:
        return _no_key_response()

    name = body.name.strip()
    description = body.description.strip()
    quirks = (body.quirks or "").strip() or "(none provided)"

    prompt = PERSONA_ENHANCE_INSTRUCTIONS.format(
        name=name,
        description=description,
        quirks=quirks,
    )

    try:
        profile = rest_generate_text(
            api_key,
            MODEL,
            prompt,
            timeout=120,
            cost_category="persona_enhance",
        )
    except RuntimeError as e:
        return JSONResponse(
            status_code=502,
            content={"error": "gemini_error", "message": str(e)},
        )

    if not profile or not profile.strip():
        return JSONResponse(
            status_code=502,
            content={"error": "empty_response", "message": "Model returned no text."},
        )

    return {"profile": profile.strip()}
