"""Prompt Library – saveable, taggable prompt templates."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_LIB_DIR = Path(__file__).resolve().parents[4] / "PROMPT_LIBRARY"
_LIB_DIR.mkdir(exist_ok=True)


class PromptTemplate(BaseModel):
    id: str = ""
    name: str
    text: str
    tags: list[str] = []
    tool_scope: list[str] = []  # e.g. ["character","prop"] or ["all"]
    created_at: str = ""
    updated_at: str = ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path_for(tid: str) -> Path:
    return _LIB_DIR / f"{tid}.json"


def _load(tid: str) -> dict:
    p = _path_for(tid)
    if not p.exists():
        raise HTTPException(404, f"Template {tid} not found")
    return json.loads(p.read_text("utf-8"))


def _save(data: dict) -> None:
    _path_for(data["id"]).write_text(json.dumps(data, indent=2), "utf-8")


@router.get("")
def list_prompts(tool: str | None = None) -> list[dict]:
    results = []
    for f in _LIB_DIR.glob("*.json"):
        try:
            d = json.loads(f.read_text("utf-8"))
        except Exception:
            continue
        if tool and tool != "all":
            scopes = d.get("tool_scope", [])
            if scopes and "all" not in scopes and tool not in scopes:
                continue
        results.append(d)
    results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return results


@router.post("", status_code=201)
def create_prompt(body: PromptTemplate) -> dict:
    data = body.model_dump()
    data["id"] = uuid.uuid4().hex[:12]
    data["created_at"] = _now_iso()
    data["updated_at"] = data["created_at"]
    _save(data)
    return data


@router.put("/{tid}")
def update_prompt(tid: str, body: PromptTemplate) -> dict:
    existing = _load(tid)
    existing["name"] = body.name
    existing["text"] = body.text
    existing["tags"] = body.tags
    existing["tool_scope"] = body.tool_scope
    existing["updated_at"] = _now_iso()
    _save(existing)
    return existing


@router.delete("/{tid}")
def delete_prompt(tid: str) -> dict:
    p = _path_for(tid)
    if not p.exists():
        raise HTTPException(404, f"Template {tid} not found")
    p.unlink()
    return {"ok": True}
