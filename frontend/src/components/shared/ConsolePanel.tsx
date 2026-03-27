import { useState, useEffect, useRef, useCallback } from "react";
import { X, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface ConsolePanelProps {
  open: boolean;
  onClose: () => void;
}

interface LogEntry {
  id: number;
  timestamp: string;
  text: string;
  level: "info" | "error" | "warn";
}

let _nextId = 0;

export function ConsolePanel({ open, onClose }: ConsolePanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const wsBase = window.location.protocol === "file:"
      ? "ws://127.0.0.1:8420"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/progress`);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "console" || msg.type === "status" || msg.type === "error") {
          const text = typeof msg.data?.message === "string" ? msg.data.message : JSON.stringify(msg.data);
          setLogs((prev) => [
            ...prev,
            {
              id: _nextId++,
              timestamp: new Date().toLocaleTimeString(),
              text,
              level: msg.type === "error" ? "error" : msg.type === "status" ? "info" : "info",
            },
          ]);
        }
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, [open]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const clearLogs = useCallback(() => setLogs([]), []);

  if (!open) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex flex-col animate-fade-in"
      style={{
        height: "280px",
        background: "var(--color-input-bg, #3C3C3C)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
          Console Output
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className="p-1 rounded transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            {autoScroll ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={clearLogs}
            className="p-1 rounded transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
        {logs.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>Console output will appear here...</p>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span style={{ color: "var(--color-text-muted)" }}>[{entry.timestamp}]</span>
              <span
                style={{
                  color: entry.level === "error" ? "var(--color-destructive)"
                    : entry.level === "warn" ? "var(--color-warning)"
                    : "var(--color-text-primary)",
                }}
              >
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
