import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Plus, Search, X, Tag } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  tags: string[];
  tool_scope: string[];
  created_at: string;
  updated_at: string;
}

interface PromptLibraryPopupProps {
  tool: string;
  currentText?: string;
  onInject: (text: string, mode: "append" | "replace") => void;
  onClose: () => void;
}

function PromptLibraryPopup({ tool, currentText = "", onInject, onClose }: PromptLibraryPopupProps) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveTags, setSaveTags] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<PromptTemplate[]>(`/prompts?tool=${encodeURIComponent(tool)}`);
      setTemplates(list);
    } catch { /* */ }
  }, [tool]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!saveName.trim() || !currentText.trim()) return;
    try {
      await apiFetch("/prompts", {
        method: "POST",
        body: JSON.stringify({
          name: saveName.trim(),
          text: currentText.trim(),
          tags: saveTags.split(",").map((t) => t.trim()).filter(Boolean),
          tool_scope: [tool],
        }),
      });
      setSaveName("");
      setSaveTags("");
      setSaving(false);
      load();
    } catch { /* */ }
  }, [saveName, saveTags, currentText, tool, load]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiFetch(`/prompts/${id}`, { method: "DELETE" });
      load();
    } catch { /* */ }
  }, [load]);

  const filtered = templates.filter((t) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q));
  });

  return (
    <div
      ref={popupRef}
      className="absolute z-50 w-80 max-h-96 rounded-lg overflow-hidden flex flex-col shadow-2xl"
      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", top: "100%", right: 0, marginTop: 4 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <BookOpen className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-xs font-semibold flex-1" style={{ color: "var(--color-text-primary)" }}>Prompt Library</span>
        <button onClick={onClose} className="p-0.5 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
          <Search className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          <input
            className="flex-1 text-[11px] bg-transparent outline-none"
            style={{ color: "var(--color-text-primary)" }}
            placeholder="Search prompts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-center py-4" style={{ color: "var(--color-text-muted)" }}>
            {templates.length === 0 ? "No saved prompts yet" : "No matches"}
          </p>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              className="px-3 py-2 hover:bg-[var(--color-hover)] transition-colors"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>{t.name}</p>
                  <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "var(--color-text-muted)" }}>{t.text}</p>
                  {t.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {t.tags.map((tag, tagIdx) => (
                        <span key={`${tag}-${tagIdx}`} className="text-[8px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)" }}>
                          <Tag className="h-2 w-2 inline mr-0.5" />{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => onInject(t.text, "append")}
                    className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                    style={{ background: "rgba(42,90,42,0.3)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.5)" }}
                  >Append</button>
                  <button
                    onClick={() => onInject(t.text, "replace")}
                    className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                    style={{ background: "rgba(42,74,90,0.3)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.5)" }}
                  >Replace</button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                    style={{ background: "rgba(90,42,42,0.2)", color: "#f06060", border: "1px solid rgba(138,74,74,0.4)" }}
                  >Delete</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Save current prompt */}
      <div className="px-3 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        {saving ? (
          <div className="space-y-1.5">
            <input
              className="w-full px-2 py-1 text-[11px] rounded"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              placeholder="Template name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            <input
              className="w-full px-2 py-1 text-[11px] rounded"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              placeholder="Tags (comma separated)"
              value={saveTags}
              onChange={(e) => setSaveTags(e.target.value)}
            />
            <div className="flex gap-1">
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="flex-1 px-2 py-1 text-[10px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(42,90,42,0.3)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.5)", opacity: saveName.trim() ? 1 : 0.4 }}
              >Save</button>
              <button
                onClick={() => setSaving(false)}
                className="px-2 py-1 text-[10px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(255,255,255,0.05)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSaving(true)}
            disabled={!currentText.trim()}
            className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] rounded cursor-pointer font-medium"
            style={{
              background: currentText.trim() ? "rgba(42,58,106,0.3)" : "rgba(255,255,255,0.03)",
              color: currentText.trim() ? "#5e9eff" : "var(--color-text-muted)",
              border: `1px solid ${currentText.trim() ? "rgba(58,90,138,0.5)" : "var(--color-border)"}`,
            }}
          >
            <Plus className="h-3 w-3" /> Save Current Prompt
          </button>
        )}
      </div>
    </div>
  );
}

interface PromptLibraryButtonProps {
  tool: string;
  currentText?: string;
  onInject: (text: string, mode: "append" | "replace") => void;
}

export function PromptLibraryButton({ tool, currentText, onInject }: PromptLibraryButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
        style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
        title="Prompt Library — save and reuse prompt snippets"
      >
        <BookOpen className="h-3.5 w-3.5" />
      </button>
      {open && (
        <PromptLibraryPopup
          tool={tool}
          currentText={currentText}
          onInject={(text, mode) => { onInject(text, mode); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
