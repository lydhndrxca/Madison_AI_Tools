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

interface SessionContextValue {
  register: (pageId: string, getter: StateGetter, setter: StateSetter) => void;
  unregister: (pageId: string) => void;
  clearAll: () => void;
  triggerSave: () => void;
  triggerOpen: () => void;
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
  triggerOpen: () => {},
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
    for (const [, { set }] of registryRef.current) {
      set(null);
    }
  }, []);

  const saveTemplate = useCallback((name: string) => {
    const pages: Record<string, unknown> = {};
    for (const [id, { get }] of registryRef.current) {
      pages[id] = stripImages(get());
    }
    const tpl: SessionTemplate = {
      name,
      savedAt: new Date().toISOString(),
      activePage: activePageRef.current,
      pages,
    };
    setTemplates((prev) => {
      const next = [...prev, tpl];
      saveTemplatesToStorage(next);
      return next;
    });
    onToast?.(`Template "${name}" saved`, "success");
  }, [onToast]);

  const loadTemplate = useCallback((idx: number) => {
    const tpl = templates[idx];
    if (!tpl) return;
    if (typeof tpl.activePage === "string") onSetActivePage(tpl.activePage);
    for (const [id, { set }] of registryRef.current) {
      // First reset to clear images, then apply template settings
      set(null);
    }
    // Use a microtask to let the reset flush, then apply settings
    setTimeout(() => {
      for (const [id, { set }] of registryRef.current) {
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

  const doSaveSession = useCallback(async () => {
    const session: Record<string, unknown> = {
      _version: 1,
      _savedAt: new Date().toISOString(),
      activePage: activePageRef.current,
    };
    for (const [id, { get }] of registryRef.current) {
      session[id] = get();
    }
    try {
      const json = JSON.stringify(session);
      const saved = await window.electronAPI!.saveSession(json);
      if (saved) onToast?.("Session saved", "success");
    } catch (err) {
      console.error("[Session] Save failed:", err);
      onToast?.("Failed to save session", "error");
    }
  }, [onToast]);

  const triggerSave = useCallback(() => { doSaveSession(); }, [doSaveSession]);

  const triggerOpen = useCallback(() => {
    window.electronAPI?.menuOpenSession();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onRequestSave) return;
    const unsub = window.electronAPI.onRequestSave(async () => {
      await doSaveSession();
    });
    return unsub;
  }, [onToast]);

  useEffect(() => {
    if (!window.electronAPI?.onSessionLoaded) return;
    const unsub = window.electronAPI.onSessionLoaded((data: string) => {
      try {
        const session = JSON.parse(data) as Record<string, unknown>;
        if (typeof session.activePage === "string") {
          onSetActivePage(session.activePage);
        }
        for (const [id, { set }] of registryRef.current) {
          if (session[id] !== undefined) set(session[id]);
        }
        onToast?.("Session loaded", "success");
      } catch (err) {
        console.error("[Session] Load failed:", err);
        onToast?.("Failed to load session", "error");
      }
    });
    return unsub;
  }, [onSetActivePage, onToast]);

  return (
    <SessionContext.Provider value={{ register, unregister, clearAll, triggerSave, triggerOpen, templates, saveTemplate, loadTemplate, deleteTemplate, renameTemplate }}>
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
