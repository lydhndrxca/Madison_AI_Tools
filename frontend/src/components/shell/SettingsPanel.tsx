import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Input } from "@/components/ui";
import { apiFetch } from "@/hooks/useApi";
import { X, RotateCcw } from "lucide-react";
import { useShortcuts, CATEGORY_LABELS, eventToComboString } from "@/hooks/useShortcuts";
import type { ShortcutDef } from "@/hooks/useShortcuts";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
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
