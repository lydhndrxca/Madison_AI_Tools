import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Input } from "@/components/ui";
import { apiFetch } from "@/hooks/useApi";
import { X, RotateCcw } from "lucide-react";
import { useShortcuts, CATEGORY_LABELS, eventToComboString } from "@/hooks/useShortcuts";
import type { ShortcutDef } from "@/hooks/useShortcuts";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ModelInfo {
  id: string;
  label: string;
  resolution: string;
  time_estimate: string;
  multimodal: boolean;
  description: string;
}

/* ── Kbd tag ─────────────────────────────────────────────────── */

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

/* ── Shortcut row ────────────────────────────────────────────── */

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
      <span className="flex-1 text-xs" style={{ color: "var(--color-text-primary)" }}>
        {sc.label}
      </span>
      <div className="shrink-0 min-w-[120px] text-right">
        {isRebinding ? (
          <span className="text-[10px] animate-pulse" style={{ color: "var(--color-accent)" }}>
            Press new shortcut...
          </span>
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

/* ── Main panel ──────────────────────────────────────────────── */

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [saving, setSaving] = useState(false);

  const { shortcuts, updateShortcut, resetShortcut, resetAll, findConflict } = useShortcuts();
  const [rebindingId, setRebindingId] = useState<string | null>(null);
  const rebindingRef = useRef<string | null>(null);
  rebindingRef.current = rebindingId;

  useEffect(() => {
    if (!open) return;
    apiFetch<{ has_key: boolean; key_masked: string }>("/system/api-key")
      .then((d) => { setHasKey(d.has_key); setKeyMasked(d.key_masked); })
      .catch(() => {});
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models")
      .then((d) => { setModels(d.models); setCurrentModel(d.current); })
      .catch(() => {});
  }, [open]);

  // Listen for keydown while rebinding
  useEffect(() => {
    if (!rebindingId) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRebindingId(null); return; }
      const combo = eventToComboString(e);
      if (!combo) return; // modifier-only press
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

  // Cancel rebinding when settings panel closes
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

  const changeModel = async (modelId: string) => {
    setCurrentModel(modelId);
    try {
      await apiFetch("/system/model", { method: "POST", body: JSON.stringify({ model_id: modelId }) });
    } catch { /* ignore */ }
  };

  const handleStartRebind = useCallback((id: string) => {
    setRebindingId((prev) => prev === id ? null : id);
  }, []);

  const handleReset = useCallback((id: string) => {
    resetShortcut(id);
  }, [resetShortcut]);

  const categories: ShortcutDef["category"][] = ["global", "navigation", "characterLab", "imageViewer"];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[580px] max-h-[85vh] overflow-y-auto animate-fade-in"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* API Key */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Google API Key
            </h3>
            {hasKey && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Current: {keyMasked}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1"
              />
              <Button onClick={saveKey} loading={saving}>
                Save
              </Button>
            </div>
          </div>

          {/* Image Model */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Image Generation Model
            </h3>
            <div className="space-y-1.5">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => changeModel(m.id)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all cursor-pointer"
                  style={{
                    background: currentModel === m.id ? "var(--color-hover)" : "transparent",
                    border: currentModel === m.id ? "1px solid var(--color-border-hover)" : "1px solid transparent",
                  }}
                >
                  <div
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2"
                    style={{
                      borderColor: currentModel === m.id ? "var(--color-text-secondary)" : "var(--color-border)",
                      background: currentModel === m.id ? "var(--color-text-secondary)" : "transparent",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                        {m.label}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          background: m.multimodal ? "rgba(52,211,153,0.15)" : "rgba(251,191,36,0.15)",
                          color: m.multimodal ? "var(--color-success)" : "var(--color-warning)",
                        }}
                      >
                        {m.multimodal ? "Multimodal" : "Imagen"}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {m.resolution} &middot; {m.time_estimate}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {m.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Keyboard Shortcuts
              </h3>
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
                      conflict={null}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
