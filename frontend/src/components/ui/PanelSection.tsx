import React, { useState, useEffect } from "react";

interface PanelSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When provided, the parent controls the open state. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}

export function PanelSection({ title, defaultOpen = true, open: controlledOpen, onToggle, children }: PanelSectionProps) {
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

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
      <button
        onClick={handleToggle}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
        style={{ color: "var(--color-text-secondary)", background: "var(--color-card)", border: "none" }}
      >
        {title}
        <span className="text-[10px]">{isOpen ? "\u25BE" : "\u25B8"}</span>
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
