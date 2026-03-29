import { useState, useCallback } from "react";
import { CharacterPage } from "./CharacterPage";

const MAX_PROJECTS = 3;

const DEFAULT_NAMES = ["Project 1", "Project 2", "Project 3"];
const STORAGE_KEY = "madison-charlab-projects";

function loadProjectNames(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed) && parsed.length === MAX_PROJECTS) return parsed;
    }
  } catch { /* */ }
  return [...DEFAULT_NAMES];
}

export function CharacterLabWrapper() {
  const [activeProject, setActiveProject] = useState(0);
  const [projectNames, setProjectNames] = useState<string[]>(loadProjectNames);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleRename = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditValue(projectNames[idx]);
  }, [projectNames]);

  const commitRename = useCallback(() => {
    if (editingIdx === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      setProjectNames((prev) => {
        const next = [...prev];
        next[editingIdx] = trimmed;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    }
    setEditingIdx(null);
  }, [editingIdx, editValue]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Project tabs */}
      <div
        className="flex items-center shrink-0 gap-0 select-none"
        style={{
          background: "var(--color-card)",
          borderBottom: "1px solid var(--color-border)",
          height: 34,
          paddingLeft: 8,
        }}
      >
        {projectNames.map((name, idx) => {
          const isActive = idx === activeProject;
          const isEditing = editingIdx === idx;

          return (
            <button
              key={idx}
              onClick={() => { if (!isEditing) setActiveProject(idx); }}
              onDoubleClick={() => handleRename(idx)}
              className="relative flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium cursor-pointer transition-colors"
              style={{
                background: isActive ? "var(--color-background)" : "transparent",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-accent, #6a6aff)" : "2px solid transparent",
                marginBottom: -1,
              }}
              title={isActive ? name : `Switch to ${name}`}
            >
              {isEditing ? (
                <input
                  className="text-[12px] font-medium px-1 py-0 rounded"
                  style={{
                    background: "var(--color-input-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                    width: Math.max(60, editValue.length * 8),
                    outline: "none",
                  }}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingIdx(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span>{name}</span>
              )}
            </button>
          );
        })}

        <span
          className="ml-2 text-[10px]"
          style={{ color: "var(--color-text-muted)", opacity: 0.5 }}
        >
          double-click to rename
        </span>
      </div>

      {/* Project instances */}
      <div className="flex-1 overflow-hidden min-h-0">
        {Array.from({ length: MAX_PROJECTS }, (_, idx) => (
          <div
            key={idx}
            className="h-full"
            style={{ display: idx === activeProject ? "contents" : "none" }}
          >
            <CharacterPage instanceId={idx} active={idx === activeProject} />
          </div>
        ))}
      </div>
    </div>
  );
}
