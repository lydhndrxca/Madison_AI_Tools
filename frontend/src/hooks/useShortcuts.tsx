import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

/* ── Types ──────────────────────────────────────────────────── */

export interface ShortcutDef {
  id: string;
  label: string;
  category: "global" | "navigation" | "characterLab" | "imageViewer";
  defaultKeys: string;
  currentKeys: string;
  /** Single-key shortcuts (no modifier) are skipped when user is typing in an input */
  singleKey?: boolean;
}

type ActionCallback = () => void;

interface ShortcutsContextValue {
  shortcuts: ShortcutDef[];
  registerAction: (id: string, cb: ActionCallback) => void;
  unregisterAction: (id: string) => void;
  updateShortcut: (id: string, newKeys: string) => void;
  resetShortcut: (id: string) => void;
  resetAll: () => void;
  findConflict: (id: string, newKeys: string) => ShortcutDef | null;
}

const ShortcutsContext = createContext<ShortcutsContextValue>({
  shortcuts: [],
  registerAction: () => {},
  unregisterAction: () => {},
  updateShortcut: () => {},
  resetShortcut: () => {},
  resetAll: () => {},
  findConflict: () => null,
});

export const useShortcuts = () => useContext(ShortcutsContext);

/* ── Defaults ───────────────────────────────────────────────── */

const CATEGORY_LABELS: Record<ShortcutDef["category"], string> = {
  global: "Global",
  navigation: "Navigation",
  characterLab: "Character Lab",
  imageViewer: "Image Viewer",
};
export { CATEGORY_LABELS };

const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Global
  { id: "openSettings", label: "Open Settings", category: "global", defaultKeys: "Ctrl+,", currentKeys: "Ctrl+," },
  { id: "toggleConsole", label: "Toggle Console", category: "global", defaultKeys: "Ctrl+`", currentKeys: "Ctrl+`" },
  { id: "saveSession", label: "Save Session", category: "global", defaultKeys: "Ctrl+S", currentKeys: "Ctrl+S" },
  { id: "openSession", label: "Open Session", category: "global", defaultKeys: "Ctrl+O", currentKeys: "Ctrl+O" },
  { id: "toggleVoice", label: "Toggle Voice to Text", category: "global", defaultKeys: "Ctrl+R", currentKeys: "Ctrl+R" },
  { id: "toggleFullscreen", label: "Toggle Fullscreen Viewer", category: "global", defaultKeys: "Ctrl+F", currentKeys: "Ctrl+F" },
  { id: "exitFullscreen", label: "Exit Fullscreen", category: "global", defaultKeys: "Escape", currentKeys: "Escape", singleKey: false },

  // Navigation
  { id: "navGenerate", label: "Go to AI Generate Image", category: "navigation", defaultKeys: "Ctrl+1", currentKeys: "Ctrl+1" },
  { id: "navMultiview", label: "Go to Multiview", category: "navigation", defaultKeys: "Ctrl+2", currentKeys: "Ctrl+2" },
  { id: "navCharacter", label: "Go to AI CharacterLab", category: "navigation", defaultKeys: "Ctrl+3", currentKeys: "Ctrl+3" },
  { id: "navWeapon", label: "Go to AI WeaponLab", category: "navigation", defaultKeys: "Ctrl+4", currentKeys: "Ctrl+4" },

  // Character Lab
  { id: "charGenerate", label: "Generate Character Image", category: "characterLab", defaultKeys: "Ctrl+G", currentKeys: "Ctrl+G" },
  { id: "charQuickGen", label: "Quick Generate", category: "characterLab", defaultKeys: "Ctrl+Shift+G", currentKeys: "Ctrl+Shift+G" },
  { id: "charAllViews", label: "Generate All Views", category: "characterLab", defaultKeys: "Ctrl+Shift+A", currentKeys: "Ctrl+Shift+A" },
  { id: "charExtract", label: "Extract Attributes", category: "characterLab", defaultKeys: "Ctrl+E", currentKeys: "Ctrl+E" },
  { id: "charEnhance", label: "Enhance Attributes", category: "characterLab", defaultKeys: "Ctrl+Shift+E", currentKeys: "Ctrl+Shift+E" },
  { id: "charRandomize", label: "Randomize Full Character", category: "characterLab", defaultKeys: "Ctrl+Shift+R", currentKeys: "Ctrl+Shift+R" },
  { id: "charShowXml", label: "Show XML", category: "characterLab", defaultKeys: "Ctrl+Shift+X", currentKeys: "Ctrl+Shift+X" },
  { id: "charSendPS", label: "Send to Photoshop", category: "characterLab", defaultKeys: "Ctrl+Shift+P", currentKeys: "Ctrl+Shift+P" },

  // Image Viewer tools
  { id: "toolBrush", label: "Brush Tool", category: "imageViewer", defaultKeys: "B", currentKeys: "B", singleKey: true },
  { id: "toolEraser", label: "Eraser Tool", category: "imageViewer", defaultKeys: "E", currentKeys: "E", singleKey: true },
  { id: "toolMarquee", label: "Marquee Select", category: "imageViewer", defaultKeys: "M", currentKeys: "M", singleKey: true },
  { id: "toolLasso", label: "Lasso Select", category: "imageViewer", defaultKeys: "L", currentKeys: "L", singleKey: true },
  { id: "toolSmartSelect", label: "Smart Select", category: "imageViewer", defaultKeys: "W", currentKeys: "W", singleKey: true },
  { id: "brushSmaller", label: "Decrease Brush Size", category: "imageViewer", defaultKeys: "[", currentKeys: "[", singleKey: true },
  { id: "brushLarger", label: "Increase Brush Size", category: "imageViewer", defaultKeys: "]", currentKeys: "]", singleKey: true },
];

/* ── Persistence ────────────────────────────────────────────── */

const STORAGE_KEY = "madison-shortcuts";

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return {};
}

function persistOverrides(overrides: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* */ }
}

function buildShortcuts(overrides: Record<string, string>): ShortcutDef[] {
  return DEFAULT_SHORTCUTS.map((s) => ({
    ...s,
    currentKeys: overrides[s.id] ?? s.defaultKeys,
  }));
}

/* ── Key combo parsing / matching ───────────────────────────── */

/** Normalize a combo string: "Ctrl+Shift+G" → { ctrl, shift, alt, key } */
function parseCombo(combo: string) {
  const parts = combo.split("+").map((p) => p.trim());
  let ctrl = false, shift = false, alt = false, key = "";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "ctrl" || low === "cmdorctrl" || low === "cmd") ctrl = true;
    else if (low === "shift") shift = true;
    else if (low === "alt") alt = true;
    else key = low;
  }
  return { ctrl, shift, alt, key };
}

function eventMatchesCombo(e: KeyboardEvent, combo: string): boolean {
  const c = parseCombo(combo);
  if (c.ctrl !== e.ctrlKey) return false;
  if (c.shift !== e.shiftKey) return false;
  if (c.alt !== e.altKey) return false;
  const eKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // Special key name mappings
  const keyMap: Record<string, string> = { escape: "escape", "`": "`", ",": ",", "[": "[", "]": "]" };
  const cKey = keyMap[c.key] ?? c.key;
  const eventKey = keyMap[eKey] ?? eKey;
  return cKey === eventKey;
}

/** Build a display-friendly string from a KeyboardEvent */
export function eventToComboString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === "Escape") key = "Escape";
  // Don't add modifier-only presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  parts.push(key);
  return parts.join("+");
}

/* ── Provider ───────────────────────────────────────────────── */

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>(loadOverrides);
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(() => buildShortcuts(loadOverrides()));
  const actionsRef = useRef<Map<string, ActionCallback>>(new Map());

  // Rebuild shortcuts whenever overrides change
  useEffect(() => {
    setShortcuts(buildShortcuts(overrides));
    persistOverrides(overrides);
  }, [overrides]);

  const registerAction = useCallback((id: string, cb: ActionCallback) => {
    actionsRef.current.set(id, cb);
  }, []);

  const unregisterAction = useCallback((id: string) => {
    actionsRef.current.delete(id);
  }, []);

  const updateShortcut = useCallback((id: string, newKeys: string) => {
    setOverrides((prev) => ({ ...prev, [id]: newKeys }));
  }, []);

  const resetShortcut = useCallback((id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setOverrides({});
  }, []);

  const findConflict = useCallback((id: string, newKeys: string): ShortcutDef | null => {
    const norm = newKeys.toLowerCase();
    for (const s of shortcuts) {
      if (s.id === id) continue;
      if (s.currentKeys.toLowerCase() === norm) return s;
    }
    return null;
  }, [shortcuts]);

  // Use a ref that always has the latest shortcuts for the keydown handler
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      for (const sc of shortcutsRef.current) {
        // Skip single-key shortcuts when user is typing
        if (sc.singleKey && isTyping) continue;
        if (eventMatchesCombo(e, sc.currentKeys)) {
          const action = actionsRef.current.get(sc.id);
          if (action) {
            e.preventDefault();
            e.stopPropagation();
            action();
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  return (
    <ShortcutsContext.Provider value={{ shortcuts, registerAction, unregisterAction, updateShortcut, resetShortcut, resetAll, findConflict }}>
      {children}
    </ShortcutsContext.Provider>
  );
}
