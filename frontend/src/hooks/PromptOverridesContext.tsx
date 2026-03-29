import React, { createContext, useContext, useState, useCallback } from "react";

/* ── localStorage persistence ─────────────────────────────────── */

const STORAGE_KEY = "madison-prompt-overrides";

interface OverrideMap {
  [key: string]: string;
}

function loadOverrides(): OverrideMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data */ }
  return {};
}

function persistOverrides(m: OverrideMap) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch { /* */ }
}

function makeKey(toolId: string, sectionId: string): string {
  return `${toolId}.${sectionId}`;
}

/* ── Context value ────────────────────────────────────────────── */

interface PromptOverridesContextValue {
  getOverride: (toolId: string, sectionId: string) => string | null;
  setOverride: (toolId: string, sectionId: string, text: string) => void;
  clearOverride: (toolId: string, sectionId: string) => void;
  hasOverride: (toolId: string, sectionId: string) => boolean;
  clearAll: () => void;
  overrideCount: number;
}

const PromptOverridesContext = createContext<PromptOverridesContextValue>({
  getOverride: () => null,
  setOverride: () => {},
  clearOverride: () => {},
  hasOverride: () => false,
  clearAll: () => {},
  overrideCount: 0,
});

export const usePromptOverrides = () => useContext(PromptOverridesContext);

/* ── Provider ─────────────────────────────────────────────────── */

export function PromptOverridesProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<OverrideMap>(loadOverrides);

  const getOverride = useCallback((toolId: string, sectionId: string): string | null => {
    return overrides[makeKey(toolId, sectionId)] ?? null;
  }, [overrides]);

  const setOverride = useCallback((toolId: string, sectionId: string, text: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [makeKey(toolId, sectionId)]: text };
      persistOverrides(next);
      return next;
    });
  }, []);

  const clearOverride = useCallback((toolId: string, sectionId: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[makeKey(toolId, sectionId)];
      persistOverrides(next);
      return next;
    });
  }, []);

  const hasOverride = useCallback((toolId: string, sectionId: string): boolean => {
    return makeKey(toolId, sectionId) in overrides;
  }, [overrides]);

  const clearAll = useCallback(() => {
    setOverrides({});
    persistOverrides({});
  }, []);

  return (
    <PromptOverridesContext.Provider
      value={{
        getOverride,
        setOverride,
        clearOverride,
        hasOverride,
        clearAll,
        overrideCount: Object.keys(overrides).length,
      }}
    >
      {children}
    </PromptOverridesContext.Provider>
  );
}
