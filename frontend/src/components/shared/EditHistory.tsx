import { useState } from "react";
import type { HistoryEntry } from "@/lib/imageHistory";

// Legacy entry format (used by Gemini, Multiview, Weapon pages)
interface LegacyEditEntry {
  timestamp: string;
  prompt: string;
  isOriginal?: boolean;
  imageFile?: string;
}

// The component accepts either new HistoryEntry[] or legacy EditEntry[]
type AnyEntry = HistoryEntry | LegacyEditEntry;

function isHistoryEntry(e: AnyEntry): e is HistoryEntry {
  return "id" in e && "label" in e;
}

interface EditHistoryProps {
  entries: AnyEntry[];
  activeEntryId?: string | null;
  onRestore?: (entryId: string) => void;
  onRestoreCurrent?: () => void;
  onClearHistory?: () => void;
  onLoadImage?: (file: string) => void;
  defaultOpen?: boolean;
}

export function EditHistory({
  entries,
  activeEntryId,
  onRestore,
  onRestoreCurrent,
  onClearHistory,
  onLoadImage,
  defaultOpen = false,
}: EditHistoryProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const isNewFormat = entries.length > 0 && isHistoryEntry(entries[0]);

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
        style={{ color: "var(--color-text-secondary)", background: "var(--color-card)", border: "none" }}
      >
        Edit History ({entries.length})
        <span className="text-[10px]">{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && (
        <div
          className="max-h-[220px] overflow-y-auto space-y-0.5 px-2 py-2"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {/* Current (live) state — only for new-format entries with restore support */}
          {isNewFormat && onRestoreCurrent && (
            <button
              onClick={onRestoreCurrent}
              className="w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors"
              style={{
                background: !activeEntryId ? "var(--color-hover)" : "transparent",
                color: "var(--color-text-primary)",
                border: "none",
                fontWeight: !activeEntryId ? 600 : 400,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
              Current (live)
            </button>
          )}

          {entries.length === 0 ? (
            <p className="text-xs px-2 py-1" style={{ color: "var(--color-text-muted)" }}>
              No edit history yet.
            </p>
          ) : isNewFormat ? (
            (entries as HistoryEntry[]).map((entry) => (
              <button
                key={entry.id}
                onClick={() => onRestore?.(entry.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors truncate"
                style={{
                  background: activeEntryId === entry.id ? "var(--color-hover)" : "transparent",
                  color: activeEntryId === entry.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: "none",
                }}
              >
                <span className="text-[10px] shrink-0 tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                  [{entry.timestamp}]
                </span>
                <span className="truncate">{entry.label}</span>
              </button>
            ))
          ) : (
            /* Legacy format rendering */
            (entries as LegacyEditEntry[]).map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1 rounded"
                style={{ background: i === 0 ? "var(--color-hover)" : "transparent" }}
              >
                {entry.imageFile && onLoadImage && (
                  <button
                    onClick={() => onLoadImage(entry.imageFile!)}
                    className="shrink-0 px-1.5 py-0.5 text-[10px] rounded cursor-pointer"
                    style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                  >IMG</button>
                )}
                <span
                  className="text-xs truncate"
                  style={{ color: entry.isOriginal ? "var(--color-text-muted)" : "var(--color-text-primary)" }}
                >
                  [{entry.timestamp}] {entry.prompt}
                  {entry.isOriginal && " (original)"}
                </span>
              </div>
            ))
          )}

          {entries.length > 0 && onClearHistory && (
            confirmingClear ? (
              <div className="flex items-center gap-1 px-2 py-1 mt-1">
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Clear all history?</span>
                <button
                  onClick={() => { onClearHistory(); setConfirmingClear(false); }}
                  className="px-1.5 py-0.5 text-[10px] rounded cursor-pointer"
                  style={{ background: "var(--color-danger, #c44)", color: "#fff", border: "none" }}
                >Yes</button>
                <button
                  onClick={() => setConfirmingClear(false)}
                  className="px-1.5 py-0.5 text-[10px] rounded cursor-pointer"
                  style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                >No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingClear(true)}
                className="w-full text-left px-2 py-1 text-[10px] cursor-pointer transition-colors mt-1"
                style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
              >
                Clear History
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
