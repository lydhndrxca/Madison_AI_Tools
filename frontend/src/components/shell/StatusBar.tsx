import { Terminal } from "lucide-react";

interface StatusBarProps {
  message: string;
  onConsoleToggle?: () => void;
  consoleOpen?: boolean;
}

export function StatusBar({ message, onConsoleToggle, consoleOpen = false }: StatusBarProps) {
  return (
    <div
      className="flex items-center justify-between px-3 py-0.5 text-xs shrink-0 select-none"
      style={{
        background: "var(--color-card)",
        borderTop: "1px solid var(--color-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span>{message}</span>
      <div className="flex items-center gap-2">
        {onConsoleToggle && (
          <button
            onClick={onConsoleToggle}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
            style={{
              background: consoleOpen ? "var(--color-hover)" : "transparent",
              border: "none",
              color: "var(--color-text-muted)",
            }}
            title="Toggle Console (Ctrl+`)"
          >
            <Terminal className="h-3 w-3" />
            <span className="text-[10px]">Console</span>
          </button>
        )}
        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
          Ctrl+1-4: Tools &middot; Ctrl+,: Settings
        </span>
      </div>
    </div>
  );
}
