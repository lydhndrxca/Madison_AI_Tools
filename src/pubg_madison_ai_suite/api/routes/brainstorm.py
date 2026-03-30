"""Brainstorm ideation pipeline — per-stage Gemini calls."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pubg_madison_ai_suite.api.core import get_api_key, rest_generate_json, rest_generate_text

router = APIRouter()


class RunStageRequest(BaseModel):
    prompt: str
    schemaHint: Optional[str] = None
    model: Optional[str] = None


@router.post("/run-stage")
def run_stage(req: RunStageRequest) -> dict[str, Any]:
    api_key = get_api_key()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="No Gemini API key configured. Add a key in Settings.",
        )

    model = (req.model or "").strip() or "gemini-2.0-flash"

    try:
        if req.schemaHint and req.schemaHint.strip():
            full = (
                req.prompt.strip()
                + "\n\n--- STRUCTURED OUTPUT CONTRACT ---\n"
                + req.schemaHint.strip()
                + "\n\nReturn ONLY valid JSON that satisfies this contract. No markdown fences."
            )
            data = rest_generate_json(api_key, model, [full], cost_category="brainstorm")
            if data is None:
                raise HTTPException(status_code=502, detail="Model did not return valid JSON.")
            return {"result": data}

        text = rest_generate_text(api_key, model, req.prompt.strip(), cost_category="brainstorm")
        if text is None:
            raise HTTPException(status_code=502, detail="Empty response from model.")
        return {"result": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
