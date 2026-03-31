import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FolderOpen,
  Upload,
  FileBox,
  Trash2,
  Loader2,
  ChevronDown,
} from "lucide-react";
import type {
  WorkshopProject,
  ModelVersion,
  MaterialSlotInfo,
  TargetingModel,
  RetextureParams,
  DecalState,
} from "@/lib/workshopTypes";
import {
  importModel,
  uploadModel,
  listProjects,
  getProject,
  addVersion,
  deleteProject,
  getModelUrl,
  pollRetexture,
  retextureModel,
  type ProjectSummary,
} from "@/lib/workshopApi";
import { useGLTF } from "@react-three/drei";
import { EditorViewer } from "./EditorViewer";
import { MaterialInspector } from "./MaterialInspector";
import { RetexturePanel, type RetextureJob } from "./RetexturePanel";
import { VersionHistory } from "./VersionHistory";
import { PbrMapsPanel } from "./PbrMapsPanel";
import { UVAtlasEditor } from "./UVAtlasEditor";
import { DecalPlacer } from "./DecalPlacer";
import { AiAnalyzePanel } from "./AiAnalyzePanel";

/* ── Accepted file extensions ─────────────────────────────── */

const ACCEPT = ".glb,.gltf,.obj,.fbx,.stl,.blend";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

export interface MaterialWorkshopProps {
  initialJob?: { taskId: string; modelUrl: string; service: string } | null;
}

export function MaterialWorkshop({ initialJob }: MaterialWorkshopProps) {
  /* ── State ───────────────────────────────────────────────── */
  const [project, setProject] = useState<WorkshopProject | null>(null);
  const [materialSlots, setMaterialSlots] = useState<MaterialSlotInfo[]>([]);
  const [targeting, setTargeting] = useState<TargetingModel>({ scope: "full-object" });
  const [compareMode, setCompareMode] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [pendingJob, setPendingJob] = useState<RetextureJob | null>(null);
  const [importing, setImporting] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [showList, setShowList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<"3d" | "uv">("3d");
  const [decalState, setDecalState] = useState<DecalState | null>(null);
  const [modelCenterOffset, setModelCenterOffset] = useState<[number, number, number]>([0, 0, 0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retexturePromptRef = useRef<((p: string) => void) | null>(null);

  /* ── Derived ─────────────────────────────────────────────── */

  const currentVersion = useMemo(
    () => project?.versions.find((v) => v.id === project.currentVersionId) ?? null,
    [project],
  );

  const currentModelUrl = useMemo(
    () => (project && currentVersion?.glbFile ? getModelUrl(project.id, currentVersion.glbFile) : null),
    [project, currentVersion],
  );

  const compareVersion = useMemo(
    () => (compareVersionId ? project?.versions.find((v) => v.id === compareVersionId) ?? null : null),
    [project, compareVersionId],
  );

  const compareModelUrl = useMemo(
    () => (project && compareVersion?.glbFile ? getModelUrl(project.id, compareVersion.glbFile) : null),
    [project, compareVersion],
  );

  /* ── Helpers ─────────────────────────────────────────────── */

  const refreshProject = useCallback(async (id: string) => {
    try {
      const p = await getProject(id);
      setProject(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setProjectList(await listProjects());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  /* ── Import flow ─────────────────────────────────────────── */

  const handleFileImport = useCallback(async (file: File) => {
    setError(null);
    setImporting(true);
    try {
      const p = await uploadModel(file);
      setProject(p);
      setMaterialSlots([]);
      setTargeting({ scope: "full-object" });
      setCompareMode(false);
      setCompareVersionId(null);
      setPendingJob(null);
      refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [refreshList]);

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileImport(file);
      e.target.value = "";
    },
    [handleFileImport],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileImport(file);
    },
    [handleFileImport],
  );

  /* ── Open from queue (initial job prop) ─────────────────── */

  useEffect(() => {
    if (!initialJob) return;
    (async () => {
      setImporting(true);
      setError(null);
      try {
        const res = await fetch(initialJob.modelUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        const p = await importModel(
          b64,
          "glb",
          `Queue ${initialJob.taskId.slice(0, 8)}`,
          initialJob.service === "meshy" ? initialJob.taskId : undefined,
        );
        setProject(p);
        setMaterialSlots([]);
        setTargeting({ scope: "full-object" });
        setCompareMode(false);
        refreshList();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to import from queue");
      } finally {
        setImporting(false);
      }
    })();
  }, [initialJob]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Retexture submit + polling ─────────────────────────── */

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const handleRetextureSubmit = useCallback(
    async (params: RetextureParams) => {
      if (!project) return;
      setError(null);
      try {
        const taskId = await retextureModel(params);
        if (!taskId) throw new Error("No task ID returned from Meshy retexture");

        const job: RetextureJob = {
          taskId,
          status: "PENDING",
          progress: 0,
          startedAt: Date.now(),
        };
        setPendingJob(job);

        const versionId = `v-${taskId.slice(0, 8)}`;
        await addVersion(project.id, {
          id: versionId,
          label: `Retexture ${project.versions.length}`,
          type: "retexture",
          meshyTaskId: taskId,
          status: "pending",
          prompt: params.text_style_prompt,
        });

        stopPoll();
        pollRef.current = setInterval(async () => {
          try {
            const result = await pollRetexture(taskId);
            setPendingJob((prev) =>
              prev ? { ...prev, status: result.status, progress: result.progress } : null,
            );

            if (result.status === "SUCCEEDED") {
              stopPoll();
              const glbUrl = result.model_urls?.glb;
              if (glbUrl) {
                await addVersion(project.id, {
                  id: versionId,
                  label: `Retexture ${project.versions.length}`,
                  type: "retexture",
                  meshyTaskId: taskId,
                  status: "ready",
                  prompt: params.text_style_prompt,
                  glb_url: glbUrl,
                });
              }
              await refreshProject(project.id);
              setPendingJob(null);
            } else if (result.status === "FAILED") {
              stopPoll();
              setPendingJob((prev) =>
                prev ? { ...prev, status: "FAILED" } : null,
              );
            }
          } catch { /* retry next tick */ }
        }, 3000);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Retexture failed");
      }
    },
    [project, refreshProject, stopPoll],
  );

  useEffect(() => stopPoll, [stopPoll]);

  const handleVersionCreated = useCallback(() => {
    if (project) refreshProject(project.id);
  }, [project, refreshProject]);

  const handleApplyRetexturePrompt = useCallback((prompt: string) => {
    retexturePromptRef.current?.(prompt);
  }, []);

  /* ── Version controls ───────────────────────────────────── */

  const handleVersionSelect = useCallback(
    (versionId: string) => {
      if (!project) return;
      setProject({ ...project, currentVersionId: versionId });
      setCompareMode(false);
      setCompareVersionId(null);
    },
    [project],
  );

  const handleVersionCompare = useCallback(
    (versionId: string) => {
      setCompareVersionId((prev) => (prev === versionId ? null : versionId));
      setCompareMode(true);
    },
    [],
  );

  /* ── Project list actions ───────────────────────────────── */

  const openProject = useCallback(async (id: string) => {
    setShowList(false);
    setError(null);
    try {
      if (currentModelUrl) {
        try { useGLTF.clear(currentModelUrl); } catch { /* ok */ }
      }
      if (compareModelUrl) {
        try { useGLTF.clear(compareModelUrl); } catch { /* ok */ }
      }
      const p = await getProject(id);
      setProject(p);
      setMaterialSlots([]);
      setTargeting({ scope: "full-object" });
      setCompareMode(false);
      setCompareVersionId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open project");
    }
  }, [currentModelUrl, compareModelUrl]);

  const removeProject = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      if (project?.id === id) setProject(null);
      refreshList();
    } catch { /* ignore */ }
  }, [project, refreshList]);

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <div
      className="flex flex-col h-full w-full min-h-0"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* ── Project bar ────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <FileBox className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
        <span
          className="text-[11px] font-semibold truncate"
          style={{ color: "var(--color-text-primary)", maxWidth: 180 }}
        >
          {project?.name ?? "No project"}
        </span>

        {/* Project list dropdown */}
        <div className="relative ml-1">
          <button
            type="button"
            onClick={() => { refreshList(); setShowList((v) => !v); }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px]"
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-secondary)",
              background: "transparent",
            }}
          >
            <FolderOpen className="h-3 w-3" /> Projects <ChevronDown className="h-2.5 w-2.5" />
          </button>

          {showList && (
            <div
              className="absolute top-full left-0 mt-1 rounded-md py-1 z-50 min-w-[200px] max-h-[240px] overflow-y-auto"
              style={{
                background: "var(--color-bg-panel, #1f1f23)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
            >
              {projectList.length === 0 && (
                <div className="px-3 py-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  No saved projects
                </div>
              )}
              {projectList.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/5 cursor-pointer"
                  onClick={() => openProject(p.id)}
                >
                  <span className="flex-1 truncate text-[10px]" style={{ color: "var(--color-text-primary)" }}>
                    {p.name}
                  </span>
                  <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-muted)" }}>
                    {p.versionCount}v
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeProject(p.id); }}
                    className="p-0.5 rounded hover:bg-white/10"
                    style={{ color: "var(--color-text-muted)" }}
                    title="Delete project"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Import button */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold"
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            color: "var(--color-text-primary)",
            background: "rgba(255,255,255,0.05)",
            cursor: importing ? "wait" : "pointer",
          }}
        >
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {importing ? "Importing..." : "Import Model"}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFilePick} />
      </div>

      {/* ── Error banner ───────────────────────────────────── */}
      {error && (
        <div
          className="shrink-0 px-3 py-1.5 text-[10px] font-medium"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", borderBottom: "1px solid rgba(239,68,68,0.2)" }}
        >
          {error}
        </div>
      )}

      {/* ── Main workspace ─────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Material Inspector */}
        <div
          className="shrink-0"
          style={{
            width: 210,
            borderRight: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <MaterialInspector
            slots={materialSlots}
            targeting={targeting}
            onSelectSlot={(idx) => setTargeting({ scope: "material-slot", materialSlotIndex: idx })}
            onSelectAll={() => setTargeting({ scope: "full-object" })}
          />
        </div>

        {/* Center: 3D Viewport / UV Editor */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Center tab bar */}
          <div
            className="shrink-0 flex items-center gap-0.5 px-3 py-1"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
          >
            {(["3d", "uv"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setCenterTab(tab)}
                className="px-2 py-1 rounded text-[10px] font-semibold"
                style={{
                  background: centerTab === tab ? "rgba(139,92,246,0.15)" : "transparent",
                  color: centerTab === tab ? "#a78bfa" : "var(--color-text-muted)",
                  border: centerTab === tab ? "1px solid rgba(139,92,246,0.2)" : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                {tab === "3d" ? "3D Viewport" : "UV Editor"}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col" style={{ display: centerTab === "3d" ? "flex" : "none" }}>
            <EditorViewer
              modelUrl={currentModelUrl}
              compareUrl={compareModelUrl}
              compareMode={compareMode}
              selectedSlotIndex={targeting.scope === "material-slot" ? targeting.materialSlotIndex ?? null : null}
              onMaterialsParsed={setMaterialSlots}
              onSelectSlot={(idx) => setTargeting({ scope: "material-slot", materialSlotIndex: idx })}
              decalState={decalState}
              onDecalStateChange={setDecalState}
              onCenterOffset={setModelCenterOffset}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col" style={{ display: centerTab === "uv" ? "flex" : "none" }}>
            <UVAtlasEditor
              projectId={project?.id ?? null}
              versionId={project?.currentVersionId}
              modelUrl={currentModelUrl}
              materialSlots={materialSlots}
              onVersionCreated={handleVersionCreated}
            />
          </div>
        </div>

        {/* Right: Retexture + Tools Panel */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{
            width: 250,
            borderLeft: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <RetexturePanel
            targeting={targeting}
            materialSlots={materialSlots}
            meshyTaskId={project?.source.meshyTaskId}
            currentGlbUrl={currentModelUrl}
            onSubmit={handleRetextureSubmit}
            pendingJob={pendingJob}
            disabled={!project}
            setPromptRef={retexturePromptRef}
          />

          {/* Separator */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />

          {/* PBR Maps */}
          <div className="px-3 py-2">
            <PbrMapsPanel
              projectId={project?.id ?? null}
              versionId={project?.currentVersionId}
            />
          </div>

          {/* Separator */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />

          {/* Decal */}
          <div className="px-3 py-2">
            <DecalPlacer
              projectId={project?.id ?? null}
              versionId={project?.currentVersionId}
              onVersionCreated={handleVersionCreated}
              decalState={decalState}
              onDecalStateChange={setDecalState}
              modelCenterOffset={modelCenterOffset}
            />
          </div>

          {/* Separator */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />

          {/* AI Analyze */}
          <div className="px-3 py-2">
            <AiAnalyzePanel
              projectId={project?.id ?? null}
              versionId={project?.currentVersionId}
              onApplyPrompt={handleApplyRetexturePrompt}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom: Version History ────────────────────────── */}
      {project && (
        <VersionHistory
          versions={project.versions}
          currentVersionId={project.currentVersionId}
          compareVersionId={compareVersionId}
          onSelect={handleVersionSelect}
          onCompare={handleVersionCompare}
        />
      )}
    </div>
  );
}
