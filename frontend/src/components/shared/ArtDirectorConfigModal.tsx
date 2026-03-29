import { useState, useCallback, useRef } from "react";
import { X, Sparkles, RotateCcw, ImagePlus, Trash2 } from "lucide-react";
import { useArtDirector, type ArtDirectorConfig, type PersonaConfig, type ContextImage } from "@/hooks/ArtDirectorContext";
import { apiFetch } from "@/hooks/useApi";

const DEFAULT_SYSTEM_PROMPT =
  "You are an AI Art Director embedded in a concept art tool. " +
  "You observe the artist's work and provide insightful, constructive, " +
  "and actionable art direction. You speak with authority and taste, " +
  "referencing composition, color theory, silhouette, mood, and storytelling.";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ArtDirectorConfigModal({ open, onClose }: Props) {
  const { config, setConfig } = useArtDirector();
  const [draft, setDraft] = useState<ArtDirectorConfig>({ ...config });
  const [genBusy, setGenBusy] = useState(false);
  const [personaNameInput, setPersonaNameInput] = useState(config.persona.name);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateDraft = useCallback((partial: Partial<ArtDirectorConfig>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  }, []);

  const updatePersona = useCallback((partial: Partial<PersonaConfig>) => {
    setDraft((prev) => ({ ...prev, persona: { ...prev.persona, ...partial } }));
  }, []);

  const handleGeneratePersona = useCallback(async () => {
    const name = personaNameInput.trim();
    if (!name) return;
    setGenBusy(true);
    try {
      const res = await apiFetch<PersonaConfig>("/director/generate-persona", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setDraft((prev) => ({
        ...prev,
        persona: {
          name: res.name || name,
          description: res.description || "",
          philosophy: res.philosophy || "",
          likes: res.likes || "",
          dislikes: res.dislikes || "",
        },
      }));
    } catch { /* */ }
    setGenBusy(false);
  }, [personaNameInput]);

  const handleAddImages = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result as string;
        const newImg: ContextImage = { id: crypto.randomUUID(), b64, label: file.name };
        setDraft((prev) => ({ ...prev, contextImages: [...prev.contextImages, newImg] }));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const removeContextImage = useCallback((id: string) => {
    setDraft((prev) => ({ ...prev, contextImages: prev.contextImages.filter((ci) => ci.id !== id) }));
  }, []);

  const handleSave = useCallback(() => {
    setConfig(draft);
    onClose();
  }, [draft, setConfig, onClose]);

  const handleResetPrompt = useCallback(() => {
    updateDraft({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
  }, [updateDraft]);

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    background: "var(--color-input-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
    borderRadius: 4,
  };

  const labelStyle: React.CSSProperties = { color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600 };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="rounded-lg overflow-hidden flex flex-col"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", width: 520, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-sm font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>Art Director Settings</h2>
          <button onClick={onClose} className="p-1 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }}><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span style={labelStyle}>System Prompt</span>
              <button onClick={handleResetPrompt} className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
                <RotateCcw className="h-3 w-3" /> Reset Default
              </button>
            </div>
            <textarea
              className="w-full px-2.5 py-2 text-[11px] rounded resize-y"
              style={{ ...inputStyle, minHeight: 80 }}
              value={draft.systemPrompt}
              onChange={(e) => updateDraft({ systemPrompt: e.target.value })}
            />
          </div>

          {/* Persona */}
          <div>
            <span style={labelStyle}>Persona</span>
            <div className="flex gap-2 mt-1 mb-2">
              <input
                className="flex-1 px-2 py-1 text-[11px]"
                style={inputStyle}
                placeholder="Enter a name (e.g. Tim Burton, Syd Mead)"
                value={personaNameInput}
                onChange={(e) => setPersonaNameInput(e.target.value)}
              />
              <button
                onClick={handleGeneratePersona}
                disabled={genBusy || !personaNameInput.trim()}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded cursor-pointer font-medium disabled:opacity-40 shrink-0"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
              >
                {genBusy ? (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Auto-Generate
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Description</span>
                <textarea className="w-full px-2 py-1 text-[11px] rounded resize-y" style={{ ...inputStyle, minHeight: 48 }} value={draft.persona.description} onChange={(e) => updatePersona({ description: e.target.value })} placeholder="Who is this art director? What's their background?" />
              </div>
              <div>
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Design Philosophy</span>
                <textarea className="w-full px-2 py-1 text-[11px] rounded resize-y" style={{ ...inputStyle, minHeight: 48 }} value={draft.persona.philosophy} onChange={(e) => updatePersona({ philosophy: e.target.value })} placeholder="What drives their creative choices?" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Likes</span>
                  <textarea className="w-full px-2 py-1 text-[11px] rounded resize-y" style={{ ...inputStyle, minHeight: 48 }} value={draft.persona.likes} onChange={(e) => updatePersona({ likes: e.target.value })} placeholder="Visual elements, techniques they love" />
                </div>
                <div>
                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Dislikes</span>
                  <textarea className="w-full px-2 py-1 text-[11px] rounded resize-y" style={{ ...inputStyle, minHeight: 48 }} value={draft.persona.dislikes} onChange={(e) => updatePersona({ dislikes: e.target.value })} placeholder="Things they avoid or dislike in design" />
                </div>
              </div>
            </div>
          </div>

          {/* Verbosity */}
          <div>
            <span style={labelStyle}>Communication Style</span>
            <div className="flex gap-2 mt-1">
              {(["brief", "medium", "detailed"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => updateDraft({ verbosity: v })}
                  className="flex-1 px-2 py-1.5 text-[10px] rounded cursor-pointer font-medium capitalize"
                  style={{
                    background: draft.verbosity === v ? "rgba(255,255,255,0.12)" : "var(--color-input-bg)",
                    color: draft.verbosity === v ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    border: `1px solid ${draft.verbosity === v ? "rgba(255,255,255,0.25)" : "var(--color-border)"}`,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div>
            <span style={labelStyle}>Thinking Mode</span>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => updateDraft({ mode: "fast" })}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] rounded cursor-pointer font-medium"
                style={{
                  background: draft.mode === "fast" ? "rgba(255,255,255,0.12)" : "var(--color-input-bg)",
                  color: draft.mode === "fast" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: `1px solid ${draft.mode === "fast" ? "rgba(255,255,255,0.25)" : "var(--color-border)"}`,
                }}
              >
                Fast (Flash)
              </button>
              <button
                onClick={() => updateDraft({ mode: "deep" })}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] rounded cursor-pointer font-medium"
                style={{
                  background: draft.mode === "deep" ? "rgba(255,255,255,0.12)" : "var(--color-input-bg)",
                  color: draft.mode === "deep" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: `1px solid ${draft.mode === "deep" ? "rgba(255,255,255,0.25)" : "var(--color-border)"}`,
                }}
              >
                Deep (Pro)
              </button>
            </div>
          </div>

          {/* Context Library */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span style={labelStyle}>Context Library</span>
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: "var(--color-text-secondary)" }}>
                <ImagePlus className="h-3 w-3" /> Add Images
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAddImages} />
            </div>
            <p className="text-[10px] mb-2" style={{ color: "var(--color-text-muted)" }}>
              Upload reference images or documents the art director should always consider.
            </p>
            {draft.contextImages.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {draft.contextImages.map((ci) => (
                  <div key={ci.id} className="relative rounded overflow-hidden group" style={{ background: "var(--color-input-bg)" }}>
                    <img src={ci.b64} alt="" className="w-full aspect-square object-cover" />
                    <button
                      onClick={() => removeContextImage(ci.id)}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                      style={{ background: "rgba(0,0,0,0.7)", color: "#f06060" }}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                    <input
                      className="w-full px-1 py-0.5 text-[8px]"
                      style={{ background: "transparent", color: "var(--color-text-secondary)", border: "none" }}
                      value={ci.label}
                      onChange={(e) => {
                        setDraft((prev) => ({
                          ...prev,
                          contextImages: prev.contextImages.map((c) => (c.id === ci.id ? { ...c, label: e.target.value } : c)),
                        }));
                      }}
                      placeholder="Label..."
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
            style={{ background: "rgba(255,255,255,0.12)", color: "var(--color-text-primary)", border: "1px solid rgba(255,255,255,0.25)" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
