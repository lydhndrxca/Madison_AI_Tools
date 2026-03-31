import { useMemo, useRef, useCallback } from "react";
import {
  Clock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ModelVersion } from "@/lib/workshopTypes";

export interface VersionHistoryProps {
  versions: ModelVersion[];
  currentVersionId: string;
  compareVersionId: string | null;
  onSelect: (versionId: string) => void;
  onCompare: (versionId: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function VersionHistory({
  versions,
  currentVersionId,
  compareVersionId,
  onSelect,
  onCompare,
}: VersionHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollBy = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 140, behavior: "smooth" });
  }, []);

  if (versions.length === 0) return null;

  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-1.5"
      style={{
        height: 68,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.15)",
      }}
    >
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        className="shrink-0 p-0.5 rounded"
        style={{ color: "var(--color-text-muted)" }}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <div ref={scrollRef} className="flex-1 flex gap-1.5 overflow-x-auto min-w-0 no-scrollbar">
        {versions.map((v) => {
          const isCurrent = v.id === currentVersionId;
          const isCompare = v.id === compareVersionId;
          const isPending = v.status === "pending";
          const isFailed = v.status === "failed";
          const isClickable = v.status === "ready" && !!v.glbFile;

          return (
            <button
              key={v.id}
              type="button"
              onClick={() => isClickable && onSelect(v.id)}
              disabled={!isClickable}
              className="shrink-0 flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
              style={{
                width: 130,
                opacity: isClickable ? 1 : 0.5,
                cursor: isClickable ? "pointer" : "default",
                border: `1.5px solid ${isCurrent ? "rgba(139,92,246,0.5)" : isCompare ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                background: isCurrent
                  ? "rgba(139,92,246,0.08)"
                  : isCompare
                  ? "rgba(59,130,246,0.06)"
                  : "rgba(255,255,255,0.02)",
              }}
            >
              {/* Top row: label + status */}
              <div className="flex items-center gap-1 w-full">
                {isPending && <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" style={{ color: "var(--color-text-muted)" }} />}
                {!isPending && !isFailed && <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-green-400" />}
                {isFailed && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-red-400" />}
                <span
                  className="text-[10px] font-semibold truncate"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {v.label}
                </span>
              </div>

              {/* Prompt snippet */}
              {v.prompt && (
                <span
                  className="text-[9px] truncate w-full"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {v.prompt}
                </span>
              )}

              {/* Bottom row: time + compare */}
              <div className="flex items-center gap-1 w-full mt-auto">
                <Clock className="h-2.5 w-2.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                  {formatTime(v.createdAt)}
                </span>
                {!isCurrent && v.status === "ready" && (
                  <button
                    type="button"
                    title="Compare with current"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCompare(v.id);
                    }}
                    className="ml-auto p-0.5 rounded"
                    style={{
                      color: isCompare ? "#3b82f6" : "var(--color-text-muted)",
                      background: isCompare ? "rgba(59,130,246,0.1)" : "transparent",
                    }}
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => scrollBy(1)}
        className="shrink-0 p-0.5 rounded"
        style={{ color: "var(--color-text-muted)" }}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
