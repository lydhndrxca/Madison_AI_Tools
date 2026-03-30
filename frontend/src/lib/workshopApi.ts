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
  const data = await apiFetch<{ result?: string }>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({ action: "retexture", ...params }),
  });
  return data.result ?? "";
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
