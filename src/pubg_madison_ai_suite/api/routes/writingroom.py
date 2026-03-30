"""Writing Room — Gemini-backed text helpers for collaborative writing sessions."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pubg_madison_ai_suite.api.core import get_api_key, rest_generate_text

router = APIRouter()

_DEFAULT_MODEL = "gemini-2.5-flash"


class GenerateTurnRequest(BaseModel):
    prompt: str
    temperature: float = 0.7
    model: str | None = None


class GenerateTurnResponse(BaseModel):
    text: str


class SummarizeRequest(BaseModel):
    prompt: str


class SummarizeResponse(BaseModel):
    summary: str


class RandomizePlanningRequest(BaseModel):
    prompt: str = Field(..., description="Instructions + context for randomized planning JSON.")


class RandomizePlanningResponse(BaseModel):
    result: str


def _require_api_key() -> str:
    key = get_api_key()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="No Gemini API key configured. Set GEMINI_API_KEY or add a key in settings.",
        )
    return key


@router.post("/generate-turn", response_model=GenerateTurnResponse)
async def generate_turn(body: GenerateTurnRequest):
    api_key = _require_api_key()
    model = (body.model or "").strip() or _DEFAULT_MODEL
    try:
        text = rest_generate_text(
            api_key,
            model,
            body.prompt,
            cost_category="writing_room",
            temperature=body.temperature,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return GenerateTurnResponse(text=text or "")


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(body: SummarizeRequest):
    api_key = _require_api_key()
    try:
        summary = rest_generate_text(
            api_key,
            _DEFAULT_MODEL,
            body.prompt,
            cost_category="writing_room",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return SummarizeResponse(summary=summary or "")


@router.post("/randomize-planning", response_model=RandomizePlanningResponse)
async def randomize_planning(body: RandomizePlanningRequest):
    api_key = _require_api_key()
    try:
        result = rest_generate_text(
            api_key,
            _DEFAULT_MODEL,
            body.prompt,
            cost_category="writing_room",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return RandomizePlanningResponse(result=result or "")
