import { useCallback, useRef, useState } from "react";
import {
  Paintbrush,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Target,
} from "lucide-react";
import type {
  MaterialSlotInfo,
  TargetingModel,
  MeshyRetextureAiModel,
  RetextureParams,
} from "@/lib/workshopTypes";

export interface RetextureJob {
  taskId: string;
  status: string;
  progress: number;
  startedAt: number;
}

export interface RetexturePanelProps {
  targeting: TargetingModel;
  materialSlots: MaterialSlotInfo[];
  meshyTaskId?: string | null;
  currentGlbUrl?: string | null;
  onSubmit: (params: RetextureParams) => void;
  pendingJob: RetextureJob | null;
  disabled?: boolean;
}

export function RetexturePanel({
  targeting,
  materialSlots,
  meshyTaskId,
  currentGlbUrl,
  onSubmit,
  pendingJob,
  disabled = false,
}: RetexturePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [imageRefB64, setImageRefB64] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<MeshyRetextureAiModel>("latest");
  const [preserveUV, setPreserveUV] = useState(true);
  const [enablePBR, setEnablePBR] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const targetLabel =
    targeting.scope === "full-object"
      ? "Full Model"
      : `Slot ${targeting.materialSlotIndex}: ${materialSlots[targeting.materialSlotIndex ?? 0]?.name ?? "?"}`;

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImageRefB64(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleSubmit = useCallback(() => {
    const params: RetextureParams = {
      ai_model: aiModel,
      enable_original_uv: preserveUV,
      enable_pbr: enablePBR,
    };
    if (prompt.trim()) params.text_style_prompt = prompt.trim();
    if (imageRefB64) params.image_style_url = imageRefB64;
    if (meshyTaskId) {
      params.input_task_id = meshyTaskId;
    }
    onSubmit(params);
  }, [prompt, imageRefB64, aiModel, preserveUV, enablePBR, meshyTaskId, onSubmit]);

  const canSubmit = !disabled && !pendingJob && (prompt.trim() || imageRefB64);
  const elapsed = pendingJob ? Math.floor((Date.now() - pendingJob.startedAt) / 1000) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="shrink-0 px-3 py-2 flex items-center gap-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <Paintbrush className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Retexture
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 pt-2 pb-3 space-y-3">
        {/* Targeting indicator */}
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded"
          style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}
        >
          <Target className="h-3 w-3 shrink-0" style={{ color: "#8b5cf6" }} />
          <span className="text-[10px] font-semibold" style={{ color: "var(--color-text-secondary)" }}>
            Targeting: {targetLabel}
          </span>
        </div>

        {/* Text prompt */}
        <div>
          <label className="block text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>
            Style Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 600))}
            placeholder="Describe the material style (e.g. 'rusty metal with worn paint')"
            rows={3}
            className="w-full px-2 py-1.5 rounded text-[11px] resize-none"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-primary)",
            }}
          />
          <div className="text-right text-[9px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {prompt.length}/600
          </div>
        </div>

        {/* Image reference */}
        <div>
          <label className="block text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>
            Image Reference (optional)
          </label>
          {imageRefB64 ? (
            <div className="relative inline-block">
              <img
                src={imageRefB64}
                alt="Style reference"
                className="h-20 w-20 rounded object-cover"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <button
                type="button"
                onClick={() => setImageRefB64(null)}
                className="absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px]"
              style={{
                border: "1px dashed rgba(255,255,255,0.15)",
                color: "var(--color-text-secondary)",
                background: "transparent",
              }}
            >
              <Upload className="h-3 w-3" /> Upload image
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>

        {/* Settings */}
        <div className="space-y-2">
          <label className="block text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
            Settings
          </label>

          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>AI Model</span>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value as MeshyRetextureAiModel)}
              className="ml-auto px-1.5 py-0.5 rounded text-[10px]"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="latest">Latest</option>
              <option value="meshy-6">Meshy-6</option>
              <option value="meshy-5">Meshy-5</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={preserveUV}
              onChange={(e) => setPreserveUV(e.target.checked)}
              className="accent-purple-500"
            />
            <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Preserve original UVs</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enablePBR}
              onChange={(e) => setEnablePBR(e.target.checked)}
              className="accent-purple-500"
            />
            <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Enable PBR maps</span>
          </label>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-2 rounded text-[11px] font-semibold transition-colors"
          style={{
            background: canSubmit ? "rgba(139,92,246,0.7)" : "rgba(255,255,255,0.06)",
            color: canSubmit ? "#fff" : "var(--color-text-muted)",
            border: "none",
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          <Paintbrush className="h-3.5 w-3.5 mr-1 inline-block" style={{ verticalAlign: "text-bottom" }} />
          Retexture with Meshy
        </button>

        {/* Pending job */}
        {pendingJob && (
          <div
            className="flex flex-col gap-1 px-2 py-2 rounded"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: "var(--color-text-secondary)" }}>
              {pendingJob.status === "SUCCEEDED" ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : pendingJob.status === "FAILED" ? (
                <AlertTriangle className="h-3 w-3 text-red-400" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--color-text-muted)" }} />
              )}
              {pendingJob.status === "SUCCEEDED" ? "Complete" : pendingJob.status === "FAILED" ? "Failed" : "Processing..."}
            </div>
            <div className="flex items-center gap-2">
              {/* Progress bar */}
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pendingJob.progress}%`,
                    background: pendingJob.status === "FAILED" ? "#ef4444" : "#8b5cf6",
                  }}
                />
              </div>
              <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{pendingJob.progress}%</span>
            </div>
            <div className="flex items-center gap-1 text-[9px]" style={{ color: "var(--color-text-muted)" }}>
              <Clock className="h-2.5 w-2.5" /> {elapsed}s elapsed
              <span className="ml-auto truncate text-[8px] opacity-60">{pendingJob.taskId}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
