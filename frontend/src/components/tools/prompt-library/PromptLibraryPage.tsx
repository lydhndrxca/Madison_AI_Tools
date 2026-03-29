import { useState, useEffect, useCallback } from "react";
import { BookOpen, Plus, Search, Trash2, Edit3, Save, X, Tag } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";

interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  tags: string[];
  tool_scope: string[];
  created_at: string;
  updated_at: string;
}

const TOOL_OPTIONS = [
  { value: "all", label: "All Tools" },
  { value: "character", label: "CharacterLab" },
  { value: "prop", label: "PropLab" },
  { value: "environment", label: "EnvironmentLab" },
  { value: "uilab", label: "UI Lab" },
  { value: "gemini", label: "Generate Image" },
  { value: "weapon", label: "WeaponLab" },
];

export function PromptLibraryPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [toolFilter, setToolFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", text: "", tags: "", tool_scope: ["all"] as string[] });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<PromptTemplate[]>(`/prompts?tool=${toolFilter === "all" ? "" : toolFilter}`);
      setTemplates(list);
    } catch { /* */ }
  }, [toolFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = templates.filter((t) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.text.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q));
  });

  const startEdit = (t: PromptTemplate) => {
    setEditingId(t.id);
    setEditForm({ name: t.name, text: t.text, tags: t.tags.join(", "), tool_scope: t.tool_scope.length ? t.tool_scope : ["all"] });
    setCreating(false);
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setEditForm({ name: "", text: "", tags: "", tool_scope: ["all"] });
  };

  const handleSave = async () => {
    const payload = {
      name: editForm.name.trim(),
      text: editForm.text.trim(),
      tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
      tool_scope: editForm.tool_scope,
    };
    if (!payload.name || !payload.text) return;
    try {
      if (creating) {
        await apiFetch("/prompts", { method: "POST", body: JSON.stringify(payload) });
      } else if (editingId) {
        await apiFetch(`/prompts/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      setEditingId(null);
      setCreating(false);
      load();
    } catch { /* */ }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this prompt template?")) return;
    try {
      await apiFetch(`/prompts/${id}`, { method: "DELETE" });
      load();
    } catch { /* */ }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreating(false);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <BookOpen className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Prompt Library
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {templates.length} template{templates.length !== 1 ? "s" : ""}
          </span>
        </h1>
        <Button size="sm" onClick={startCreate}>
          <Plus className="h-3 w-3 mr-1" /> New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-5 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded flex-1" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          <input
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: "var(--color-text-primary)" }}
            placeholder="Search by name, text, or tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="px-2 py-1 text-[11px] rounded"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
        >
          <option value="all">All Tools</option>
          {TOOL_OPTIONS.filter((o) => o.value !== "all").map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Create / Edit form */}
      {(creating || editingId) && (
        <div className="px-5 py-3 shrink-0 space-y-2" style={{ borderBottom: "1px solid var(--color-border)", background: "rgba(255,255,255,0.02)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {creating ? "New Prompt Template" : "Edit Template"}
          </p>
          <input
            className="w-full px-2.5 py-1.5 text-xs rounded"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            placeholder="Template name"
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
          />
          <textarea
            className="w-full px-2.5 py-1.5 text-xs rounded resize-none"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            placeholder="Prompt text..."
            rows={4}
            value={editForm.text}
            onChange={(e) => setEditForm((f) => ({ ...f, text: e.target.value }))}
          />
          <div className="flex gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 text-xs rounded"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              placeholder="Tags (comma separated)"
              value={editForm.tags}
              onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
            />
            <select
              className="px-2 py-1.5 text-[11px] rounded"
              style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
              value={editForm.tool_scope[0] || "all"}
              onChange={(e) => setEditForm((f) => ({ ...f, tool_scope: [e.target.value] }))}
            >
              {TOOL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={!editForm.name.trim() || !editForm.text.trim()}>
              <Save className="h-3 w-3 mr-1" /> Save
            </Button>
            <Button size="sm" onClick={cancelEdit} className="opacity-60">Cancel</Button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <BookOpen className="h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {templates.length === 0 ? "No prompt templates yet. Create one to get started." : "No matches found."}
            </p>
          </div>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              className="px-5 py-3 hover:bg-[var(--color-hover)] transition-colors"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{t.name}</p>
                  <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--color-text-secondary)", maxHeight: 80, overflow: "hidden" }}>
                    {t.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {t.tags.map((tag, tagIdx) => (
                      <span key={`${tag}-${tagIdx}`} className="text-[9px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)" }}>
                        <Tag className="h-2 w-2" />{tag}
                      </span>
                    ))}
                    {t.tool_scope.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(42,74,90,0.2)", color: "#5ec9e0" }}>
                        {t.tool_scope.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(t)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Edit">
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
