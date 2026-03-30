import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, Button, Select, PanelSection } from "@/components/ui";
import { ModelViewer } from "@/components/shared/ModelViewer";
import type { ModelViewerExportFormat } from "@/components/shared/ModelViewer";
import {
  listJobs,
  meshyPollTask,
  hitem3dQueryTask,
  proxyModel,
  exportModel,
  getThreeDSettings,
  saveThreeDSettings,
  type ThreeDJob,
  type ThreeDSettings,
} from "@/lib/threedgenApi";
import { useToastContext } from "@/hooks/ToastContext";
import {
  Box,
  RefreshCw,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Settings,
  FolderOpen,
  Paintbrush,
  List,
  Plus,
  Upload,
  X,
  ImageIcon,
  Wrench,
  Trash2,
} from "lucide-react";
import { MaterialWorkshop } from "./MaterialWorkshop";
import ModelWorkshopTab from "./ModelWorkshopTab";
import { ThreeDGenSidebar, type ViewImage } from "@/components/shared/ThreeDGenSidebar";

type ActiveTab = "create" | "queue" | "model" | "workshop";

/* ── View slot definitions for image uploads ──────────────── */

interface ViewSlot {
  key: string;
  label: string;
  hint: string;
  services: ("meshy" | "hitem3d")[];
}

const VIEW_SLOTS: ViewSlot[] = [
  { key: "front",         label: "Front",          hint: "Straight-on front view",                    services: ["meshy", "hitem3d"] },
  { key: "back",          label: "Back",           hint: "Straight-on rear view",                     services: ["meshy", "hitem3d"] },
  { key: "side",          label: "Side (Left)",    hint: "Left profile view — maps to 'left' for Hitem3D", services: ["meshy", "hitem3d"] },
  { key: "right",         label: "Right",          hint: "Right profile view",                        services: ["hitem3d"] },
  { key: "three_quarter", label: "Three-Quarter",  hint: "¾ angle for extra detail (Meshy only)",     services: ["meshy"] },
];

interface UploadedView {
  key: string;
  base64: string;
  mimeType: string;
  previewUrl: string;
}

/* ── Status helpers ────────────────────────────────────────── */

function isTerminal(status: string): boolean {
  const s = status.toUpperCase();
  return s === "SUCCEEDED" || s === "SUCCESS" || s === "FAILED" || s === "CANCELED";
}

function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === "SUCCEEDED" || s === "SUCCESS") return "#22c55e";
  if (s === "FAILED" || s === "CANCELED") return "#ef4444";
  if (s === "IN_PROGRESS" || s === "PROCESSING") return "#3b82f6";
  return "var(--color-text-muted)";
}

function StatusIcon({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "SUCCEEDED" || s === "SUCCESS") return <CheckCircle2 size={14} style={{ color: "#22c55e" }} />;
  if (s === "FAILED" || s === "CANCELED") return <XCircle size={14} style={{ color: "#ef4444" }} />;
  if (s === "IN_PROGRESS" || s === "PROCESSING") return <Loader2 size={14} className="animate-spin" style={{ color: "#3b82f6" }} />;
  return <Clock size={14} style={{ color: "var(--color-text-muted)" }} />;
}

/* ── Main page ─────────────────────────────────────────────── */

export function ThreeDGenPage({ visible = true }: { visible?: boolean }) {
  const { addToast } = useToastContext();

  const [activeTab, setActiveTab] = useState<ActiveTab>("create");
  const [workshopJob, setWorkshopJob] = useState<{ taskId: string; modelUrl: string; service: string } | null>(null);
  const [modelWsUrl, setModelWsUrl] = useState<string | null>(null);
  const [modelWsJobId, setModelWsJobId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ThreeDJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [settings, setSettings] = useState<ThreeDSettings>({});
  const [showSettings, setShowSettings] = useState(false);
  const [exportDirOverride, setExportDirOverride] = useState("");

  const handleOpenInWorkshop = useCallback(async (job: ThreeDJob) => {
    let remoteUrl = "";
    if (job.service === "meshy" && job.model_urls?.glb) {
      remoteUrl = job.model_urls.glb;
    } else if (job.service === "hitem3d" && job.url) {
      remoteUrl = job.url;
    }
    if (!remoteUrl) {
      addToast("No model URL available yet", "info");
      return;
    }
    try {
      const blobUrl = await proxyModel(job.service, remoteUrl);
      setWorkshopJob({ taskId: job.task_id, modelUrl: blobUrl, service: job.service });
      setActiveTab("workshop");
    } catch (e) {
      addToast(`Failed to load model: ${(e as Error).message}`, "error");
    }
  }, [addToast]);

  const handleOpenInModelWorkshop = useCallback(async (job: ThreeDJob) => {
    let remoteUrl = "";
    if (job.service === "meshy" && job.model_urls?.glb) {
      remoteUrl = job.model_urls.glb;
    } else if (job.service === "hitem3d" && job.url) {
      remoteUrl = job.url;
    }
    if (!remoteUrl) {
      addToast("No model URL available yet", "info");
      return;
    }
    try {
      const blobUrl = await proxyModel(job.service, remoteUrl);
      setModelWsUrl(blobUrl);
      setModelWsJobId(job.task_id);
      setActiveTab("model");
    } catch (e) {
      addToast(`Failed to load model: ${(e as Error).message}`, "error");
    }
  }, [addToast]);

  const loadModelForWorkshop = useCallback(async (job: ThreeDJob): Promise<string> => {
    let remoteUrl = "";
    if (job.service === "meshy" && job.model_urls?.glb) remoteUrl = job.model_urls.glb;
    else if (job.service === "hitem3d" && job.url) remoteUrl = job.url;
    if (!remoteUrl) throw new Error("No model URL");
    return proxyModel(job.service, remoteUrl);
  }, []);

  const succeededJobs = useMemo(() =>
    jobs.filter((j) => {
      const s = j.status.toUpperCase();
      return s === "SUCCEEDED" || s === "SUCCESS";
    }),
  [jobs]);

  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  /* ── Load jobs + settings on mount AND when page becomes visible ── */
  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
    getThreeDSettings().then(setSettings).catch(() => {});
  }, []);

  const refreshJobList = useCallback(() => {
    listJobs().then((fresh) => {
      setJobs((prev) => {
        const freshMap = new Map(fresh.map((j) => [j.task_id, j]));
        const prevMap = new Map(prev.map((j) => [j.task_id, j]));

        // Merge: update existing jobs with fresh data, add new ones
        const merged: ThreeDJob[] = [];
        const seen = new Set<string>();

        // Start with fresh jobs (preserves server ordering)
        for (const fj of fresh) {
          seen.add(fj.task_id);
          const existing = prevMap.get(fj.task_id);
          if (existing) {
            merged.push({ ...existing, ...fj });
          } else {
            merged.push(fj);
          }
        }

        // Append any local-only jobs the server doesn't know about yet
        for (const pj of prev) {
          if (!seen.has(pj.task_id)) {
            merged.push(pj);
          }
        }

        return merged;
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return;
    refreshJobList();
    const interval = setInterval(refreshJobList, 5000);
    return () => clearInterval(interval);
  }, [visible, refreshJobList]);

  /* ── Poll active jobs ── */
  const pollJob = useCallback(async (job: ThreeDJob) => {
    try {
      if (job.service === "meshy") {
        const result = await meshyPollTask(job.task_id, job.type === "multi");
        setJobs((prev) =>
          prev.map((j) =>
            j.task_id === job.task_id
              ? { ...j, status: result.status, progress: result.progress, model_urls: result.model_urls, thumbnail_url: result.thumbnail_url }
              : j,
          ),
        );
        if (isTerminal(result.status)) {
          const timer = pollTimers.current.get(job.task_id);
          if (timer) { clearInterval(timer); pollTimers.current.delete(job.task_id); }
        }
      } else {
        const result = await hitem3dQueryTask(job.task_id);
        setJobs((prev) =>
          prev.map((j) =>
            j.task_id === job.task_id
              ? { ...j, status: result.status, progress: result.progress ?? 0, url: result.url, cover_url: result.cover_url }
              : j,
          ),
        );
        if (isTerminal(result.status)) {
          const timer = pollTimers.current.get(job.task_id);
          if (timer) { clearInterval(timer); pollTimers.current.delete(job.task_id); }
        }
      }
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      for (const timer of pollTimers.current.values()) clearInterval(timer);
      pollTimers.current.clear();
      return;
    }
    for (const job of jobs) {
      if (!isTerminal(job.status) && !pollTimers.current.has(job.task_id)) {
        const timer = setInterval(() => pollJob(job), 3000);
        pollTimers.current.set(job.task_id, timer);
        pollJob(job);
      }
    }
    return () => {
      for (const timer of pollTimers.current.values()) clearInterval(timer);
      pollTimers.current.clear();
    };
  }, [jobs.length, pollJob, visible]);

  /* ── Load selected model ── */
  const handleSelectJob = useCallback(async (job: ThreeDJob) => {
    setSelectedJobId(job.task_id);
    setLoadingModel(true);
    try {
      let remoteUrl = "";
      if (job.service === "meshy" && job.model_urls?.glb) {
        remoteUrl = job.model_urls.glb;
      } else if (job.service === "hitem3d" && job.url) {
        remoteUrl = job.url;
      }
      if (!remoteUrl) {
        addToast("No model URL available yet", "info");
        setLoadingModel(false);
        return;
      }
      const blobUrl = await proxyModel(job.service, remoteUrl);
      setModelUrl(blobUrl);
    } catch (e) {
      addToast(`Failed to load model: ${(e as Error).message}`, "error");
    }
    setLoadingModel(false);
  }, [addToast]);

  /* ── Export ── */
  const handleExport = useCallback(
    async (format: ModelViewerExportFormat) => {
      const job = jobs.find((j) => j.task_id === selectedJobId);
      if (!job) return;

      let remoteUrl = "";
      if (job.service === "meshy") {
        remoteUrl = job.model_urls?.[format] ?? job.model_urls?.glb ?? "";
      } else if (job.service === "hitem3d") {
        remoteUrl = job.url ?? "";
      }
      if (!remoteUrl) {
        addToast(`No ${format} URL available`, "info");
        return;
      }

      const dir = exportDirOverride
        || (job.service === "meshy" ? settings.meshy_export_dir : settings.hitem3d_export_dir)
        || "";
      if (!dir) {
        addToast("Set an export directory in settings first", "info");
        setShowSettings(true);
        return;
      }

      const ext = format === "obj" ? "obj" : format === "fbx" ? "fbx" : format === "usdz" ? "usdz" : "glb";
      const filename = `${job.service}_${job.task_id.slice(0, 8)}.${ext}`;

      try {
        const result = await exportModel(remoteUrl, dir, filename);
        addToast(`Exported to ${result.path} (${(result.size / 1024).toFixed(0)} KB)`, "success");
      } catch (e) {
        addToast(`Export failed: ${(e as Error).message}`, "error");
      }
    },
    [selectedJobId, jobs, settings, exportDirOverride, addToast],
  );

  const handleRefresh = useCallback(async () => {
    try {
      const fresh = await listJobs();
      setJobs(fresh);
      addToast("Job list refreshed", "success");
    } catch {
      addToast("Failed to refresh jobs", "error");
    }
  }, [addToast]);

  const selectedJob = jobs.find((j) => j.task_id === selectedJobId);
  const thumbnailUrl = selectedJob?.thumbnail_url ?? selectedJob?.cover_url;

  const meshyJobs = jobs.filter((j) => j.service === "meshy");
  const hitemJobs = jobs.filter((j) => j.service === "hitem3d");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Tab bar ── */}
      <div
        className="shrink-0 flex items-center gap-0 px-1"
        style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        {([
          { key: "create" as ActiveTab, icon: <Plus size={13} />, label: "New Generation" },
          { key: "queue" as ActiveTab, icon: <List size={13} />, label: "Generation Queue" },
          { key: "model" as ActiveTab, icon: <Wrench size={13} />, label: "Model Workshop" },
          { key: "workshop" as ActiveTab, icon: <Paintbrush size={13} />, label: "Material Workshop" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-t text-[11px] font-semibold transition-colors"
            style={{
              background: activeTab === tab.key ? "var(--color-background)" : "transparent",
              border: "none",
              borderBottomStyle: "solid",
              borderBottomWidth: 2,
              borderBottomColor: activeTab === tab.key ? "#8b5cf6" : "transparent",
              color: activeTab === tab.key ? "var(--color-text-primary)" : "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── New Generation tab content ── */}
      {activeTab === "create" && (
        <NewGenerationPanel onJobStarted={() => { setActiveTab("queue"); refreshJobList(); }} />
      )}

      {/* ── Model Workshop tab content ── */}
      {activeTab === "model" && (
        <div className="flex-1 min-h-0">
          <ModelWorkshopTab
            succeededJobs={succeededJobs}
            initialModelUrl={modelWsUrl}
            initialJobId={modelWsJobId}
            onLoadModel={loadModelForWorkshop}
          />
        </div>
      )}

      {/* ── Material Workshop tab content ── */}
      {activeTab === "workshop" && (
        <div className="flex-1 min-h-0">
          <MaterialWorkshop initialJob={workshopJob} />
        </div>
      )}

      {/* ── Queue tab content ── */}
      {activeTab === "queue" && (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Left: Job Queue ── */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{
          width: 320,
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        <div
          className="flex items-center justify-between px-3 shrink-0"
          style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            3D Generation Queue
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings((p) => !p)}
              className="p-1 rounded cursor-pointer"
              style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={handleRefresh}
              className="p-1 rounded cursor-pointer"
              style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Settings inline */}
        {showSettings && (
          <div className="px-3 py-2 space-y-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <label className="block text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Meshy Export Dir
              <input
                className="w-full mt-0.5 px-2 py-1 rounded text-xs"
                style={{ background: "var(--color-background)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={settings.meshy_export_dir ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, meshy_export_dir: e.target.value }))}
                placeholder="C:\Models\Meshy"
              />
            </label>
            <label className="block text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Hitem3D Export Dir
              <input
                className="w-full mt-0.5 px-2 py-1 rounded text-xs"
                style={{ background: "var(--color-background)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={settings.hitem3d_export_dir ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, hitem3d_export_dir: e.target.value }))}
                placeholder="C:\Models\Hitem3D"
              />
            </label>
            <label className="block text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Blender Path
              <input
                className="w-full mt-0.5 px-2 py-1 rounded text-xs"
                style={{ background: "var(--color-background)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={settings.blender_path ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, blender_path: e.target.value }))}
                placeholder="C:\Program Files\Blender Foundation\Blender 4.4\blender.exe"
              />
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={async () => {
                  try {
                    await saveThreeDSettings(settings);
                    addToast("3D settings saved", "success");
                  } catch {
                    addToast("Failed to save settings", "error");
                  }
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowSettings(false)}>Close</Button>
            </div>
          </div>
        )}

        {/* Job list */}
        <div className="flex-1 overflow-y-auto">
          {jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
              <Box size={32} style={{ color: "var(--color-text-muted)" }} />
              <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                No 3D generation jobs yet. Use the "New Generation" tab or any tool's 3D sidebar to start one.
              </p>
            </div>
          )}

          {meshyJobs.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-text-muted)", background: "var(--color-background)" }}>
                Meshy AI
              </div>
              {meshyJobs.map((job) => (
                <JobRow
                  key={job.task_id}
                  job={job}
                  selected={selectedJobId === job.task_id}
                  onClick={() => handleSelectJob(job)}
                  onOpenWorkshop={() => handleOpenInWorkshop(job)}
                  onOpenModelWorkshop={() => handleOpenInModelWorkshop(job)}
                />
              ))}
            </div>
          )}

          {hitemJobs.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-text-muted)", background: "var(--color-background)" }}>
                Hitem 3D
              </div>
              {hitemJobs.map((job) => (
                <JobRow
                  key={job.task_id}
                  job={job}
                  selected={selectedJobId === job.task_id}
                  onClick={() => handleSelectJob(job)}
                  onOpenWorkshop={() => handleOpenInWorkshop(job)}
                  onOpenModelWorkshop={() => handleOpenInModelWorkshop(job)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Export dir override */}
        {selectedJob && (
          <div className="px-3 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
            <label className="flex items-center gap-1 text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              <FolderOpen size={11} />
              Export Override
            </label>
            <input
              className="w-full mt-0.5 px-2 py-1 rounded text-xs"
              style={{ background: "var(--color-background)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              value={exportDirOverride}
              onChange={(e) => setExportDirOverride(e.target.value)}
              placeholder="Leave empty to use settings default"
            />
          </div>
        )}
      </div>

      {/* ── Right: 3D Viewer ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--color-background)" }}>
        {loadingModel ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
          </div>
        ) : (
          <ModelViewer
            modelUrl={modelUrl}
            thumbnailUrl={thumbnailUrl}
            height="100%"
            onExport={(format) => handleExport(format)}
          />
        )}
      </div>
    </div>
      )}
    </div>
  );
}

/* ── New Generation panel ─────────────────────────────────── */

function NewGenerationPanel({ onJobStarted }: { onJobStarted: () => void }) {
  const [uploads, setUploads] = useState<UploadedView[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotRef = useRef<string | null>(null);

  const handleFileSelect = useCallback((slotKey: string) => {
    activeSlotRef.current = slotKey;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slotKey = activeSlotRef.current;
    if (!file || !slotKey) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header] = dataUrl.split(",");
      const mimeType = header.match(/data:(.*?);/)?.[1] ?? "image/png";
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const previewUrl = dataUrl;

      setUploads((prev) => {
        const filtered = prev.filter((u) => u.key !== slotKey);
        return [...filtered, { key: slotKey, base64, mimeType, previewUrl }];
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((slotKey: string) => {
    navigator.clipboard.read().then(async (items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            setUploads((prev) => {
              const filtered = prev.filter((u) => u.key !== slotKey);
              return [...filtered, { key: slotKey, base64, mimeType: imageType, previewUrl: dataUrl }];
            });
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }).catch(() => {});
  }, []);

  const removeUpload = useCallback((key: string) => {
    setUploads((prev) => prev.filter((u) => u.key !== key));
  }, []);

  const getViewImages = useCallback((): ViewImage[] => {
    return uploads.map((u) => {
      const slot = VIEW_SLOTS.find((s) => s.key === u.key);
      return {
        viewKey: u.key,
        label: slot?.label ?? u.key,
        base64: u.base64,
        mimeType: u.mimeType,
      };
    });
  }, [uploads]);

  const uploadedKeys = new Set(uploads.map((u) => u.key));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Left: Image uploads ── */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{ width: 360, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        <div
          className="px-3 shrink-0 flex items-center"
          style={{ height: 44, borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            Upload Reference Images
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

          {/* Service guidance */}
          <div className="space-y-2">
            <div className="rounded-lg p-2.5" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <p className="text-[10px] font-semibold mb-1" style={{ color: "#a78bfa" }}>Meshy AI</p>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Accepts <strong>1 or more</strong> images. Best results with <strong>Front + Back + Side</strong>. Three-quarter views add extra detail.
              </p>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <p className="text-[10px] font-semibold mb-1" style={{ color: "#60a5fa" }}>Hitem 3D</p>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                Uses directional slots: <strong>Front, Back, Left (Side), Right</strong>. Provide at least <strong>Front + Back</strong> for good results. Single image also supported.
              </p>
            </div>
          </div>

          {/* Upload slots */}
          <div className="space-y-2">
            {VIEW_SLOTS.map((slot) => {
              const uploaded = uploads.find((u) => u.key === slot.key);
              return (
                <div key={slot.key} className="flex items-center gap-3">
                  {/* Thumbnail / upload area */}
                  <button
                    type="button"
                    onClick={() => uploaded ? undefined : handleFileSelect(slot.key)}
                    className="shrink-0 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer relative group"
                    style={{
                      width: 64,
                      height: 64,
                      background: uploaded ? "var(--color-background)" : "var(--color-input-bg)",
                      border: uploaded
                        ? "2px solid rgba(34,197,94,0.4)"
                        : uploadedKeys.size > 0 && !uploaded
                          ? "2px dashed var(--color-border)"
                          : "2px dashed rgba(148,163,184,0.3)",
                    }}
                    title={uploaded ? slot.label : `Upload ${slot.label} view`}
                  >
                    {uploaded ? (
                      <img src={uploaded.previewUrl} alt={slot.label} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <Upload size={14} style={{ color: "var(--color-text-muted)" }} />
                        <span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>Upload</span>
                      </div>
                    )}
                  </button>

                  {/* Label + actions */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold" style={{ color: "var(--color-text-primary)" }}>{slot.label}</span>
                      <div className="flex gap-0.5">
                        {slot.services.map((svc) => (
                          <span
                            key={svc}
                            className="text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{
                              background: svc === "meshy" ? "rgba(139,92,246,0.12)" : "rgba(59,130,246,0.12)",
                              color: svc === "meshy" ? "#a78bfa" : "#60a5fa",
                            }}
                          >
                            {svc === "meshy" ? "M" : "H"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-[9px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{slot.hint}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        type="button"
                        onClick={() => handleFileSelect(slot.key)}
                        className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                      >
                        {uploaded ? "Replace" : "Browse"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePaste(slot.key)}
                        className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                      >
                        Paste
                      </button>
                      {uploaded && (
                        <button
                          type="button"
                          onClick={() => removeUpload(slot.key)}
                          className="p-0.5 rounded cursor-pointer"
                          style={{ background: "transparent", border: "none", color: "#ef4444" }}
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="rounded-lg p-2" style={{ background: "var(--color-background)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-2">
              <ImageIcon size={13} style={{ color: "var(--color-text-muted)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                {uploads.length === 0
                  ? "No images uploaded yet"
                  : `${uploads.length} image${uploads.length > 1 ? "s" : ""} ready: ${uploads.map((u) => VIEW_SLOTS.find((s) => s.key === u.key)?.label ?? u.key).join(", ")}`
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Generation settings (ThreeDGenSidebar) ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ background: "var(--color-background)" }}>
        {uploads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
            <Box size={40} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            <p className="text-sm font-medium text-center" style={{ color: "var(--color-text-muted)" }}>
              Upload at least one reference image to configure generation settings
            </p>
            <p className="text-xs text-center" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>
              Use the panel on the left to add front, back, and side views of your subject
            </p>
          </div>
        ) : (
          <div className="p-4">
            <ThreeDGenSidebar
              getViewImages={getViewImages}
              toolLabel="3D Gen AI"
              embedded
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Job row ── */

function JobRow({ job, selected, onClick, onOpenWorkshop, onOpenModelWorkshop }: { job: ThreeDJob; selected: boolean; onClick: () => void; onOpenWorkshop: () => void; onOpenModelWorkshop: () => void }) {
  const isReady = isTerminal(job.status) && (job.status.toUpperCase() === "SUCCEEDED" || job.status.toUpperCase() === "SUCCESS");
  const timeAgo = job.created_at ? formatTimeAgo(job.created_at) : "";

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-2 text-left cursor-pointer"
      style={{
        background: selected ? "var(--color-hover)" : "transparent",
        border: "none",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    >
      {/* Thumbnail */}
      <div
        className="shrink-0 rounded overflow-hidden flex items-center justify-center"
        style={{ width: 40, height: 40, background: "var(--color-background)", border: "1px solid var(--color-border)" }}
      >
        {job.thumbnail_url || job.cover_url ? (
          <img src={job.thumbnail_url || job.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Box size={16} style={{ color: "var(--color-text-muted)" }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <StatusIcon status={job.status} />
          <span className="text-[11px] font-medium truncate">{job.task_id.slice(0, 12)}...</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-medium px-1 py-0.5 rounded"
            style={{ background: "rgba(255,255,255,0.06)", color: statusColor(job.status) }}
          >
            {job.status}
          </span>
          {!isTerminal(job.status) && job.progress > 0 && (
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {job.progress}%
            </span>
          )}
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{timeAgo}</span>
        </div>
        {job.model && (
          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
            {job.model}{job.resolution ? ` • ${job.resolution}` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 shrink-0">
        {isReady && (
          <>
            <Download size={14} style={{ color: "var(--color-text-muted)" }} />
            <button
              type="button"
              title="Open in Model Workshop"
              onClick={(e) => { e.stopPropagation(); onOpenModelWorkshop(); }}
              className="p-0.5 rounded hover:bg-white/10"
              style={{ color: "var(--color-text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Wrench size={12} />
            </button>
            <button
              type="button"
              title="Open in Material Workshop"
              onClick={(e) => { e.stopPropagation(); onOpenWorkshop(); }}
              className="p-0.5 rounded hover:bg-white/10"
              style={{ color: "var(--color-text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Paintbrush size={12} />
            </button>
          </>
        )}
      </div>
    </button>
  );
}

function formatTimeAgo(ts: number): string {
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
