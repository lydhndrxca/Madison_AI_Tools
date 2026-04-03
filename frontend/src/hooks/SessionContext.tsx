import React, { createContext, useContext, useRef, useCallback, useEffect, useState } from "react";

type StateGetter = () => unknown;
type StateSetter = (state: unknown) => void;

export interface SessionTemplate {
  name: string;
  savedAt: string;
  activePage: string;
  pages: Record<string, unknown>;
}

const TEMPLATES_STORAGE_KEY = "madison_session_templates";

function loadTemplatesFromStorage(): SessionTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTemplatesToStorage(templates: SessionTemplate[]) {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch { /* quota exceeded */ }
}

const IMAGE_KEYS = new Set(["gallery", "imageIdx", "imageRecords"]);

function stripImages(pageState: unknown): unknown {
  if (!pageState || typeof pageState !== "object") return pageState;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pageState as Record<string, unknown>)) {
    if (IMAGE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Keep layout/text; drop image payloads so templates stay small (matches lab template behavior). */
function stripArtboardTemplateImages(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const s = state as Record<string, unknown>;
  const raw = s.itemsByBoard;
  if (!raw || typeof raw !== "object") return stripImages(state);
  const itemsByBoard: Record<string, unknown[]> = {};
  for (const [bid, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr)) continue;
    itemsByBoard[bid] = arr.map((it) => {
      if (!it || typeof it !== "object") return it;
      const o = it as Record<string, unknown>;
      if (o.type === "image" && typeof o.content === "string" && o.content.length > 0) {
        return { ...o, content: "" };
      }
      return it;
    });
  }
  return { ...s, itemsByBoard };
}

interface RecentFile {
  path: string;
  name: string;
}

interface SessionContextValue {
  register: (pageId: string, getter: StateGetter, setter: StateSetter) => void;
  unregister: (pageId: string) => void;
  clearAll: () => void;
  triggerSave: () => void;
  triggerSaveAs: () => void;
  triggerOpen: () => void;
  triggerOpenRecent: (filePath: string) => void;
  recentFiles: RecentFile[];
  refreshRecentFiles: () => void;
  currentFilePath: string | null;
  templates: SessionTemplate[];
  saveTemplate: (name: string) => void;
  loadTemplate: (idx: number) => void;
  deleteTemplate: (idx: number) => void;
  renameTemplate: (idx: number, name: string) => void;
}

const SessionContext = createContext<SessionContextValue>({
  register: () => {},
  unregister: () => {},
  clearAll: () => {},
  triggerSave: () => {},
  triggerSaveAs: () => {},
  triggerOpen: () => {},
  triggerOpenRecent: () => {},
  recentFiles: [],
  refreshRecentFiles: () => {},
  currentFilePath: null,
  templates: [],
  saveTemplate: () => {},
  loadTemplate: () => {},
  deleteTemplate: () => {},
  renameTemplate: () => {},
});

interface SessionProviderProps {
  children: React.ReactNode;
  activePage: string;
  onSetActivePage: (page: string) => void;
  onToast?: (msg: string, type: "success" | "error" | "info") => void;
}

export function SessionProvider({ children, activePage, onSetActivePage, onToast }: SessionProviderProps) {
  const registryRef = useRef<Map<string, { get: StateGetter; set: StateSetter }>>(new Map());
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  const [templates, setTemplates] = useState<SessionTemplate[]>(loadTemplatesFromStorage);

  const register = useCallback((pageId: string, getter: StateGetter, setter: StateSetter) => {
    registryRef.current.set(pageId, { get: getter, set: setter });
  }, []);

  const unregister = useCallback((pageId: string) => {
    registryRef.current.delete(pageId);
  }, []);

  const clearAll = useCallback(() => {
    for (const [id, { set }] of registryRef.current) {
      if (id === "artboard") continue;
      set(null);
    }
  }, []);

  const saveTemplate = useCallback((name: string) => {
    try {
      const pages: Record<string, unknown> = {};
      for (const [id, { get }] of registryRef.current) {
        const raw = get();
        pages[id] = id === "artboard" ? stripArtboardTemplateImages(raw) : stripImages(raw);
      }
      const tpl: SessionTemplate = {
        name,
        savedAt: new Date().toISOString(),
        activePage: activePageRef.current,
        pages,
      };
      JSON.stringify(tpl);
      setTemplates((prev) => {
        const next = [...prev, tpl];
        saveTemplatesToStorage(next);
        return next;
      });
      onToast?.(`Template "${name}" saved`, "success");
    } catch (e) {
      console.error("[Session] saveTemplate failed:", e);
      onToast?.(e instanceof Error ? e.message : "Failed to save template", "error");
    }
  }, [onToast]);

  const loadTemplate = useCallback((idx: number) => {
    const tpl = templates[idx];
    if (!tpl) return;
    if (typeof tpl.activePage === "string") onSetActivePage(tpl.activePage);
    for (const [id, { set }] of registryRef.current) {
      if (id === "artboard") continue;
      set(null);
    }
    setTimeout(() => {
      for (const [id, { set }] of registryRef.current) {
        if (id === "artboard") continue;
        if (tpl.pages[id] !== undefined) set(tpl.pages[id]);
      }
      onToast?.(`Template "${tpl.name}" loaded`, "success");
    }, 0);
  }, [templates, onSetActivePage, onToast]);

  const deleteTemplate = useCallback((idx: number) => {
    setTemplates((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      saveTemplatesToStorage(next);
      return next;
    });
  }, []);

  const renameTemplate = useCallback((idx: number, name: string) => {
    setTemplates((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], name };
      saveTemplatesToStorage(next);
      return next;
    });
  }, []);

  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

  const refreshRecentFiles = useCallback(async () => {
    if (window.electronAPI?.getRecentSessionFiles) {
      try {
        const paths: string[] = await window.electronAPI.getRecentSessionFiles();
        setRecentFiles(paths.map((p) => ({ path: p, name: p.replace(/^.*[\\/]/, "").replace(/\.json$/, "") })));
      } catch { /* */ }
    }
  }, []);

  useEffect(() => { refreshRecentFiles(); }, [refreshRecentFiles]);

  const buildSessionJson = useCallback(() => {
    const session: Record<string, unknown> = {
      _version: 1,
      _savedAt: new Date().toISOString(),
      activePage: activePageRef.current,
    };
    for (const [id, { get }] of registryRef.current) {
      session[id] = get();
    }
    return JSON.stringify(session);
  }, []);

  const doSaveAs = useCallback(async () => {
    try {
      const json = buildSessionJson();
      if (window.electronAPI?.saveSession) {
        const filePath = await window.electronAPI.saveSession(json);
        if (filePath) {
          setCurrentFilePath(filePath);
          refreshRecentFiles();
          onToast?.("Session saved", "success");
        }
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `madison-session-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        onToast?.("Session saved (downloaded)", "success");
      }
    } catch (err) {
      console.error("[Session] Save As failed:", err);
      onToast?.("Failed to save session", "error");
    }
  }, [buildSessionJson, refreshRecentFiles, onToast]);

  const doSave = useCallback(async () => {
    if (!currentFilePath) {
      doSaveAs();
      return;
    }
    try {
      const json = buildSessionJson();
      if (window.electronAPI?.saveSessionToPath) {
        const ok = await window.electronAPI.saveSessionToPath(currentFilePath, json);
        if (ok) {
          refreshRecentFiles();
          onToast?.("Session saved", "success");
        } else {
          onToast?.("Failed to save session", "error");
        }
      } else {
        doSaveAs();
      }
    } catch (err) {
      console.error("[Session] Save failed:", err);
      onToast?.("Failed to save session", "error");
    }
  }, [currentFilePath, buildSessionJson, doSaveAs, refreshRecentFiles, onToast]);

  const triggerSave = useCallback(() => { doSave(); }, [doSave]);
  const triggerSaveAs = useCallback(() => { doSaveAs(); }, [doSaveAs]);

  const applySession = useCallback((data: string, filePath?: string) => {
    try {
      const session = JSON.parse(data) as Record<string, unknown>;
      if (typeof session.activePage === "string") {
        onSetActivePage(session.activePage);
      }

      const savedByPrefix = new Map<string, { key: string; data: unknown }[]>();
      for (const key of Object.keys(session)) {
        if (key.startsWith("_") || key === "activePage") continue;
        const dash = key.indexOf("-");
        const prefix = dash > 0 ? key.slice(0, dash) : key;
        if (!savedByPrefix.has(prefix)) savedByPrefix.set(prefix, []);
        savedByPrefix.get(prefix)!.push({ key, data: session[key] });
      }

      const registeredByPrefix = new Map<string, { id: string; set: StateSetter }[]>();
      for (const [id, { set }] of registryRef.current) {
        const dash = id.indexOf("-");
        const prefix = dash > 0 ? id.slice(0, dash) : id;
        if (!registeredByPrefix.has(prefix)) registeredByPrefix.set(prefix, []);
        registeredByPrefix.get(prefix)!.push({ id, set });
      }

      for (const [prefix, registered] of registeredByPrefix) {
        if (prefix === "artboard") continue;
        const saved = savedByPrefix.get(prefix);
        if (!saved) continue;
        for (let i = 0; i < registered.length && i < saved.length; i++) {
          registered[i].set(saved[i].data);
        }
      }

      if (filePath) setCurrentFilePath(filePath);
      refreshRecentFiles();
      const name = filePath ? filePath.replace(/^.*[\\/]/, "").replace(/\.json$/, "") : "session";
      onToast?.(`Loaded: ${name}`, "success");
    } catch (err) {
      console.error("[Session] Load failed:", err);
      onToast?.("Failed to load session", "error");
    }
  }, [onSetActivePage, refreshRecentFiles, onToast]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerOpen = useCallback(() => {
    if (window.electronAPI?.menuOpenSession) {
      window.electronAPI.menuOpenSession();
    } else {
      if (!fileInputRef.current) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.style.display = "none";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") applySession(reader.result);
          };
          reader.readAsText(file);
          input.value = "";
        });
        document.body.appendChild(input);
        fileInputRef.current = input;
      }
      fileInputRef.current.click();
    }
  }, [applySession]);

  const triggerOpenRecent = useCallback(async (filePath: string) => {
    if (window.electronAPI?.openSessionFile) {
      const ok = await window.electronAPI.openSessionFile(filePath);
      if (!ok) onToast?.("Failed to open session file", "error");
    }
  }, [onToast]);

  useEffect(() => {
    if (!window.electronAPI?.onRequestSave) return;
    const unsub = window.electronAPI.onRequestSave(async () => {
      await doSave();
    });
    return unsub;
  }, [doSave]);

  useEffect(() => {
    if (!window.electronAPI?.onSessionLoaded) return;
    const unsub = window.electronAPI.onSessionLoaded((data: string, filePath?: string) => applySession(data, filePath));
    return unsub;
  }, [applySession]);

  return (
    <SessionContext.Provider value={{ register, unregister, clearAll, triggerSave, triggerSaveAs, triggerOpen, triggerOpenRecent, recentFiles, refreshRecentFiles, currentFilePath, templates, saveTemplate, loadTemplate, deleteTemplate, renameTemplate }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  return useContext(SessionContext);
}

/**
 * Register a page's state getter/setter for session save/load.
 * The getter and setter can be plain inline arrow functions — refs keep them fresh.
 */
export function useSessionRegister(pageId: string, getter: StateGetter, setter: StateSetter) {
  const { register, unregister } = useContext(SessionContext);
  const getterRef = useRef(getter);
  const setterRef = useRef(setter);
  getterRef.current = getter;
  setterRef.current = setter;

  useEffect(() => {
    register(pageId, () => getterRef.current(), (s) => setterRef.current(s));
    return () => unregister(pageId);
  }, [pageId, register, unregister]);
}
