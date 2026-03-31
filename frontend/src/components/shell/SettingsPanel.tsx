import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { apiFetch } from "@/hooks/useApi";
import { getThreeDSettings, saveThreeDSettings, detectBlenderPath, type ThreeDSettings } from "@/lib/threedgenApi";
import { X, RotateCcw, GripVertical, XCircle, Eye, EyeOff } from "lucide-react";
import { useShortcuts, CATEGORY_LABELS, eventToComboString } from "@/hooks/useShortcuts";
import type { ShortcutDef } from "@/hooks/useShortcuts";
import { useVoiceToText, nativeSpeechSupported } from "@/hooks/useVoiceToText";
import type { VoiceEngine } from "@/hooks/useVoiceToText";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/* ── Reusable helpers ─────────────────────────────────────────── */

function Kbd({ combo }: { combo: string }) {
  const parts = combo.split("+");
  return (
    <span className="inline-flex gap-0.5">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded"
          style={{
            background: "var(--color-input-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            boxShadow: "0 1px 0 var(--color-border)",
            lineHeight: 1.3,
          }}
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutRow({
  sc,
  rebindingId,
  onStartRebind,
  onReset,
  conflict,
}: {
  sc: ShortcutDef;
  rebindingId: string | null;
  onStartRebind: (id: string) => void;
  onReset: (id: string) => void;
  conflict: ShortcutDef | null;
}) {
  const isRebinding = rebindingId === sc.id;
  const isModified = sc.currentKeys !== sc.defaultKeys;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded" style={{ background: isRebinding ? "var(--color-hover)" : "transparent" }}>
      <span className="flex-1 text-xs" style={{ color: "var(--color-text-primary)" }}>{sc.label}</span>
      <div className="shrink-0 min-w-[120px] text-right">
        {isRebinding ? (
          <span className="text-[10px] animate-pulse" style={{ color: "var(--color-accent)" }}>Press new shortcut...</span>
        ) : (
          <Kbd combo={sc.currentKeys} />
        )}
      </div>
      <button
        onClick={() => onStartRebind(sc.id)}
        className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
        style={{
          background: isRebinding ? "var(--color-accent)" : "var(--color-input-bg)",
          border: "1px solid var(--color-border)",
          color: isRebinding ? "var(--color-foreground)" : "var(--color-text-secondary)",
        }}
      >
        {isRebinding ? "Cancel" : "Rebind"}
      </button>
      {isModified && (
        <button
          onClick={() => onReset(sc.id)}
          className="p-0.5 rounded cursor-pointer"
          style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          title={`Reset to default (${sc.defaultKeys})`}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
      {conflict && !isRebinding && (
        <span className="text-[9px]" style={{ color: "var(--color-warning)" }}>!</span>
      )}
    </div>
  );
}

/* ── Lab layout definitions ─────────────────────────────────── */

interface LabDef {
  id: string;
  label: string;
  storageKey: string;
  sections: { id: string; label: string }[];
  defaultOrder: string[];
  defaultCollapsed: Record<string, boolean>;
  nonCollapsible: Set<string>;
}

const CHARACTER_SECTIONS = [
  { id: "generate", label: "Generate Character Image" },
  { id: "identity", label: "Character Identity" },
  { id: "attributes", label: "Character Attributes" },
  { id: "bible", label: "Character Bible" },
  { id: "costume", label: "Costume & Outfit" },
  { id: "styleFusion", label: "Style Fusion" },
  { id: "envPlacement", label: "Environment Placement" },
  { id: "preservation", label: "Preservation Rules" },
  { id: "upscaleRestore", label: "Upscale / Restore" },
  { id: "multiview", label: "Multi-View Generation" },
  { id: "threeDGen", label: "3D Gen AI" },
  { id: "saveOptions", label: "Save Options" },
];

const PROP_SECTIONS = [
  { id: "generate", label: "Generate Prop Image" },
  { id: "identity", label: "Prop Identity" },
  { id: "propDescription", label: "Prop Description" },
  { id: "attributes", label: "Prop Attributes" },
  { id: "styleFusion", label: "Style Fusion" },
  { id: "preservation", label: "Preservation Rules" },
  { id: "upscaleRestore", label: "Upscale / Restore" },
  { id: "multiview", label: "Multi-View Generation" },
  { id: "threeDGen", label: "3D Gen AI" },
  { id: "saveOptions", label: "Save Options" },
];

const ENV_SECTIONS = [
  { id: "generate", label: "Generate Environment Concept" },
  { id: "identity", label: "Environment Identity" },
  { id: "envDescription", label: "Environment Description" },
  { id: "attributes", label: "Environment Attributes" },
  { id: "reimagine", label: "Game Screenshot Reimagine" },
  { id: "styleFusion", label: "Style Fusion" },
  { id: "preservation", label: "Preservation Rules" },
  { id: "upscaleRestore", label: "Upscale / Restore" },
  { id: "multiview", label: "Multi-View Generation" },
  { id: "saveOptions", label: "Save Options" },
];

const UI_SECTIONS = [
  { id: "generate", label: "Generate UI Element" },
  { id: "refImage", label: "Reference Image" },
  { id: "buttonLayout", label: "Button Layout & States" },
  { id: "scrollbarParts", label: "Scrollbar Parts" },
  { id: "charGen", label: "Character / Icon Set" },
  { id: "styleFusion", label: "Style Fusion" },
  { id: "threeDGen", label: "3D Gen AI" },
  { id: "saveOptions", label: "Save Options" },
];

const WEAPON_SECTIONS = [
  { id: "generate", label: "Generate Weapon Image" },
  { id: "weaponLibrary", label: "Weapon Library" },
  { id: "identity", label: "Weapon Identity" },
  { id: "components", label: "Weapon Components" },
  { id: "threeDGen", label: "3D Gen AI" },
  { id: "multiview", label: "Multi-View Generation" },
  { id: "saveOptions", label: "Save Options" },
];

const LABS: LabDef[] = [
  {
    id: "character",
    label: "Character Lab",
    storageKey: "madison-character-layout",
    sections: CHARACTER_SECTIONS,
    defaultOrder: CHARACTER_SECTIONS.map((s) => s.id),
    defaultCollapsed: { styleFusion: true, envPlacement: true, preservation: true, upscaleRestore: true, multiview: true, threeDGen: true, saveOptions: true },
    nonCollapsible: new Set(["generate"]),
  },
  {
    id: "prop",
    label: "Prop Lab",
    storageKey: "madison-prop-layout",
    sections: PROP_SECTIONS,
    defaultOrder: PROP_SECTIONS.map((s) => s.id),
    defaultCollapsed: { styleFusion: true, preservation: true, upscaleRestore: true, multiview: true, threeDGen: true, saveOptions: true },
    nonCollapsible: new Set(["generate"]),
  },
  {
    id: "env",
    label: "Environment Lab",
    storageKey: "madison-env-layout",
    sections: ENV_SECTIONS,
    defaultOrder: ENV_SECTIONS.map((s) => s.id),
    defaultCollapsed: { reimagine: true, styleFusion: true, preservation: true, upscaleRestore: true, multiview: true, saveOptions: true },
    nonCollapsible: new Set(["generate"]),
  },
  {
    id: "uilab",
    label: "UI Lab",
    storageKey: "madison-uilab-layout",
    sections: UI_SECTIONS,
    defaultOrder: UI_SECTIONS.map((s) => s.id),
    defaultCollapsed: { refImage: true, styleFusion: true, threeDGen: true, saveOptions: true },
    nonCollapsible: new Set(["generate"]),
  },
  {
    id: "weapon",
    label: "Weapon Lab",
    storageKey: "madison-weapon-layout",
    sections: WEAPON_SECTIONS,
    defaultOrder: WEAPON_SECTIONS.map((s) => s.id),
    defaultCollapsed: { components: true, threeDGen: true, saveOptions: true },
    nonCollapsible: new Set(["generate"]),
  },
];

interface LayoutState { order: string[]; collapsed: Record<string, boolean>; hidden?: string[] }

function loadLayout(lab: LabDef): LayoutState {
  try {
    const raw = localStorage.getItem(lab.storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set(lab.defaultOrder);
      const order = parsed.order.filter((id) => allIds.has(id));
      for (const id of lab.defaultOrder) { if (!order.includes(id)) order.push(id); }
      return { order, collapsed: parsed.collapsed ?? {}, hidden: parsed.hidden };
    }
  } catch { /* */ }
  return { order: [...lab.defaultOrder], collapsed: { ...lab.defaultCollapsed } };
}

function saveLayout(lab: LabDef, state: LayoutState) {
  localStorage.setItem(lab.storageKey, JSON.stringify(state));
}

/* ── Lab Layout Editor component ──────────────────────────────── */

function LabLayoutEditor({ lab }: { lab: LabDef }) {
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout(lab));
  const dragItem = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sectionMap = new Map(lab.sections.map((s) => [s.id, s]));
  const hiddenSet = new Set(layout.hidden ?? []);

  const visibleOrder = layout.order.filter((id) => !hiddenSet.has(id));
  const hiddenSections = lab.sections.filter((s) => hiddenSet.has(s.id));

  const handleDragStart = (id: string) => { dragItem.current = id; };
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverId(id); };
  const handleDragEnd = () => { setDragOverId(null); dragItem.current = null; };

  const handleDrop = (targetId: string) => {
    const from = dragItem.current;
    if (!from || from === targetId) { handleDragEnd(); return; }
    const newOrder = [...layout.order];
    const fi = newOrder.indexOf(from);
    const ti = newOrder.indexOf(targetId);
    if (fi >= 0 && ti >= 0) {
      newOrder.splice(fi, 1);
      newOrder.splice(ti, 0, from);
      const next = { ...layout, order: newOrder };
      setLayout(next);
      saveLayout(lab, next);
    }
    handleDragEnd();
  };

  const toggleCollapsed = (id: string) => {
    if (lab.nonCollapsible.has(id)) return;
    const next = { ...layout, collapsed: { ...layout.collapsed, [id]: !layout.collapsed[id] } };
    setLayout(next);
    saveLayout(lab, next);
  };

  const hideSection = (id: string) => {
    if (lab.nonCollapsible.has(id)) return;
    const newHidden = [...(layout.hidden ?? []), id];
    const next = { ...layout, hidden: newHidden };
    setLayout(next);
    saveLayout(lab, next);
  };

  const showSection = (id: string) => {
    const newHidden = (layout.hidden ?? []).filter((h) => h !== id);
    const next = { ...layout, hidden: newHidden };
    setLayout(next);
    saveLayout(lab, next);
  };

  const restoreDefault = () => {
    const next: LayoutState = { order: [...lab.defaultOrder], collapsed: { ...lab.defaultCollapsed }, hidden: [] };
    setLayout(next);
    saveLayout(lab, next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
          {lab.label}
        </h4>
        <button
          onClick={restoreDefault}
          className="text-[10px] px-2 py-0.5 rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
          title="Restore default layout"
        >
          Restore Default Layout
        </button>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        {visibleOrder.map((id) => {
          const sec = sectionMap.get(id);
          if (!sec) return null;
          const isCollapsed = layout.collapsed[id] ?? false;
          const isLocked = lab.nonCollapsible.has(id);
          const isDragTarget = dragOverId === id && dragItem.current !== id;

          return (
            <div
              key={id}
              draggable={!isLocked}
              onDragStart={() => handleDragStart(id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDrop={() => handleDrop(id)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-2 px-2 py-1.5"
              style={{
                background: isDragTarget ? "var(--color-hover)" : "var(--color-card)",
                borderBottom: "1px solid var(--color-border)",
                opacity: isCollapsed ? 0.5 : 1,
                transition: "opacity 0.15s, background 0.15s",
              }}
            >
              {!isLocked ? (
                <span className="cursor-grab active:cursor-grabbing" style={{ color: "var(--color-text-muted)" }}>
                  <GripVertical className="h-3 w-3" />
                </span>
              ) : (
                <span className="w-3" />
              )}

              <span className="flex-1 text-[11px] font-medium" style={{ color: "var(--color-text-primary)" }}>
                {sec.label}
              </span>

              {!isLocked && (
                <button
                  onClick={() => toggleCollapsed(id)}
                  className="p-0.5 rounded cursor-pointer"
                  style={{ background: "transparent", border: "none", color: isCollapsed ? "var(--color-text-muted)" : "var(--color-text-secondary)" }}
                  title={isCollapsed ? "Panel starts collapsed" : "Panel starts expanded"}
                >
                  {isCollapsed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              )}

              {!isLocked && (
                <button
                  onClick={() => hideSection(id)}
                  className="p-0.5 rounded cursor-pointer"
                  style={{ background: "transparent", border: "none", color: "#ef4444" }}
                  title="Remove from layout"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Hidden / removed panels */}
      {hiddenSections.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Removed panels — click to restore:</p>
          <div className="flex flex-wrap gap-1">
            {hiddenSections.map((sec) => (
              <button
                key={sec.id}
                onClick={() => showSection(sec.id)}
                className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
              >
                + {sec.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tab definitions ──────────────────────────────────────────── */

type SettingsTab = "general" | "apiKeys" | "threeD" | "voice" | "shortcuts" | "layouts";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "apiKeys", label: "API Keys" },
  { id: "threeD", label: "3D Gen AI" },
  { id: "voice", label: "Voice & Audio" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "layouts", label: "Lab Layouts" },
];

/* ── Main panel ──────────────────────────────────────────────── */

interface ExtraKeyInfo { has_key: boolean; key_masked: string }

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [saving, setSaving] = useState(false);

  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsInfo, setPexelsInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [pixabayKey, setPixabayKey] = useState("");
  const [pixabayInfo, setPixabayInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [savingExtra, setSavingExtra] = useState<string | null>(null);

  const [meshyKey, setMeshyKey] = useState("");
  const [meshyInfo, setMeshyInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [hitem3dAccessKey, setHitem3dAccessKey] = useState("");
  const [hitem3dAccessInfo, setHitem3dAccessInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [hitem3dSecretKey, setHitem3dSecretKey] = useState("");
  const [hitem3dSecretInfo, setHitem3dSecretInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [threeDSettings, setThreeDSettings] = useState<ThreeDSettings>({});
  const [saving3D, setSaving3D] = useState(false);

  const { settings: voiceSettings, updateSettings: updateVoiceSettings } = useVoiceToText();
  const { shortcuts, updateShortcut, resetShortcut, resetAll, findConflict } = useShortcuts();
  const [rebindingId, setRebindingId] = useState<string | null>(null);
  const rebindingRef = useRef<string | null>(null);
  rebindingRef.current = rebindingId;

  useEffect(() => {
    if (!open) return;
    apiFetch<{ has_key: boolean; key_masked: string }>("/system/api-key")
      .then((d) => { setHasKey(d.has_key); setKeyMasked(d.key_masked); })
      .catch(() => {});
    apiFetch<Record<string, ExtraKeyInfo>>("/system/extra-keys")
      .then((d) => {
        if (d.pexels_api_key) setPexelsInfo(d.pexels_api_key);
        if (d.pixabay_api_key) setPixabayInfo(d.pixabay_api_key);
        if (d.meshy_api_key) setMeshyInfo(d.meshy_api_key);
        if (d.hitem3d_access_key) setHitem3dAccessInfo(d.hitem3d_access_key);
        if (d.hitem3d_secret_key) setHitem3dSecretInfo(d.hitem3d_secret_key);
      })
      .catch(() => {});
    getThreeDSettings().then(setThreeDSettings).catch(() => {});
  }, [open]);

  const saveExtraKey = async (name: string, value: string) => {
    if (!value.trim()) return;
    setSavingExtra(name);
    try {
      await apiFetch("/system/extra-key", { method: "POST", body: JSON.stringify({ name, key: value }) });
      const masked = value.slice(0, 4) + "..." + value.slice(-4);
      if (name === "pexels_api_key") { setPexelsInfo({ has_key: true, key_masked: masked }); setPexelsKey(""); }
      if (name === "pixabay_api_key") { setPixabayInfo({ has_key: true, key_masked: masked }); setPixabayKey(""); }
      if (name === "meshy_api_key") { setMeshyInfo({ has_key: true, key_masked: masked }); setMeshyKey(""); }
      if (name === "hitem3d_access_key") { setHitem3dAccessInfo({ has_key: true, key_masked: masked }); setHitem3dAccessKey(""); }
      if (name === "hitem3d_secret_key") { setHitem3dSecretInfo({ has_key: true, key_masked: masked }); setHitem3dSecretKey(""); }
    } catch { /* ignore */ }
    setSavingExtra(null);
  };

  useEffect(() => {
    if (!rebindingId) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRebindingId(null); return; }
      const combo = eventToComboString(e);
      if (!combo) return;
      const id = rebindingRef.current;
      if (!id) return;
      const conflict = findConflict(id, combo);
      if (conflict) {
        const swap = confirm(`"${combo}" is already used by "${conflict.label}".\n\nSwap shortcuts?`);
        if (swap) {
          const myOld = shortcuts.find((s) => s.id === id)?.currentKeys || "";
          updateShortcut(conflict.id, myOld);
          updateShortcut(id, combo);
        }
      } else {
        updateShortcut(id, combo);
      }
      setRebindingId(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [rebindingId, findConflict, updateShortcut, shortcuts]);

  useEffect(() => { if (!open) setRebindingId(null); }, [open]);

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/system/api-key", { method: "POST", body: JSON.stringify({ key: apiKey }) });
      setHasKey(true);
      setKeyMasked(apiKey.slice(0, 4) + "..." + apiKey.slice(-4));
      setApiKey("");
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleStartRebind = useCallback((id: string) => {
    setRebindingId((prev) => prev === id ? null : id);
  }, []);

  const handleReset = useCallback((id: string) => {
    resetShortcut(id);
  }, [resetShortcut]);

  const categories: ShortcutDef["category"][] = ["global", "navigation", "characterLab", "propLab", "envLab", "uilab", "imageViewer"];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[640px] h-[80vh] max-h-[85vh] flex flex-col animate-fade-in"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {SETTINGS_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-3 py-2 text-xs font-medium cursor-pointer relative"
                style={{
                  background: "transparent",
                  border: "none",
                  color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                  borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* ── General ── */}
          {activeTab === "general" && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Dictation Engine
                </h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Gemini uses AI transcription via your API key. Windows / Native uses your OS built-in speech
                  recognition{!nativeSpeechSupported && " (not available in this browser)"}.
                </p>
                <div className="flex gap-2">
                  {(["gemini", "native"] as VoiceEngine[]).map((eng) => {
                    const selected = voiceSettings.engine === eng;
                    const disabled = eng === "native" && !nativeSpeechSupported;
                    return (
                      <button
                        key={eng}
                        disabled={disabled}
                        onClick={() => updateVoiceSettings({ engine: eng })}
                        className="flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: selected ? "var(--color-accent)" : "var(--color-input-bg)",
                          border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                          color: selected ? "var(--color-foreground)" : "var(--color-text-secondary)",
                        }}
                      >
                        {eng === "gemini" ? "Gemini (AI)" : "Windows / Native"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── API Keys ── */}
          {activeTab === "apiKeys" && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Google Gemini API Key</h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Required for all AI features. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>aistudio.google.com</a>.
                </p>
                {hasKey && (
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Current: {keyMasked}</p>
                )}
                <div className="flex gap-2">
                  <Input type="password" placeholder="Enter Google Gemini API key..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1" />
                  <Button onClick={saveKey} loading={saving}>Save</Button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Deep Search API Keys
                  <span className="text-[10px] font-normal ml-2" style={{ color: "var(--color-text-muted)" }}>optional</span>
                </h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Add free API keys for Pexels and Pixabay to boost Deep Reference Search results.
                </p>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Pexels
                    {pexelsInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({pexelsInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Pexels API key — get free at pexels.com/api" value={pexelsKey} onChange={(e) => setPexelsKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("pexels_api_key", pexelsKey)} loading={savingExtra === "pexels_api_key"}>Save</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Pixabay
                    {pixabayInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({pixabayInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Pixabay API key — get free at pixabay.com/api/docs" value={pixabayKey} onChange={(e) => setPixabayKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("pixabay_api_key", pixabayKey)} loading={savingExtra === "pixabay_api_key"}>Save</Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  3D Gen AI Keys
                  <span className="text-[10px] font-normal ml-2" style={{ color: "var(--color-text-muted)" }}>optional — Meshy + Hitem3D</span>
                </h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  API keys for 3D model generation services.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Meshy API Key
                    {meshyInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({meshyInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Meshy API key — get at meshy.ai/api" value={meshyKey} onChange={(e) => setMeshyKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("meshy_api_key", meshyKey)} loading={savingExtra === "meshy_api_key"}>Save</Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Hitem3D Access Key
                    {hitem3dAccessInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({hitem3dAccessInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Hitem3D access key" value={hitem3dAccessKey} onChange={(e) => setHitem3dAccessKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("hitem3d_access_key", hitem3dAccessKey)} loading={savingExtra === "hitem3d_access_key"}>Save</Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Hitem3D Secret Key
                    {hitem3dSecretInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({hitem3dSecretInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Hitem3D secret key" value={hitem3dSecretKey} onChange={(e) => setHitem3dSecretKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("hitem3d_secret_key", hitem3dSecretKey)} loading={savingExtra === "hitem3d_secret_key"}>Save</Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── 3D Gen AI ── */}
          {activeTab === "threeD" && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Export & Tools</h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Export paths and Blender location for post-processing.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Meshy Export Directory</label>
                  <Input placeholder="C:\Models\Meshy" value={threeDSettings.meshy_export_dir ?? ""} onChange={(e) => setThreeDSettings((s) => ({ ...s, meshy_export_dir: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Hitem3D Export Directory</label>
                  <Input placeholder="C:\Models\Hitem3D" value={threeDSettings.hitem3d_export_dir ?? ""} onChange={(e) => setThreeDSettings((s) => ({ ...s, hitem3d_export_dir: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Blender Path</label>
                  <div className="flex gap-1">
                    <Input className="flex-1 min-w-0" placeholder="C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" value={threeDSettings.blender_path ?? ""} onChange={(e) => setThreeDSettings((s) => ({ ...s, blender_path: e.target.value }))} />
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        const res = await detectBlenderPath();
                        if (res.found && res.path) {
                          setThreeDSettings((s) => ({ ...s, blender_path: res.path! }));
                        }
                      }}
                    >
                      Auto-detect
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={async () => {
                    setSaving3D(true);
                    try { await saveThreeDSettings(threeDSettings); } catch { /* ignore */ }
                    setSaving3D(false);
                  }}
                  loading={saving3D}
                  className="w-full"
                >
                  Save 3D Settings
                </Button>
              </div>
            </>
          )}

          {/* ── Voice & Audio ── */}
          {activeTab === "voice" && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Dictation Engine</h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Gemini uses AI transcription via your API key. Windows / Native uses your OS built-in speech
                  recognition{!nativeSpeechSupported && " (not available in this browser)"}.
                </p>
                <div className="flex gap-2">
                  {(["gemini", "native"] as VoiceEngine[]).map((eng) => {
                    const selected = voiceSettings.engine === eng;
                    const disabled = eng === "native" && !nativeSpeechSupported;
                    return (
                      <button
                        key={eng}
                        disabled={disabled}
                        onClick={() => updateVoiceSettings({ engine: eng })}
                        className="flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: selected ? "var(--color-accent)" : "var(--color-input-bg)",
                          border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                          color: selected ? "var(--color-foreground)" : "var(--color-text-secondary)",
                        }}
                      >
                        {eng === "gemini" ? "Gemini (AI)" : "Windows / Native"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Audio input devices can be selected using the microphone icon in the top toolbar when Dictate is active.
                </p>
              </div>
            </>
          )}

          {/* ── Keyboard Shortcuts ── */}
          {activeTab === "shortcuts" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Keyboard Shortcuts</h3>
                <button
                  onClick={() => { if (confirm("Reset all shortcuts to defaults?")) resetAll(); }}
                  className="text-[10px] px-2 py-0.5 rounded cursor-pointer"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  Reset All to Defaults
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                Click "Rebind" then press your desired key combination. Press Escape to cancel.
              </p>
              {categories.map((cat) => {
                const catShortcuts = shortcuts.filter((s) => s.category === cat);
                if (catShortcuts.length === 0) return null;
                return (
                  <div key={cat} className="space-y-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider pt-1" style={{ color: "var(--color-text-muted)" }}>
                      {CATEGORY_LABELS[cat]}
                    </p>
                    {catShortcuts.map((sc) => (
                      <ShortcutRow
                        key={sc.id}
                        sc={sc}
                        rebindingId={rebindingId}
                        onStartRebind={handleStartRebind}
                        onReset={handleReset}
                        conflict={findConflict(sc.id, sc.currentKeys)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Lab Layouts ── */}
          {activeTab === "layouts" && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Lab Panel Layouts</h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Drag panels to reorder, toggle the eye icon to set default collapsed state, or click the red X to remove a panel.
                  Removed panels can be restored. Changes apply next time you open the lab. You can also save layouts
                  from inside each lab using the "Set Active Layout as Default" button.
                </p>
              </div>
              {LABS.map((lab) => (
                <LabLayoutEditor key={lab.id} lab={lab} />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
