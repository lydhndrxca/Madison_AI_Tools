import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, X } from "lucide-react";

const MAX_PROJECTS = 10;

interface ProjectMeta {
  name: string;
}

interface ProjectTabsWrapperProps {
  storageKey: string;
  defaultProjectName?: string;
  children: (props: { instanceId: number; active: boolean }) => React.ReactNode;
}

function loadProjects(storageKey: string, defaultName: string): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as ProjectMeta[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* */ }
  return [{ name: `${defaultName} 1` }];
}

function saveProjects(storageKey: string, projects: ProjectMeta[]) {
  localStorage.setItem(storageKey, JSON.stringify(projects));
}

export function ProjectTabsWrapper({ storageKey, defaultProjectName = "Project", children }: ProjectTabsWrapperProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => loadProjects(storageKey, defaultProjectName));
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu]);

  const persist = useCallback((next: ProjectMeta[]) => {
    setProjects(next);
    saveProjects(storageKey, next);
  }, [storageKey]);

  const addProject = useCallback(() => {
    if (projects.length >= MAX_PROJECTS) return;
    const next = [...projects, { name: `${defaultProjectName} ${projects.length + 1}` }];
    persist(next);
    setActiveIdx(next.length - 1);
  }, [projects, defaultProjectName, persist]);

  const handleRename = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditValue(projects[idx].name);
    setCtxMenu(null);
  }, [projects]);

  const commitRename = useCallback(() => {
    if (editingIdx === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      const next = [...projects];
      next[editingIdx] = { ...next[editingIdx], name: trimmed };
      persist(next);
    }
    setEditingIdx(null);
  }, [editingIdx, editValue, projects, persist]);

  const clearProject = useCallback((idx: number) => {
    // Clearing means removing stored state for this instance — we do this by
    // dispatching a custom event the child page can listen for to reset itself.
    window.dispatchEvent(new CustomEvent("project-clear", { detail: { storageKey, instanceId: idx } }));
    setCtxMenu(null);
  }, [storageKey]);

  const deleteProject = useCallback((idx: number) => {
    if (projects.length <= 1) return;
    const next = projects.filter((_, i) => i !== idx);
    persist(next);
    if (activeIdx >= next.length) setActiveIdx(next.length - 1);
    else if (activeIdx > idx) setActiveIdx(activeIdx - 1);
    // Fire clear so any residual state is wiped
    window.dispatchEvent(new CustomEvent("project-clear", { detail: { storageKey, instanceId: idx } }));
    setCtxMenu(null);
  }, [projects, activeIdx, persist, storageKey]);

  const handleContextMenu = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, idx });
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Project tabs bar */}
      <div
        className="flex items-center shrink-0 gap-0 select-none"
        style={{
          background: "var(--color-card)",
          borderBottom: "1px solid var(--color-border)",
          height: 34,
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        {projects.map((proj, idx) => {
          const isActive = idx === activeIdx;
          const isEditing = editingIdx === idx;

          return (
            <button
              key={idx}
              onClick={() => { if (!isEditing) setActiveIdx(idx); }}
              onDoubleClick={() => handleRename(idx)}
              onContextMenu={(e) => handleContextMenu(e, idx)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors"
              style={{
                background: isActive ? "var(--color-background)" : "transparent",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-accent, #6a6aff)" : "2px solid transparent",
                marginBottom: -1,
              }}
              title={isEditing ? undefined : isActive ? proj.name : `Switch to ${proj.name}`}
            >
              {isEditing ? (
                <input
                  className="text-[11px] font-medium px-1 py-0 rounded"
                  style={{
                    background: "var(--color-input-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                    width: Math.max(60, editValue.length * 7),
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
                <span>{proj.name}</span>
              )}
            </button>
          );
        })}

        {/* Add project button */}
        {projects.length < MAX_PROJECTS && (
          <button
            onClick={addProject}
            className="flex items-center justify-center ml-1 rounded cursor-pointer transition-colors"
            style={{
              width: 22,
              height: 22,
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
            }}
            title="New project"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}

        <span
          className="ml-auto text-[10px] shrink-0"
          style={{ color: "var(--color-text-muted)", opacity: 0.4 }}
        >
          double-click to rename {"\u00b7"} right-click for options
        </span>
      </div>

      {/* Project instances — keep all mounted for state preservation */}
      <div className="flex-1 overflow-hidden min-h-0">
        {projects.map((_, idx) => (
          <div
            key={idx}
            className="h-full"
            style={{ display: idx === activeIdx ? "contents" : "none" }}
          >
            {children({ instanceId: idx, active: idx === activeIdx })}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[9999] py-1 rounded-md shadow-lg min-w-[160px]"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <button
            className="flex items-center w-full px-3 py-1.5 text-[11px] text-left cursor-pointer transition-colors"
            style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-input-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => handleRename(ctxMenu.idx)}
          >
            Rename Project
          </button>
          <button
            className="flex items-center w-full px-3 py-1.5 text-[11px] text-left cursor-pointer transition-colors"
            style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-input-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => clearProject(ctxMenu.idx)}
          >
            Clear Project
          </button>
          <div className="mx-2 my-1" style={{ height: 1, background: "var(--color-border)" }} />
          <button
            className="flex items-center w-full px-3 py-1.5 text-[11px] text-left cursor-pointer transition-colors"
            style={{
              background: "transparent",
              border: "none",
              color: projects.length <= 1 ? "var(--color-text-muted)" : "#e55",
              opacity: projects.length <= 1 ? 0.4 : 1,
            }}
            disabled={projects.length <= 1}
            onMouseEnter={(e) => { if (projects.length > 1) e.currentTarget.style.background = "var(--color-input-bg)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => deleteProject(ctxMenu.idx)}
          >
            <X className="h-3 w-3 mr-1.5 shrink-0" />
            Delete Project
          </button>
        </div>
      )}
    </div>
  );
}
