import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Card, Button, Textarea } from "@/components/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { ArtboardCanvas } from "@/components/shared/ArtboardCanvas";
import { VideoEditor } from "@/components/shared/VideoEditor";
import type { VideoEditorState } from "@/components/shared/VideoEditor";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { readClipboardImage } from "@/hooks/useClipboardPaste";
import { useGenerationStatus } from "@/hooks/GenerationStatusContext";
import { ChevronDown, ChevronRight, X, Upload, Film, FolderOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VeoModel {
  id: string;
  label: string;
  description: string;
  resolutions: string[];
  durations: number[];
  has_audio: boolean;
  supports_refs: boolean;
  supports_interpolation: boolean;
  status: string;
}

interface VideoTab {
  id: string;
  label: string;
  videoB64: string;
  prompt: string;
  model: string;
  editorState: VideoEditorState | null;
}

interface RefSlotState {
  image_b64: string | null;
  description: string;
}

const EMPTY_REF: RefSlotState = { image_b64: null, description: "" };
const REF_LABELS = ["Ref A", "Ref B", "Ref C"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
}

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

function openFileAsDataUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function openVideoFile(): Promise<{ b64: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/webm,video/quicktime,video/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.replace(/^data:video\/[^;]+;base64,/, "");
        resolve({ b64, name: file.name.replace(/\.[^.]+$/, "") });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = { color: "var(--color-text-secondary)" };
const mutedStyle: React.CSSProperties = { color: "var(--color-text-muted)" };
const selectStyle: React.CSSProperties = { background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" };

// ---------------------------------------------------------------------------
// Collapsible section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle, open, onToggle }: { title: string; subtitle?: string; open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      className="w-full flex items-center gap-1.5 cursor-pointer"
      style={{ background: "none", border: "none", padding: 0 }}
      onClick={onToggle}
    >
      <Icon size={12} style={mutedStyle} />
      <span className="text-xs font-semibold uppercase tracking-wider" style={headingStyle}>{title}</span>
      {subtitle && <span className="text-[9px] ml-auto" style={mutedStyle}>{subtitle}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Image slot (used for start frame, last frame)
// ---------------------------------------------------------------------------

function ImageSlot({ label, hint, src, onSet, onClear, disabled }: { label: string; hint: string; src: string | null; onSet: (url: string) => void; onClear: () => void; disabled: boolean }) {
  const handleOpen = useCallback(async () => { const url = await openFileAsDataUrl(); if (url) onSet(url); }, [onSet]);
  const handlePaste = useCallback(async () => { try { const url = await readClipboardImage(); if (url) onSet(url); } catch { /* */ } }, [onSet]);

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium" style={mutedStyle}>{label}</p>
      {src ? (
        <div className="relative rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          <img src={src} alt={label} className="w-full h-[72px] object-contain" style={{ background: "#111" }} />
          <button className="absolute top-0.5 right-0.5 text-[9px] px-1.5 py-0.5 rounded cursor-pointer" style={{ background: "rgba(0,0,0,.75)", color: "#fff", border: "none" }} onClick={onClear}>Clear</button>
        </div>
      ) : (
        <div className="flex gap-1">
          <Button size="sm" className="flex-1 text-[10px]" onClick={handleOpen} disabled={disabled}>Open</Button>
          <Button size="sm" className="flex-1 text-[10px]" onClick={handlePaste} disabled={disabled}>Paste</Button>
        </div>
      )}
      {!src && <p className="text-[9px]" style={mutedStyle}>{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ref slot
// ---------------------------------------------------------------------------

function RefSlot({ label, slot, onChange, disabled }: { label: string; slot: RefSlotState; onChange: (s: RefSlotState) => void; disabled: boolean }) {
  const handleOpen = useCallback(async () => { const url = await openFileAsDataUrl(); if (url) onChange({ ...slot, image_b64: url }); }, [slot, onChange]);
  const handlePaste = useCallback(async () => { try { const url = await readClipboardImage(); if (url) onChange({ ...slot, image_b64: url }); } catch { /* */ } }, [slot, onChange]);
  const hasImage = !!slot.image_b64;

  return (
    <div className="rounded p-2 space-y-1.5" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold" style={headingStyle}>{label}</span>
        {hasImage && (
          <button className="text-[9px] cursor-pointer" style={{ ...mutedStyle, background: "none", border: "none" }} onClick={() => onChange({ ...slot, image_b64: null })}>Clear</button>
        )}
      </div>
      {hasImage ? (
        <img src={slot.image_b64!} alt={label} className="w-full h-[64px] object-contain rounded" style={{ background: "#111" }} />
      ) : (
        <div className="flex gap-1">
          <Button size="sm" className="flex-1 text-[10px]" onClick={handleOpen} disabled={disabled}>Open</Button>
          <Button size="sm" className="flex-1 text-[10px]" onClick={handlePaste} disabled={disabled}>Paste</Button>
        </div>
      )}
      <input
        type="text"
        className="w-full px-1.5 py-1 text-[10px] rounded"
        style={selectStyle}
        placeholder={`What is this? e.g. "flamingo dress"`}
        value={slot.description}
        onChange={(e) => onChange({ ...slot, description: e.target.value })}
        disabled={disabled}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle button row
// ---------------------------------------------------------------------------

function ToggleRow({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          className="flex-1 px-1.5 py-1 text-[11px] rounded cursor-pointer"
          style={{
            background: value === o.value ? "var(--color-primary)" : "var(--color-input-bg)",
            color: value === o.value ? "#fff" : "var(--color-text-primary)",
            border: `1px solid ${value === o.value ? "var(--color-primary)" : "var(--color-border)"}`,
          }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VeoPage() {
  const [prompt, setPrompt] = useState("");
  const busy = useBusySet();
  const genStatus = useGenerationStatus();
  const prevBusyRef = useRef(false);
  const { addToast } = useToastContext();

  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);
  const [styleDescription, setStyleDescription] = useState("");
  const [describingStyle, setDescribingStyle] = useState(false);

  useEffect(() => {
    if (busy.any && !prevBusyRef.current) genStatus.startPage("veo");
    else if (!busy.any && prevBusyRef.current) genStatus.endPage("veo");
    prevBusyRef.current = busy.any;
  }, [busy.any, genStatus]);

  useEffect(() => {
    apiFetch<{ name: string; guidance_text: string }[]>("/styles/folders?category=general")
      .then(setStyleLibraryFolders)
      .catch(() => {});
  }, []);

  // Models
  const [models, setModels] = useState<VeoModel[]>([]);
  const [modelId, setModelId] = useState("veo-3.1-generate-preview");
  useEffect(() => {
    apiFetch<{ models: VeoModel[] }>("/veo/models").then((r) => setModels(r.models)).catch(() => {});
  }, []);
  const selectedModel = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);

  // Config
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [duration, setDuration] = useState(8);
  const [batchCount, setBatchCount] = useState(1);

  // Frames
  const [startFrameB64, setStartFrameB64] = useState<string | null>(null);
  const [lastFrameB64, setLastFrameB64] = useState<string | null>(null);

  // Reference images
  const [refs, setRefs] = useState<[RefSlotState, RefSlotState, RefSlotState]>([{ ...EMPTY_REF }, { ...EMPTY_REF }, { ...EMPTY_REF }]);
  const setRef = useCallback((idx: number, val: RefSlotState) => {
    setRefs((prev) => { const n = [...prev] as [RefSlotState, RefSlotState, RefSlotState]; n[idx] = val; return n; });
  }, []);

  // Collapsible sections
  const [framesOpen, setFramesOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);

  // ── Dynamic video tabs ──
  const [videoTabs, setVideoTabs] = useState<VideoTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("timeline");
  const videoCountRef = useRef(0);

  // Progress
  const [completedCount, setCompletedCount] = useState(0);
  const [genStartTime, setGenStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!genStartTime) return;
    const tick = setInterval(() => setElapsed(Date.now() - genStartTime), 250);
    return () => clearInterval(tick);
  }, [genStartTime]);

  useEffect(() => {
    if (!selectedModel) return;
    if (selectedModel.resolutions.length > 0 && !selectedModel.resolutions.includes(resolution)) setResolution(selectedModel.resolutions[0]);
    if (!selectedModel.durations.includes(duration)) setDuration(selectedModel.durations[selectedModel.durations.length - 1]);
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const supportsRefs = selectedModel?.supports_refs ?? false;
  const supportsInterp = selectedModel?.supports_interpolation ?? false;
  const hasFrames = !!(startFrameB64 || lastFrameB64);
  const refCount = refs.filter((r) => r.image_b64).length;

  // Close a video tab
  const handleCloseTab = useCallback((tabId: string) => {
    if (!confirm("Remove this video?")) return;
    setVideoTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => prev === tabId ? "timeline" : prev);
  }, []);

  // Update editor state for a tab (called by VideoEditor)
  const handleEditorStateChange = useCallback((tabId: string, state: VideoEditorState) => {
    setVideoTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, editorState: state } : t));
  }, []);

  // Load external video
  const handleLoadVideo = useCallback(async () => {
    const result = await openVideoFile();
    if (!result) return;
    videoCountRef.current += 1;
    const id = `video_${Date.now()}_loaded`;
    const tab: VideoTab = {
      id,
      label: result.name || `Video ${videoCountRef.current}`,
      videoB64: result.b64,
      prompt: "(loaded)",
      model: "",
      editorState: null,
    };
    setVideoTabs((prev) => [...prev, tab]);
    setActiveTabId(id);
    addToast(`Loaded: ${tab.label}`, "success");
  }, [addToast]);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || busy.any) return;
    busy.start("generate");
    setCompletedCount(0);
    setGenStartTime(Date.now());
    setElapsed(0);

    const clean = (b64: string | null) => b64?.replace(/^data:image\/\w+;base64,/, "") || null;
    const refPayload = refs.filter((r) => r.image_b64).map((r) => ({ image_b64: clean(r.image_b64)!, description: r.description }));
    const styleFolder = styleLibraryFolders.find((f) => f.name === styleLibraryFolder);
    const styleGuidance = styleFolder?.guidance_text || undefined;

    const promises = Array.from({ length: batchCount }, (_, i) =>
      apiFetch<{ video_b64?: string; error?: string; duration_seconds?: number }>("/veo/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt, model_id: modelId, aspect_ratio: aspectRatio, resolution, duration_seconds: duration,
          image_b64: clean(startFrameB64),
          last_frame_b64: supportsInterp ? clean(lastFrameB64) : undefined,
          reference_images: supportsRefs && refPayload.length > 0 ? refPayload : undefined,
          style_guidance: styleGuidance,
        }),
      }).then((res) => { setCompletedCount((c) => c + 1); return { ok: true as const, res, idx: i }; })
        .catch((e) => { setCompletedCount((c) => c + 1); return { ok: false as const, error: e instanceof Error ? e.message : String(e), idx: i }; }),
    );

    const results = await Promise.all(promises);
    const newTabs: VideoTab[] = [];
    for (const r of results.sort((a, b) => a.idx - b.idx)) {
      if (r.ok && r.res.video_b64) {
        videoCountRef.current += 1;
        newTabs.push({
          id: `video_${Date.now()}_${r.idx}`,
          label: `Video ${videoCountRef.current}`,
          videoB64: r.res.video_b64,
          prompt: prompt.slice(0, 100),
          model: modelId,
          editorState: null,
        });
      } else if (r.ok && r.res.error) addToast(r.res.error, "error");
      else if (!r.ok) addToast(r.error, "error");
    }
    if (newTabs.length > 0) {
      setVideoTabs((prev) => [...prev, ...newTabs]);
      setActiveTabId(newTabs[0].id);
      addToast(newTabs.length > 1 ? `Generated ${newTabs.length} videos` : "Video generated", "success");
    }
    setGenStartTime(null);
    busy.end("generate");
  }, [prompt, modelId, aspectRatio, resolution, duration, startFrameB64, lastFrameB64, refs, supportsRefs, supportsInterp, batchCount, busy, addToast, styleLibraryFolder, styleLibraryFolders]);

  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim() || busy.is("enhance")) return;
    busy.start("enhance");
    try {
      const refImages = refs.map((r) => r.image_b64).filter(Boolean) as string[];
      const res = await apiFetch<{ prompt?: string; error?: string }>("/veo/enhance-prompt", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          start_frame_b64: startFrameB64 || undefined,
          last_frame_b64: lastFrameB64 || undefined,
          reference_images: refImages.length > 0 ? refImages : undefined,
        }),
      });
      if (res.prompt) {
        setPrompt(res.prompt);
        addToast("Prompt enhanced", "success");
      } else {
        addToast(res.error || "Failed to enhance prompt", "error");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      busy.end("enhance");
    }
  }, [prompt, startFrameB64, lastFrameB64, refs, busy, addToast]);

  const handleDescribeStyle = useCallback(async () => {
    if (!styleLibraryFolder || describingStyle) return;
    setDescribingStyle(true);
    try {
      const res = await apiFetch<{ ok: boolean; description?: string; error?: string }>(
        `/styles/folders/${encodeURIComponent(styleLibraryFolder)}/describe`,
        { method: "POST" },
      );
      if (res.ok && res.description) {
        setStyleDescription(res.description);
        const tag = `\n\n[Style: ${res.description}]`;
        setPrompt((prev) => {
          const cleaned = prev.replace(/\n\n\[Style:.*\]$/s, "");
          return cleaned + tag;
        });
        addToast("Style description added to prompt", "success");
      } else {
        addToast(res.error || "Failed to describe style", "error");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setDescribingStyle(false);
    }
  }, [styleLibraryFolder, describingStyle, addToast]);

  // Session (saves sidebar state + all video tabs with editor state)
  useSessionRegister(
    "veo",
    () => ({
      prompt, modelId, aspectRatio, resolution, duration, batchCount,
      startFrameB64, lastFrameB64, refs, styleLibraryFolder, styleDescription,
      videoTabs: videoTabs.map((t) => ({
        id: t.id,
        label: t.label,
        videoB64: t.videoB64,
        prompt: t.prompt,
        model: t.model,
        editorState: t.editorState ? {
          currentFrameIdx: t.editorState.currentFrameIdx,
          chromaKeySettings: t.editorState.chromaKeySettings,
          editHistory: t.editorState.editHistory,
          audioEnabled: t.editorState.audioEnabled,
          frames: t.editorState.frames.map((f) => ({
            id: f.id,
            editedData: f.editedData,
            enabled: f.enabled,
            duration_ms: f.duration_ms,
          })),
        } : null,
      })),
      activeTabId,
    }),
    (s: unknown) => {
      if (s === null) {
        setPrompt(""); setModelId("veo-3.1-generate-preview"); setAspectRatio("16:9");
        setResolution("720p"); setDuration(8); setBatchCount(1);
        setStartFrameB64(null); setLastFrameB64(null);
        setRefs([{ ...EMPTY_REF }, { ...EMPTY_REF }, { ...EMPTY_REF }]);
        setStyleLibraryFolder(""); setStyleDescription("");
        setVideoTabs([]); setActiveTabId("artboard");
        return;
      }
      const d = s as Record<string, unknown>;
      if (typeof d.prompt === "string") setPrompt(d.prompt);
      if (typeof d.modelId === "string") setModelId(d.modelId);
      if (typeof d.aspectRatio === "string") setAspectRatio(d.aspectRatio);
      if (typeof d.resolution === "string") setResolution(d.resolution);
      if (typeof d.duration === "number") setDuration(d.duration);
      if (typeof d.batchCount === "number") setBatchCount(d.batchCount);
      if (typeof d.startFrameB64 === "string") setStartFrameB64(d.startFrameB64);
      else setStartFrameB64(null);
      if (typeof d.lastFrameB64 === "string") setLastFrameB64(d.lastFrameB64);
      else setLastFrameB64(null);
      if (Array.isArray(d.refs)) setRefs(d.refs as [RefSlotState, RefSlotState, RefSlotState]);
      if (typeof d.styleLibraryFolder === "string") setStyleLibraryFolder(d.styleLibraryFolder);
      if (typeof d.styleDescription === "string") setStyleDescription(d.styleDescription);
      if (Array.isArray(d.videoTabs)) {
        const restored = (d.videoTabs as Record<string, unknown>[]).map((t) => ({
          id: String(t.id),
          label: String(t.label),
          videoB64: String(t.videoB64),
          prompt: String(t.prompt || ""),
          model: String(t.model || ""),
          editorState: t.editorState as VideoEditorState | null,
        }));
        setVideoTabs(restored);
        videoCountRef.current = restored.length;
      }
      if (typeof d.activeTabId === "string") setActiveTabId(d.activeTabId);
    },
  );

  const isGenerating = busy.is("generate");
  const pct = batchCount > 0 && isGenerating ? (completedCount / batchCount) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-[340px] h-full shrink-0 overflow-y-auto p-2.5 space-y-2.5" style={{ borderRight: "1px solid var(--color-border)" }}>

        {/* ── Card 1: Prompt + Model + Generate ── */}
        <Card>
          <div className="px-3 py-2.5 space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe your video — camera motion, subjects, lighting, mood, dialogue, sound effects..."
              disabled={isGenerating}
            />
            <Button
              size="sm"
              className="w-full text-[10px]"
              onClick={handleEnhancePrompt}
              disabled={busy.is("enhance") || isGenerating || !prompt.trim()}
              generating={busy.is("enhance")}
              generatingText="Enhancing..."
            >
              Enhance Prompt
            </Button>

            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={mutedStyle}>Model</label>
              <select className="w-full px-2 py-1.5 text-xs" style={selectStyle} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.status})</option>)}
              </select>
              {selectedModel && (
                <p className="text-[9px] leading-relaxed" style={mutedStyle}>
                  {selectedModel.description}{selectedModel.has_audio && " • Audio"}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <NumberStepper value={batchCount} onChange={setBatchCount} min={1} max={4} label="Count:" />
              </div>
              <Button
                variant="primary"
                className="flex-1"
                generating={isGenerating}
                generatingText={batchCount > 1 ? `${completedCount}/${batchCount}...` : "Generating..."}
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
              >
                Generate
              </Button>
            </div>
            {isGenerating && <p className="text-[9px] text-center" style={mutedStyle}>Videos take 1–3 min per clip</p>}
          </div>
        </Card>

        {/* ── Load Video ── */}
        <Card>
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer"
            style={{ background: "none", border: "none" }}
            onClick={handleLoadVideo}
            disabled={isGenerating}
          >
            <Upload size={14} style={{ color: "var(--color-accent)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--color-text-primary)" }}>Load Video File</span>
            <span className="text-[9px] ml-auto" style={mutedStyle}>MP4, WebM, MOV</span>
          </button>
        </Card>

        {/* ── Card 2: Video Settings ── */}
        <Card>
          <div className="px-3 py-2.5 space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={headingStyle}>Video Settings</p>

            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={mutedStyle}>Aspect Ratio</label>
              <ToggleRow
                options={[{ value: "16:9", label: "Landscape 16:9" }, { value: "9:16", label: "Portrait 9:16" }]}
                value={aspectRatio}
                onChange={setAspectRatio}
              />
            </div>

            {selectedModel && selectedModel.resolutions.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium" style={mutedStyle}>Resolution</label>
                <ToggleRow
                  options={selectedModel.resolutions.map((r) => ({ value: r, label: r.toUpperCase() }))}
                  value={resolution}
                  onChange={setResolution}
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-medium" style={mutedStyle}>Duration</label>
              <ToggleRow
                options={(selectedModel?.durations ?? [4, 6, 8]).map((d) => ({ value: String(d), label: `${d}s` }))}
                value={String(duration)}
                onChange={(v) => setDuration(Number(v))}
              />
            </div>
          </div>
        </Card>

        {/* ── Style Library ── */}
        {styleLibraryFolders.length > 0 && (
          <Card>
            <div className="px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={headingStyle}>Style Library</p>
                <span className="text-[9px]" style={mutedStyle}>text description only</span>
              </div>
              <select
                className="w-full px-2 py-1.5 text-xs rounded-[var(--radius-sm)] min-w-0 truncate"
                style={selectStyle}
                value={styleLibraryFolder}
                onChange={(e) => { setStyleLibraryFolder(e.target.value); setStyleDescription(""); }}
                title="Style folder for visual guidance"
              >
                <option value="">None</option>
                {styleLibraryFolders.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
              {styleLibraryFolder && (
                <Button
                  size="sm"
                  className="w-full text-[10px]"
                  onClick={handleDescribeStyle}
                  disabled={describingStyle || isGenerating}
                  generating={describingStyle}
                  generatingText="Analyzing images..."
                >
                  Describe Selected Style
                </Button>
              )}
              {styleDescription && (
                <p className="text-[9px] leading-relaxed rounded p-1.5" style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)" }}>
                  {styleDescription}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* ── Card 3: Image Inputs (collapsible) ── */}
        <Card>
          <div className="px-3 py-2.5 space-y-2">
            <SectionHeader
              title="Image Inputs"
              subtitle={hasFrames ? (startFrameB64 && lastFrameB64 ? "Start + End" : "Start frame") : "None"}
              open={framesOpen}
              onToggle={() => setFramesOpen((p) => !p)}
            />
            {framesOpen && (
              <div className="space-y-2.5 pt-1">
                <ImageSlot
                  label="Starting Frame"
                  hint="First frame for image-to-video. Omit for text-only."
                  src={startFrameB64}
                  onSet={setStartFrameB64}
                  onClear={() => setStartFrameB64(null)}
                  disabled={isGenerating}
                />
                {supportsInterp && (
                  <ImageSlot
                    label="Last Frame"
                    hint="End frame — Veo interpolates the transition. Veo 3.1 only."
                    src={lastFrameB64}
                    onSet={setLastFrameB64}
                    onClear={() => setLastFrameB64(null)}
                    disabled={isGenerating}
                  />
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── Card 4: Reference Images (collapsible, Veo 3.1 only) ── */}
        {supportsRefs && (
          <Card>
            <div className="px-3 py-2.5 space-y-2">
              <SectionHeader
                title="Reference Images"
                subtitle={refCount > 0 ? `${refCount}/3 loaded` : "Veo 3.1"}
                open={refsOpen}
                onToggle={() => setRefsOpen((p) => !p)}
              />
              {refsOpen && (
                <div className="space-y-2 pt-1">
                  <p className="text-[9px]" style={mutedStyle}>Up to 3 images to guide content and style. Describe each so Veo knows what it represents.</p>
                  {REF_LABELS.map((label, i) => (
                    <RefSlot key={label} label={label} slot={refs[i]} onChange={(v) => setRef(i, v)} disabled={isGenerating} />
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── View All Videos in Gallery ── */}
        <Card>
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer"
            style={{ background: "none", border: "none" }}
            onClick={() => {
              window.dispatchEvent(new CustomEvent("app-navigate", { detail: "generated-images" }));
              setTimeout(() => window.dispatchEvent(new CustomEvent("gallery-select-tool", { detail: "Veo" })), 100);
            }}
          >
            <FolderOpen size={14} style={{ color: "var(--color-accent)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--color-text-primary)" }}>View All Videos in Gallery</span>
          </button>
        </Card>

      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col min-w-0 relative" style={{ background: "var(--color-surface)" }}>
        {/* Dynamic tab bar */}
        <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)", scrollbarWidth: "thin" }}>
          {/* Veo Timeline tab (default) */}
          <button
            className="px-3 py-1 text-xs rounded cursor-pointer shrink-0"
            style={{
              background: activeTabId === "timeline" ? "var(--color-primary)" : "transparent",
              color: activeTabId === "timeline" ? "#fff" : "var(--color-text-secondary)",
              border: "none",
              fontWeight: activeTabId === "timeline" ? 600 : 400,
            }}
            onClick={() => setActiveTabId("timeline")}
          >
            Veo Timeline
          </button>

          {/* Art Table tab */}
          <button
            className="px-3 py-1 text-xs rounded cursor-pointer shrink-0"
            style={{
              background: activeTabId === "artboard" ? "var(--color-primary)" : "transparent",
              color: activeTabId === "artboard" ? "#fff" : "var(--color-text-secondary)",
              border: "none",
              fontWeight: activeTabId === "artboard" ? 600 : 400,
            }}
            onClick={() => setActiveTabId("artboard")}
          >
            Art Table
          </button>

          {/* Video tabs */}
          {videoTabs.map((tab) => (
            <div
              key={tab.id}
              className="flex items-center gap-0.5 shrink-0 rounded overflow-hidden"
              style={{
                background: activeTabId === tab.id ? "var(--color-primary)" : "transparent",
              }}
            >
              <button
                className="px-2 py-1 text-xs cursor-pointer"
                style={{
                  background: "transparent",
                  color: activeTabId === tab.id ? "#fff" : "var(--color-text-secondary)",
                  border: "none",
                  fontWeight: activeTabId === tab.id ? 600 : 400,
                }}
                onClick={() => setActiveTabId(tab.id)}
                title={tab.prompt}
              >
                {tab.label}
              </button>
              <button
                className="px-1 py-1 cursor-pointer"
                style={{
                  background: "transparent",
                  border: "none",
                  color: activeTabId === tab.id ? "rgba(255,255,255,.7)" : "var(--color-text-muted)",
                  lineHeight: 0,
                }}
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                title="Close video"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>

        {/* Tab content */}
        {activeTabId === "artboard" ? (
          <ArtboardCanvas />
        ) : activeTabId === "timeline" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
            <Film size={48} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              {isGenerating ? "Generating your video..." : "Generate or load a video to edit"}
            </p>
            <p className="text-xs max-w-md text-center" style={mutedStyle}>
              {isGenerating
                ? "Veo videos typically take 1–3 minutes. Progress updates below."
                : "Write a prompt and click Generate, or load an existing video file from the sidebar."}
            </p>
            {!isGenerating && (
              <Button
                size="sm"
                className="text-xs mt-1"
                onClick={handleLoadVideo}
              >
                <Upload size={12} className="mr-1.5" /> Load Video File
              </Button>
            )}
          </div>
        ) : (() => {
          const tab = videoTabs.find((t) => t.id === activeTabId);
          if (!tab) return null;
          return (
            <VideoEditor
              key={tab.id}
              videoB64={tab.videoB64}
              prompt={tab.prompt}
              onNotify={(msg, type) => addToast(msg, type)}
              initialState={tab.editorState}
              onStateChange={(state) => handleEditorStateChange(tab.id, state)}
            />
          );
        })()}

        {/* Generation progress bar */}
        {isGenerating && (
          <div className="shrink-0 flex items-center gap-3 px-3 py-1.5" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <div className="relative h-3.5 w-3.5 shrink-0">
              <div className="absolute inset-0 rounded-full animate-spin" style={{ border: "2px solid var(--color-border)", borderTopColor: "var(--color-accent)" }} />
            </div>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-input-bg)" }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent)", transition: "width 300ms", boxShadow: "0 0 6px var(--color-accent)" }} />
            </div>
            <span className="text-[10px] font-mono shrink-0" style={mutedStyle}>{completedCount}/{batchCount}</span>
            <span className="text-[10px] font-mono shrink-0" style={mutedStyle}>{formatElapsed(elapsed)}</span>
            {selectedModel && <span className="text-[10px] shrink-0 truncate max-w-[10rem]" style={mutedStyle}>{selectedModel.label}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
