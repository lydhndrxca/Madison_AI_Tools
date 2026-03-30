/**
 * Shared types for the 3D Material Workshop.
 */

export interface WorkshopProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: ModelSource;
  versions: ModelVersion[];
  currentVersionId: string;
}

export interface ModelSource {
  originalFormat: string;
  meshyTaskId?: string;
  fileName?: string;
}

export interface ModelVersion {
  id: string;
  label: string;
  createdAt: number;
  type: "original" | "retexture";
  meshyTaskId?: string;
  status: "ready" | "pending" | "failed";
  prompt?: string;
  imageRefB64?: string;
  glbFile: string;
  thumbnailFile?: string;
}

export interface MaterialSlotInfo {
  index: number;
  name: string;
  meshNames: string[];
  hasUVs: boolean;
  textures: {
    baseColor?: { width: number; height: number };
    normal?: { width: number; height: number };
    roughness?: { width: number; height: number };
    metallic?: { width: number; height: number };
  };
}

export interface TargetingModel {
  scope: "full-object" | "material-slot";
  materialSlotIndex?: number;
}

export type MeshyRetextureAiModel = "meshy-5" | "meshy-6" | "latest";

export interface RetextureParams {
  model_url?: string;
  input_task_id?: string;
  text_style_prompt?: string;
  image_style_url?: string;
  ai_model?: MeshyRetextureAiModel;
  enable_original_uv?: boolean;
  enable_pbr?: boolean;
  target_formats?: string[];
}

export interface RetextureResult {
  id: string;
  type: string;
  status: string;
  progress: number;
  model_urls?: Record<string, string>;
  texture_urls?: Array<{
    base_color?: string;
    metallic?: string;
    normal?: string;
    roughness?: string;
  }>;
  thumbnail_url?: string;
  task_error?: { message: string };
}
