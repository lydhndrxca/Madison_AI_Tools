import React, { useState, useEffect } from "react";

interface PanelSectionProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  locked?: boolean;
  onLockToggle?: (locked: boolean) => void;
  children: React.ReactNode;
}

export function PanelSection({ title, defaultOpen = true, open: controlledOpen, onToggle, locked, onLockToggle, children }: PanelSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    if (isControlled) setInternalOpen(controlledOpen);
  }, [isControlled, controlledOpen]);

  const handleToggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    if (!isControlled) setInternalOpen(next);
  };

  const handleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLockToggle) onLockToggle(!locked);
  };

  return (
    <div className="shrink-0" style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
      <button
        onClick={handleToggle}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
        style={{ color: "var(--color-text-secondary)", background: "var(--color-card)", border: "none", borderRadius: "var(--radius-md)" }}
      >
        {title}
        <span className="flex items-center gap-1.5">
          {onLockToggle && (
            <span
              role="button"
              onClick={handleLock}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] leading-none select-none"
              style={{
                background: locked ? "rgba(255,255,255,0.12)" : "transparent",
                color: locked ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
              title={locked ? "Locked — AI won't change these fields. You can still edit them yourself." : "Unlocked — AI can update these fields when you Extract, Enhance, or Randomize."}
            >
              {locked ? "\uD83D\uDD12" : "\uD83D\uDD13"}
            </span>
          )}
          <span className="text-[10px]">{isOpen ? "\u25BE" : "\u25B8"}</span>
        </span>
      </button>
      {isOpen && (
        <div
          className="px-3 py-2 space-y-2"
          style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
