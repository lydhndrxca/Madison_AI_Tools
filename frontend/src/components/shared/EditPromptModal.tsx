import { useState, useEffect, useRef } from "react";
import { X, RotateCcw } from "lucide-react";

interface EditPromptModalProps {
  open: boolean;
  sectionLabel: string;
  defaultText: string;
  currentText: string;
  hasOverride: boolean;
  onSave: (text: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export function EditPromptModal({
  open,
  sectionLabel,
  defaultText,
  currentText,
  hasOverride,
  onSave,
  onReset,
  onClose,
}: EditPromptModalProps) {
  const [text, setText] = useState(currentText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setText(currentText);
  }, [open, currentText]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(0, 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave(text);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, onSave, text]);

  if (!open) return null;

  const isModified = text !== defaultText;
  const isEmpty = !text.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(30,30,30,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[640px] max-h-[85vh] flex flex-col animate-fade-in"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>
              Edit Prompt — {sectionLabel}
            </h2>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              This text is sent to the AI when this section is enabled.
              {hasOverride && (
                <span style={{ color: "var(--color-accent)" }}> (customized)</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4 min-h-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-full min-h-[260px] max-h-[55vh] resize-y text-xs font-mono p-3 rounded-md"
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              lineHeight: 1.6,
            }}
            spellCheck={false}
          />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            {(hasOverride || isModified) && (
              <button
                onClick={() => {
                  setText(defaultText);
                  onReset();
                }}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md cursor-pointer"
                style={{
                  background: "var(--color-input-bg)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
                title="Reset to default prompt"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to Default
              </button>
            )}
            {isModified && (
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                Modified
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              Ctrl+S to save
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1 text-[11px] rounded-md cursor-pointer"
              style={{
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(text)}
              disabled={isEmpty}
              className="px-3 py-1 text-[11px] rounded-md cursor-pointer font-medium disabled:opacity-40"
              style={{
                background: "var(--color-accent)",
                border: "1px solid var(--color-accent)",
                color: "var(--color-foreground)",
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
