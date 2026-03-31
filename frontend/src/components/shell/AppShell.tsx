import React, { useState, useCallback, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { SettingsPanel } from "./SettingsPanel";
import { WelcomeModal } from "./WelcomeModal";
import { ConsolePanel } from "@/components/shared/ConsolePanel";
import { AudioSettingsModal } from "@/components/shared/AudioSettingsModal";
import { useWebSocket } from "@/hooks/useApi";
import { useSessionContext } from "@/hooks/SessionContext";
import { useVoiceToText, nativeSpeechSupported } from "@/hooks/useVoiceToText";
import type { VoiceEngine } from "@/hooks/useVoiceToText";

import { useShortcuts } from "@/hooks/useShortcuts";
import { CostCounter } from "./CostCounter";
import type { PageId } from "@/app";
import { DS_EVT, confettiBurst } from "@/lib/deepSearchEvents";
import { Button } from "@/components/ui";

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

type TemplateNameModal =
  | null
  | { mode: "save" }
  | { mode: "rename"; idx: number; initial: string };

function TemplateDropdown() {
  const { templates, saveTemplate, loadTemplate, deleteTemplate, renameTemplate } = useSessionContext();
  const [open, setOpen] = useState(false);
  const [nameModal, setNameModal] = useState<TemplateNameModal>(null);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [open]);

  useEffect(() => {
    if (!nameModal) return;
    setNameDraft(nameModal.mode === "rename" ? nameModal.initial : "");
    const t = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNameModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [nameModal]);

  const openSaveModal = () => {
    setOpen(false);
    setNameModal({ mode: "save" });
  };

  const commitNameModal = () => {
    const name = nameDraft.trim();
    if (!name || !nameModal) return;
    if (nameModal.mode === "save") {
      saveTemplate(name);
      setOpen(false);
    } else {
      renameTemplate(nameModal.idx, name);
    }
    setNameModal(null);
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
            type="button"
            onClick={openSaveModal}
            className="ctx-menu-item font-medium"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >+ Save Current as Template</button>
          {templates.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>No saved templates</div>
          )}
          {templates.map((tpl, i) => (
            <div key={i} className="flex items-center group" style={{ borderBottom: i < templates.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <button
                type="button"
                className="ctx-menu-item flex-1 text-left"
                onClick={() => { loadTemplate(i); setOpen(false); }}
                title={`Saved ${new Date(tpl.savedAt).toLocaleString()}`}
              >{tpl.name}</button>
              <button
                type="button"
                onClick={() => { setOpen(false); setNameModal({ mode: "rename", idx: i, initial: tpl.name }); }}
                className="px-1.5 text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0"
                style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
                title="Rename"
              >&#x270E;</button>
              <button
                type="button"
                onClick={() => { if (confirm(`Delete template "${tpl.name}"?`)) deleteTemplate(i); }}
                className="px-1.5 text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0"
                style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
                title="Delete"
              >&#x2715;</button>
            </div>
          ))}
        </div>
      )}

      {nameModal && (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setNameModal(null); }}
        >
          <div
            className="rounded-lg shadow-xl p-4 min-w-[280px]"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-[12px] font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
              {nameModal.mode === "save" ? "Save session template" : "Rename template"}
            </p>
            <input
              ref={nameInputRef}
              className="w-full px-2 py-1.5 text-[12px] rounded mb-3"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitNameModal(); }}
              placeholder="Template name"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setNameModal(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={commitNameModal}>Save</Button>
            </div>
          </div>
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
  "brainstorm": "Idea Brainstorming",
  "writingroom": "Writing Room",
  "help": "Help Wiki",
};

export function AppShell({ activePage, onNavigate, children }: AppShellProps) {
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const { triggerSave, triggerOpen } = useSessionContext();
  const voice = useVoiceToText();
  const [voiceCtxMenu, setVoiceCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [voiceRestartPending, setVoiceRestartPending] = useState(false);

  // Deep Search visual states
  const [dsState, setDsState] = useState<"idle" | "searching" | "results">("idle");
  const dsTopBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onStart = () => setDsState("searching");
    const onComplete = (e: Event) => {
      const count = (e as CustomEvent).detail?.count ?? 0;
      if (count > 0) {
        setDsState("results");
        if (dsTopBtnRef.current) confettiBurst(dsTopBtnRef.current);
      } else {
        setDsState("idle");
      }
    };
    const onViewed = () => setDsState("idle");
    window.addEventListener(DS_EVT.START, onStart);
    window.addEventListener(DS_EVT.COMPLETE, onComplete);
    window.addEventListener(DS_EVT.VIEWED, onViewed);
    return () => {
      window.removeEventListener(DS_EVT.START, onStart);
      window.removeEventListener(DS_EVT.COMPLETE, onComplete);
      window.removeEventListener(DS_EVT.VIEWED, onViewed);
    };
  }, []);
  const { registerAction, unregisterAction } = useShortcuts();

  const toggleVoiceToText = useCallback(() => {
    voice.toggle();
  }, [voice]);

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
              title="Open tools panel"
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
              background: voice.active ? "rgba(224, 80, 80, 0.15)" : voice.processing ? "rgba(251, 191, 36, 0.12)" : "rgba(148, 163, 184, 0.12)",
              border: voice.active ? "1px solid rgba(224, 80, 80, 0.4)" : voice.processing ? "1px solid rgba(251, 191, 36, 0.35)" : "1px solid rgba(148, 163, 184, 0.28)",
              color: voice.active ? "#e05050" : voice.processing ? "#fbbf24" : "var(--color-text-primary)",
            }}
            title={`${voice.active ? "Recording in progress — click to stop" : voice.processing ? "Processing remaining audio..." : "Dictate — click into a text field and speak to type"}\nEngine: ${voice.settings.engine === "native" ? "Windows / Native" : "Gemini (AI)"}\nRight-click to switch engine`}
          >
            {voice.active && <span className="voice-recording-dot" />}
            {voice.processing && !voice.active && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
            {!voice.active && !voice.processing && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>}
            {voice.active ? "Recording in progress..." : voice.processing ? "Processing..." : `Dictate${voice.settings.engine === "native" ? " (Native)" : ""}`}
          </button>

          <button
            ref={dsTopBtnRef}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (dsState === "results") {
                setDsState("idle");
                window.dispatchEvent(new CustomEvent(DS_EVT.VIEWED));
              }
              window.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabId: "deepSearch" } }));
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium${dsState === "searching" ? " ds-searching" : ""}${dsState === "results" ? " ds-results-ready" : ""}`}
            style={{
              background: dsState === "results" ? "rgba(34,197,94,0.1)" : "rgba(148, 163, 184, 0.12)",
              border: dsState === "results" ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(148, 163, 184, 0.28)",
              color: dsState === "results" ? "#22c55e" : "var(--color-text-primary)",
            }}
            title={dsState === "results" ? "Results ready — click to view" : dsState === "searching" ? "Searching..." : "Open Deep Search"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={dsState === "results" ? "#22c55e" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            {dsState === "results" ? "RESULTS READY" : dsState === "searching" ? "Searching..." : "Deep Search"}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onNavigate("help" as PageId)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
            style={{
              background: activePage === "help" ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.08)",
              border: activePage === "help" ? "1px solid rgba(148, 163, 184, 0.4)" : "1px solid transparent",
              color: activePage === "help" ? "var(--color-foreground)" : "var(--color-text-muted)",
            }}
            title="Help Wiki — documentation and AI assistant"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>
            </svg>
            Help
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => window.dispatchEvent(new CustomEvent("voice-command", { detail: { action: "quick_generate", params: {} } }))}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
            style={{
              background: "rgba(148, 163, 184, 0.12)",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              color: "var(--color-text-primary)",
            }}
            title="Quick generate with current settings"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Quick Generate
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
      <WelcomeModal onNavigate={onNavigate as (page: string) => void} />

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
