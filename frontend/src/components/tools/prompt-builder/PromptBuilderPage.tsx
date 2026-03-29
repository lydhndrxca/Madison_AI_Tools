import { useState, useCallback, useRef, useEffect } from "react";
import {
  Puzzle, Plus, Trash2, Edit3, Save, X, Download, Upload, GripVertical,
  ChevronDown, ChevronUp, Copy, Sparkles, Eye, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  useCustomSections,
  createEmptySection,
  createEmptyBlock,
  buildSectionPrompt,
  BLOCK_TYPE_OPTIONS,
  ALL_TOOL_TARGETS,
} from "@/hooks/CustomSectionsContext";
import type { CustomSectionDef, CustomBlockDef, BlockType, ToolTarget } from "@/hooks/CustomSectionsContext";
import { CustomSectionRenderer } from "@/components/shared/CustomSectionRenderer";
import { apiFetch } from "@/hooks/useApi";

/* ── Color presets ──────────────────────────────────────────── */
const COLOR_PRESETS = [
  "#808080", "#e05050", "#e09040", "#d0c040", "#50b060",
  "#40a0d0", "#6070e0", "#a060d0", "#d060a0", "#ffffff",
];

/* ── Block Editor ─────────────────────────────────────────────── */

function BlockEditor({
  block,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  block: CustomBlockDef;
  index: number;
  total: number;
  onUpdate: (updated: CustomBlockDef) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const typeInfo = BLOCK_TYPE_OPTIONS.find((b) => b.id === block.type);

  return (
    <div
      className="rounded-md"
      style={{ border: "1px solid var(--color-border)", background: "rgba(255,255,255,0.02)" }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <GripVertical className="h-3 w-3 shrink-0 opacity-40" />
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)" }}>
          {typeInfo?.label ?? block.type}
        </span>
        <span className="text-xs flex-1 truncate" style={{ color: "var(--color-text-primary)" }}>
          {block.label}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-0.5 rounded cursor-pointer disabled:opacity-20" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}>
            <ChevronUp className="h-3 w-3" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-0.5 rounded cursor-pointer disabled:opacity-20" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}>
            <ChevronDown className="h-3 w-3" />
          </button>
          <button onClick={() => setExpanded((e) => !e)} className="p-0.5 rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button onClick={onRemove} className="p-0.5 rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "#e05050" }}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Label</label>
              <input
                className="w-full text-xs px-2 py-1 rounded mt-0.5"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={block.label}
                onChange={(e) => onUpdate({ ...block, label: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Placeholder</label>
              <input
                className="w-full text-xs px-2 py-1 rounded mt-0.5"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={block.placeholder ?? ""}
                onChange={(e) => onUpdate({ ...block, placeholder: e.target.value || undefined })}
                placeholder="(optional)"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Prompt Template
              <span className="font-normal ml-1 opacity-60">
                {block.type === "toggle"
                  ? "(text added when ON)"
                  : "(use {{value}} for the user's input)"}
              </span>
            </label>
            <textarea
              rows={2}
              className="w-full text-xs px-2 py-1 rounded mt-0.5 resize-y font-mono"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              value={block.promptTemplate}
              onChange={(e) => onUpdate({ ...block, promptTemplate: e.target.value })}
              placeholder={block.type === "toggle" ? "Text to add when toggle is ON" : "Style: {{value}}"}
            />
          </div>

          {/* Type-specific config */}
          {block.type === "dropdown" && (
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                Options <span className="font-normal opacity-60">(one per line)</span>
              </label>
              <textarea
                rows={3}
                className="w-full text-xs px-2 py-1 rounded mt-0.5 font-mono resize-y"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={(block.options ?? []).join("\n")}
                onChange={(e) => onUpdate({ ...block, options: e.target.value.split("\n").filter(Boolean) })}
              />
            </div>
          )}

          {block.type === "tags" && (
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                Preset Tags <span className="font-normal opacity-60">(one per line)</span>
              </label>
              <textarea
                rows={3}
                className="w-full text-xs px-2 py-1 rounded mt-0.5 font-mono resize-y"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={(block.presets ?? []).join("\n")}
                onChange={(e) => onUpdate({ ...block, presets: e.target.value.split("\n").filter(Boolean) })}
              />
            </div>
          )}

          {block.type === "slider" && (
            <div className="grid grid-cols-3 gap-2">
              {(["min", "max", "step"] as const).map((field) => (
                <div key={field}>
                  <label className="text-[10px] font-medium capitalize" style={{ color: "var(--color-text-muted)" }}>{field}</label>
                  <input
                    type="number"
                    className="w-full text-xs px-2 py-1 rounded mt-0.5"
                    style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                    value={block[field] ?? (field === "min" ? 0 : field === "max" ? 100 : 1)}
                    onChange={(e) => onUpdate({ ...block, [field]: Number(e.target.value) })}
                  />
                </div>
              ))}
            </div>
          )}

          {block.type === "image" && (
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Max Images</label>
              <input
                type="number"
                min={1}
                max={5}
                className="w-20 text-xs px-2 py-1 rounded mt-0.5"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={block.maxImages ?? 1}
                onChange={(e) => onUpdate({ ...block, maxImages: Math.min(5, Math.max(1, Number(e.target.value))) })}
              />
            </div>
          )}

          {(block.type === "text" || block.type === "textarea" || block.type === "color") && (
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Default Value</label>
              <input
                type={block.type === "color" ? "color" : "text"}
                className="w-full text-xs px-2 py-1 rounded mt-0.5"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={(block.defaultValue as string) ?? ""}
                onChange={(e) => onUpdate({ ...block, defaultValue: e.target.value })}
                placeholder="(optional)"
              />
            </div>
          )}

          {block.type === "toggle" && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={block.defaultValue === true}
                onChange={(e) => onUpdate({ ...block, defaultValue: e.target.checked })}
              />
              <label className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Default ON</label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Add Block Palette ─────────────────────────────────────────── */

function AddBlockPalette({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded cursor-pointer w-full justify-center"
        style={{ background: "var(--color-input-bg)", border: "1px dashed var(--color-border)", color: "var(--color-text-secondary)" }}
      >
        <Plus className="h-3 w-3" /> Add Block
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 py-1 rounded-md shadow-lg z-10"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
        >
          {BLOCK_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onAdd(opt.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--color-hover)]"
              style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="ml-1.5 opacity-50">{opt.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Section Editor ───────────────────────────────────────────── */

function SectionEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: CustomSectionDef;
  onSave: (section: CustomSectionDef) => void;
  onCancel: () => void;
}) {
  const [section, setSection] = useState<CustomSectionDef>(initial);
  const [showPreview, setShowPreview] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [aiReview, setAiReview] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const updateBlock = useCallback((index: number, updated: CustomBlockDef) => {
    setSection((prev) => {
      const blocks = [...prev.blocks];
      blocks[index] = updated;
      return { ...prev, blocks };
    });
  }, []);

  const removeBlock = useCallback((index: number) => {
    setSection((prev) => ({ ...prev, blocks: prev.blocks.filter((_, i) => i !== index) }));
  }, []);

  const moveBlock = useCallback((index: number, dir: -1 | 1) => {
    setSection((prev) => {
      const blocks = [...prev.blocks];
      const target = index + dir;
      if (target < 0 || target >= blocks.length) return prev;
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...prev, blocks };
    });
  }, []);

  const addBlock = useCallback((type: BlockType) => {
    setSection((prev) => ({ ...prev, blocks: [...prev.blocks, createEmptyBlock(type)] }));
  }, []);

  const toggleTool = useCallback((tool: ToolTarget) => {
    setSection((prev) => {
      const tools = prev.tools.includes(tool) ? prev.tools.filter((t) => t !== tool) : [...prev.tools, tool];
      return { ...prev, tools };
    });
  }, []);

  const handleAiReview = useCallback(async () => {
    setAiLoading(true);
    setAiReview(null);
    try {
      const prompt = buildSectionPrompt(section, previewValues);
      const res = await apiFetch<{ text: string }>("/system/ai-review", {
        method: "POST",
        body: JSON.stringify({
          section_name: section.name,
          block_count: section.blocks.length,
          block_types: section.blocks.map((b) => b.type),
          prompt_output: prompt || "(no output — fill in the preview to test)",
          tools: section.tools,
        }),
      });
      setAiReview(res.text);
    } catch {
      setAiReview("Could not reach the AI review endpoint. Make sure the backend is running.");
    }
    setAiLoading(false);
  }, [section, previewValues]);

  const previewPrompt = buildSectionPrompt(section, previewValues);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <button onClick={onCancel} className="p-1 rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          {initial.createdAt === section.createdAt && !section.blocks.length ? "New Custom Section" : `Edit: ${section.name}`}
        </h1>
        <Button size="sm" onClick={() => setShowPreview((p) => !p)}>
          <Eye className="h-3 w-3 mr-1" /> {showPreview ? "Editor" : "Preview"}
        </Button>
        <Button size="sm" onClick={() => onSave(section)} disabled={!section.name.trim() || section.tools.length === 0}>
          <Save className="h-3 w-3 mr-1" /> Save
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showPreview ? (
          /* ── Preview Mode ─────────────────────────── */
          <div className="px-5 py-4 space-y-4 max-w-lg">
            <div
              className="rounded-lg p-3 space-y-2.5"
              style={{ background: "var(--color-card)", border: `1px solid ${section.color || "var(--color-border)"}` }}
            >
              <div className="flex items-center gap-2">
                {section.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: section.color }} />}
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-primary)" }}>
                  {section.name || "Unnamed Section"}
                </span>
              </div>
              <CustomSectionRenderer
                section={section}
                values={previewValues}
                onChange={(blockId, val) => setPreviewValues((prev) => ({ ...prev, [blockId]: val }))}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>Prompt Output</h3>
              <pre
                className="text-[10px] p-2.5 rounded whitespace-pre-wrap font-mono"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)", minHeight: 60 }}
              >
                {previewPrompt || "(fill in the fields above to see output)"}
              </pre>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleAiReview}
                disabled={aiLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-accent)" }}
              >
                <Sparkles className="h-3 w-3" /> {aiLoading ? "Reviewing..." : "AI Gut-Check"}
              </button>
              {aiReview && (
                <div
                  className="text-[11px] p-2.5 rounded whitespace-pre-wrap"
                  style={{ background: "rgba(42,74,90,0.15)", border: "1px solid rgba(94,201,224,0.2)", color: "var(--color-text-secondary)" }}
                >
                  {aiReview}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Editor Mode ──────────────────────────── */
          <div className="px-5 py-4 space-y-4 max-w-2xl">
            {/* Name + Color */}
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Section Name</label>
                <input
                  className="w-full text-sm px-2.5 py-1.5 rounded mt-0.5"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  value={section.name}
                  onChange={(e) => setSection((s) => ({ ...s, name: e.target.value }))}
                  placeholder="My Custom Section"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Color</label>
                <div className="flex items-center gap-1 mt-0.5">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSection((s) => ({ ...s, color: s.color === c ? undefined : c }))}
                      className="w-5 h-5 rounded-full cursor-pointer shrink-0"
                      style={{
                        background: c,
                        border: section.color === c ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={section.color || "#808080"}
                    onChange={(e) => setSection((s) => ({ ...s, color: e.target.value }))}
                    className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                    title="Custom color"
                  />
                </div>
              </div>
            </div>

            {/* Tool scope */}
            <div>
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                Applies To {section.tools.length === 0 && <span className="text-red-400 ml-1">(select at least one)</span>}
              </label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {ALL_TOOL_TARGETS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTool(t.id)}
                    className="px-2.5 py-1 text-[10px] rounded cursor-pointer"
                    style={{
                      background: section.tools.includes(t.id) ? "var(--color-accent)" : "var(--color-input-bg)",
                      color: section.tools.includes(t.id) ? "white" : "var(--color-text-secondary)",
                      border: "1px solid " + (section.tools.includes(t.id) ? "var(--color-accent)" : "var(--color-border)"),
                    }}
                  >
                    {t.label}
                  </button>
                ))}
                <button
                  onClick={() => setSection((s) => ({ ...s, tools: s.tools.length === ALL_TOOL_TARGETS.length ? [] : ALL_TOOL_TARGETS.map((t) => t.id) }))}
                  className="px-2 py-1 text-[10px] rounded cursor-pointer"
                  style={{ background: "transparent", border: "1px dashed var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  {section.tools.length === ALL_TOOL_TARGETS.length ? "Clear All" : "Select All"}
                </button>
              </div>
            </div>

            {/* Blocks */}
            <div className="space-y-2">
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                Building Blocks ({section.blocks.length})
              </label>
              {section.blocks.map((block, i) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  index={i}
                  total={section.blocks.length}
                  onUpdate={(updated) => updateBlock(i, updated)}
                  onRemove={() => removeBlock(i)}
                  onMove={(dir) => moveBlock(i, dir)}
                />
              ))}
              <AddBlockPalette onAdd={addBlock} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */

export function PromptBuilderPage() {
  const ctx = useCustomSections();
  const { sections, addSection, updateSection, removeSection, importSection, exportSection } = ctx;
  const [editing, setEditing] = useState<CustomSectionDef | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(() => {
    setEditing(createEmptySection());
  }, []);

  const handleEdit = useCallback((section: CustomSectionDef) => {
    setEditing({ ...section });
  }, []);

  const handleDuplicate = useCallback((section: CustomSectionDef) => {
    const dup = createEmptySection();
    dup.name = section.name + " (copy)";
    dup.tools = [...section.tools];
    dup.color = section.color;
    dup.blocks = section.blocks.map((b) => ({ ...b }));
    addSection(dup);
  }, [addSection]);

  const handleSave = useCallback((section: CustomSectionDef) => {
    if (sections.find((s) => s.id === section.id)) {
      updateSection(section);
    } else {
      addSection(section);
    }
    setEditing(null);
  }, [sections, addSection, updateSection]);

  const handleDelete = useCallback((id: string) => {
    if (!window.confirm("Delete this custom section? This cannot be undone.")) return;
    removeSection(id);
  }, [removeSection]);

  const handleExport = useCallback((id: string) => {
    const json = exportSection(id);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const section = sections.find((s) => s.id === id);
    a.download = `${(section?.name ?? "section").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportSection, sections]);

  const handleImport = useCallback(() => {
    importRef.current?.click();
  }, []);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const result = importSection(reader.result);
        if (!result) alert("Invalid section file. Please check the format.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [importSection]);

  // If editing, show the editor
  if (editing) {
    return <SectionEditor initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  // List view
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Puzzle className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Prompt Builder
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {sections.length} custom section{sections.length !== 1 ? "s" : ""}
          </span>
        </h1>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        <Button size="sm" onClick={handleImport}>
          <Upload className="h-3 w-3 mr-1" /> Import
        </Button>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="h-3 w-3 mr-1" /> New Section
        </Button>
      </div>

      {/* Intro */}
      {sections.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <Puzzle className="h-12 w-12" style={{ color: "var(--color-text-muted)", opacity: 0.25 }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Build Your Own Prompt Sections
          </h2>
          <p className="text-xs max-w-md" style={{ color: "var(--color-text-muted)" }}>
            Create custom sidebar sections that appear alongside the built-in ones (Style Fusion, Attributes, etc.)
            in any tool page. Add text fields, dropdowns, image slots, toggles, tags and more — then configure
            how each block contributes to the AI prompt. Share your creations with teammates via import/export.
          </p>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="h-3 w-3 mr-1" /> Create Your First Section
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sections.map((s) => (
            <div
              key={s.id}
              className="px-5 py-3 hover:bg-[var(--color-hover)] transition-colors"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-start gap-3">
                {s.color && <span className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ background: s.color }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{s.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-muted)" }}>
                      {s.blocks.length} block{s.blocks.length !== 1 ? "s" : ""}
                    </span>
                    {s.tools.map((t) => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(42,74,90,0.2)", color: "#5ec9e0" }}>
                        {ALL_TOOL_TARGETS.find((at) => at.id === t)?.label ?? t}
                      </span>
                    ))}
                    {s.blocks.slice(0, 3).map((b) => (
                      <span key={b.id} className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "var(--color-text-muted)" }}>
                        {BLOCK_TYPE_OPTIONS.find((bt) => bt.id === b.type)?.label ?? b.type}
                      </span>
                    ))}
                    {s.blocks.length > 3 && (
                      <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                        +{s.blocks.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleEdit(s)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Edit">
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDuplicate(s)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Duplicate">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleExport(s.id)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }} title="Export">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]" style={{ color: "#e05050", border: "none", background: "transparent" }} title="Delete">
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
