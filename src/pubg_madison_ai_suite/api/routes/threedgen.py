"""3D generation routes: Meshy AI and Hitem3D proxy, job tracking, export."""

from __future__ import annotations

import base64
import json
import threading
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter
import shutil
import uuid

from fastapi import File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from pubg_madison_ai_suite.api.core import CONFIG_ROOT, get_extra_key, track_cost

router = APIRouter()

# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------


def _meshy_key() -> str:
    return get_extra_key("meshy_api_key")


def _hitem3d_access() -> str:
    return get_extra_key("hitem3d_access_key")


def _hitem3d_secret() -> str:
    return get_extra_key("hitem3d_secret_key")


# ---------------------------------------------------------------------------
# Hitem3D OAuth token cache
# ---------------------------------------------------------------------------

_token_lock = threading.Lock()
_token_cache: dict = {}
TOKEN_TTL = 25 * 60  # 25 minutes

HITEM3D_BASE = "https://api.hitem3d.ai"
MESHY_BASE = "https://api.meshy.ai"

MESHY_ALLOWED_HOSTS = {"assets.meshy.ai", "cdn.meshy.ai", "api.meshy.ai"}
HITEM3D_ALLOWED_HOSTS = {"api.hitem3d.ai", "cdn.hitem3d.ai", "assets.hitem3d.ai"}


def _get_hitem3d_token(access_key: str, secret_key: str) -> str:
    with _token_lock:
        cached = _token_cache.get(access_key)
        if cached and time.time() < cached["expires_at"]:
            return cached["token"]

    basic = base64.b64encode(f"{access_key}:{secret_key}".encode()).decode()
    resp = requests.post(
        f"{HITEM3D_BASE}/open-api/v1/auth/token",
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
        json={},
        timeout=30,
    )
    data = resp.json()
    code = data.get("code")
    if code and code != 200:
        msg = data.get("msg", data.get("message", "Unknown error"))
        raise RuntimeError(f"Hitem3D auth failed ({code}): {msg}")

    token = data.get("data", {}).get("accessToken")
    if not token:
        raise RuntimeError(f"No accessToken in auth response: {json.dumps(data)[:200]}")

    with _token_lock:
        _token_cache[access_key] = {"token": token, "expires_at": time.time() + TOKEN_TTL}
    return token


# ---------------------------------------------------------------------------
# In-memory job tracker
# ---------------------------------------------------------------------------

_jobs_lock = threading.Lock()
_jobs: list[dict] = []
MAX_JOBS = 50


def _add_job(job: dict) -> None:
    with _jobs_lock:
        _jobs.insert(0, job)
        if len(_jobs) > MAX_JOBS:
            _jobs[:] = _jobs[:MAX_JOBS]


def _update_job(task_id: str, updates: dict) -> None:
    with _jobs_lock:
        for j in _jobs:
            if j.get("task_id") == task_id:
                j.update(updates)
                break


@router.get("/jobs")
async def list_jobs():
    with _jobs_lock:
        return {"jobs": list(_jobs)}


# ---------------------------------------------------------------------------
# Meshy endpoints
# ---------------------------------------------------------------------------


class MeshyCreateRequest(BaseModel):
    action: str  # create-image-to-3d, create-multi-image-to-3d, poll-image-to-3d, retexture, poll-retexture, proxy-model, test-connection
    image_url: Optional[str] = None
    image_urls: Optional[list[str]] = None
    taskId: Optional[str] = None
    isMulti: Optional[bool] = False
    url: Optional[str] = None
    # Meshy image-to-3d params
    ai_model: Optional[str] = None
    model_type: Optional[str] = None
    topology: Optional[str] = None
    target_polycount: Optional[int] = None
    symmetry_mode: Optional[str] = None
    pose_mode: Optional[str] = None
    should_remesh: Optional[bool] = None
    save_pre_remeshed_model: Optional[bool] = None
    should_texture: Optional[bool] = None
    enable_pbr: Optional[bool] = None
    image_enhancement: Optional[bool] = None
    remove_lighting: Optional[bool] = None
    texture_prompt: Optional[str] = None
    target_formats: Optional[list[str]] = None
    auto_size: Optional[bool] = None
    origin_at: Optional[str] = None
    # Meshy retexture params
    input_task_id: Optional[str] = None
    model_url: Optional[str] = None
    text_style_prompt: Optional[str] = None
    image_style_url: Optional[str] = None
    enable_original_uv: Optional[bool] = None


@router.post("/meshy")
async def meshy_proxy(body: MeshyCreateRequest):
    key = _meshy_key()
    if not key:
        return JSONResponse(
            status_code=500,
            content={"error": "Meshy API key not configured. Add it in Settings."},
        )

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    if body.action == "test-connection":
        try:
            r = requests.get(f"{MESHY_BASE}/openapi/v1/image-to-3d?limit=1", headers=headers, timeout=15)
            if 200 <= r.status_code < 300:
                return {"ok": True, "message": "Meshy API key is valid."}
            return {"ok": False, "error": r.text[:200]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if body.action == "create-image-to-3d":
        payload = {k: v for k, v in body.model_dump().items() if v is not None and k not in ("action", "taskId", "isMulti", "url", "image_urls")}
        r = requests.post(f"{MESHY_BASE}/openapi/v1/image-to-3d", headers=headers, json=payload, timeout=120)
        data = r.json()
        if r.ok and isinstance(data, dict) and "result" in data:
            _add_job({"task_id": data["result"], "service": "meshy", "type": "single", "status": "PENDING", "progress": 0, "created_at": time.time()})
            is_v6 = str(body.ai_model or "").startswith("meshy-6")
            has_tex = body.should_texture is not False
            credits = (30 if has_tex else 20) if is_v6 else (15 if has_tex else 5)
            track_cost("meshy_3d", body.ai_model or "meshy", meshy_credits=credits)
        return data

    if body.action == "create-multi-image-to-3d":
        payload = {k: v for k, v in body.model_dump().items() if v is not None and k not in ("action", "taskId", "isMulti", "url", "image_url")}
        r = requests.post(f"{MESHY_BASE}/openapi/v1/multi-image-to-3d", headers=headers, json=payload, timeout=120)
        data = r.json()
        if r.ok and isinstance(data, dict) and "result" in data:
            _add_job({"task_id": data["result"], "service": "meshy", "type": "multi", "status": "PENDING", "progress": 0, "created_at": time.time()})
            is_v6 = str(body.ai_model or "").startswith("meshy-6")
            has_tex = body.should_texture is not False
            credits = (30 if has_tex else 20) if is_v6 else (15 if has_tex else 5)
            track_cost("meshy_3d", body.ai_model or "meshy", meshy_credits=credits)
        return data

    if body.action == "poll-image-to-3d":
        prefix = "/openapi/v1/multi-image-to-3d" if body.isMulti else "/openapi/v1/image-to-3d"
        r = requests.get(f"{MESHY_BASE}{prefix}/{body.taskId}", headers=headers, timeout=30)
        data = r.json()
        if isinstance(data, dict):
            _update_job(body.taskId or "", {
                "status": data.get("status", "UNKNOWN"),
                "progress": data.get("progress", 0),
                "model_urls": data.get("model_urls"),
                "thumbnail_url": data.get("thumbnail_url"),
            })
        return data

    if body.action == "retexture":
        payload: dict = {}
        if body.input_task_id:
            payload["input_task_id"] = body.input_task_id
        elif body.model_url:
            resolved_url = body.model_url
            ws_prefix = "/api/3d/workshop/projects/"
            local_idx = resolved_url.find(ws_prefix)
            if local_idx >= 0:
                remainder = resolved_url[local_idx + len(ws_prefix):]
                parts = remainder.split("/model/", 1)
                if len(parts) == 2:
                    pid, fname = parts[0], parts[1]
                    fpath = _ws_dir(pid) / fname.replace("/", "").replace("\\", "").replace("..", "")
                    if fpath.exists():
                        glb_b64 = base64.b64encode(fpath.read_bytes()).decode()
                        resolved_url = f"data:application/octet-stream;base64,{glb_b64}"
                    else:
                        return JSONResponse(status_code=404, content={"error": f"Model file not found: {fname}"})
            payload["model_url"] = resolved_url
        else:
            return JSONResponse(status_code=400, content={"error": "Retexture requires input_task_id or model_url"})
        if body.text_style_prompt:
            payload["text_style_prompt"] = body.text_style_prompt
        if body.image_style_url:
            payload["image_style_url"] = body.image_style_url
        if body.ai_model:
            payload["ai_model"] = body.ai_model
        if body.enable_original_uv is not None:
            payload["enable_original_uv"] = body.enable_original_uv
        if body.enable_pbr is not None:
            payload["enable_pbr"] = body.enable_pbr
        if body.target_formats:
            payload["target_formats"] = body.target_formats
        if body.remove_lighting is not None:
            payload["remove_lighting"] = body.remove_lighting
        try:
            payload_size_mb = len(json.dumps(payload)) / (1024 * 1024)
            timeout = max(120, int(payload_size_mb * 10))
            r = requests.post(f"{MESHY_BASE}/openapi/v1/retexture", headers=headers, json=payload, timeout=timeout)
            data = r.json()
            if r.ok and isinstance(data, dict) and "result" in data:
                _add_job({"task_id": data["result"], "service": "meshy", "type": "retexture", "status": "PENDING", "progress": 0, "created_at": time.time()})
                track_cost("meshy_retexture", body.ai_model or "meshy", meshy_credits=10)
            if not r.ok:
                return JSONResponse(status_code=r.status_code, content=data if isinstance(data, dict) else {"error": str(data)})
            return data
        except requests.exceptions.Timeout:
            return JSONResponse(status_code=504, content={"error": f"Meshy API timed out uploading model ({payload_size_mb:.1f} MB)"})
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": str(e)})

    if body.action == "poll-retexture":
        if not body.taskId:
            return JSONResponse(status_code=400, content={"error": "Missing taskId"})
        try:
            r = requests.get(f"{MESHY_BASE}/openapi/v1/retexture/{body.taskId}", headers=headers, timeout=30)
            data = r.json()
            if isinstance(data, dict):
                _update_job(body.taskId, {
                    "status": data.get("status", "UNKNOWN"),
                    "progress": data.get("progress", 0),
                    "model_urls": data.get("model_urls"),
                    "thumbnail_url": data.get("thumbnail_url"),
                    "texture_urls": data.get("texture_urls"),
                })
            return data
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": str(e)})

    if body.action == "proxy-model":
        if not body.url:
            return {"error": "Missing url"}
        host = urlparse(body.url).hostname
        if host not in MESHY_ALLOWED_HOSTS:
            return {"error": f"Proxy blocked: {host}"}
        r = requests.get(body.url, timeout=120)
        if not r.ok:
            return {"error": f"Download failed: {r.status_code}"}
        content_type = r.headers.get("content-type", "model/gltf-binary")
        return Response(content=r.content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})

    return {"error": f"Unknown action: {body.action}"}


# ---------------------------------------------------------------------------
# Hitem3D endpoints
# ---------------------------------------------------------------------------


class Hitem3DRequest(BaseModel):
    action: str  # submit-task, query-task, proxy-model, test-connection
    task_id: Optional[str] = None
    request_type: Optional[int] = None
    model: Optional[str] = None
    resolution: Optional[str] = None
    face: Optional[int] = None
    format: Optional[int] = None
    mesh_url: Optional[str] = None
    url: Optional[str] = None
    images: Optional[dict] = None
    multi_images: Optional[list[dict]] = None
    multi_images_bit: Optional[str] = None


@router.post("/hitem3d")
async def hitem3d_proxy(body: Hitem3DRequest):
    access = _hitem3d_access()
    secret = _hitem3d_secret()
    if not access:
        return {"error": "Hitem3D access key not configured. Add it in Settings."}
    if not secret:
        return {"error": "Hitem3D secret key not configured. Add it in Settings."}

    try:
        token = _get_hitem3d_token(access, secret)
    except Exception as e:
        return {"error": str(e)}

    auth_headers = {"Authorization": f"Bearer {token}"}

    if body.action == "test-connection":
        try:
            r = requests.get(
                f"{HITEM3D_BASE}/open-api/v1/query-task?task_id=__ping__",
                headers=auth_headers,
                timeout=15,
            )
            if r.status_code == 401 or r.status_code == 403:
                return {"ok": False, "error": "Invalid Hitem3D credentials."}
            return {"ok": True, "message": "Hitem3D credentials are valid."}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if body.action == "submit-task":
        import io

        files = []
        form_data = {}
        if body.request_type is not None:
            form_data["request_type"] = str(body.request_type)
        if body.model:
            form_data["model"] = body.model
        if body.resolution:
            form_data["resolution"] = body.resolution
        if body.face is not None:
            form_data["face"] = str(body.face)
        if body.format is not None:
            form_data["format"] = str(body.format)
        if body.mesh_url:
            form_data["mesh_url"] = body.mesh_url

        if body.multi_images:
            for img in body.multi_images:
                buf = base64.b64decode(img["base64"])
                files.append(("multi_images", (img.get("name", "view.png"), io.BytesIO(buf), img.get("mimeType", "image/png"))))
            if body.multi_images_bit:
                form_data["multi_images_bit"] = body.multi_images_bit
        elif body.images:
            buf = base64.b64decode(body.images["base64"])
            files.append(("images", (body.images.get("name", "input.png"), io.BytesIO(buf), body.images.get("mimeType", "image/png"))))

        try:
            r = requests.post(
                f"{HITEM3D_BASE}/open-api/v1/submit-task",
                headers=auth_headers,
                data=form_data,
                files=files if files else None,
                timeout=120,
            )
            data = r.json()
            # Track job
            task_id = None
            if isinstance(data, dict):
                task_id = data.get("task_id") or (data.get("data", {}) if isinstance(data.get("data"), dict) else {}).get("task_id")
            if task_id:
                _add_job({"task_id": task_id, "service": "hitem3d", "type": "image-to-3d", "status": "created", "progress": 0, "created_at": time.time(), "model": body.model, "resolution": body.resolution})
                track_cost("hitem3d", body.model or "hitem3d", flat_cost=0.50)
            return data
        except Exception as e:
            return {"error": str(e)}

    if body.action == "query-task":
        if not body.task_id:
            return {"error": "Missing task_id"}
        r = requests.get(
            f"{HITEM3D_BASE}/open-api/v1/query-task?task_id={body.task_id}",
            headers=auth_headers,
            timeout=30,
        )
        data = r.json()
        if isinstance(data, dict):
            inner = data.get("data", data)
            if isinstance(inner, dict):
                _update_job(body.task_id, {
                    "status": inner.get("status", "unknown"),
                    "progress": inner.get("progress", 0),
                    "url": inner.get("url"),
                    "cover_url": inner.get("cover_url"),
                })
        return data

    if body.action == "proxy-model":
        if not body.url:
            return {"error": "Missing url"}
        host = urlparse(body.url).hostname
        if host not in HITEM3D_ALLOWED_HOSTS:
            return {"error": f"Proxy blocked: {host}"}
        r = requests.get(body.url, timeout=120)
        if not r.ok:
            return {"error": f"Download failed: {r.status_code}"}
        ct = r.headers.get("content-type", "application/octet-stream")
        return Response(content=r.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    return {"error": f"Unknown action: {body.action}"}


# ---------------------------------------------------------------------------
# Export model to disk
# ---------------------------------------------------------------------------


class ExportRequest(BaseModel):
    url: str
    directory: str
    filename: str


@router.post("/export")
async def export_model(body: ExportRequest):
    if not body.url or not body.directory or not body.filename:
        return {"error": "Missing url, directory, or filename"}

    for bad in ("/", "\\", ".."):
        if bad in body.filename:
            return {"error": "Invalid filename"}

    resolved = Path(body.directory).resolve()
    out_path = resolved / body.filename
    if not str(out_path).startswith(str(resolved)):
        return {"error": "Path traversal detected"}

    try:
        resolved.mkdir(parents=True, exist_ok=True)
        r = requests.get(body.url, timeout=180)
        if not r.ok:
            return {"error": f"Download failed: {r.status_code} {r.reason}"}
        out_path.write_bytes(r.content)
        return {"ok": True, "path": str(out_path), "size": len(r.content)}
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# 3D export paths (settings)
# ---------------------------------------------------------------------------

_EXPORT_CONFIG = CONFIG_ROOT / "threedgen_settings.json"


def _read_3d_settings() -> dict:
    if _EXPORT_CONFIG.is_file():
        try:
            return json.loads(_EXPORT_CONFIG.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _write_3d_settings(data: dict) -> None:
    _EXPORT_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    _EXPORT_CONFIG.write_text(json.dumps(data, indent=2), encoding="utf-8")


@router.get("/settings")
async def get_3d_settings():
    data = _read_3d_settings()
    if not data.get("blender_path"):
        detected = _detect_blender()
        if detected:
            data["blender_path"] = detected
            _write_3d_settings(data)
    return data


class ThreeDSettings(BaseModel):
    meshy_export_dir: Optional[str] = None
    hitem3d_export_dir: Optional[str] = None
    blender_path: Optional[str] = None


@router.post("/settings")
async def set_3d_settings(body: ThreeDSettings):
    data = _read_3d_settings()
    for k, v in body.model_dump(exclude_none=True).items():
        data[k] = v
    _write_3d_settings(data)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Workshop project CRUD
# ---------------------------------------------------------------------------

WORKSHOP_ROOT = CONFIG_ROOT / "workshop"


def _ws_dir(project_id: str) -> Path:
    safe = project_id.replace("/", "").replace("\\", "").replace("..", "")
    return WORKSHOP_ROOT / safe


def _read_ws_project(project_id: str) -> dict | None:
    pf = _ws_dir(project_id) / "project.json"
    if not pf.exists():
        return None
    try:
        return json.loads(pf.read_text("utf-8"))
    except Exception:
        return None


def _write_ws_project(project_id: str, data: dict) -> None:
    d = _ws_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "project.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


class WorkshopImportRequest(BaseModel):
    glb_b64: str
    format: str = "glb"
    name: str = "Untitled"
    meshy_task_id: Optional[str] = None


@router.post("/workshop/import")
async def workshop_import(body: WorkshopImportRequest):
    project_id = str(uuid.uuid4())[:12]
    d = _ws_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)

    (d / "original.glb").write_bytes(base64.b64decode(body.glb_b64))

    version_id = "v0"
    project = {
        "id": project_id,
        "name": body.name,
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000,
        "source": {
            "originalFormat": body.format,
            "meshyTaskId": body.meshy_task_id,
            "fileName": body.name,
        },
        "versions": [
            {
                "id": version_id,
                "label": "Original",
                "createdAt": time.time() * 1000,
                "type": "original",
                "status": "ready",
                "glbFile": "original.glb",
            }
        ],
        "currentVersionId": version_id,
    }
    _write_ws_project(project_id, project)
    return project


_GLB_FORMATS = {"glb", "gltf"}
_CONVERTIBLE_FORMATS = {"fbx", "obj", "stl", "blend"}


@router.post("/workshop/upload")
async def workshop_upload(
    file: UploadFile = File(...),
    meshy_task_id: Optional[str] = Form(None),
):
    """Single multipart upload: auto-detects format, converts via Blender if needed, creates project."""
    import subprocess
    import tempfile

    name = file.filename or "Untitled"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in _GLB_FORMATS and ext not in _CONVERTIBLE_FORMATS:
        return JSONResponse(status_code=400, content={"error": f"Unsupported format: .{ext}"})

    raw_bytes = await file.read()

    if ext in _GLB_FORMATS:
        glb_bytes = raw_bytes
    else:
        blender_path = _find_blender_path()
        if not blender_path:
            return JSONResponse(status_code=400, content={"error": "Blender not found. Set the path in settings or click Auto-detect."})

        work_dir = Path(tempfile.gettempdir()) / "madison_blender"
        work_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        input_path = work_dir / f"upload_{ts}.{ext}"
        output_path = work_dir / f"upload_{ts}.glb"

        input_path.write_bytes(raw_bytes)
        del raw_bytes

        project_root = Path(__file__).resolve().parents[4]
        script_path = project_root / "scripts" / "blender" / "convert_to_glb.py"
        if not script_path.exists():
            input_path.unlink(missing_ok=True)
            return JSONResponse(status_code=500, content={"error": f"Blender script not found: {script_path}"})

        input_mb = input_path.stat().st_size / (1024 * 1024)
        timeout_secs = max(120, int(input_mb * 15))
        args_json = json.dumps({
            "input": str(input_path),
            "output": str(output_path),
            "inputFormat": ext,
            "joinMeshes": True,
            "stripAnim": True,
        })
        try:
            result = subprocess.run(
                [blender_path, "--background", "--python", str(script_path), "--", args_json],
                capture_output=True, text=True, timeout=timeout_secs,
            )
            if result.returncode != 0:
                stderr = (result.stderr or "")[-500:]
                stdout = (result.stdout or "")[-500:]
                return JSONResponse(status_code=500, content={"error": f"Blender conversion failed: {stderr or stdout}"})
            if not output_path.exists():
                return JSONResponse(status_code=500, content={"error": "Blender produced no output"})
            glb_bytes = output_path.read_bytes()
        except subprocess.TimeoutExpired:
            return JSONResponse(status_code=504, content={"error": f"Blender conversion timed out ({timeout_secs}s for {input_mb:.1f}MB file)"})
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
        finally:
            input_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)

    project_id = str(uuid.uuid4())[:12]
    d = _ws_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "original.glb").write_bytes(glb_bytes)

    version_id = "v0"
    project = {
        "id": project_id,
        "name": name,
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000,
        "source": {
            "originalFormat": ext,
            "meshyTaskId": meshy_task_id,
            "fileName": name,
        },
        "versions": [
            {
                "id": version_id,
                "label": "Original",
                "createdAt": time.time() * 1000,
                "type": "original",
                "status": "ready",
                "glbFile": "original.glb",
            }
        ],
        "currentVersionId": version_id,
    }
    _write_ws_project(project_id, project)
    return project


@router.get("/workshop/projects")
async def workshop_list():
    if not WORKSHOP_ROOT.exists():
        return {"projects": []}
    projects = []
    for d in sorted(WORKSHOP_ROOT.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        pf = d / "project.json"
        if pf.exists():
            try:
                p = json.loads(pf.read_text("utf-8"))
                projects.append({"id": p["id"], "name": p["name"], "updatedAt": p.get("updatedAt", 0), "versionCount": len(p.get("versions", []))})
            except Exception:
                pass
    return {"projects": projects}


@router.get("/workshop/projects/{project_id}")
async def workshop_get(project_id: str):
    p = _read_ws_project(project_id)
    if not p:
        return JSONResponse(status_code=404, content={"error": "Project not found"})
    d = _ws_dir(project_id)
    versions = p.get("versions", [])
    p["versions"] = [
        v for v in versions
        if v.get("status") == "pending" or (v.get("glbFile") and (d / v["glbFile"]).exists())
    ]
    if p["currentVersionId"] not in [v["id"] for v in p["versions"]]:
        ready = [v for v in p["versions"] if v.get("glbFile")]
        if ready:
            p["currentVersionId"] = ready[-1]["id"]
    return p


class AddVersionRequest(BaseModel):
    id: str
    label: str
    type: str = "retexture"
    meshyTaskId: Optional[str] = None
    status: str = "ready"
    prompt: Optional[str] = None
    glb_b64: Optional[str] = None
    glb_url: Optional[str] = None


@router.post("/workshop/projects/{project_id}/versions")
async def workshop_add_version(project_id: str, body: AddVersionRequest):
    p = _read_ws_project(project_id)
    if not p:
        return JSONResponse(status_code=404, content={"error": "Project not found"})

    d = _ws_dir(project_id)
    glb_file = f"{body.id}.glb"

    has_glb = False
    if body.glb_b64:
        (d / glb_file).write_bytes(base64.b64decode(body.glb_b64))
        has_glb = True
    elif body.glb_url:
        try:
            r = requests.get(body.glb_url, timeout=120)
            if r.ok:
                (d / glb_file).write_bytes(r.content)
                has_glb = True
            else:
                return JSONResponse(status_code=502, content={"error": f"Download failed: {r.status_code}"})
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": str(e)})

    version = {
        "id": body.id,
        "label": body.label,
        "createdAt": time.time() * 1000,
        "type": body.type,
        "meshyTaskId": body.meshyTaskId,
        "status": body.status,
        "prompt": body.prompt,
        "glbFile": glb_file if has_glb else None,
    }

    existing = next((v for v in p.get("versions", []) if v["id"] == body.id), None)
    if existing:
        existing.update({k: v for k, v in version.items() if v is not None})
    else:
        p.setdefault("versions", []).append(version)

    if has_glb:
        p["currentVersionId"] = body.id
    p["updatedAt"] = time.time() * 1000
    _write_ws_project(project_id, p)
    return existing or version


@router.delete("/workshop/projects/{project_id}")
async def workshop_delete(project_id: str):
    d = _ws_dir(project_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


@router.get("/workshop/projects/{project_id}/model/{filename}")
async def workshop_serve_model(project_id: str, filename: str):
    safe_name = filename.replace("/", "").replace("\\", "").replace("..", "")
    fpath = _ws_dir(project_id) / safe_name
    if not fpath.exists():
        return JSONResponse(status_code=404, content={"error": "File not found"})
    return FileResponse(str(fpath), media_type="model/gltf-binary", filename=safe_name)


# ---------------------------------------------------------------------------
# Blender integration
# ---------------------------------------------------------------------------


class BlenderRequest(BaseModel):
    operation: str  # scale, collision, scale-surface
    glb_b64: str
    params: Optional[dict] = None


@router.post("/blender")
async def blender_process(body: BlenderRequest):
    import subprocess
    import tempfile

    blender_path = _find_blender_path()
    if not blender_path:
        return {"error": "Blender not found. Set the path in 3D Gen AI settings or click Auto-detect."}

    work_dir = Path(tempfile.gettempdir()) / "madison_blender"
    work_dir.mkdir(parents=True, exist_ok=True)

    input_ext = (body.params or {}).get("inputFormat", "glb") if body.operation == "convert" else "glb"
    input_path = work_dir / f"input_{int(time.time())}.{input_ext}"
    output_path = work_dir / f"output_{int(time.time())}.glb"

    input_path.write_bytes(base64.b64decode(body.glb_b64))

    script_map = {
        "scale": "scale_model",
        "collision": "gen_collision",
        "scale-surface": "scale_surface",
        "convert": "convert_to_glb",
    }
    script_name = script_map.get(body.operation)
    if not script_name:
        return {"error": f"Unknown operation: {body.operation}"}

    # Look for blender scripts in project
    project_root = Path(__file__).resolve().parents[4]
    scripts_dir = project_root / "scripts" / "blender"
    script_path = scripts_dir / f"{script_name}.py"

    if not script_path.exists():
        return {"error": f"Blender script not found: {script_path}"}

    args_json = json.dumps({
        "input": str(input_path),
        "output": str(output_path),
        **(body.params or {}),
    })

    try:
        result = subprocess.run(
            [blender_path, "--background", "--python", str(script_path), "--", args_json],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            return {"error": f"Blender failed: {result.stderr[:500]}"}
        if not output_path.exists():
            return {"error": "Blender produced no output"}
        out_b64 = base64.b64encode(output_path.read_bytes()).decode()
        return {"ok": True, "glb_b64": out_b64, "size": output_path.stat().st_size}
    except subprocess.TimeoutExpired:
        return {"error": "Blender timed out (120s)"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        input_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Shared Blender helpers
# ---------------------------------------------------------------------------

def _detect_blender() -> str | None:
    """Scan PATH, common install dirs (Win/Mac/Linux), return best match."""
    import glob as _glob
    import platform
    import re

    on_path = shutil.which("blender")
    if on_path:
        return str(Path(on_path).resolve())

    system = platform.system()
    candidates: list[str] = []

    if system == "Windows":
        for root in [
            r"C:\Program Files\Blender Foundation",
            r"C:\Program Files (x86)\Blender Foundation",
        ]:
            candidates.extend(
                _glob.glob(root + r"\Blender *\blender.exe")
            )
        local = Path.home() / "AppData" / "Local" / "Blender Foundation"
        if local.is_dir():
            candidates.extend(
                str(p) for p in local.rglob("blender.exe")
            )
    elif system == "Darwin":
        candidates.extend(_glob.glob("/Applications/Blender*.app/Contents/MacOS/Blender"))
        candidates.extend(_glob.glob(str(Path.home() / "Applications/Blender*.app/Contents/MacOS/Blender")))
    else:  # Linux
        for d in ["/usr/bin", "/usr/local/bin", "/snap/bin", str(Path.home() / ".local/bin")]:
            p = Path(d) / "blender"
            if p.exists():
                candidates.append(str(p))
        candidates.extend(_glob.glob("/opt/blender*/blender"))

    def _version_key(path: str) -> tuple:
        m = re.search(r"(\d+)\.(\d+)", path)
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

    valid = [c for c in candidates if Path(c).is_file()]
    valid.sort(key=_version_key, reverse=True)
    return valid[0] if valid else None


def _find_blender_path() -> str | None:
    settings = _read_3d_settings()
    blender_path = settings.get("blender_path", "")
    if blender_path and Path(blender_path).exists():
        return blender_path

    detected = _detect_blender()
    if detected:
        settings["blender_path"] = detected
        _write_3d_settings(settings)
        return detected
    return None


@router.get("/detect-blender")
async def detect_blender():
    """Auto-detect Blender and persist path if found."""
    detected = _detect_blender()
    if detected:
        settings = _read_3d_settings()
        settings["blender_path"] = detected
        _write_3d_settings(settings)
        return {"found": True, "path": detected}
    return {"found": False, "path": None}


def _run_blender_script(script_name: str, args_dict: dict, timeout: int = 180) -> dict:
    """Run a named Blender script and return stdout/stderr. Returns {"error": ...} on failure."""
    import subprocess

    blender_path = _find_blender_path()
    if not blender_path:
        return {"error": "Blender not found. Set the path in 3D Gen AI settings."}

    project_root = Path(__file__).resolve().parents[4]
    script_path = project_root / "scripts" / "blender" / f"{script_name}.py"
    if not script_path.exists():
        return {"error": f"Blender script not found: {script_path}"}

    args_json = json.dumps(args_dict)
    try:
        result = subprocess.run(
            [blender_path, "--background", "--python", str(script_path), "--", args_json],
            capture_output=True, text=True, timeout=timeout,
        )
        out = {"returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        if result.returncode != 0:
            stderr_tail = (result.stderr or "")[-500:]
            stdout_tail = (result.stdout or "")[-500:]
            out["error"] = f"Blender exited with code {result.returncode}. {stderr_tail or stdout_tail}"
        return out
    except subprocess.TimeoutExpired:
        return {"error": f"Blender timed out ({timeout}s)"}
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# P1.1: PBR Map Extraction
# ---------------------------------------------------------------------------

class ExtractPbrRequest(BaseModel):
    project_id: str
    version_id: Optional[str] = None
    glb_b64: Optional[str] = None


@router.post("/extract-pbr")
async def extract_pbr(body: ExtractPbrRequest):
    import tempfile

    work_dir = Path(tempfile.mkdtemp(prefix="madison_pbr_"))

    try:
        if body.glb_b64:
            input_path = work_dir / "input.glb"
            input_path.write_bytes(base64.b64decode(body.glb_b64))
        elif body.project_id:
            p = _read_ws_project(body.project_id)
            if not p:
                return {"error": "Project not found"}
            vid = body.version_id or p.get("currentVersionId", "v0")
            v = next((v for v in p.get("versions", []) if v["id"] == vid), None)
            if not v or not v.get("glbFile"):
                return {"error": "Version has no GLB file"}
            input_path = _ws_dir(body.project_id) / v["glbFile"]
            if not input_path.exists():
                return {"error": "GLB file not found on disk"}
        else:
            return {"error": "Provide project_id or glb_b64"}

        output_dir = work_dir / "maps"
        output_dir.mkdir()

        result = _run_blender_script("extract_pbr_maps", {
            "input": str(input_path),
            "output_dir": str(output_dir),
        })

        if "error" in result:
            return result

        stdout = result.get("stdout", "")
        extract_data = None
        for line in stdout.splitlines():
            if line.startswith("EXTRACT_RESULT:"):
                extract_data = json.loads(line[len("EXTRACT_RESULT:"):])
                break

        if not extract_data:
            return {"error": "PBR extraction produced no result", "stdout": stdout[:500]}

        maps = {}
        for mat_info in extract_data.get("materials", []):
            mat_name = mat_info["name"]
            channels = {}
            for channel, value in mat_info.get("channels", {}).items():
                if isinstance(value, str):
                    fpath = output_dir / value
                    if fpath.exists():
                        channels[channel] = base64.b64encode(fpath.read_bytes()).decode()
                elif isinstance(value, dict) and "constant" in value:
                    channels[channel] = {"constant": value["constant"]}
            maps[mat_name] = channels

        return {"ok": True, "maps": maps}

    finally:
        import shutil as _shutil
        _shutil.rmtree(work_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# P1.2: UV Atlas Render
# ---------------------------------------------------------------------------

class RenderUvAtlasRequest(BaseModel):
    project_id: str
    version_id: Optional[str] = None
    material_index: int = 0
    resolution: int = 2048
    smart_unwrap: bool = False


@router.post("/render-uv-atlas")
async def render_uv_atlas(body: RenderUvAtlasRequest):
    import tempfile

    p = _read_ws_project(body.project_id)
    if not p:
        return {"error": "Project not found"}

    vid = body.version_id or p.get("currentVersionId", "v0")
    v = next((v for v in p.get("versions", []) if v["id"] == vid), None)
    if not v or not v.get("glbFile"):
        return {"error": "Version has no GLB file"}

    input_path = _ws_dir(body.project_id) / v["glbFile"]
    if not input_path.exists():
        return {"error": "GLB file not found on disk"}

    work_dir = Path(tempfile.mkdtemp(prefix="madison_uv_"))
    atlas_path = work_dir / "atlas.png"
    wire_path = work_dir / "wireframe.png"

    try:
        result = _run_blender_script("render_uv_atlas", {
            "input": str(input_path),
            "output": str(atlas_path),
            "wireframe_output": str(wire_path),
            "material_index": body.material_index,
            "resolution": body.resolution,
            "smart_unwrap": body.smart_unwrap,
        }, timeout=300)

        if "error" in result:
            return result

        stdout = result.get("stdout", "")
        was_unwrapped = "was_unwrapped\": true" in stdout

        atlas_b64 = base64.b64encode(atlas_path.read_bytes()).decode() if atlas_path.exists() else None
        wire_b64 = base64.b64encode(wire_path.read_bytes()).decode() if wire_path.exists() else None

        if not atlas_b64:
            return {"error": f"UV atlas render produced no output. Blender output: {stdout[-500:]}"}

        return {
            "ok": True,
            "atlas_b64": atlas_b64,
            "wireframe_b64": wire_b64,
            "width": body.resolution,
            "height": body.resolution,
            "was_unwrapped": was_unwrapped,
        }

    finally:
        import shutil as _shutil
        _shutil.rmtree(work_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# P1.3: Apply Texture (Bake-Back)
# ---------------------------------------------------------------------------

class ApplyTextureRequest(BaseModel):
    project_id: str
    version_id: Optional[str] = None
    material_index: int = 0
    channel: str = "diffuse"
    texture_b64: str


@router.post("/apply-texture")
async def apply_texture(body: ApplyTextureRequest):
    import tempfile

    p = _read_ws_project(body.project_id)
    if not p:
        return {"error": "Project not found"}

    vid = body.version_id or p.get("currentVersionId", "v0")
    v = next((v for v in p.get("versions", []) if v["id"] == vid), None)
    if not v or not v.get("glbFile"):
        return {"error": "Version has no GLB file"}

    input_path = _ws_dir(body.project_id) / v["glbFile"]
    if not input_path.exists():
        return {"error": "GLB file not found on disk"}

    work_dir = Path(tempfile.mkdtemp(prefix="madison_apply_tex_"))
    texture_path = work_dir / "new_texture.png"
    output_path = work_dir / "output.glb"

    try:
        texture_path.write_bytes(base64.b64decode(body.texture_b64))

        result = _run_blender_script("apply_texture", {
            "input": str(input_path),
            "output": str(output_path),
            "material_index": body.material_index,
            "channel": body.channel,
            "texture_path": str(texture_path),
        })

        if "error" in result:
            return result
        if not output_path.exists():
            return {"error": "Blender produced no output GLB"}

        new_version_id = f"v-tex-{uuid.uuid4().hex[:8]}"
        d = _ws_dir(body.project_id)
        glb_file = f"{new_version_id}.glb"
        (d / glb_file).write_bytes(output_path.read_bytes())

        version = {
            "id": new_version_id,
            "label": f"Texture Edit ({body.channel})",
            "createdAt": time.time() * 1000,
            "type": "texture-edit",
            "status": "ready",
            "prompt": f"Applied {body.channel} texture to slot {body.material_index}",
            "glbFile": glb_file,
        }
        p.setdefault("versions", []).append(version)
        p["currentVersionId"] = new_version_id
        p["updatedAt"] = time.time() * 1000
        _write_ws_project(body.project_id, p)

        return {"ok": True, "version": version}

    finally:
        import shutil as _shutil
        _shutil.rmtree(work_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# P1.4: Decal Projection
# ---------------------------------------------------------------------------

class ProjectDecalRequest(BaseModel):
    project_id: str
    version_id: Optional[str] = None
    decal_b64: str
    position: list[float]  # [x, y, z]
    normal: list[float]    # [x, y, z]
    scale: float = 0.5
    opacity: float = 1.0


@router.post("/project-decal")
async def project_decal(body: ProjectDecalRequest):
    import tempfile

    p = _read_ws_project(body.project_id)
    if not p:
        return {"error": "Project not found"}

    vid = body.version_id or p.get("currentVersionId", "v0")
    v = next((v for v in p.get("versions", []) if v["id"] == vid), None)
    if not v or not v.get("glbFile"):
        return {"error": "Version has no GLB file"}

    input_path = _ws_dir(body.project_id) / v["glbFile"]
    if not input_path.exists():
        return {"error": "GLB file not found on disk"}

    work_dir = Path(tempfile.mkdtemp(prefix="madison_decal_"))
    decal_path = work_dir / "decal.png"
    output_path = work_dir / "output.glb"

    try:
        decal_path.write_bytes(base64.b64decode(body.decal_b64))

        result = _run_blender_script("project_decal", {
            "input": str(input_path),
            "output": str(output_path),
            "decal_path": str(decal_path),
            "position": body.position,
            "normal": body.normal,
            "scale": body.scale,
            "opacity": body.opacity,
        })

        if "error" in result:
            return result
        if not output_path.exists():
            return {"error": "Blender produced no output GLB"}

        new_version_id = f"v-decal-{uuid.uuid4().hex[:8]}"
        d = _ws_dir(body.project_id)
        glb_file = f"{new_version_id}.glb"
        (d / glb_file).write_bytes(output_path.read_bytes())

        version = {
            "id": new_version_id,
            "label": "Decal Projection",
            "createdAt": time.time() * 1000,
            "type": "decal",
            "status": "ready",
            "prompt": "Decal projected onto model",
            "glbFile": glb_file,
        }
        p.setdefault("versions", []).append(version)
        p["currentVersionId"] = new_version_id
        p["updatedAt"] = time.time() * 1000
        _write_ws_project(body.project_id, p)

        return {"ok": True, "version": version}

    finally:
        import shutil as _shutil
        _shutil.rmtree(work_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# P1.5: AI Material Inference (Ortho Views + Gemini Analysis)
# ---------------------------------------------------------------------------

class AnalyzeMaterialsRequest(BaseModel):
    project_id: str
    version_id: Optional[str] = None


@router.post("/analyze-materials")
async def analyze_materials(body: AnalyzeMaterialsRequest):
    import tempfile
    from pubg_madison_ai_suite.api.core import get_api_key, rest_generate_json

    api_key = get_api_key()
    if not api_key:
        return {"error": "No Gemini API key configured"}

    p = _read_ws_project(body.project_id)
    if not p:
        return {"error": "Project not found"}

    vid = body.version_id or p.get("currentVersionId", "v0")
    v = next((v for v in p.get("versions", []) if v["id"] == vid), None)
    if not v or not v.get("glbFile"):
        return {"error": "Version has no GLB file"}

    input_path = _ws_dir(body.project_id) / v["glbFile"]
    if not input_path.exists():
        return {"error": "GLB file not found on disk"}

    work_dir = Path(tempfile.mkdtemp(prefix="madison_analyze_"))

    try:
        output_dir = work_dir / "views"
        output_dir.mkdir()

        result = _run_blender_script("render_ortho_views", {
            "input": str(input_path),
            "output_dir": str(output_dir),
            "resolution": 1024,
            "views": ["front", "back", "left", "right", "top", "bottom"],
        }, timeout=300)

        if "error" in result:
            return result

        view_images = []
        views_b64 = {}
        for view_name in ["front", "back", "left", "right", "top", "bottom"]:
            fp = output_dir / f"{view_name}.png"
            if fp.exists():
                b64 = base64.b64encode(fp.read_bytes()).decode()
                views_b64[view_name] = b64
                view_images.append({
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": b64,
                    }
                })

        if not view_images:
            return {"error": "No orthographic views were rendered"}

        prompt = (
            "You are a 3D material analysis expert. You are given orthographic renders "
            "(front, back, left, right, top, bottom) of a 3D model.\n\n"
            "Analyze the surface regions and respond with a JSON object containing a 'regions' array. "
            "Each region should have:\n"
            "- 'name': descriptive name of the region (e.g., 'main body', 'handle', 'blade')\n"
            "- 'material_type': the material type (e.g., 'metal', 'wood', 'plastic', 'fabric', 'leather', 'glass', 'rubber', 'stone', 'paint')\n"
            "- 'suggested_prompt': a retexturing prompt for this region (e.g., 'weathered brushed steel with scratches')\n"
            "- 'approximate_location': where on the model this region is (e.g., 'top half', 'handle area', 'base')\n\n"
            "Identify 2-8 distinct surface regions. Be specific in your texture prompts."
        )

        contents = view_images + [prompt]
        analysis = rest_generate_json(
            api_key,
            "gemini-2.5-flash",
            contents,
            timeout=120,
            cost_category="3d_analysis",
        )

        if not analysis:
            return {"error": "Gemini analysis returned no result"}

        regions = analysis.get("regions", []) if isinstance(analysis, dict) else []

        return {
            "ok": True,
            "regions": regions,
            "views": views_b64,
        }

    finally:
        import shutil as _shutil
        _shutil.rmtree(work_dir, ignore_errors=True)
