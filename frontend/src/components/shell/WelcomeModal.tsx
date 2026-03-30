import { useState, useEffect, useCallback } from "react";
import { Button, Input } from "@/components/ui";
import { apiFetch } from "@/hooks/useApi";
import {
  Sparkles,
  Palette,
  FolderOpen,
  Wrench,
  Lightbulb,
  Archive,
  Key,
  ChevronRight,
} from "lucide-react";

const STORAGE_KEY = "madison-welcome-dismissed";

interface ExtraKeyInfo {
  has_key: boolean;
  key_masked: string;
}

export function WelcomeModal() {
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [saving, setSaving] = useState(false);

  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsInfo, setPexelsInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [pixabayKey, setPixabayKey] = useState("");
  const [pixabayInfo, setPixabayInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [meshyKey, setMeshyKey] = useState("");
  const [meshyInfo, setMeshyInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [hitem3dAccessKey, setHitem3dAccessKey] = useState("");
  const [hitem3dAccessInfo, setHitem3dAccessInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [hitem3dSecretKey, setHitem3dSecretKey] = useState("");
  const [hitem3dSecretInfo, setHitem3dSecretInfo] = useState<ExtraKeyInfo>({ has_key: false, key_masked: "" });
  const [savingExtra, setSavingExtra] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch { /* */ }
    setVisible(true);

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
  }, []);

  const saveMainKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/system/api-key", { method: "POST", body: JSON.stringify({ key: apiKey }) });
      setHasKey(true);
      setKeyMasked(apiKey.slice(0, 4) + "..." + apiKey.slice(-4));
      setApiKey("");
    } catch { /* */ }
    setSaving(false);
  }, [apiKey]);

  const saveExtraKey = useCallback(async (name: string, value: string) => {
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
    } catch { /* */ }
    setSavingExtra(null);
  }, []);

  const dismiss = useCallback(() => {
    if (dontShow) {
      try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* */ }
    }
    setVisible(false);
  }, [dontShow]);

  if (!visible) return null;

  const NAV_ITEMS = [
    { icon: Palette, label: "Style Library", desc: "Save, manage, and apply your art styles to any lab." },
    { icon: FolderOpen, label: "Generated Images", desc: "Browse and favorite everything you've created." },
    { icon: Wrench, label: "Tools", desc: "AI-powered labs for Characters, UI, Props, Weapons, Environments, 3D models, Multiview, and more." },
    { icon: Lightbulb, label: "Creative", desc: "Idea Brainstorming and the Writing Room for collaborative AI writing." },
    { icon: Archive, label: "Utilities", desc: "Art Direction Logs and Prompt Builder." },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-[600px] max-h-[90vh] flex flex-col animate-fade-in"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2.5 mb-2">
            <Sparkles size={20} style={{ color: "var(--color-accent)" }} />
            <h2 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>
              Welcome to Madison AI Suite
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            A quick overview to get you started. You can always access Settings from the sidebar.
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Navigation TLDR */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-secondary)" }}>
              App Navigation
            </h3>
            <div className="space-y-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-start gap-3 p-2.5 rounded-md"
                    style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}
                  >
                    <Icon size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-accent)" }} />
                    <div>
                      <div className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                        {item.label}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                        {item.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* API Keys */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Key size={14} style={{ color: "var(--color-accent)" }} />
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
                API Keys
              </h3>
            </div>

            {/* Gemini — required */}
            <div className="space-y-2 mb-4">
              <div>
                <label className="text-[11px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Google Gemini API Key
                  <span className="ml-1.5 text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>required</span>
                </label>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                  Powers all AI features. Get a free key at{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>aistudio.google.com</a>.
                </p>
              </div>
              {hasKey && (
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Current: {keyMasked}</p>
              )}
              <div className="flex gap-2">
                <Input type="password" placeholder="Enter Google Gemini API key..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1" />
                <Button onClick={saveMainKey} loading={saving}>Save</Button>
              </div>
            </div>

            {/* Optional keys */}
            <details className="group">
              <summary
                className="text-[11px] font-medium cursor-pointer flex items-center gap-1 select-none"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                Optional API Keys
                <span className="text-[10px] font-normal ml-1" style={{ color: "var(--color-text-muted)" }}>
                  (Deep Search, 3D Gen AI)
                </span>
              </summary>

              <div className="mt-3 space-y-3 pl-0.5">
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  These are optional. You can always add them later in Settings &gt; API Keys.
                </p>

                {/* Pexels */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Pexels
                    {pexelsInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({pexelsInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Pexels API key" value={pexelsKey} onChange={(e) => setPexelsKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("pexels_api_key", pexelsKey)} loading={savingExtra === "pexels_api_key"}>Save</Button>
                  </div>
                </div>

                {/* Pixabay */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Pixabay
                    {pixabayInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({pixabayInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Pixabay API key" value={pixabayKey} onChange={(e) => setPixabayKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("pixabay_api_key", pixabayKey)} loading={savingExtra === "pixabay_api_key"}>Save</Button>
                  </div>
                </div>

                {/* Meshy */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Meshy AI
                    {meshyInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({meshyInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Meshy API key" value={meshyKey} onChange={(e) => setMeshyKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("meshy_api_key", meshyKey)} loading={savingExtra === "meshy_api_key"}>Save</Button>
                  </div>
                </div>

                {/* Hitem3D */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Hitem3D Access Key
                    {hitem3dAccessInfo.has_key && <span className="ml-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>({hitem3dAccessInfo.key_masked})</span>}
                  </label>
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Hitem3D access key" value={hitem3dAccessKey} onChange={(e) => setHitem3dAccessKey(e.target.value)} className="flex-1" />
                    <Button onClick={() => saveExtraKey("hitem3d_access_key", hitem3dAccessKey)} loading={savingExtra === "hitem3d_access_key"}>Save</Button>
                  </div>
                </div>

                <div className="space-y-1">
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
            </details>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 shrink-0 flex items-center justify-between"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Don't show this again
            </span>
          </label>
          <Button onClick={dismiss}>
            Get Started
          </Button>
        </div>
      </div>
    </div>
  );
}
