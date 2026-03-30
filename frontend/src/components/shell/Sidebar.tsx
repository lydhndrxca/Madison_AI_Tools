import {
  Sparkles,
  Image,
  User,
  Crosshair,
  Box,
  Package,
  Mountain,
  Layout,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bug,
  Palette,
  FolderOpen,
  Puzzle,
  MessageSquare,
  Lightbulb,
  PenTool,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { PageId } from "@/app";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onSettingsClick?: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

type NavItem = { id: PageId; label: string; icon: React.ComponentType<{ className?: string }>; disabled?: boolean };

const TOP_ITEMS: NavItem[] = [
  { id: "style-library", label: "Style Library", icon: Palette },
  { id: "generated-images", label: "Generated Images", icon: FolderOpen },
];

const TOOL_ITEMS: NavItem[] = [
  { id: "character", label: "AI Character Lab", icon: User },
  { id: "uilab", label: "AI UI Lab", icon: Layout },
  { id: "prop", label: "AI Prop Lab", icon: Package },
  { id: "weapon", label: "AI Weapon Lab", icon: Crosshair },
  { id: "environment", label: "AI Environment Lab", icon: Mountain },
  { id: "3d", label: "3D GEN AI", icon: Box },
  { id: "gemini", label: "Default Gemini", icon: Sparkles },
  { id: "multiview", label: "Multiview", icon: Image },
];

const CREATIVE_ITEMS: NavItem[] = [
  { id: "brainstorm", label: "Idea Brainstorming", icon: Lightbulb },
  { id: "writingroom", label: "Writing Room", icon: PenTool },
];

const UTILITY_ITEMS: NavItem[] = [
  { id: "transcripts", label: "Art Direction Logs", icon: MessageSquare },
  { id: "prompt-builder", label: "Prompt Builder", icon: Puzzle },
];

export function Sidebar({ activePage, onNavigate, onSettingsClick, collapsed, setCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex shrink-0 border-r transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-[52px]" : "w-[268px]",
      )}
      style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
      
    >
      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <div className="flex h-11 items-center shrink-0 px-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <span className="text-[13px] font-bold tracking-tight" style={{ color: "var(--color-foreground)" }}>
              Madison AI Suite
            </span>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
            <button
              onClick={onSettingsClick}
              className="flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-all w-full text-left cursor-pointer"
              style={{
                border: "none",
                background: "transparent",
                color: "var(--color-text-secondary)",
              }}
            >
              <Settings className="h-4 w-4 shrink-0" />
              Settings
            </button>

            {TOP_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-all w-full text-left cursor-pointer",
                    active
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-foreground)]",
                  )}
                  style={{
                    border: "none",
                    background: active ? "var(--color-hover)" : "transparent",
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full"
                      style={{ background: "var(--color-text-secondary)" }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}

            <p
              className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-text-muted)" }}
            >
              Tools
            </p>

            {TOOL_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => !item.disabled && onNavigate(item.id)}
                  disabled={item.disabled}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-all w-full text-left cursor-pointer",
                    active
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-foreground)]",
                    item.disabled && "opacity-30 cursor-not-allowed",
                  )}
                  style={{
                    border: "none",
                    background: active ? "var(--color-hover)" : "transparent",
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full"
                      style={{ background: "var(--color-text-secondary)" }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.disabled && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wide opacity-50">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}

            <p
              className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-text-muted)" }}
            >
              Creative
            </p>

            {CREATIVE_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-all w-full text-left cursor-pointer",
                    active
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-foreground)]",
                  )}
                  style={{
                    border: "none",
                    background: active ? "var(--color-hover)" : "transparent",
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full"
                      style={{ background: "var(--color-text-secondary)" }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}

            <p
              className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-text-muted)" }}
            >
              Utilities
            </p>

            {UTILITY_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-all w-full text-left cursor-pointer",
                    active
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-foreground)]",
                  )}
                  style={{
                    border: "none",
                    background: active ? "var(--color-hover)" : "transparent",
                  }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full"
                      style={{ background: "var(--color-text-secondary)" }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div
            className="border-t px-2 py-2 flex flex-col gap-0.5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <a
              href="mailto:shawn@bluehole.net?subject=PUBG%20Madison%20AI%20Suite%20Bug"
              className="flex items-center gap-2.5 rounded px-3 py-1 text-[11px] transition-colors no-underline"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Bug className="h-3 w-3 shrink-0" />
              Report Bug
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="shrink-0 w-[52px] flex flex-col items-center justify-center transition-colors cursor-pointer"
        style={{
          border: "none",
          borderLeft: collapsed ? "none" : "1px solid var(--color-border)",
          background: "transparent",
          color: "var(--color-text-muted)",
        }}
        title={collapsed ? "Show the tools panel" : "Hide the tools panel to give more room for your image"}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
    </aside>
  );
}
