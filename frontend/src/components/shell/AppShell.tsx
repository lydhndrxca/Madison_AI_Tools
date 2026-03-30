import React, { useState, useCallback, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { SettingsPanel } from "./SettingsPanel";
import { ConsolePanel } from "@/components/shared/ConsolePanel";
import { AudioSettingsModal } from "@/components/shared/AudioSettingsModal";
import { useWebSocket } from "@/hooks/useApi";
import { useSessionContext } from "@/hooks/SessionContext";
import { useVoiceToText, nativeSpeechSupported } from "@/hooks/useVoiceToText";
import type { VoiceEngine } from "@/hooks/useVoiceToText";
import { useVoiceDirector } from "@/hooks/useVoiceDirector";
import { useShortcuts } from "@/hooks/useShortcuts";
import { CostCounter } from "./CostCounter";
import type { PageId } from "@/app";

interface AppShellProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  children: React.ReactNode;
}

/* ── Reusable menu-bar dropdown ───────────────────────────────── */
interface MenuItem { label: string; shortcut?: string; onClick: () => void; separator?: false }
interface MenuSeparator { separator: true }
type MenuEntry = MenuItem | MenuSeparator;

function MenuBarDropdown({ label, items }: { label: string; items: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
        style={{ background: open ? "var(--color-hover)" : "transparent", color: "var(--color-text-secondary)", border: "none" }}
      >{label}</button>
      {open && (
        <div
          className="absolute left-0 top-full mt-0.5 z-[9999] rounded shadow-lg py-1"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 220 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {items.map((item, i) =>
            item.separator
              ? <div key={i} style={{ borderTop: "1px solid var(--color-border)", margin: "3px 0" }} />
              : (
                <button
                  key={i}
                  className="ctx-menu-item flex items-center justify-between w-full text-left"
                  onClick={() => { item.onClick(); setOpen(false); }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <span className="text-[10px] ml-4" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>{item.shortcut}</span>}
                </button>
              ),
          )}
        </div>
      )}
    </div>
  );
}

function TemplateDropdown() {
  const { templates, saveTemplate, loadTemplate, deleteTemplate, renameTemplate } = useSessionContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [open]);

  const handleSave = () => {
    const name = prompt("Template name:");
    if (!name?.trim()) return;
    saveTemplate(name.trim());
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="px-2.5 py-1 text-[11px] rounded cursor-pointer flex items-center gap-1.5 font-medium"
        style={{ background: open ? "var(--color-hover)" : "transparent", color: "var(--color-text-secondary)", border: "none" }}
      >
        Session Templates
        <span className="text-[9px]">{open ? "\u25B4" : "\u25BE"}</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-[9999] rounded shadow-lg py-1"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 220, maxHeight: 320, overflowY: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleSave}
            className="ctx-menu-item font-medium"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >+ Save Current as Template</button>
          {templates.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>No saved templates</div>
          )}
          {templates.map((tpl, i) => (
            <div key={i} className="flex items-center group" style={{ borderBottom: i < templates.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <button
                className="ctx-menu-item flex-1 text-left"
                onClick={() => { loadTemplate(i); setOpen(false); }}
                title={`Saved ${new Date(tpl.savedAt).toLocaleString()}`}
              >{tpl.name}</button>
              <button
                onClick={() => {
                  const name = prompt("Rename template:", tpl.name);
                  if (name?.trim()) renameTemplate(i, name.trim());
                }}
                className="px-1.5 text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0"
                style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
                title="Rename"
              >&#x270E;</button>
              <button
                onClick={() => { if (confirm(`Delete template "${tpl.name}"?`)) deleteTemplate(i); }}
                className="px-1.5 text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0"
                style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
                title="Delete"
              >&#x2715;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_LABELS: Record<PageId, string> = {
  "style-library": "Style Library",
  "prompt-builder": "Prompt Builder",
  "generated-images": "Generated Images",
  "favorites": "Generated Images",
  "gemini": "Default Gemini",
  "multiview": "Multiview",
  "character": "AI Character Lab",
  "weapon": "AI Weapon Lab",
  "prop": "AI Prop Lab",
  "environment": "AI Environment Lab",
  "uilab": "AI UI Lab",
  "3d": "3D GEN AI",
  "transcripts": "Art Direction Logs",
};

export function AppShell({ activePage, onNavigate, children }: AppShellProps) {
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const { triggerSave, triggerOpen } = useSessionContext();
  const voice = useVoiceToText();
  const director = useVoiceDirector();
  const [voiceCtxMenu, setVoiceCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [voiceRestartPending, setVoiceRestartPending] = useState(false);
  const { registerAction, unregisterAction } = useShortcuts();

  const toggleVoiceToText = useCallback(() => {
    if (director.active) director.toggle();
    voice.toggle();
  }, [voice, director]);

  const toggleDirector = useCallback(() => {
    if (voice.active) voice.toggle();
    director.toggle();
  }, [voice, director]);

  const switchVoiceEngine = useCallback((engine: VoiceEngine) => {
    if (voice.settings.engine === engine) { setVoiceCtxMenu(null); return; }
    const wasActive = voice.active;
    if (wasActive) voice.toggle();
    voice.updateSettings({ engine });
    setVoiceCtxMenu(null);
    if (wasActive) setVoiceRestartPending(true);
  }, [voice]);

  useEffect(() => {
    if (!voiceRestartPending || voice.active) return;
    const timer = setTimeout(() => { voice.toggle(); setVoiceRestartPending(false); }, 150);
    return () => clearTimeout(timer);
  }, [voiceRestartPending, voice]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail;
      if (action === "navigate" && params?.page) {
        onNavigate(params.page as PageId);
      }
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, [onNavigate]);

  const onWsMessage = useCallback(
    (msg: { type: string; data: Record<string, unknown> }) => {
      if (msg.type === "status" && typeof msg.data.message === "string") {
        setStatusMessage(msg.data.message);
      }
    },
    [],
  );

  useWebSocket(onWsMessage);

  // Register global & navigation shortcuts via the shortcuts system
  useEffect(() => {
    registerAction("openSettings", () => setSettingsOpen((p) => !p));
    registerAction("toggleConsole", () => setConsoleOpen((p) => !p));
    registerAction("saveSession", () => triggerSave());
    registerAction("openSession", () => triggerOpen());
    registerAction("navGenerate", () => onNavigate("gemini"));
    registerAction("navMultiview", () => onNavigate("multiview"));
    registerAction("navCharacter", () => onNavigate("character"));
    registerAction("navWeapon", () => onNavigate("weapon"));
    registerAction("navPropLab", () => onNavigate("prop"));
    registerAction("navEnvLab", () => onNavigate("environment"));
    registerAction("navUILab", () => onNavigate("uilab"));
    return () => {
      for (const id of ["openSettings", "toggleConsole", "saveSession", "openSession", "navGenerate", "navMultiview", "navCharacter", "navWeapon", "navPropLab", "navEnvLab", "navUILab"]) {
        unregisterAction(id);
      }
    };
  }, [registerAction, unregisterAction, onNavigate, triggerSave, triggerOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        onSettingsClick={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top menu bar: File | Edit | Session Templates */}
        <div
          className="flex items-center shrink-0 select-none"
          style={{ height: 32, background: "var(--color-card)", borderBottom: "1px solid var(--color-border)" }}
        >
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="px-3 py-1 text-[13px] font-bold tracking-tight cursor-pointer shrink-0"
              style={{ background: "transparent", border: "none", color: "var(--color-foreground)", borderRight: "1px solid var(--color-border)", marginRight: 2 }}
              title="Click to open the tools panel"
            >
              {PAGE_LABELS[activePage] || "Madison AI Suite"}
            </button>
          )}
          <MenuBarDropdown label="File" items={[
            { label: "Save Session", shortcut: "Ctrl+S", onClick: () => triggerSave() },
            { label: "Open Session", shortcut: "Ctrl+O", onClick: () => triggerOpen() },
            { separator: true },
            { label: "Audio Settings...", onClick: () => setAudioSettingsOpen(true) },
            { separator: true },
            { label: "Set Save Folder...", onClick: () => window.electronAPI?.menuSetSaveFolder() },
            { label: "Reset Save Folder to Default", onClick: () => window.electronAPI?.menuResetSaveFolder() },
            { separator: true },
            { label: "Show Console View", onClick: () => window.electronAPI?.menuShowConsole() },
            { separator: true },
            { label: "Reset App", onClick: () => window.electronAPI?.menuResetApp() },
          ]} />
          <MenuBarDropdown label="Edit" items={[
            { label: "Undo", shortcut: "Ctrl+Z", onClick: () => document.execCommand("undo") },
            { label: "Redo", shortcut: "Ctrl+Shift+Z", onClick: () => document.execCommand("redo") },
            { separator: true },
            { label: "Cut", shortcut: "Ctrl+X", onClick: () => document.execCommand("cut") },
            { label: "Copy", shortcut: "Ctrl+C", onClick: () => document.execCommand("copy") },
            { label: "Paste", shortcut: "Ctrl+V", onClick: () => document.execCommand("paste") },
            { label: "Select All", shortcut: "Ctrl+A", onClick: () => document.execCommand("selectAll") },
          ]} />
          <TemplateDropdown />

          {/* Voice-to-text button — onMouseDown preventDefault keeps focus in the active text field */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleVoiceToText}
            onContextMenu={(e) => { e.preventDefault(); setVoiceCtxMenu({ x: e.clientX, y: e.clientY }); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium${voice.active ? " voice-recording-indicator" : ""}`}
            style={{
              background: voice.active ? "rgba(224, 80, 80, 0.15)" : "transparent",
              border: voice.active ? "1px solid rgba(224, 80, 80, 0.4)" : "1px solid transparent",
              color: voice.active ? "#e05050" : "var(--color-text-secondary)",
            }}
            title={`${voice.active ? "Voice recording is active — click to stop" : "Start voice-to-text — click into a text field and speak to dictate"}\nEngine: ${voice.settings.engine === "native" ? "Windows / Native" : "Gemini (AI)"}\nRight-click to switch engine`}
          >
            {voice.active && <span className="voice-recording-dot" />}
            {!voice.active && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>}
            {voice.active ? "Voice Recording Active" : `Voice to Text${voice.settings.engine === "native" ? " (Native)" : ""}`}
          </button>

          {/* Voice Director button — hands-free art direction via Gemini function calling */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleDirector}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium${director.active ? " voice-recording-indicator" : ""}`}
            style={{
              background: director.active ? "rgba(139, 92, 246, 0.15)" : "transparent",
              border: director.active ? "1px solid rgba(139, 92, 246, 0.4)" : "1px solid transparent",
              color: director.active ? "#a78bfa" : "var(--color-text-secondary)",
            }}
            title={director.active ? "Voice Director is active — click to stop" : "Start Voice Director — speak commands to control the AI tools hands-free"}
          >
            {director.active && <span className="voice-recording-dot" style={{ background: "#a78bfa" }} />}
            {!director.active && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4-8 8 3 3 8-8"/><path d="m18 7-3-3"/><path d="M9 15 4.4 19.6a2.1 2.1 0 1 0 3 3L12 18"/></svg>}
            {director.active ? "Director Listening..." : "Voice Director"}
          </button>

          <CostCounter />
        </div>
        <main
          className="flex-1 overflow-hidden relative"
          style={{
            background: "var(--color-background)",
            marginBottom: consoleOpen ? "280px" : 0,
            transition: "margin-bottom 0.2s ease",
          }}
        >
          {children}
        </main>
        <StatusBar
          message={statusMessage}
          onConsoleToggle={() => setConsoleOpen((prev) => !prev)}
          consoleOpen={consoleOpen}
        />
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConsolePanel open={consoleOpen} onClose={() => setConsoleOpen(false)} />
      <AudioSettingsModal open={audioSettingsOpen} onClose={() => setAudioSettingsOpen(false)} />

      {/* Voice engine right-click context menu */}
      {voiceCtxMenu && (
        <div className="fixed inset-0 z-[55]" onClick={() => setVoiceCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setVoiceCtxMenu(null); }}>
          <div
            className="absolute py-1 rounded-md shadow-lg"
            style={{ left: voiceCtxMenu.x, top: voiceCtxMenu.y, background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 200, zIndex: 56 }}
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
              Voice Engine
            </div>
            {(["gemini", "native"] as VoiceEngine[]).map((eng) => {
              const isSelected = voice.settings.engine === eng;
              const isDisabled = eng === "native" && !nativeSpeechSupported;
              const label = eng === "gemini" ? "Gemini (AI)" : "Windows / Native";
              return (
                <button
                  key={eng}
                  disabled={isDisabled}
                  className="w-full text-left px-3 py-1.5 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: isSelected ? "var(--color-hover)" : "transparent",
                    border: "none",
                    color: isSelected ? "var(--color-accent)" : "var(--color-text-primary)",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.background = "var(--color-hover)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  onClick={() => switchVoiceEngine(eng)}
                >
                  {isSelected ? "\u2713 " : "  "}{label}
                  {isDisabled && " (unavailable)"}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
