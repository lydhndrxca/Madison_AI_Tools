import { X } from "lucide-react";
import type { Toast } from "@/hooks/useToast";

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

const levelStyles: Record<Toast["level"], { bg: string; border: string; color: string }> = {
  info: { bg: "var(--color-card)", border: "var(--color-border-hover)", color: "var(--color-text-primary)" },
  error: { bg: "#5a2a2a", border: "var(--color-destructive)", color: "#ffaaaa" },
  success: { bg: "#2a4a2a", border: "var(--color-success)", color: "#aaffaa" },
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const s = levelStyles[t.level];
        return (
          <div
            key={t.id}
            className="flex flex-col gap-1 px-3 py-2 rounded shadow-lg animate-fade-in"
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, minWidth: 220 }}
          >
            <div className="flex items-start gap-2">
              <span className="text-xs flex-1 break-words">{t.message}</span>
              <button
                onClick={() => onDismiss(t.id)}
                className="shrink-0 p-0.5 rounded cursor-pointer"
                style={{ background: "transparent", border: "none", color: "inherit", opacity: 0.6 }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {t.progress != null && (
              <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: "rgba(255,255,255,0.12)" }}>
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${Math.min(100, Math.round(t.progress * 100))}%`,
                    background: t.progress >= 1 ? "var(--color-success)" : "var(--color-primary)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
