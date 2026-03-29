import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";

// Backwards-compatible flat TabBar for pages that use string[] tabs
interface TabBarProps {
  tabs: string[];
  active: string;
  onSelect: (tab: string) => void;
}

export function TabBar({ tabs, active, onSelect }: TabBarProps) {
  return (
    <div
      className="flex items-center gap-0 shrink-0 overflow-x-auto"
      style={{ background: "var(--color-card)", borderBottom: "1px solid var(--color-border)" }}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap cursor-pointer",
            active === tab
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
          )}
          style={{
            background: active === tab ? "var(--color-hover)" : "transparent",
            border: "none",
            borderBottom: active === tab ? "2px solid var(--color-text-secondary)" : "2px solid transparent",
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export interface TabDef {
  id: string;
  label: string;
  group: "stage" | "views" | "refs" | "library" | "artboard";
  prompt?: string;
  isCustom?: boolean;
}

interface GroupedTabBarProps {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  onAddRef?: () => void;
  onRemoveTab?: (tabId: string) => void;
  onEditTabPrompt?: (tabId: string, newPrompt: string) => void;
  noBorder?: boolean;
}

const GROUP_BG: Record<string, string> = {
  stage: "rgba(255,255,255,0.04)",
  views: "transparent",
  library: "rgba(255,255,255,0.02)",
  artboard: "rgba(200,200,200,0.08)",
  refs: "rgba(0,0,0,0.08)",
};

export function GroupedTabBar({ tabs, active, onSelect, onAddRef, onRemoveTab, onEditTabPrompt, noBorder }: GroupedTabBarProps) {
  const groups: ("stage" | "views" | "library" | "artboard" | "refs")[] = ["stage", "views", "library", "artboard", "refs"];

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [editingTab, setEditingTab] = useState<{ id: string; label: string; prompt: string } | null>(null);
  const [editPromptVal, setEditPromptVal] = useState("");
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [ctxMenu]);

  const handleTabContextMenu = (e: React.MouseEvent, tab: TabDef) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
  };

  const openEditPrompt = () => {
    if (!ctxMenu) return;
    const tab = tabs.find((t) => t.id === ctxMenu.tabId);
    if (!tab) return;
    setEditingTab({ id: tab.id, label: tab.label, prompt: tab.prompt || "" });
    setEditPromptVal(tab.prompt || "");
    setCtxMenu(null);
  };

  const savePrompt = () => {
    if (editingTab && onEditTabPrompt) {
      onEditTabPrompt(editingTab.id, editPromptVal);
    }
    setEditingTab(null);
  };

  return (
    <>
      <div
        className="flex items-end gap-0 shrink-0 no-scrollbar"
        style={{ background: noBorder ? "transparent" : "var(--color-background)", borderBottom: noBorder ? "none" : "1px solid var(--color-border)", paddingTop: noBorder ? 0 : 4 }}
      >
        {groups.map((group, gi) => {
          const groupTabs = tabs.filter((t) => t.group === group);
          if (groupTabs.length === 0) return null;
          return (
            <div key={group} className="flex items-end">
              {gi > 0 && (
                <div className="w-px self-stretch mx-1" style={{ background: "var(--color-border)", marginBottom: 0 }} />
              )}
              {groupTabs.map((tab) => {
                const isActive = active === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onSelect(tab.id)}
                    onContextMenu={(e) => handleTabContextMenu(e, tab)}
                    className={cn(
                      "text-xs font-medium transition-all whitespace-nowrap cursor-pointer relative",
                      isActive
                        ? "text-[var(--color-foreground)]"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
                    )}
                    style={{
                      background: isActive ? "var(--color-card)" : GROUP_BG[group],
                      border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
                      borderBottom: isActive ? "1px solid var(--color-card)" : "1px solid var(--color-border)",
                      borderRadius: isActive ? "6px 6px 0 0" : "4px 4px 0 0",
                      padding: isActive ? "6px 14px 5px" : tab.group === "artboard" ? "5px 16px 5px" : "4px 12px 5px",
                      marginBottom: -1,
                      zIndex: isActive ? 2 : 1,
                    }}
                    title={tab.prompt ? `View prompt: ${tab.prompt}\n\nRight-click to edit or remove.` : "Right-click for options"}
                  >
                    {tab.label}
                  </button>
                );
              })}
              {group === "refs" && onAddRef && (
                <button
                  onClick={onAddRef}
                  className="px-2 text-xs cursor-pointer transition-colors"
                  style={{ color: "var(--color-text-muted)", background: "transparent", border: "none", paddingBottom: 5, marginBottom: -1 }}
                  title="Add a new reference image tab — use these for pasting inspiration or reference photos"
                >+</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (() => {
        const ctxTab = tabs.find((t) => t.id === ctxMenu.tabId);
        const isRef = ctxTab?.group === "refs";
        return (
          <div
            ref={ctxRef}
            className="fixed z-[9999]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1 rounded shadow-lg" style={{ background: "var(--color-card, #4F4F4F)", border: "1px solid var(--color-border, #3A3A3A)", minWidth: 140 }}>
              {!isRef && (
                <button className="ctx-menu-item" onClick={openEditPrompt}>Edit Prompt</button>
              )}
              {isRef && onRemoveTab && (
                <button className="ctx-menu-item" onClick={() => { onRemoveTab(ctxMenu.tabId); setCtxMenu(null); }}>Remove</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Edit Prompt modal */}
      {editingTab && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
          onMouseDown={() => setEditingTab(null)}>
          <div
            className="rounded-lg shadow-xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", width: 420, maxWidth: "90vw" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
              Edit Prompt — {editingTab.label}
            </div>
            <textarea
              className="w-full px-3 py-2 text-xs rounded resize-none"
              rows={5}
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              value={editPromptVal}
              onChange={(e) => setEditPromptVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); savePrompt(); } if (e.key === "Escape") setEditingTab(null); }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1 text-xs rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                onClick={() => setEditingTab(null)}
              >Cancel</button>
              <button
                className="px-3 py-1 text-xs rounded cursor-pointer"
                style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
                onClick={savePrompt}
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
