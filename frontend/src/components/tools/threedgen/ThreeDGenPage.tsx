import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { MaterialWorkshop } from "./MaterialWorkshop";

type ActiveTab = "queue" | "workshop";

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

  const [activeTab, setActiveTab] = useState<ActiveTab>("queue");
  const [workshopJob, setWorkshopJob] = useState<{ taskId: string; modelUrl: string; service: string } | null>(null);

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

  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  /* ── Load jobs + settings on mount AND when page becomes visible ── */
  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
    getThreeDSettings().then(setSettings).catch(() => {});
  }, []);

  const refreshJobList = useCallback(() => {
    listJobs().then((fresh) => {
      setJobs((prev) => {
        const existingIds = new Set(prev.map((j) => j.task_id));
        const newJobs = fresh.filter((j) => !existingIds.has(j.task_id));
        if (newJobs.length === 0) return prev;
        return [...newJobs, ...prev];
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
        <button
          onClick={() => setActiveTab("queue")}
          className="flex items-center gap-1.5 px-3 py-1 rounded-t text-[11px] font-semibold transition-colors"
          style={{
            background: activeTab === "queue" ? "var(--color-background)" : "transparent",
            borderBottom: activeTab === "queue" ? "2px solid #8b5cf6" : "2px solid transparent",
            color: activeTab === "queue" ? "var(--color-text-primary)" : "var(--color-text-muted)",
            border: "none",
            borderBottomStyle: "solid",
            borderBottomWidth: 2,
            borderBottomColor: activeTab === "queue" ? "#8b5cf6" : "transparent",
            cursor: "pointer",
          }}
        >
          <List size={13} /> Generation Queue
        </button>
        <button
          onClick={() => setActiveTab("workshop")}
          className="flex items-center gap-1.5 px-3 py-1 rounded-t text-[11px] font-semibold transition-colors"
          style={{
            background: activeTab === "workshop" ? "var(--color-background)" : "transparent",
            border: "none",
            borderBottomStyle: "solid",
            borderBottomWidth: 2,
            borderBottomColor: activeTab === "workshop" ? "#8b5cf6" : "transparent",
            color: activeTab === "workshop" ? "var(--color-text-primary)" : "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          <Paintbrush size={13} /> Material Workshop
        </button>
      </div>

      {/* ── Workshop tab content ── */}
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
                No 3D generation jobs yet. Start a generation from any tool's 3D sidebar.
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

/* ── Job row ── */

function JobRow({ job, selected, onClick, onOpenWorkshop }: { job: ThreeDJob; selected: boolean; onClick: () => void; onOpenWorkshop: () => void }) {
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
