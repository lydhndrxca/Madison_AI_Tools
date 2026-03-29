import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, Trash2, Clock, CheckCircle, AlertCircle, XCircle, ListOrdered } from "lucide-react";
import { apiFetch, useWebSocket } from "@/hooks/useApi";

interface QueueJob {
  id: string;
  tool: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result_image_b64: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />,
  running: <Loader2 className="h-3 w-3 animate-spin" style={{ color: "#5e9eff" }} />,
  done: <CheckCircle className="h-3 w-3" style={{ color: "#4ec9a0" }} />,
  failed: <AlertCircle className="h-3 w-3" style={{ color: "#f06060" }} />,
  cancelled: <XCircle className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />,
};

const TOOL_LABELS: Record<string, string> = {
  character: "Char",
  prop: "Prop",
  environment: "Env",
  uilab: "UI",
  weapon: "Weapon",
};

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleWsMessage = useCallback((msg: { type: string; data: Record<string, unknown> }) => {
    if (msg.type === "queue_progress") {
      const data = msg.data as { jobs?: QueueJob[] };
      if (data.jobs) setJobs(data.jobs);
    }
  }, []);

  useWebSocket(handleWsMessage);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<QueueJob[]>("/queue/jobs");
      setJobs(list);
    } catch { /* */ }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleCancel = useCallback(async (id: string) => {
    try {
      await apiFetch(`/queue/jobs/${id}`, { method: "DELETE" });
      load();
    } catch { /* */ }
  }, [load]);

  const handleClear = useCallback(async () => {
    try {
      await apiFetch("/queue/clear", { method: "POST" });
      load();
    } catch { /* */ }
  }, [load]);

  if (!open) return null;

  const pendingCount = jobs.filter((j) => j.status === "pending").length;
  const runningCount = jobs.filter((j) => j.status === "running").length;

  return (
    <div
      ref={panelRef}
      className="fixed right-4 bottom-4 z-[9990] w-80 max-h-96 rounded-lg overflow-hidden flex flex-col shadow-2xl"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <ListOrdered className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-xs font-semibold flex-1" style={{ color: "var(--color-text-primary)" }}>
          Generation Queue
          {(pendingCount > 0 || runningCount > 0) && (
            <span className="ml-1.5 text-[10px] font-normal" style={{ color: "var(--color-text-muted)" }}>
              {runningCount > 0 && `${runningCount} running`}
              {runningCount > 0 && pendingCount > 0 && ", "}
              {pendingCount > 0 && `${pendingCount} pending`}
            </span>
          )}
        </span>
        {jobs.some((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled") && (
          <button
            onClick={handleClear}
            className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer font-medium"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          >Clear Done</button>
        )}
        <button onClick={onClose} className="p-0.5 rounded cursor-pointer" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}>
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <p className="text-[11px] text-center py-6" style={{ color: "var(--color-text-muted)" }}>
            Queue is empty
          </p>
        ) : (
          [...jobs].reverse().map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-2 px-3 py-2"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              {job.result_image_b64 ? (
                <img
                  src={`data:image/png;base64,${job.result_image_b64}`}
                  alt=""
                  className="w-8 h-8 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {STATUS_ICON[job.status]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                  {job.label}
                </p>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)" }}>
                    {TOOL_LABELS[job.tool] || job.tool}
                  </span>
                  {job.error && (
                    <span className="text-[9px] truncate" style={{ color: "#f06060" }}>
                      {job.error}
                    </span>
                  )}
                </div>
              </div>
              {job.status === "pending" && (
                <button
                  onClick={() => handleCancel(job.id)}
                  className="p-1 rounded cursor-pointer"
                  style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface QueueButtonProps {
  tool: string;
  payload: Record<string, unknown>;
  label?: string;
  disabled?: boolean;
}

export function QueueButton({ tool, payload, label, disabled }: QueueButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleEnqueue = useCallback(async () => {
    setBusy(true);
    try {
      await apiFetch("/queue/enqueue", {
        method: "POST",
        body: JSON.stringify({ tool, payload, label: label || tool, count: 1 }),
      });
    } catch { /* */ }
    setBusy(false);
  }, [tool, payload, label]);

  return (
    <button
      onClick={handleEnqueue}
      disabled={disabled || busy}
      className="flex items-center gap-1 px-2 py-1 text-[10px] rounded cursor-pointer font-medium"
      style={{
        background: "rgba(42,58,106,0.25)",
        color: "#5e9eff",
        border: "1px solid rgba(58,90,138,0.4)",
        opacity: disabled || busy ? 0.4 : 1,
      }}
      title="Add this generation to the batch queue"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListOrdered className="h-3 w-3" />}
      Queue
    </button>
  );
}
