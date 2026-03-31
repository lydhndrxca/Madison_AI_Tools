/**
 * Client-side 3D generation API helpers (Meshy + Hitem3D).
 * All calls go through the FastAPI backend proxy at /api/3d/*.
 */

import { apiFetch } from "@/hooks/useApi";

/* ── Meshy types ──────────────────────────────────────────── */

export interface MeshyTaskResult {
  id: string;
  type: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  model_urls: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
    mtl?: string;
    pre_remeshed_glb?: string;
  };
  thumbnail_url?: string;
  texture_urls?: Array<{
    base_color?: string;
    metallic?: string;
    normal?: string;
    roughness?: string;
  }>;
  task_error?: { message: string };
  preceding_tasks?: number;
  started_at?: number;
  created_at?: number;
  finished_at?: number;
}

export type MeshyOutputFormat = "glb" | "obj" | "fbx" | "stl" | "usdz";

export const MESHY_OUTPUT_FORMATS: { value: MeshyOutputFormat; label: string }[] = [
  { value: "glb", label: ".glb" },
  { value: "obj", label: ".obj" },
  { value: "fbx", label: ".fbx" },
  { value: "stl", label: ".stl" },
  { value: "usdz", label: ".usdz" },
];

export const MESHY_POLYCOUNT_PRESETS = [
  { value: 5000, label: "5K" },
  { value: 10000, label: "10K" },
  { value: 30000, label: "30K (Default)" },
  { value: 50000, label: "50K" },
  { value: 100000, label: "100K" },
  { value: 200000, label: "200K" },
  { value: 300000, label: "300K (Max)" },
] as const;

export const HITEM3D_FACE_PRESETS = [
  { value: 100000, label: "100K" },
  { value: 200000, label: "200K" },
  { value: 500000, label: "500K" },
  { value: 1000000, label: "1M" },
  { value: 1500000, label: "1.5M" },
  { value: 2000000, label: "2M (Max)" },
] as const;

export interface MeshyCreateParams {
  ai_model?: "latest" | "meshy-6" | "meshy-5";
  model_type?: "standard" | "lowpoly";
  topology?: "triangle" | "quad";
  target_polycount?: number;
  symmetry_mode?: "on" | "auto" | "off";
  pose_mode?: "" | "t-pose" | "a-pose";
  should_remesh?: boolean;
  save_pre_remeshed_model?: boolean;
  should_texture?: boolean;
  enable_pbr?: boolean;
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  texture_prompt?: string;
  target_formats?: MeshyOutputFormat[];
  auto_size?: boolean;
  origin_at?: "bottom" | "center";
}

export async function meshyCreateImageTo3D(
  imageBase64: string,
  mimeType: string,
  params: MeshyCreateParams = {},
): Promise<string> {
  const dataUri = `data:${mimeType};base64,${imageBase64}`;
  const data = await apiFetch<{ result?: string }>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({
      action: "create-image-to-3d",
      image_url: dataUri,
      ...params,
    }),
  });
  return data.result ?? "";
}

export async function meshyCreateMultiImageTo3D(
  images: Array<{ base64: string; mimeType: string }>,
  params: MeshyCreateParams = {},
): Promise<string> {
  const image_urls = images.map(
    (img) => `data:${img.mimeType};base64,${img.base64}`,
  );
  const data = await apiFetch<{ result?: string }>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({
      action: "create-multi-image-to-3d",
      image_urls,
      ...params,
    }),
  });
  return data.result ?? "";
}

export async function meshyPollTask(
  taskId: string,
  isMulti: boolean,
): Promise<MeshyTaskResult> {
  return apiFetch<MeshyTaskResult>("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({ action: "poll-image-to-3d", taskId, isMulti }),
  });
}

export async function meshyTestConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  return apiFetch("/3d/meshy", {
    method: "POST",
    body: JSON.stringify({ action: "test-connection" }),
  });
}

/* ── Hitem3D types ────────────────────────────────────────── */

export type Hitem3DRequestType = 1 | 2 | 3;
export type Hitem3DModel =
  | "hitem3dv1.5"
  | "hitem3dv2.0"
  | "scene-portraitv1.5"
  | "scene-portraitv2.0"
  | "scene-portraitv2.1";
export type Hitem3DResolution = "512" | "1024" | "1536" | "1536pro";
export type Hitem3DFormat = 1 | 2 | 3 | 4 | 5;
export type Hitem3DTaskStatus = "created" | "queueing" | "processing" | "success" | "failed";

export const HITEM3D_FORMAT_LABELS: Record<Hitem3DFormat, string> = {
  1: ".obj",
  2: ".glb",
  3: ".stl",
  4: ".fbx",
  5: ".usdz",
};

export const HITEM3D_MODEL_INFO: Record<Hitem3DModel, {
  label: string;
  resolutions: Hitem3DResolution[];
}> = {
  "hitem3dv1.5": { label: "General v1.5", resolutions: ["512", "1024", "1536", "1536pro"] },
  "hitem3dv2.0": { label: "General v2.0 (HQ)", resolutions: ["1536", "1536pro"] },
  "scene-portraitv1.5": { label: "Portrait v1.5", resolutions: ["1536"] },
  "scene-portraitv2.0": { label: "Portrait v2.0", resolutions: ["1536pro"] },
  "scene-portraitv2.1": { label: "Portrait v2.1 (Latest)", resolutions: ["1536pro"] },
};

export interface Hitem3DTaskResult {
  task_id: string;
  status: Hitem3DTaskStatus;
  url?: string;
  cover_url?: string;
  progress?: number;
  error?: string;
}

export interface Hitem3DSubmitParams {
  request_type: Hitem3DRequestType;
  model: Hitem3DModel;
  resolution?: Hitem3DResolution;
  face?: number;
  format?: Hitem3DFormat;
}

export async function hitem3dSubmitTask(
  params: Hitem3DSubmitParams,
  singleImage?: { base64: string; mimeType: string },
  multiImages?: Array<{ base64: string; mimeType: string; viewKey: string }>,
): Promise<string> {
  const body: Record<string, unknown> = { action: "submit-task", ...params };

  if (multiImages && multiImages.length > 0) {
    const VIEW_SLOT_ORDER = ["front", "back", "left", "right"] as const;
    const VIEW_ALIAS: Record<string, string> = {
      front: "front", back: "back", left: "left", right: "right",
      side: "left", top: "front",
    };
    const mapped = multiImages.map((img) => ({
      ...img,
      slot: VIEW_ALIAS[img.viewKey] ?? img.viewKey,
    }));
    const slotBuckets = new Map<string, (typeof mapped)[number]>();
    for (const img of mapped) {
      if (!slotBuckets.has(img.slot)) slotBuckets.set(img.slot, img);
    }
    const orderedImages: (typeof mapped)  = [];
    const bitChars: string[] = [];
    for (const slot of VIEW_SLOT_ORDER) {
      const img = slotBuckets.get(slot);
      if (img) { orderedImages.push(img); bitChars.push("1"); }
      else { bitChars.push("0"); }
    }
    body.multi_images = orderedImages.map((img, i) => ({
      base64: img.base64,
      mimeType: img.mimeType,
      name: `view_${i}.${img.mimeType.split("/")[1] || "png"}`,
    }));
    body.multi_images_bit = bitChars.join("");
  } else if (singleImage) {
    body.images = {
      base64: singleImage.base64,
      mimeType: singleImage.mimeType,
      name: `input.${singleImage.mimeType.split("/")[1] || "png"}`,
    };
  }

  const data = await apiFetch<Record<string, unknown>>("/3d/hitem3d", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const taskId = (data.task_id as string) ?? (typeof data.data === "object" && data.data ? (data.data as Record<string, unknown>).task_id as string : undefined);
  if (!taskId) throw new Error("No task_id in Hitem3D response");
  return taskId;
}

export async function hitem3dQueryTask(taskId: string): Promise<Hitem3DTaskResult> {
  const data = await apiFetch<Record<string, unknown>>("/3d/hitem3d", {
    method: "POST",
    body: JSON.stringify({ action: "query-task", task_id: taskId }),
  });
  const inner = (data.data ?? data) as Hitem3DTaskResult;
  return inner;
}

export async function hitem3dTestConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  return apiFetch("/3d/hitem3d", {
    method: "POST",
    body: JSON.stringify({ action: "test-connection" }),
  });
}

/* ── Shared: proxy model, export, jobs, settings ──────── */

export async function proxyModel(
  service: "meshy" | "hitem3d",
  remoteUrl: string,
): Promise<string> {
  const base = service === "meshy" ? "/3d/meshy" : "/3d/hitem3d";
  const res = await fetch(
    `${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api${base}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "proxy-model", url: remoteUrl }),
    },
  );
  if (!res.ok) throw new Error(`Proxy failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface ThreeDJob {
  task_id: string;
  service: "meshy" | "hitem3d";
  type: string;
  status: string;
  progress: number;
  model_urls?: Record<string, string>;
  thumbnail_url?: string;
  url?: string;
  cover_url?: string;
  model?: string;
  resolution?: string;
  created_at: number;
}

export async function listJobs(): Promise<ThreeDJob[]> {
  const data = await apiFetch<{ jobs: ThreeDJob[] }>("/3d/jobs");
  return data.jobs ?? [];
}

export async function exportModel(
  url: string,
  directory: string,
  filename: string,
): Promise<{ ok: boolean; path: string; size: number }> {
  return apiFetch("/3d/export", {
    method: "POST",
    body: JSON.stringify({ url, directory, filename }),
  });
}

export interface ThreeDSettings {
  meshy_export_dir?: string;
  hitem3d_export_dir?: string;
  blender_path?: string;
}

export async function getThreeDSettings(): Promise<ThreeDSettings> {
  return apiFetch("/3d/settings");
}

export async function saveThreeDSettings(settings: ThreeDSettings): Promise<void> {
  await apiFetch("/3d/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export async function detectBlenderPath(): Promise<{ found: boolean; path: string | null }> {
  return apiFetch("/3d/detect-blender");
}
