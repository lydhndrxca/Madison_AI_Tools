import { useCallback, useRef, useEffect } from "react";

interface XmlModalProps {
  xml: string;
  title?: string;
  onClose: () => void;
}

export function XmlModal({ xml, title = "Character XML", onClose }: XmlModalProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(xml);
    } catch {
      textRef.current?.select();
      document.execCommand("copy");
    }
  }, [xml]);

  const handleSave = useCallback(() => {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [xml, title]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onMouseDown={onClose}
    >
      <div
        className="rounded-lg shadow-xl flex flex-col"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          width: 640,
          maxWidth: "90vw",
          maxHeight: "85vh",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
            {title}
          </span>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          >
            Close
          </button>
        </div>

        <textarea
          ref={textRef}
          readOnly
          value={xml}
          className="flex-1 min-h-0 px-4 py-3 text-xs font-mono resize-none"
          style={{
            background: "var(--color-bg, #1e1e1e)",
            color: "var(--color-text-primary)",
            border: "none",
            outline: "none",
          }}
          spellCheck={false}
        />

        <div
          className="flex items-center justify-end gap-2 px-4 py-2.5 shrink-0"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            onClick={handleCopy}
            className="px-3 py-1 text-xs rounded cursor-pointer"
            style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
          >
            Copy to Clipboard
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 text-xs rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
          >
            Save as File
          </button>
        </div>
      </div>
    </div>
  );
}
