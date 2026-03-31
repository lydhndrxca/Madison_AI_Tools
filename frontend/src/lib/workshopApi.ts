/**
 * Frontend API client for the 3D Material Workshop.
 */

import { apiFetch } from "@/hooks/useApi";
import type {
  WorkshopProject,
  ModelVersion,
  RetextureParams,
  RetextureResult,
} from "./workshopTypes";

/* ── Meshy Retexture ─────────────────────────────────────── */

export async function retextureModel(params: RetextureParams): Promise<string> {
  const data = await apiFetch<{ result?: string; message?: string; error?: string }>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({ action: "retexture", ...params }),
  });
  if (data.error) throw new Error(data.error);
  if (data.message && !data.result) throw new Error(data.message);
  if (!data.result) throw new Error(`Meshy returned unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  return data.result;
}

export async function pollRetexture(taskId: string): Promise<RetextureResult> {
  return apiFetch<RetextureResult>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({ action: "poll-retexture", taskId }),
  });
}

/* ── Workshop Project CRUD ───────────────────────────────── */

export async function importModel(
  glbB64: string,
  format: string,
  name: string,
  meshyTaskId?: string,
): Promise<WorkshopProject> {
  return apiFetch<WorkshopProject>("/3d/workshop/import", {
    method: "POST",
    body: JSON.stringify({
      glb_b64: glbB64,
      format,
      name,
      meshy_task_id: meshyTaskId,
    }),
  });
}

export async function uploadModel(
  file: File,
  meshyTaskId?: string,
): Promise<WorkshopProject> {
  const base = window.location.protocol === "file:" ? "http://127.0.0.1:8420" : "";
  const form = new FormData();
  form.append("file", file);
  if (meshyTaskId) form.append("meshy_task_id", meshyTaskId);
  const res = await fetch(`${base}/api/3d/workshop/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `${res.status}: ${text}`;
    try { msg = JSON.parse(text).error ?? msg; } catch { /* ok */ }
    throw new Error(msg);
  }
  return res.json();
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  versionCount: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const data = await apiFetch<{ projects: ProjectSummary[] }>("/3d/workshop/projects");
  return data.projects ?? [];
}

export async function getProject(id: string): Promise<WorkshopProject> {
  return apiFetch<WorkshopProject>(`/3d/workshop/projects/${id}`);
}

export async function addVersion(
  projectId: string,
  version: {
    id: string;
    label: string;
    type?: string;
    meshyTaskId?: string;
    status?: string;
    prompt?: string;
    glb_b64?: string;
    glb_url?: string;
  },
): Promise<ModelVersion> {
  return apiFetch<ModelVersion>(`/3d/workshop/projects/${projectId}/versions`, {
    method: "POST",
    body: JSON.stringify(version),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/3d/workshop/projects/${id}`, { method: "DELETE" });
}

export function getModelUrl(projectId: string, filename: string): string {
  const base = window.location.protocol === "file:" ? "http://127.0.0.1:8420" : "";
  return `${base}/api/3d/workshop/projects/${projectId}/model/${filename}`;
}

/* ── Blender convert ─────────────────────────────────────── */

export async function blenderConvert(
  fileB64: string,
  inputFormat: string,
): Promise<string> {
  const data = await apiFetch<{ ok?: boolean; glb_b64?: string; error?: string }>("/3d/blender", {
    method: "POST",
    body: JSON.stringify({
      operation: "convert",
      glb_b64: fileB64,
      params: { inputFormat },
    }),
  });
  if (data.error) throw new Error(data.error);
  return data.glb_b64 ?? "";
}

/* ── PBR Map Extraction ──────────────────────────────────── */

export interface PbrMaps {
  [materialName: string]: {
    [channel: string]: string | { constant: number | number[] };
  };
}

export async function extractPbrMaps(
  projectId: string,
  versionId?: string,
): Promise<PbrMaps> {
  const data = await apiFetch<{ ok?: boolean; maps?: PbrMaps; error?: string }>("/3d/extract-pbr", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, version_id: versionId }),
  });
  if (data.error) throw new Error(data.error);
  return data.maps ?? {};
}

/* ── UV Atlas Render ─────────────────────────────────────── */

export interface UvAtlasResult {
  atlas_b64: string;
  wireframe_b64: string | null;
  width: number;
  height: number;
}

export async function renderUvAtlas(
  projectId: string,
  versionId?: string,
  materialIndex: number = 0,
  resolution: number = 2048,
): Promise<UvAtlasResult> {
  const data = await apiFetch<UvAtlasResult & { ok?: boolean; error?: string }>("/3d/render-uv-atlas", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      version_id: versionId,
      material_index: materialIndex,
      resolution,
    }),
  });
  if (data.error) throw new Error(data.error);
  return data;
}

/* ── Apply Texture (Bake-Back) ───────────────────────────── */

export async function applyTexture(
  projectId: string,
  materialIndex: number,
  channel: string,
  textureB64: string,
  versionId?: string,
): Promise<ModelVersion> {
  const data = await apiFetch<{ ok?: boolean; version?: ModelVersion; error?: string }>("/3d/apply-texture", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      version_id: versionId,
      material_index: materialIndex,
      channel,
      texture_b64: textureB64,
    }),
  });
  if (data.error) throw new Error(data.error);
  return data.version!;
}

/* ── Decal Projection ────────────────────────────────────── */

export async function projectDecal(
  projectId: string,
  decalB64: string,
  position: [number, number, number],
  normal: [number, number, number],
  scale: number = 0.5,
  opacity: number = 1.0,
  versionId?: string,
): Promise<ModelVersion> {
  const data = await apiFetch<{ ok?: boolean; version?: ModelVersion; error?: string }>("/3d/project-decal", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      version_id: versionId,
      decal_b64: decalB64,
      position,
      normal,
      scale,
      opacity,
    }),
  });
  if (data.error) throw new Error(data.error);
  return data.version!;
}

/* ── AI Material Inference ───────────────────────────────── */

export interface MaterialRegion {
  name: string;
  material_type: string;
  suggested_prompt: string;
  approximate_location: string;
}

export interface AnalyzeMaterialsResult {
  regions: MaterialRegion[];
  views: { [viewName: string]: string };
}

export async function analyzeMaterials(
  projectId: string,
  versionId?: string,
): Promise<AnalyzeMaterialsResult> {
  const data = await apiFetch<AnalyzeMaterialsResult & { ok?: boolean; error?: string }>("/3d/analyze-materials", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, version_id: versionId }),
  });
  if (data.error) throw new Error(data.error);
  return { regions: data.regions ?? [], views: data.views ?? {} };
}
