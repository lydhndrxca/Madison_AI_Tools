import { useState, useEffect } from "react";
import { Card, Button, Input, Select } from "@/components/ui";
import { apiFetch } from "@/hooks/useApi";
import { X } from "lucide-react";

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

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ has_key: boolean; key_masked: string }>("/system/api-key")
      .then((d) => {
        setHasKey(d.has_key);
        setKeyMasked(d.key_masked);
      })
      .catch(() => {});
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models")
      .then((d) => {
        setModels(d.models);
        setCurrentModel(d.current);
      })
      .catch(() => {});
  }, [open]);

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto animate-fade-in"
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
        </div>
      </div>
    </div>
  );
}
