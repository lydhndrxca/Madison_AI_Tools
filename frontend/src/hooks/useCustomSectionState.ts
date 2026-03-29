import { useState, useCallback, useMemo, useEffect } from "react";
import type { CustomSectionDef, ToolTarget } from "./CustomSectionsContext";
import { useCustomSections, buildSectionPrompt } from "./CustomSectionsContext";

interface CustomSectionState {
  sections: CustomSectionDef[];
  values: Record<string, Record<string, unknown>>;
  enabled: Record<string, boolean>;
  collapsed: Record<string, boolean>;
  setValue: (sectionId: string, blockId: string, value: unknown) => void;
  toggleEnabled: (sectionId: string) => void;
  isEnabled: (sectionId: string) => boolean;
  toggleCollapsed: (sectionId: string) => void;
  isCollapsed: (sectionId: string) => boolean;
  getPromptContributions: () => string;
  getImageAttachments: () => string[];
  clearAll: () => void;
}

export function useCustomSectionState(tool: ToolTarget): CustomSectionState {
  const { getSectionsForTool } = useCustomSections();
  const sections = useMemo(() => getSectionsForTool(tool), [getSectionsForTool, tool]);

  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of sections) init[s.id] = true;
    return init;
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEnabled((prev) => {
      const next = { ...prev };
      for (const s of sections) {
        if (!(s.id in next)) next[s.id] = true;
      }
      return next;
    });
  }, [sections]);

  const setValue = useCallback((sectionId: string, blockId: string, value: unknown) => {
    setValues((prev) => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] ?? {}), [blockId]: value },
    }));
  }, []);

  const toggleEnabled = useCallback((sectionId: string) => {
    setEnabled((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const isEnabled = useCallback((sectionId: string) => enabled[sectionId] !== false, [enabled]);

  const toggleCollapsed = useCallback((sectionId: string) => {
    setCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const isCollapsed = useCallback((sectionId: string) => !!collapsed[sectionId], [collapsed]);

  const getPromptContributions = useCallback((): string => {
    const parts: string[] = [];
    for (const section of sections) {
      if (!enabled[section.id]) continue;
      const sectionValues = values[section.id] ?? {};
      const text = buildSectionPrompt(section, sectionValues);
      if (text.trim()) parts.push(text);
    }
    return parts.join("\n\n");
  }, [sections, enabled, values]);

  const getImageAttachments = useCallback((): string[] => {
    const imgs: string[] = [];
    for (const section of sections) {
      if (!enabled[section.id]) continue;
      const sectionValues = values[section.id] ?? {};
      for (const block of section.blocks) {
        if (block.type === "image") {
          const blockImgs = sectionValues[block.id] as string[] | undefined;
          if (blockImgs) imgs.push(...blockImgs.filter(Boolean));
        }
      }
    }
    return imgs;
  }, [sections, enabled, values]);

  const clearAll = useCallback(() => {
    setValues({});
    setEnabled(() => {
      const init: Record<string, boolean> = {};
      for (const s of sections) init[s.id] = true;
      return init;
    });
    setCollapsed({});
  }, [sections]);

  return {
    sections,
    values,
    enabled,
    collapsed,
    setValue,
    toggleEnabled,
    isEnabled,
    toggleCollapsed,
    isCollapsed,
    getPromptContributions,
    getImageAttachments,
    clearAll,
  };
}
