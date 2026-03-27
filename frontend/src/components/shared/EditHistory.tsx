import { useState } from "react";
import { Button } from "@/components/ui";

interface EditEntry {
  timestamp: string;
  prompt: string;
  imageFile?: string;
  isOriginal?: boolean;
}

interface EditHistoryProps {
  entries: EditEntry[];
  onLoadImage?: (file: string) => void;
  defaultOpen?: boolean;
}

export function EditHistory({ entries, onLoadImage, defaultOpen = false }: EditHistoryProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
        style={{ color: "var(--color-text-secondary)", background: "var(--color-card)", border: "none" }}
      >
        Edit History
        <span className="text-[10px]">{open ? "\u25BE" : "\u25B8"}</span>
      </button>
      {open && (
        <div
          className="max-h-[180px] overflow-y-auto space-y-1 px-2 py-2"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {entries.length === 0 ? (
            <p className="text-xs px-2 py-2" style={{ color: "var(--color-text-muted)" }}>
              No edits yet. Apply changes to create history.
            </p>
          ) : (
            <>
              <p className="text-xs px-2 font-semibold" style={{ color: "var(--color-text-muted)" }}>
                Edits ({entries.length} total)
              </p>
              {entries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-1 rounded"
                  style={{ background: i === 0 ? "var(--color-hover)" : "transparent" }}
                >
                  {entry.imageFile && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onLoadImage?.(entry.imageFile!)}
                      className="shrink-0 !px-1.5 !py-0.5"
                    >
                      IMG
                    </Button>
                  )}
                  <span
                    className="text-xs truncate"
                    style={{
                      color: entry.isOriginal
                        ? "var(--color-text-muted)"
                        : "var(--color-text-primary)",
                    }}
                  >
                    [{entry.timestamp}] {entry.prompt}
                    {entry.isOriginal && " (original)"}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
