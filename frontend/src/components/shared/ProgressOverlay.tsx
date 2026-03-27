import { Button } from "@/components/ui";

interface ProgressOverlayProps {
  visible: boolean;
  message?: string;
  onCancel?: () => void;
}

export function ProgressOverlay({ visible, message = "Generating...", onCancel }: ProgressOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="flex flex-col items-center gap-4 px-8 py-6 rounded-xl"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
      >
        <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-text-muted)", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{message}</p>
        {onCancel && (
          <Button variant="danger" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
