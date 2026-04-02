import { useState, useCallback, useRef, useEffect } from "react";
import { Plus } from "lucide-react";

const MAX_PROJECTS = 10;
const DEFAULT_COUNT = 3;

interface ProjectMeta {
  name: string;
  uid?: string;
}

interface ProjectTabsWrapperProps {
  storageKey: string;
  defaultProjectName?: string;
  children: (props: { instanceId: number; active: boolean; projectUid: string }) => React.ReactNode;
}

function ensureUid(p: ProjectMeta): ProjectMeta {
  return p.uid ? p : { ...p, uid: crypto.randomUUID() };
}

const MIGRATION_KEY = "madison-project-tabs-v2";

function makeDefaults(defaultName: string): ProjectMeta[] {
  return Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
    name: `${defaultName} ${i + 1}`,
    uid: crypto.randomUUID(),
  }));
}

function loadProjects(storageKey: string, defaultName: string): ProjectMeta[] {
  if (!localStorage.getItem(MIGRATION_KEY)) {
    localStorage.setItem(MIGRATION_KEY, "1");
    const keys = [
      "madison-charlab-projects",
      "madison-proplab-projects",
      "madison-envlab-projects",
      "madison-uilab-projects",
    ];
    for (const k of keys) localStorage.removeItem(k);
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as ProjectMeta[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(ensureUid);
    }
  } catch { /* */ }
  return makeDefaults(defaultName);
}

function saveProjects(storageKey: string, projects: ProjectMeta[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(projects));
  } catch { /* quota exceeded */ }
}

const menuBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-primary)",
};

function CtxMenuItem({
  label,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center w-full px-3 py-1.5 text-[11px] text-left cursor-pointer transition-colors"
      style={{
        ...menuBtnStyle,
        color: danger ? "#e55" : "var(--color-text-primary)",
        opacity: disabled ? 0.35 : 1,
      }}
      disabled={disabled}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--color-input-bg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ProjectTabsWrapper({
  storageKey,
  defaultProjectName = "Project",
  children,
}: ProjectTabsWrapperProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() =>
    loadProjects(storageKey, defaultProjectName),
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);
  const loadTargetRef = useRef<number>(0);

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

  const persist = useCallback(
    (next: ProjectMeta[]) => {
      setProjects(next);
      saveProjects(storageKey, next);
    },
    [storageKey],
  );

  const addProject = useCallback(() => {
    if (projects.length >= MAX_PROJECTS) return;
    const next = [
      ...projects,
      { name: `${defaultProjectName} ${projects.length + 1}`, uid: crypto.randomUUID() },
    ];
    persist(next);
    setActiveIdx(next.length - 1);
  }, [projects, defaultProjectName, persist]);

  const handleRename = useCallback(
    (idx: number) => {
      setEditingIdx(idx);
      setEditValue(projects[idx].name);
      setCtxMenu(null);
    },
    [projects],
  );

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

  const handleSaveProject = useCallback(
    (idx: number) => {
      setCtxMenu(null);
      window.dispatchEvent(
        new CustomEvent("project-save", { detail: { storageKey, instanceId: idx } }),
      );
    },
    [storageKey],
  );

  const handleLoadProject = useCallback(
    (idx: number) => {
      setCtxMenu(null);
      loadTargetRef.current = idx;
      loadInputRef.current?.click();
    },
    [],
  );

  const onLoadFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          window.dispatchEvent(
            new CustomEvent("project-load", {
              detail: { storageKey, instanceId: loadTargetRef.current, data },
            }),
          );
        } catch {
          alert("Invalid project file.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [storageKey],
  );

  // Listen for "request-new-project" events to create/switch to an empty project
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey !== storageKey) return;
      const { callbackEvent, callbackDetail } = detail;

      // Create a new project and switch to it
      if (projects.length < MAX_PROJECTS) {
        const next = [
          ...projects,
          { name: `${defaultProjectName} ${projects.length + 1}`, uid: crypto.randomUUID() },
        ];
        persist(next);
        setActiveIdx(next.length - 1);

        // Re-fire the callback event after a tick so the new instance renders
        if (callbackEvent) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(callbackEvent, { detail: callbackDetail }));
          }, 100);
        }
      }
    };
    window.addEventListener("request-new-project", handler);
    return () => window.removeEventListener("request-new-project", handler);
  }, [storageKey, projects, defaultProjectName, persist]);

  const removeProject = useCallback(
    (idx: number) => {
      if (projects.length <= 1) return;
      const next = projects.filter((_, i) => i !== idx);
      persist(next);
      if (activeIdx >= next.length) setActiveIdx(next.length - 1);
      else if (activeIdx > idx) setActiveIdx(activeIdx - 1);
      window.dispatchEvent(
        new CustomEvent("project-clear", { detail: { storageKey, instanceId: idx } }),
      );
      setCtxMenu(null);
    },
    [projects, activeIdx, persist, storageKey],
  );

  const handleDuplicate = useCallback(
    (idx: number) => {
      if (projects.length >= MAX_PROJECTS) return;
      setCtxMenu(null);

      // Synchronous carrier — source page writes its state into this object
      const carrier: { state: Record<string, unknown> | null } = { state: null };
      window.dispatchEvent(
        new CustomEvent("project-export", {
          detail: { storageKey, instanceId: idx, carrier },
        }),
      );

      const newProj: ProjectMeta = {
        name: `${projects[idx].name} (Copy)`,
        uid: crypto.randomUUID(),
      };
      const next = [...projects, newProj];
      persist(next);
      const targetIdx = next.length - 1;
      setActiveIdx(targetIdx);

      if (carrier.state) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("project-load", {
              detail: { storageKey, instanceId: targetIdx, data: carrier.state },
            }),
          );
        }, 150);
      }
    },
    [projects, storageKey, persist],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, idx });
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <input
        ref={loadInputRef}
        type="file"
        accept=".json,.madison"
        className="hidden"
        onChange={onLoadFile}
      />

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
              key={proj.uid ?? idx}
              onClick={() => {
                if (!isEditing) setActiveIdx(idx);
              }}
              onDoubleClick={() => handleRename(idx)}
              onContextMenu={(e) => handleContextMenu(e, idx)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors"
              style={{
                background: isActive ? "var(--color-background)" : "transparent",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--color-accent, #6a6aff)"
                  : "2px solid transparent",
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
                    width: Math.max(80, editValue.length * 7.5 + 16),
                    minWidth: 80,
                    maxWidth: 300,
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
                  onFocus={(e) => e.target.select()}
                />
              ) : (
                <span
                  style={{
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "inline-block",
                  }}
                >
                  {proj.name}
                </span>
              )}
            </button>
          );
        })}

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
            title="Create new project"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Project instances */}
      <div className="flex-1 overflow-hidden min-h-0">
        {projects.map((proj, idx) => (
          <div
            key={proj.uid ?? idx}
            className="h-full"
            style={{ display: idx === activeIdx ? "contents" : "none" }}
          >
            {children({ instanceId: idx, active: idx === activeIdx, projectUid: proj.uid ?? String(idx) })}
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
          <CtxMenuItem label="Rename" onClick={() => handleRename(ctxMenu.idx)} />
          <CtxMenuItem
            label="Duplicate"
            onClick={() => handleDuplicate(ctxMenu.idx)}
            disabled={projects.length >= MAX_PROJECTS}
          />
          <div className="mx-2 my-1" style={{ height: 1, background: "var(--color-border)" }} />
          <CtxMenuItem label="Save Project..." onClick={() => handleSaveProject(ctxMenu.idx)} />
          <CtxMenuItem label="Load Project..." onClick={() => handleLoadProject(ctxMenu.idx)} />
          <div className="mx-2 my-1" style={{ height: 1, background: "var(--color-border)" }} />
          <CtxMenuItem
            label="Remove"
            onClick={() => { if (window.confirm(`Remove "${projects[ctxMenu.idx]?.name}"? This cannot be undone.`)) removeProject(ctxMenu.idx); }}
            danger
            disabled={projects.length <= 1}
          />
        </div>
      )}
    </div>
  );
}
