"""Generation History / Audit Trail – global timeline of all generated images."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Query
from pubg_madison_ai_suite.api.core import _get_save_root

router = APIRouter()


def _history_dir() -> Path:
    d = _get_save_root() / ".history"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.get("/timeline")
def get_timeline(
    tool: str | None = None,
    date: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    """Return paginated timeline entries, newest first."""
    hist = _history_dir()
    files = sorted(hist.glob("*.jsonl"), reverse=True)

    if date:
        files = [f for f in files if f.stem == date]

    entries: list[dict] = []
    for f in files:
        for line in reversed(f.read_text("utf-8").strip().splitlines()):
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if tool and entry.get("tool") != tool:
                continue
            if search and search.lower() not in json.dumps(entry).lower():
                continue
            entries.append(entry)

    total = len(entries)
    start = (page - 1) * page_size
    sliced = entries[start : start + page_size]
    return {"total": total, "page": page, "page_size": page_size, "entries": sliced}


@router.get("/dates")
def get_dates() -> list[str]:
    """Return available history dates."""
    hist = _history_dir()
    return sorted([f.stem for f in hist.glob("*.jsonl")], reverse=True)


@router.delete("/entry/{entry_id}")
def delete_entry(entry_id: str) -> dict:
    """Remove a single entry from the JSONL files."""
    hist = _history_dir()
    for f in hist.glob("*.jsonl"):
        lines = f.read_text("utf-8").strip().splitlines()
        new_lines = []
        found = False
        for line in lines:
            try:
                entry = json.loads(line)
                if entry.get("id") == entry_id:
                    found = True
                    continue
            except Exception:
                pass
            new_lines.append(line)
        if found:
            f.write_text("\n".join(new_lines) + ("\n" if new_lines else ""), "utf-8")
            return {"ok": True}
    return {"ok": False, "detail": "Entry not found"}
