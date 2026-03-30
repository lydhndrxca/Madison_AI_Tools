import { useState, useRef, useEffect } from "react";

export interface TagItem {
  label: string;
  prompt: string;
  isCustom?: boolean;
}

interface TagPickerProps {
  presets: TagItem[];
  selected: TagItem[];
  onChange: (selected: TagItem[]) => void;
  onPresetsChange?: (presets: TagItem[]) => void;
  label?: string;
  defaultVisibleCount?: number;
  disabled?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  tag: TagItem;
}

export function TagPicker({
  presets,
  selected,
  onChange,
  onPresetsChange,
  label,
  defaultVisibleCount = 3,
  disabled = false,
}: TagPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const ctxRef = useRef<HTMLDivElement>(null);
  const addLabelRef = useRef<HTMLInputElement>(null);

  const allTags = presets;
  const visibleTags = expanded ? allTags : allTags.slice(0, defaultVisibleCount);
  const hiddenCount = allTags.length - defaultVisibleCount;

  const isSelected = (tag: TagItem) => selected.some((s) => s.label === tag.label);

  const toggle = (tag: TagItem) => {
    if (isSelected(tag)) {
      onChange(selected.filter((s) => s.label !== tag.label));
    } else {
      onChange([...selected, tag]);
    }
  };

  const handleContext = (e: React.MouseEvent, tag: TagItem) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, tag });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  useEffect(() => {
    if (adding && addLabelRef.current) addLabelRef.current.focus();
  }, [adding]);

  const handleDelete = () => {
    if (!ctxMenu) return;
    const label = ctxMenu.tag.label;
    onChange(selected.filter((s) => s.label !== label));
    if (onPresetsChange) onPresetsChange(presets.filter((p) => p.label !== label));
    setCtxMenu(null);
  };

  const commitAdd = () => {
    const trimLabel = newLabel.trim();
    const trimPrompt = newPrompt.trim();
    if (!trimLabel) return;
    const newTag: TagItem = { label: trimLabel, prompt: trimPrompt || trimLabel, isCustom: true };
    if (onPresetsChange) onPresetsChange([...presets, newTag]);
    onChange([...selected, newTag]);
    setNewLabel("");
    setNewPrompt("");
    setAdding(false);
  };

  const tagBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--color-accent)" : "transparent",
    color: active ? "var(--color-foreground)" : "var(--color-text-muted, #777)",
    borderColor: active ? "var(--color-accent)" : "var(--color-border)",
    fontWeight: active ? 600 : 400,
    opacity: active ? 1 : 0.55,
  });

  const inputStyle: React.CSSProperties = {
    background: "var(--color-input-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    color: "var(--color-text-primary)",
  };

  return (
    <div className="relative">
      {label && (
        <span className="text-xs block mb-1" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </span>
      )}

      <div className="flex flex-wrap gap-1 items-center">
        {visibleTags.map((tag) => {
          const active = isSelected(tag);
          return (
            <button
              key={tag.label}
              type="button"
              onClick={() => toggle(tag)}
              onContextMenu={(e) => handleContext(e, tag)}
              disabled={disabled}
              className="px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer transition-all border disabled:opacity-40 disabled:pointer-events-none"
              style={tagBtnStyle(active)}
              title={`${tag.label} — ${tag.prompt}\n\nClick to toggle on/off. Right-click for more options.`}
            >
              {active && <span className="mr-0.5">&#x2713;</span>}{tag.label}
            </button>
          );
        })}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer transition-colors border"
            style={{ background: "transparent", color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
          >
            {expanded ? "Show less" : `+${hiddenCount} more`}
          </button>
        )}

        {onPresetsChange && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={disabled}
            className="px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer transition-colors border disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: "transparent", color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
            title="Create custom tag"
          >
            +
          </button>
        )}
      </div>

      {/* Inline add form */}
      {adding && (
        <div className="mt-1.5 flex flex-col gap-1 p-1.5 rounded-[var(--radius-sm)]" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
          <input
            ref={addLabelRef}
            className="w-full px-1.5 py-0.5 text-[10px]"
            style={inputStyle}
            placeholder="Tag label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") setAdding(false); }}
          />
          <textarea
            className="w-full px-1.5 py-0.5 text-[10px] resize-none"
            rows={2}
            style={inputStyle}
            placeholder="Prompt influence (how this tag affects the image)"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitAdd(); } if (e.key === "Escape") setAdding(false); }}
          />
          <div className="flex gap-1 justify-end">
            <button type="button" className="px-2 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }} onClick={commitAdd}>Add</button>
            <button type="button" className="px-2 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer" style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 py-1 rounded-[var(--radius-sm)] shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y, background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 120 }}
        >
          <button
            type="button"
            className="block w-full text-left px-3 py-1 text-[11px] cursor-pointer"
            style={{ color: "#e06060", background: "transparent", border: "none" }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--color-input-bg)"; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
