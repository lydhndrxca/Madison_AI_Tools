import { useState, useRef, useEffect, useCallback, Fragment } from "react";
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
  group: "stage" | "views" | "refs" | "library" | "artboard" | "search";
  prompt?: string;
  isCustom?: boolean;
}

export type TabStatus = "generating" | "done";

interface GroupedTabBarProps {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  onAddRef?: () => void;
  onRemoveTab?: (tabId: string) => void;
  noBorder?: boolean;
  /** Tab id currently receiving an image generation (pulsing highlight). */
  generatingTabId?: string | null;
  /** Per-tab status indicators: red dot while generating, green dot when done. */
  tabStatuses?: Record<string, TabStatus>;
  onReorder?: (tabs: TabDef[]) => void;
}

const GROUP_BG: Record<string, string> = {
  stage: "rgba(255,255,255,0.04)",
  views: "transparent",
  library: "rgba(255,255,255,0.02)",
  artboard: "rgba(200,200,200,0.08)",
  search: "rgba(100,180,255,0.06)",
  refs: "rgba(0,0,0,0.08)",
};

export function GroupedTabBar({ tabs, active, onSelect, onAddRef, onRemoveTab, noBorder, generatingTabId, tabStatuses, onReorder }: GroupedTabBarProps) {
  const groups: ("stage" | "views" | "library" | "artboard" | "search" | "refs")[] = ["stage", "views", "library", "artboard", "search", "refs"];

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const [draggedTab, setDraggedTab] = useState<TabDef | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const draggedTabRef = useRef<TabDef | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, tab: TabDef) => {
    if (!onReorder) return;
    draggedTabRef.current = tab;
    setDraggedTab(tab);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tab.id);
  }, [onReorder]);

  const handleDragOver = useCallback((e: React.DragEvent, tab: TabDef) => {
    if (!onReorder || !draggedTabRef.current || draggedTabRef.current.id === tab.id) return;
    e.preventDefault();
    setDragOverTab(tab.id);
  }, [onReorder]);

  const handleDragEnd = useCallback(() => {
    draggedTabRef.current = null;
    setDraggedTab(null);
    setDragOverTab(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetTab: TabDef) => {
    if (!onReorder) return;
    e.preventDefault();
    const source = draggedTabRef.current;
    if (!source || source.id === targetTab.id) {
      handleDragEnd();
      return;
    }
    const without = tabs.filter((t) => t.id !== source.id);
    const toIndex = without.findIndex((t) => t.id === targetTab.id);
    if (toIndex < 0) {
      handleDragEnd();
      return;
    }
    const next = [...without.slice(0, toIndex), source, ...without.slice(toIndex)];
    onReorder(next);
    handleDragEnd();
  }, [onReorder, tabs, handleDragEnd]);

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
    if (tab.group !== "refs") return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
  };

  const renderTabButton = (tab: TabDef, group: TabDef["group"]) => {
    const isActive = active === tab.id;
    const isGenerating = generatingTabId != null && generatingTabId === tab.id;
    const showDropIndicator = !!onReorder && dragOverTab === tab.id;
    return (
      <button
        draggable={!!onReorder}
        onDragStart={(e) => handleDragStart(e, tab)}
        onDragOver={(e) => handleDragOver(e, tab)}
        onDragEnd={handleDragEnd}
        onDrop={(e) => handleDrop(e, tab)}
        onClick={() => onSelect(tab.id)}
        onContextMenu={(e) => handleTabContextMenu(e, tab)}
        className={cn(
          "text-xs font-medium transition-all whitespace-nowrap cursor-pointer relative",
          isGenerating && "btn-generating rounded-md",
          isActive
            ? "text-[var(--color-foreground)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
        )}
        style={{
          background: isActive ? "var(--color-card)" : GROUP_BG[group],
          border: isActive ? "1px solid var(--color-border)" : "1px solid transparent",
          borderBottom: isActive ? "1px solid var(--color-card)" : "1px solid var(--color-border)",
          borderLeft: showDropIndicator ? "2px solid rgba(255,255,255,0.4)" : undefined,
          borderRadius: isActive ? "6px 6px 0 0" : "4px 4px 0 0",
          padding: isActive ? "6px 14px 5px" : tab.group === "artboard" ? "5px 16px 5px" : "4px 12px 5px",
          marginBottom: -1,
          zIndex: isActive ? 2 : 1,
          opacity: draggedTab?.id === tab.id ? 0.55 : 1,
        }}
      >
        {tab.label}
        {tabStatuses?.[tab.id] && (
          <span
            className={cn("inline-block ml-1.5 h-1.5 w-1.5 rounded-full shrink-0", tabStatuses[tab.id] === "generating" && "animate-pulse")}
            style={{ background: tabStatuses[tab.id] === "generating" ? "#ef4444" : "#22c55e" }}
          />
        )}
      </button>
    );
  };

  return (
    <>
      <div
        className="flex items-end gap-0 shrink-0 no-scrollbar"
        style={{ background: noBorder ? "transparent" : "var(--color-background)", borderBottom: noBorder ? "none" : "1px solid var(--color-border)", paddingTop: noBorder ? 0 : 4 }}
      >
        {onReorder ? (
          <>
            {tabs.map((tab, i) => {
              const prev = i > 0 ? tabs[i - 1] : null;
              const showDivider = prev != null && tab.group !== prev.group;
              const isLastInRefRun =
                tab.group === "refs"
                && (i === tabs.length - 1 || tabs[i + 1].group !== "refs");
              return (
                <Fragment key={tab.id}>
                  {showDivider && (
                    <div className="w-px self-stretch mx-1" style={{ background: "var(--color-border)", marginBottom: 0 }} />
                  )}
                  {renderTabButton(tab, tab.group)}
                  {isLastInRefRun && onAddRef && (
                    <button
                      type="button"
                      onClick={onAddRef}
                      className="px-2 text-xs cursor-pointer transition-colors"
                      style={{ color: "var(--color-text-muted)", background: "transparent", border: "none", paddingBottom: 5, marginBottom: -1 }}
                      title="Add reference tab"
                    >+</button>
                  )}
                </Fragment>
              );
            })}
          </>
        ) : (
          groups.map((group, gi) => {
            const groupTabs = tabs.filter((t) => t.group === group);
            if (groupTabs.length === 0) return null;
            return (
              <div key={group} className="flex items-end">
                {gi > 0 && (
                  <div className="w-px self-stretch mx-1" style={{ background: "var(--color-border)", marginBottom: 0 }} />
                )}
                {groupTabs.map((tab) => (
                  <Fragment key={tab.id}>{renderTabButton(tab, group)}</Fragment>
                ))}
                {group === "refs" && onAddRef && (
                  <button
                    type="button"
                    onClick={onAddRef}
                    className="px-2 text-xs cursor-pointer transition-colors"
                    style={{ color: "var(--color-text-muted)", background: "transparent", border: "none", paddingBottom: 5, marginBottom: -1 }}
                    title="Add reference tab"
                  >+</button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Right-click context menu for ref tabs */}
      {ctxMenu && (() => {
        const ctxTab = tabs.find((t) => t.id === ctxMenu.tabId);
        const isRef = ctxTab?.group === "refs";
        if (!isRef || !onRemoveTab) return null;
        return (
          <div
            ref={ctxRef}
            className="fixed z-[9999]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1 rounded shadow-lg" style={{ background: "var(--color-card, #4F4F4F)", border: "1px solid var(--color-border, #3A3A3A)", minWidth: 140 }}>
              <button className="ctx-menu-item" onClick={() => { onRemoveTab(ctxMenu.tabId); setCtxMenu(null); }}>Remove</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
