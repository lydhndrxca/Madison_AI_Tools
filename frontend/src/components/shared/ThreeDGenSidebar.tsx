/**
 * Collapsible sidebar panel for launching 3D model generation
 * from Character Lab, Prop Lab, Weapon Lab, and UI Lab.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button, PanelSection } from "@/components/ui";
import { NumberStepper } from "@/components/ui";
import { useToastContext } from "@/hooks/ToastContext";
import {
  meshyCreateImageTo3D,
  meshyCreateMultiImageTo3D,
  meshyPollTask,
  hitem3dSubmitTask,
  hitem3dQueryTask,
  type MeshyCreateParams,
  type MeshyOutputFormat,
  type Hitem3DSubmitParams,
  type Hitem3DModel,
  type Hitem3DResolution,
  type Hitem3DFormat,
  HITEM3D_MODEL_INFO,
  HITEM3D_FORMAT_LABELS,
  MESHY_OUTPUT_FORMATS,
  MESHY_POLYCOUNT_PRESETS,
  HITEM3D_FACE_PRESETS,
} from "@/lib/threedgenApi";
import {
  Box,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────── */

export interface ViewImage {
  viewKey: string;
  label: string;
  base64: string;
  mimeType: string;
}

interface ThreeDGenSidebarProps {
  getViewImages: () => ViewImage[];
  toolLabel: string;
  /** When true, renders content without the outer border/header — parent handles collapse/toggle */
  embedded?: boolean;
}

type LocalJobStatus = "pending" | "in_progress" | "succeeded" | "failed";

interface LocalJob {
  id: string;
  service: "meshy" | "hitem3d";
  status: LocalJobStatus;
  progress: number;
}

/* ── Inline select using native <select> ── */

function MiniSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{label}</label>
      <select
        className="w-full px-2 py-1.5 text-xs rounded cursor-pointer"
        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ── Checkbox row ── */

function MiniCheck({ label, checked, onChange, hint }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label
      className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
      style={{ color: "var(--color-text-secondary)" }}
      title={hint}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ── Polycount / Face count picker with presets + custom ── */

function CountPicker({ label, value, onChange, presets, min, max }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  presets: readonly { value: number; label: string }[];
  min: number;
  max: number;
}) {
  const isCustom = !presets.some((p) => p.value === value);
  const [customMode, setCustomMode] = useState(isCustom);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            className="px-2 py-1 text-[10px] rounded cursor-pointer font-medium transition-colors"
            style={{
              background: !customMode && value === p.value ? "rgba(59,130,246,0.2)" : "var(--color-input-bg)",
              border: !customMode && value === p.value ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--color-border)",
              color: !customMode && value === p.value ? "#60a5fa" : "var(--color-text-secondary)",
            }}
            onClick={() => { setCustomMode(false); onChange(p.value); }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="px-2 py-1 text-[10px] rounded cursor-pointer font-medium transition-colors"
          style={{
            background: customMode ? "rgba(59,130,246,0.2)" : "var(--color-input-bg)",
            border: customMode ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--color-border)",
            color: customMode ? "#60a5fa" : "var(--color-text-secondary)",
          }}
          onClick={() => setCustomMode(true)}
        >
          Custom
        </button>
      </div>
      {customMode && (
        <input
          type="number"
          className="w-full px-2 py-1.5 text-xs rounded tabular-nums"
          style={{
            background: "var(--color-input-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            MozAppearance: "textfield" as never,
          }}
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          placeholder={`${min.toLocaleString()} – ${max.toLocaleString()}`}
        />
      )}
    </div>
  );
}

/* ── Multi-select format picker (Meshy target_formats) ── */

function FormatPicker({ label, selected, onChange, options }: {
  label: string;
  selected: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
}) {
  const toggle = (val: string) => {
    if (selected.includes(val)) {
      const next = selected.filter((s) => s !== val);
      if (next.length > 0) onChange(next);
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className="px-2 py-1 text-[10px] rounded cursor-pointer font-medium transition-colors"
              style={{
                background: on ? "rgba(34,197,94,0.15)" : "var(--color-input-bg)",
                border: on ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--color-border)",
                color: on ? "#22c55e" : "var(--color-text-secondary)",
              }}
              onClick={() => toggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────── */

export function ThreeDGenSidebar({ getViewImages, toolLabel, embedded }: ThreeDGenSidebarProps) {
  const { addToast } = useToastContext();
  const [open, setOpen] = useState(!!embedded);
  const [confirmOpen, setConfirmOpen] = useState<null | (() => void)>(null);
  const [missingViews, setMissingViews] = useState<string[]>([]);

  /* ── Meshy state ── */
  const [meshyModel, setMeshyModel] = useState("latest");
  const [meshyModelType, setMeshyModelType] = useState("standard");
  const [meshyTopology, setMeshyTopology] = useState("triangle");
  const [meshyPolycount, setMeshyPolycount] = useState(30000);
  const [meshyShouldRemesh, setMeshyShouldRemesh] = useState(false);
  const [meshySavePreRemeshed, setMeshySavePreRemeshed] = useState(false);
  const [meshySymmetry, setMeshySymmetry] = useState("auto");
  const [meshyPose, setMeshyPose] = useState("");
  const [meshyShouldTexture, setMeshyShouldTexture] = useState(true);
  const [meshyEnablePbr, setMeshyEnablePbr] = useState(true);
  const [meshyImageEnhancement, setMeshyImageEnhancement] = useState(true);
  const [meshyRemoveLighting, setMeshyRemoveLighting] = useState(true);
  const [meshyTexturePrompt, setMeshyTexturePrompt] = useState("");
  const [meshyTargetFormats, setMeshyTargetFormats] = useState<MeshyOutputFormat[]>(["glb", "obj", "fbx"]);
  const [meshyAutoSize, setMeshyAutoSize] = useState(false);
  const [meshyOriginAt, setMeshyOriginAt] = useState("bottom");
  const [meshyCount, setMeshyCount] = useState(1);

  /* ── Hitem3D state ── */
  const [hitemModel, setHitemModel] = useState<Hitem3DModel>("hitem3dv2.0");
  const [hitemResolution, setHitemResolution] = useState<Hitem3DResolution>("1536pro");
  const [hitemFormat, setHitemFormat] = useState<Hitem3DFormat>(2);
  const [hitemFace, setHitemFace] = useState(200000);
  const [hitemCount, setHitemCount] = useState(1);

  /* ── Jobs ── */
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const meshyInProgress = useMemo(() => jobs.filter((j) => j.service === "meshy" && (j.status === "pending" || j.status === "in_progress")).length, [jobs]);
  const hitemInProgress = useMemo(() => jobs.filter((j) => j.service === "hitem3d" && (j.status === "pending" || j.status === "in_progress")).length, [jobs]);

  useEffect(() => {
    return () => {
      for (const t of pollTimers.current.values()) clearInterval(t);
    };
  }, []);

  const startPolling = useCallback(
    (taskId: string, service: "meshy" | "hitem3d", isMulti: boolean) => {
      const timer = setInterval(async () => {
        try {
          if (service === "meshy") {
            const r = await meshyPollTask(taskId, isMulti);
            const st: LocalJobStatus =
              r.status === "SUCCEEDED" ? "succeeded" : r.status === "FAILED" || r.status === "CANCELED" ? "failed" : "in_progress";
            setJobs((prev) => prev.map((j) => (j.id === taskId ? { ...j, status: st, progress: r.progress } : j)));
            if (st === "succeeded" || st === "failed") {
              clearInterval(pollTimers.current.get(taskId)!);
              pollTimers.current.delete(taskId);
              addToast(
                st === "succeeded" ? `Meshy model ready (${taskId.slice(0, 8)})` : `Meshy generation failed`,
                st === "succeeded" ? "success" : "error",
              );
            }
          } else {
            const r = await hitem3dQueryTask(taskId);
            const st: LocalJobStatus =
              r.status === "success" ? "succeeded" : r.status === "failed" ? "failed" : "in_progress";
            setJobs((prev) => prev.map((j) => (j.id === taskId ? { ...j, status: st, progress: r.progress ?? 0 } : j)));
            if (st === "succeeded" || st === "failed") {
              clearInterval(pollTimers.current.get(taskId)!);
              pollTimers.current.delete(taskId);
              addToast(
                st === "succeeded" ? `Hitem3D model ready (${taskId.slice(0, 8)})` : `Hitem3D generation failed`,
                st === "succeeded" ? "success" : "error",
              );
            }
          }
        } catch { /* ignore */ }
      }, 3000);
      pollTimers.current.set(taskId, timer);
    },
    [addToast],
  );

  const checkViewsAndRun = useCallback(
    (action: () => void) => {
      const views = getViewImages();
      const available = new Set(views.map((v) => v.viewKey));
      const ideal = ["front", "back", "side"];
      const missing = ideal.filter((v) => !available.has(v));

      if (missing.length > 0 && views.length < 3) {
        setMissingViews(missing);
        setConfirmOpen(() => action);
      } else {
        action();
      }
    },
    [getViewImages],
  );

  /* ── Meshy generate ── */
  const handleMeshyGenerate = useCallback(async () => {
    const views = getViewImages();
    if (views.length === 0) {
      addToast("No images available. Generate some views first.", "info");
      return;
    }

    const isLowPoly = meshyModelType === "lowpoly";
    const params: MeshyCreateParams = {
      ai_model: meshyModel as MeshyCreateParams["ai_model"],
      model_type: meshyModelType as MeshyCreateParams["model_type"],
      ...(!isLowPoly && { topology: meshyTopology as MeshyCreateParams["topology"] }),
      ...(!isLowPoly && { target_polycount: meshyPolycount }),
      ...(!isLowPoly && { should_remesh: meshyShouldRemesh }),
      ...(!isLowPoly && meshyShouldRemesh && { save_pre_remeshed_model: meshySavePreRemeshed }),
      symmetry_mode: meshySymmetry as MeshyCreateParams["symmetry_mode"],
      pose_mode: meshyPose as MeshyCreateParams["pose_mode"],
      should_texture: meshyShouldTexture,
      ...(meshyShouldTexture && { enable_pbr: meshyEnablePbr }),
      ...(meshyShouldTexture && meshyTexturePrompt.trim() && { texture_prompt: meshyTexturePrompt.trim() }),
      image_enhancement: meshyImageEnhancement,
      remove_lighting: meshyRemoveLighting,
      target_formats: meshyTargetFormats,
      auto_size: meshyAutoSize,
      ...(meshyAutoSize && { origin_at: meshyOriginAt as MeshyCreateParams["origin_at"] }),
    };

    for (let i = 0; i < meshyCount; i++) {
      try {
        let taskId: string;
        if (views.length >= 2) {
          taskId = await meshyCreateMultiImageTo3D(
            views.map((v) => ({ base64: v.base64, mimeType: v.mimeType })),
            params,
          );
        } else {
          taskId = await meshyCreateImageTo3D(views[0].base64, views[0].mimeType, params);
        }
        const job: LocalJob = { id: taskId, service: "meshy", status: "pending", progress: 0 };
        setJobs((prev) => [job, ...prev]);
        startPolling(taskId, "meshy", views.length >= 2);
        addToast(`Meshy job started: ${taskId.slice(0, 8)}`, "info");
      } catch (e) {
        addToast(`Meshy error: ${(e as Error).message}`, "error");
      }
    }
  }, [
    getViewImages, meshyModel, meshyModelType, meshyTopology, meshyPolycount,
    meshyShouldRemesh, meshySavePreRemeshed, meshySymmetry, meshyPose,
    meshyShouldTexture, meshyEnablePbr, meshyImageEnhancement, meshyRemoveLighting,
    meshyTexturePrompt, meshyTargetFormats, meshyAutoSize, meshyOriginAt,
    meshyCount, startPolling, addToast,
  ]);

  /* ── Hitem3D generate ── */
  const handleHitemGenerate = useCallback(async () => {
    const views = getViewImages();
    if (views.length === 0) {
      addToast("No images available. Generate some views first.", "info");
      return;
    }

    const params: Hitem3DSubmitParams = {
      request_type: views.length >= 2 ? 3 : 1,
      model: hitemModel,
      resolution: hitemResolution,
      format: hitemFormat,
      face: hitemFace,
    };

    for (let i = 0; i < hitemCount; i++) {
      try {
        const taskId = await hitem3dSubmitTask(
          params,
          views.length === 1 ? { base64: views[0].base64, mimeType: views[0].mimeType } : undefined,
          views.length >= 2 ? views.map((v) => ({ base64: v.base64, mimeType: v.mimeType, viewKey: v.viewKey })) : undefined,
        );
        const job: LocalJob = { id: taskId, service: "hitem3d", status: "pending", progress: 0 };
        setJobs((prev) => [job, ...prev]);
        startPolling(taskId, "hitem3d", false);
        addToast(`Hitem3D job started: ${taskId.slice(0, 8)}`, "info");
      } catch (e) {
        addToast(`Hitem3D error: ${(e as Error).message}`, "error");
      }
    }
  }, [getViewImages, hitemModel, hitemResolution, hitemFormat, hitemFace, hitemCount, startPolling, addToast]);

  const availableResolutions = HITEM3D_MODEL_INFO[hitemModel]?.resolutions ?? [];

  const isLowPoly = meshyModelType === "lowpoly";

  const innerContent = (
    <div className={embedded ? "space-y-3" : "px-3 py-2 space-y-3"} style={embedded ? undefined : { borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}>
      {/* Active jobs */}
      {jobs.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Active Jobs</span>
          {jobs.slice(0, 8).map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
              {j.status === "in_progress" || j.status === "pending" ? (
                <Loader2 size={11} className="animate-spin" style={{ color: "#3b82f6" }} />
              ) : j.status === "succeeded" ? (
                <CheckCircle2 size={11} style={{ color: "#22c55e" }} />
              ) : (
                <XCircle size={11} style={{ color: "#ef4444" }} />
              )}
              <span className="truncate flex-1">{j.service === "meshy" ? "Meshy" : "Hitem3D"} &bull; {j.id.slice(0, 8)}</span>
              {j.progress > 0 && j.status !== "succeeded" && <span className="text-[10px] tabular-nums">{j.progress}%</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── Meshy AI ── */}
      <PanelSection title="Meshy AI" defaultOpen={true}>
        <div className="space-y-2.5">
          <MiniSelect label="AI Model" value={meshyModel} onChange={setMeshyModel} options={[
            { value: "latest", label: "Latest (Meshy 6)" },
            { value: "meshy-6", label: "Meshy 6" },
            { value: "meshy-5", label: "Meshy 5" },
          ]} />

          <MiniSelect label="Model Type" value={meshyModelType} onChange={setMeshyModelType} options={[
            { value: "standard", label: "Standard (High Detail)" },
            { value: "lowpoly", label: "Low Poly" },
          ]} />

          {!isLowPoly && (
            <>
              <MiniSelect label="Topology" value={meshyTopology} onChange={setMeshyTopology} options={[
                { value: "triangle", label: "Triangle" },
                { value: "quad", label: "Quad" },
              ]} />

              <CountPicker
                label="Target Polycount"
                value={meshyPolycount}
                onChange={setMeshyPolycount}
                presets={MESHY_POLYCOUNT_PRESETS}
                min={100}
                max={300000}
              />

              <MiniCheck label="Remesh" checked={meshyShouldRemesh} onChange={setMeshyShouldRemesh}
                hint="Enable remesh phase to apply topology & polycount settings" />
              {meshyShouldRemesh && (
                <MiniCheck label="Save Pre-Remeshed Model" checked={meshySavePreRemeshed} onChange={setMeshySavePreRemeshed}
                  hint="Keep a copy of the mesh before remeshing" />
              )}
            </>
          )}

          <MiniSelect label="Symmetry" value={meshySymmetry} onChange={setMeshySymmetry} options={[
            { value: "auto", label: "Auto" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]} />

          <MiniSelect label="Pose" value={meshyPose} onChange={setMeshyPose} options={[
            { value: "", label: "Default (None)" },
            { value: "t-pose", label: "T-Pose" },
            { value: "a-pose", label: "A-Pose" },
          ]} />

          <div className="space-y-1 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Texturing</span>
            <MiniCheck label="Generate Textures" checked={meshyShouldTexture} onChange={setMeshyShouldTexture} />
            {meshyShouldTexture && (
              <>
                <MiniCheck label="PBR Materials" checked={meshyEnablePbr} onChange={setMeshyEnablePbr}
                  hint="Generate metallic, roughness, and normal maps" />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Texture Prompt (optional)</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 text-xs rounded"
                    style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                    value={meshyTexturePrompt}
                    onChange={(e) => setMeshyTexturePrompt(e.target.value)}
                    placeholder="Guide the texturing (max 600 chars)"
                    maxLength={600}
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Image Processing</span>
            <MiniCheck label="Image Enhancement" checked={meshyImageEnhancement} onChange={setMeshyImageEnhancement}
              hint="Optimize input images for better results" />
            <MiniCheck label="Remove Lighting" checked={meshyRemoveLighting} onChange={setMeshyRemoveLighting}
              hint="Remove highlights/shadows from base color for cleaner lighting" />
          </div>

          <FormatPicker
            label="Output Formats"
            selected={meshyTargetFormats}
            onChange={(v) => setMeshyTargetFormats(v as MeshyOutputFormat[])}
            options={MESHY_OUTPUT_FORMATS}
          />

          <div className="space-y-1 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Sizing</span>
            <MiniCheck label="Auto Size (AI-estimated real-world scale)" checked={meshyAutoSize} onChange={setMeshyAutoSize} />
            {meshyAutoSize && (
              <MiniSelect label="Origin" value={meshyOriginAt} onChange={setMeshyOriginAt} options={[
                { value: "bottom", label: "Bottom" },
                { value: "center", label: "Center" },
              ]} />
            )}
          </div>

          <NumberStepper label="Generations" value={meshyCount} onChange={setMeshyCount} min={1} max={10} />

          <Button size="sm" className="w-full" onClick={() => checkViewsAndRun(handleMeshyGenerate)}>
            <Box size={12} className="mr-1" />
            Create Model{meshyCount > 1 ? "s" : ""} (Meshy)
            {meshyInProgress > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full tabular-nums" style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa" }}>
                {meshyInProgress} in progress
              </span>
            )}
          </Button>
        </div>
      </PanelSection>

      {/* ── Hitem3D ── */}
      <PanelSection title="Hitem 3D" defaultOpen={false}>
        <div className="space-y-2.5">
          <MiniSelect
            label="Model"
            value={hitemModel}
            onChange={(v) => {
              const m = v as Hitem3DModel;
              setHitemModel(m);
              const res = HITEM3D_MODEL_INFO[m]?.resolutions ?? [];
              if (!res.includes(hitemResolution)) setHitemResolution(res[0] as Hitem3DResolution ?? "1536pro");
            }}
            options={Object.entries(HITEM3D_MODEL_INFO).map(([k, v]) => ({ value: k, label: v.label }))}
          />

          <MiniSelect
            label="Resolution"
            value={hitemResolution}
            onChange={(v) => setHitemResolution(v as Hitem3DResolution)}
            options={availableResolutions.map((r) => ({ value: r, label: r }))}
          />

          <MiniSelect
            label="Output Format"
            value={String(hitemFormat)}
            onChange={(v) => setHitemFormat(Number(v) as Hitem3DFormat)}
            options={Object.entries(HITEM3D_FORMAT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          />

          <CountPicker
            label="Face Count"
            value={hitemFace}
            onChange={setHitemFace}
            presets={HITEM3D_FACE_PRESETS}
            min={100000}
            max={2000000}
          />

          <NumberStepper label="Generations" value={hitemCount} onChange={setHitemCount} min={1} max={10} />

          <Button size="sm" className="w-full" onClick={() => checkViewsAndRun(handleHitemGenerate)}>
            <Box size={12} className="mr-1" />
            Create Model{hitemCount > 1 ? "s" : ""} (Hitem3D)
            {hitemInProgress > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full tabular-nums" style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa" }}>
                {hitemInProgress} in progress
              </span>
            )}
          </Button>
        </div>
      </PanelSection>
    </div>
  );

  const confirmDialog = confirmOpen ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="rounded-lg p-5 max-w-sm w-full mx-4" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={20} style={{ color: "#f59e0b" }} className="shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Missing Views</h3>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
              The following views are not available: <strong>{missingViews.join(", ")}</strong>.
              For best results, generate front, back, and side views first.
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
              Generate anyway with the available views, or cancel to set up the missing views?
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="secondary" onClick={() => { setConfirmOpen(null); setMissingViews([]); }}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const action = confirmOpen;
              setConfirmOpen(null);
              setMissingViews([]);
              action();
            }}
          >
            Generate Anyway
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  if (embedded) {
    return (
      <>
        {innerContent}
        {confirmDialog}
      </>
    );
  }

  return (
    <div className="shrink-0" style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer"
        style={{ color: "var(--color-text-secondary)", background: "var(--color-card)", border: "none", borderRadius: "var(--radius-md)" }}
      >
        <span className="flex items-center gap-1.5">
          <Box size={12} />
          3D Gen AI
        </span>
        <span className="flex items-center gap-1.5">
          {(meshyInProgress + hitemInProgress) > 0 && (
            <>
              <Loader2 size={11} className="animate-spin" style={{ color: "#3b82f6" }} />
              <span className="text-[10px] tabular-nums" style={{ color: "#60a5fa" }}>{meshyInProgress + hitemInProgress}</span>
            </>
          )}
          <span className="text-[10px]">{open ? "\u25BE" : "\u25B8"}</span>
        </span>
      </button>

      {open && innerContent}
      {confirmDialog}
    </div>
  );
}
