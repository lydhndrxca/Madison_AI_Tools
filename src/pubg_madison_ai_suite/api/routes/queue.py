"""Batch Generation Queue – enqueue multiple jobs and run them sequentially."""
from __future__ import annotations

import asyncio
import traceback
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pubg_madison_ai_suite.api.ws import manager

router = APIRouter()


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class QueueJob(BaseModel):
    id: str = ""
    tool: str  # "character" | "prop" | "environment" | "uilab" | "gemini" | "weapon"
    payload: dict[str, Any] = {}
    label: str = ""
    status: JobStatus = JobStatus.pending
    result_image_b64: str | None = None
    error: str | None = None
    created_at: str = ""
    completed_at: str | None = None


class EnqueueRequest(BaseModel):
    tool: str
    payload: dict[str, Any] = {}
    label: str = ""
    count: int = 1


_jobs: list[QueueJob] = []
_queue: asyncio.Queue[str] | None = None
_worker_task: asyncio.Task | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_job(jid: str) -> QueueJob | None:
    return next((j for j in _jobs if j.id == jid), None)


async def _broadcast_queue_state():
    pending = sum(1 for j in _jobs if j.status == JobStatus.pending)
    running = sum(1 for j in _jobs if j.status == JobStatus.running)
    done = sum(1 for j in _jobs if j.status == JobStatus.done)
    await manager.broadcast("queue_progress", {
        "jobs": [j.model_dump() for j in _jobs[-50:]],
        "pending": pending,
        "running": running,
        "done": done,
        "total": len(_jobs),
    })


def _run_job_sync(job: QueueJob) -> str | None:
    """Run a generation job synchronously. Returns base64 image or None."""
    from concurrent.futures import ThreadPoolExecutor
    tool = job.tool
    payload = job.payload

    if tool == "character":
        from pubg_madison_ai_suite.api.routes.character import _do_generate, CharacterGenerateRequest
        req = CharacterGenerateRequest(**payload)
        result = _do_generate(req)
        return result.image_b64 if result and not result.error else None
    elif tool == "prop":
        from pubg_madison_ai_suite.api.routes.prop import _do_generate, PropGenerateRequest
        req = PropGenerateRequest(**payload)
        result = _do_generate(req)
        return result.image_b64 if result and not result.error else None
    elif tool == "environment":
        from pubg_madison_ai_suite.api.routes.environment import _do_generate, EnvGenerateRequest
        req = EnvGenerateRequest(**payload)
        result = _do_generate(req)
        return result.image_b64 if result and not result.error else None
    elif tool == "weapon":
        from pubg_madison_ai_suite.api.routes.weapon import _do_generate, WeaponGenerateRequest
        req = WeaponGenerateRequest(**payload)
        result = _do_generate(req)
        return result.image_b64 if result and not result.error else None
    else:
        raise ValueError(f"Unsupported tool: {tool}")


async def _worker():
    """Background worker that processes queued jobs sequentially."""
    global _queue
    if _queue is None:
        return
    loop = asyncio.get_running_loop()
    while True:
        jid = await _queue.get()
        job = _get_job(jid)
        if not job or job.status == JobStatus.cancelled:
            _queue.task_done()
            continue

        job.status = JobStatus.running
        await _broadcast_queue_state()

        try:
            result_b64 = await loop.run_in_executor(None, _run_job_sync, job)
            if result_b64:
                job.result_image_b64 = result_b64
                job.status = JobStatus.done
            else:
                job.status = JobStatus.failed
                job.error = "No image returned"
        except Exception as e:
            job.status = JobStatus.failed
            job.error = str(e)
            traceback.print_exc()

        job.completed_at = _now_iso()
        await _broadcast_queue_state()
        _queue.task_done()


def _ensure_worker():
    global _queue, _worker_task
    if _queue is None:
        _queue = asyncio.Queue()
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.get_running_loop().create_task(_worker())


@router.post("/enqueue")
async def enqueue(body: EnqueueRequest) -> list[dict]:
    _ensure_worker()
    created = []
    for i in range(max(1, min(body.count, 20))):
        job = QueueJob(
            id=uuid.uuid4().hex[:12],
            tool=body.tool,
            payload=body.payload,
            label=body.label or f"{body.tool} #{i + 1}",
            created_at=_now_iso(),
        )
        _jobs.append(job)
        await _queue.put(job.id)  # type: ignore
        created.append(job.model_dump())
    await _broadcast_queue_state()
    return created


@router.get("/jobs")
def list_jobs() -> list[dict]:
    return [j.model_dump() for j in _jobs[-100:]]


@router.delete("/jobs/{jid}")
async def cancel_job(jid: str) -> dict:
    job = _get_job(jid)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status == JobStatus.pending:
        job.status = JobStatus.cancelled
        await _broadcast_queue_state()
        return {"ok": True}
    return {"ok": False, "detail": "Job is not pending"}


@router.post("/clear")
async def clear_finished() -> dict:
    global _jobs
    _jobs = [j for j in _jobs if j.status in (JobStatus.pending, JobStatus.running)]
    await _broadcast_queue_state()
    return {"ok": True}
