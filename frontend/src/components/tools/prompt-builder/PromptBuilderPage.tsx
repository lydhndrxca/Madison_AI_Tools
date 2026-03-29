import { useState, useCallback, useRef, useEffect } from "react";
import {
  Puzzle, Plus, Trash2, Edit3, Save, X, Copy, Upload, Download, Image as ImageIcon, ClipboardPaste,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

const LS_KEY = "madison_prompt_builder_entries";

interface PromptEntry {
  id: string;
  name: string;
  text: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadEntries(): PromptEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEntries(entries: PromptEntry[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

/* ── Editor ──────────────────────────────────────────────────── */

function EntryEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: PromptEntry;
  onSave: (entry: PromptEntry) => void;
  onCancel: () => void;
}) {
  const [entry, setEntry] = useState<PromptEntry>(initial);
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      if (!f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setEntry((prev) => ({ ...prev, images: [...prev.images, reader.result as string] }));
        }
      };
      reader.readAsDataURL(f);
    });
  }, []);

  const removeImage = useCallback((idx: number) => {
    setEntry((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setEntry((prev) => ({ ...prev, images: [...prev.images, reader.result as string] }));
          }
        };
        reader.readAsDataURL(blob);
      }
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clipItems = await navigator.clipboard.read();
      for (const clipItem of clipItems) {
        for (const type of clipItem.types) {
          if (type.startsWith("image/")) {
            const blob = await clipItem.getType(type);
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                setEntry((prev) => ({ ...prev, images: [...prev.images, reader.result as string] }));
              }
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    } catch { /* clipboard access denied or empty */ }
  }, []);

  const canSave = entry.name.trim() && entry.text.trim();

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Puzzle className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} />
        <h1 className="text-sm font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          {initial.name ? `Edit: ${initial.name}` : "New Prompt"}
        </h1>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-3" onPaste={handlePaste}>
        <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>

          {/* Name */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Prompt Name</label>
            <input
              className="w-full text-xs px-2.5 py-1.5 rounded"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              value={entry.name}
              onChange={(e) => setEntry((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Cinematic Lighting Setup"
              autoFocus
            />
          </div>

          {/* Prompt text */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Prompt / Instructions</label>
            <textarea
              rows={8}
              className="w-full text-[11px] px-2.5 py-2 rounded resize-y"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", minHeight: 120 }}
              value={entry.text}
              onChange={(e) => setEntry((prev) => ({ ...prev, text: e.target.value }))}
              placeholder="Type your prompt text, rules, or instructions here..."
            />
          </div>

          {/* Reference images */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>
              Reference Images <span className="font-normal opacity-50">(optional)</span>
            </label>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />

            {entry.images.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {entry.images.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="w-16 h-16 object-cover rounded" style={{ border: "1px solid var(--color-border)" }} />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "#e05050", border: "none", color: "white", fontSize: 9 }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
              >
                <ImageIcon className="h-3 w-3" /> Add Image{entry.images.length > 0 ? "s" : ""}
              </button>
              <button
                onClick={pasteFromClipboard}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                title="Paste an image from your clipboard (or use Ctrl+V anywhere in this editor)"
              >
                <ClipboardPaste className="h-3 w-3" /> Paste Image
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" className="flex-1" size="sm" onClick={() => onSave({ ...entry, updatedAt: new Date().toISOString() })} disabled={!canSave}>
              <Save className="h-3 w-3 mr-1" /> Save Prompt
            </Button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-[11px] rounded cursor-pointer"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */

export function PromptBuilderPage() {
  const [entries, setEntries] = useState<PromptEntry[]>(loadEntries);
  const [editing, setEditing] = useState<PromptEntry | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveEntries(entries); }, [entries]);

  const handleCreate = useCallback(() => {
    setEditing({
      id: generateId(),
      name: "",
      text: "",
      images: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const handleSave = useCallback((entry: PromptEntry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [...prev, entry];
    });
    setEditing(null);
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Delete this prompt? This cannot be undone.")) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const handleExport = useCallback((entry: PromptEntry) => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as PromptEntry;
        if (!data.name || !data.text) { alert("Invalid prompt file."); return; }
        data.id = generateId();
        data.createdAt = new Date().toISOString();
        data.updatedAt = new Date().toISOString();
        setEntries((prev) => [...prev, data]);
      } catch { alert("Could not read file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  if (editing) {
    return <EntryEditor initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Puzzle className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Prompt Builder
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {entries.length} saved prompt{entries.length !== 1 ? "s" : ""}
          </span>
        </h1>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        <Button size="sm" onClick={() => importRef.current?.click()}>
          <Upload className="h-3 w-3 mr-1" /> Import
        </Button>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="h-3 w-3 mr-1" /> New Prompt
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col gap-3 px-5 py-6">
          <Puzzle className="h-8 w-8" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Save Your Go-To Prompts
          </h2>
          <p className="text-xs max-w-sm" style={{ color: "var(--color-text-muted)" }}>
            Create reusable prompts, rules, and instructions with optional reference images.
            Copy them into any tool when you need them, or export to share with teammates.
          </p>
          <div>
            <Button size="sm" onClick={handleCreate}>
              <Plus className="h-3 w-3 mr-1" /> Create Your First Prompt
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="px-5 py-3 hover:bg-[var(--color-hover)] transition-colors"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-start gap-3">
                {entry.images.length > 0 && (
                  <img src={entry.images[0]} alt="" className="w-10 h-10 object-cover rounded shrink-0 mt-0.5" style={{ border: "1px solid var(--color-border)" }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{entry.name}</p>
                  <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--color-text-muted)" }}>
                    {entry.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {entry.images.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)" }}>
                        {entry.images.length} image{entry.images.length > 1 ? "s" : ""}
                      </span>
                    )}
                    <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(entry.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleCopy(entry.text)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Copy prompt text">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditing({ ...entry })} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Edit">
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleExport(entry)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Export">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "#e05050", border: "none", background: "transparent" }} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
