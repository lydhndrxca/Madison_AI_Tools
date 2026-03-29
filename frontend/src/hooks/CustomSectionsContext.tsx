import React, { createContext, useContext, useState, useCallback } from "react";

/* ── Block definition types ───────────────────────────────────── */

export type BlockType = "text" | "textarea" | "image" | "dropdown" | "toggle" | "tags" | "slider" | "color";

export interface CustomBlockDef {
  id: string;
  type: BlockType;
  label: string;
  promptTemplate: string;
  placeholder?: string;
  defaultValue?: string | boolean | number | string[];
  options?: string[];
  presets?: string[];
  min?: number;
  max?: number;
  step?: number;
  maxImages?: number;
}

/* ── Section definition ───────────────────────────────────────── */

export type ToolTarget = "character" | "prop" | "env" | "uilab";

export interface CustomSectionDef {
  id: string;
  name: string;
  tools: ToolTarget[];
  color?: string;
  blocks: CustomBlockDef[];
  createdAt: number;
  updatedAt: number;
}

export const ALL_TOOL_TARGETS: { id: ToolTarget; label: string }[] = [
  { id: "character", label: "CharacterLab" },
  { id: "prop", label: "PropLab" },
  { id: "env", label: "EnvironmentLab" },
  { id: "uilab", label: "UILab" },
];

export const BLOCK_TYPE_OPTIONS: { id: BlockType; label: string; description: string }[] = [
  { id: "text", label: "Text Input", description: "Single line text field" },
  { id: "textarea", label: "Text Area", description: "Multi-line text field" },
  { id: "dropdown", label: "Dropdown", description: "Select from predefined options" },
  { id: "toggle", label: "Toggle", description: "On/off switch that adds text when on" },
  { id: "tags", label: "Tags", description: "Multi-select tags / keywords" },
  { id: "image", label: "Image Reference", description: "Image paste/upload slot" },
  { id: "slider", label: "Slider", description: "Numeric slider with range" },
  { id: "color", label: "Color Picker", description: "Color selector with hex output" },
];

/* ── Helpers ──────────────────────────────────────────────────── */

export function generateId(): string {
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function generateBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildSectionPrompt(
  section: CustomSectionDef,
  values: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const block of section.blocks) {
    const val = values[block.id];
    if (val === undefined || val === null || val === "" || val === false) continue;

    let text = block.promptTemplate;
    if (!text) continue;

    if (block.type === "toggle") {
      if (val === true) parts.push(text);
      continue;
    }

    if (block.type === "tags" && Array.isArray(val)) {
      if (val.length === 0) continue;
      text = text.replace(/\{\{value\}\}/g, val.join(", "));
    } else if (block.type === "image") {
      parts.push(text);
      continue;
    } else {
      text = text.replace(/\{\{value\}\}/g, String(val));
    }
    parts.push(text);
  }
  return parts.join("\n");
}

export function createEmptySection(): CustomSectionDef {
  return {
    id: generateId(),
    name: "New Section",
    tools: ["character", "prop", "env", "uilab"],
    color: undefined,
    blocks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createEmptyBlock(type: BlockType): CustomBlockDef {
  const base: CustomBlockDef = {
    id: generateBlockId(),
    type,
    label: BLOCK_TYPE_OPTIONS.find((b) => b.id === type)?.label ?? type,
    promptTemplate: "{{value}}",
  };
  if (type === "dropdown") base.options = ["Option 1", "Option 2", "Option 3"];
  if (type === "tags") base.presets = ["tag1", "tag2", "tag3"];
  if (type === "toggle") { base.defaultValue = false; base.promptTemplate = "Enable this feature"; }
  if (type === "slider") { base.min = 0; base.max = 100; base.step = 1; base.defaultValue = 50; }
  if (type === "image") { base.maxImages = 1; base.promptTemplate = "Reference image attached"; }
  if (type === "color") base.promptTemplate = "Color: {{value}}";
  return base;
}

/* ── localStorage persistence ─────────────────────────────────── */

const STORAGE_KEY = "madison-custom-sections";

function loadSections(): CustomSectionDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch { /* */ }
  return [];
}

function persistSections(sections: CustomSectionDef[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sections)); } catch { /* */ }
}

/* ── Section colors (all sections, built-in + custom) ─────────── */

const COLORS_KEY = "madison-section-colors";

function loadColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(COLORS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
  } catch { /* */ }
  return {};
}

function persistColors(c: Record<string, string>) {
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(c)); } catch { /* */ }
}

/* ── Context value ────────────────────────────────────────────── */

interface CustomSectionsContextValue {
  sections: CustomSectionDef[];
  getSectionsForTool: (tool: ToolTarget) => CustomSectionDef[];
  addSection: (section: CustomSectionDef) => void;
  updateSection: (section: CustomSectionDef) => void;
  removeSection: (id: string) => void;
  importSection: (json: string) => CustomSectionDef | null;
  exportSection: (id: string) => string | null;
  getSectionColor: (toolId: string, sectionId: string) => string | undefined;
  setSectionColor: (toolId: string, sectionId: string, color: string | undefined) => void;
  clearAllColors: () => void;
}

const CustomSectionsContext = createContext<CustomSectionsContextValue>({
  sections: [],
  getSectionsForTool: () => [],
  addSection: () => {},
  updateSection: () => {},
  removeSection: () => {},
  importSection: () => null,
  exportSection: () => null,
  getSectionColor: () => undefined,
  setSectionColor: () => {},
  clearAllColors: () => {},
});

export const useCustomSections = () => useContext(CustomSectionsContext);

/* ── Provider ─────────────────────────────────────────────────── */

export function CustomSectionsProvider({ children }: { children: React.ReactNode }) {
  const [sections, setSections] = useState<CustomSectionDef[]>(loadSections);
  const [colors, setColors] = useState<Record<string, string>>(loadColors);

  const persist = useCallback((next: CustomSectionDef[]) => {
    setSections(next);
    persistSections(next);
  }, []);

  const getSectionsForTool = useCallback((tool: ToolTarget): CustomSectionDef[] => {
    return sections.filter((s) => s.tools.includes(tool));
  }, [sections]);

  const addSection = useCallback((section: CustomSectionDef) => {
    persist([...sections, section]);
  }, [sections, persist]);

  const updateSection = useCallback((section: CustomSectionDef) => {
    persist(sections.map((s) => (s.id === section.id ? { ...section, updatedAt: Date.now() } : s)));
  }, [sections, persist]);

  const removeSection = useCallback((id: string) => {
    persist(sections.filter((s) => s.id !== id));
  }, [sections, persist]);

  const importSection = useCallback((json: string): CustomSectionDef | null => {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.name || !Array.isArray(parsed.blocks) || !Array.isArray(parsed.tools)) return null;
      const imported: CustomSectionDef = {
        ...parsed,
        id: generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      persist([...sections, imported]);
      return imported;
    } catch { return null; }
  }, [sections, persist]);

  const exportSection = useCallback((id: string): string | null => {
    const section = sections.find((s) => s.id === id);
    if (!section) return null;
    return JSON.stringify(section, null, 2);
  }, [sections]);

  // Section colors
  const colorKey = (toolId: string, sectionId: string) => `${toolId}.${sectionId}`;

  const getSectionColor = useCallback((toolId: string, sectionId: string): string | undefined => {
    return colors[colorKey(toolId, sectionId)];
  }, [colors]);

  const setSectionColor = useCallback((toolId: string, sectionId: string, color: string | undefined) => {
    setColors((prev) => {
      const next = { ...prev };
      const key = colorKey(toolId, sectionId);
      if (color) next[key] = color;
      else delete next[key];
      persistColors(next);
      return next;
    });
  }, []);

  const clearAllColors = useCallback(() => {
    setColors({});
    persistColors({});
  }, []);

  return (
    <CustomSectionsContext.Provider
      value={{
        sections,
        getSectionsForTool,
        addSection,
        updateSection,
        removeSection,
        importSection,
        exportSection,
        getSectionColor,
        setSectionColor,
        clearAllColors,
      }}
    >
      {children}
    </CustomSectionsContext.Provider>
  );
}
