import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ArtboardItem {
  id: string;
  type: "image" | "text" | "frame";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  zIndex: number;
  content: string;
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
}

export interface ArtboardViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface BoardMeta {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Delta types (for collaborative sync)
// ---------------------------------------------------------------------------

export type ArtboardDelta =
  | { type: "add"; item: ArtboardItem }
  | { type: "add_many"; items: ArtboardItem[] }
  | { type: "remove"; ids: string[] }
  | { type: "update"; id: string; patch: Partial<ArtboardItem> }
  | { type: "move"; ids: string[]; dx: number; dy: number }
  | { type: "resize"; id: string; w: number; h: number }
  | { type: "reorder"; ids: string[]; zIndexMap: Record<string, number> }
  | { type: "clear" }
  | { type: "full_sync"; items: ArtboardItem[] };

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface ArtboardContextValue {
  items: ArtboardItem[];
  viewport: ArtboardViewport;
  selection: Set<string>;

  setViewport: (v: ArtboardViewport) => void;
  /** True after user has explicitly panned/zoomed — prevents auto-fit on tab return. */
  viewportTouched: boolean;
  markViewportTouched: () => void;
  resetViewportTouched: () => void;
  addItem: (item: Omit<ArtboardItem, "id" | "zIndex">) => string;
  addItems: (items: Omit<ArtboardItem, "id" | "zIndex">[]) => void;
  removeItems: (ids: string[]) => void;
  updateItem: (id: string, patch: Partial<ArtboardItem>) => void;
  moveItems: (ids: string[], dx: number, dy: number) => void;
  resizeItem: (id: string, w: number, h: number) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  setSelection: (ids: Set<string>) => void;
  selectAll: () => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  clearBoard: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Multi-board
  boards: BoardMeta[];
  activeBoardId: string;
  createBoard: (name: string) => string;
  switchBoard: (id: string) => void;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
  duplicateBoard: (id: string) => string;
  loadItemsDirectly: (items: ArtboardItem[]) => void;

  // Collab
  mode: "local" | "shared";
  roomId: string | null;
  roomUsers: RoomUser[];
  remoteCursors: Map<string, RemoteCursor>;
  joinRoom: (roomId: string, userName: string, password?: string) => void;
  leaveRoom: () => void;
  setDeltaListener: (listener: ((delta: ArtboardDelta) => void) | null) => void;
  applyRemoteDelta: (delta: ArtboardDelta) => void;
  setRoomUsers: React.Dispatch<React.SetStateAction<RoomUser[]>>;
  setRemoteCursors: React.Dispatch<React.SetStateAction<Map<string, RemoteCursor>>>;
}

export interface RoomUser {
  name: string;
  color: string;
}

export interface RemoteCursor {
  x: number;
  y: number;
  color: string;
  name: string;
  lastUpdate: number;
}

const ArtboardCtx = createContext<ArtboardContextValue | null>(null);

export function useArtboard(): ArtboardContextValue {
  const ctx = useContext(ArtboardCtx);
  if (!ctx) throw new Error("useArtboard must be used inside ArtboardProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const INDEX_KEY = "madison-artboard-index";
const BOARD_PREFIX = "madison-artboard-";
const MAX_HISTORY = 50;
const DEFAULT_BOARD_ID = "default";

function loadIndex(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BoardMeta[];
      if (parsed.length > 0) return parsed;
    }
  } catch { /* */ }
  return [{ id: DEFAULT_BOARD_ID, name: "Art Table" }];
}

function saveIndex(boards: BoardMeta[]) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(boards)); } catch { /* quota */ }
}

function loadBoardItems(boardId: string): ArtboardItem[] {
  try {
    // Migration: try the old key for the default board
    if (boardId === DEFAULT_BOARD_ID) {
      const old = localStorage.getItem("madison-artboard");
      if (old) {
        const items = JSON.parse(old) as ArtboardItem[];
        localStorage.setItem(BOARD_PREFIX + boardId, old);
        localStorage.removeItem("madison-artboard");
        return items;
      }
    }
    const raw = localStorage.getItem(BOARD_PREFIX + boardId);
    if (raw) return JSON.parse(raw) as ArtboardItem[];
  } catch { /* */ }
  return [];
}

function saveBoardItems(boardId: string, items: ArtboardItem[]) {
  try { localStorage.setItem(BOARD_PREFIX + boardId, JSON.stringify(items)); } catch { /* quota */ }
}

let _counter = 0;
export function uid(): string {
  return `ab_${Date.now()}_${++_counter}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ArtboardProvider({ children }: { children: ReactNode }) {
  const [boards, setBoards] = useState<BoardMeta[]>(loadIndex);
  const [activeBoardId, setActiveBoardId] = useState<string>(() => boards[0]?.id ?? DEFAULT_BOARD_ID);
  const [items, setItems] = useState<ArtboardItem[]>(() => loadBoardItems(activeBoardId));
  const [viewport, setViewport] = useState<ArtboardViewport>({ zoom: 1, panX: 0, panY: 0 });
  const [viewportTouched, setViewportTouched] = useState(false);
  const markViewportTouched = useCallback(() => setViewportTouched(true), []);
  const resetViewportTouched = useCallback(() => setViewportTouched(false), []);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const undoStack = useRef<ArtboardItem[][]>([]);
  const redoStack = useRef<ArtboardItem[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Collab state
  const [mode, setMode] = useState<"local" | "shared">("local");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomUsers, setRoomUsers] = useState<RoomUser[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const deltaListenerRef = useRef<((delta: ArtboardDelta) => void) | null>(null);
  const activeBoardRef = useRef(activeBoardId);
  useEffect(() => { activeBoardRef.current = activeBoardId; }, [activeBoardId]);

  // Debounced persistence (only in local mode)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== "local") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveBoardItems(activeBoardRef.current, items);
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [items, mode]);

  // Save board index when it changes
  useEffect(() => { saveIndex(boards); }, [boards]);

  const emitDelta = useCallback((delta: ArtboardDelta) => {
    if (deltaListenerRef.current) deltaListenerRef.current(delta);
  }, []);

  const pushUndo = useCallback((prev: ArtboardItem[]) => {
    undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), prev];
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const addItem = useCallback((partial: Omit<ArtboardItem, "id" | "zIndex">): string => {
    const id = uid();
    let created: ArtboardItem | null = null;
    setItems((prev) => {
      pushUndo(prev);
      const z = prev.length === 0 ? 1 : Math.max(...prev.map((i) => i.zIndex)) + 1;
      created = { ...partial, id, zIndex: z };
      return [...prev, created];
    });
    if (created) emitDelta({ type: "add", item: created });
    return id;
  }, [pushUndo, emitDelta]);

  const addItems = useCallback((partials: Omit<ArtboardItem, "id" | "zIndex">[]) => {
    const newItems: ArtboardItem[] = [];
    setItems((prev) => {
      pushUndo(prev);
      let z = prev.length === 0 ? 1 : Math.max(...prev.map((i) => i.zIndex)) + 1;
      for (const p of partials) newItems.push({ ...p, id: uid(), zIndex: z++ });
      return [...prev, ...newItems];
    });
    if (newItems.length) emitDelta({ type: "add_many", items: newItems });
  }, [pushUndo, emitDelta]);

  const removeItems = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setItems((prev) => { pushUndo(prev); return prev.filter((i) => !idSet.has(i.id)); });
    setSelection((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
    emitDelta({ type: "remove", ids });
  }, [pushUndo, emitDelta]);

  const updateItem = useCallback((id: string, patch: Partial<ArtboardItem>) => {
    setItems((prev) => { pushUndo(prev); return prev.map((i) => i.id === id ? { ...i, ...patch } : i); });
    emitDelta({ type: "update", id, patch });
  }, [pushUndo, emitDelta]);

  const moveItems = useCallback((ids: string[], dx: number, dy: number) => {
    const idSet = new Set(ids);
    setItems((prev) => { pushUndo(prev); return prev.map((i) => idSet.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i); });
    emitDelta({ type: "move", ids, dx, dy });
  }, [pushUndo, emitDelta]);

  const resizeItem = useCallback((id: string, w: number, h: number) => {
    setItems((prev) => { pushUndo(prev); return prev.map((i) => i.id === id ? { ...i, w, h } : i); });
    emitDelta({ type: "resize", id, w, h });
  }, [pushUndo, emitDelta]);

  const bringToFront = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    let zMap: Record<string, number> = {};
    setItems((prev) => {
      pushUndo(prev);
      let z = Math.max(...prev.map((i) => i.zIndex)) + 1;
      const result = prev.map((i) => idSet.has(i.id) ? { ...i, zIndex: z++ } : i);
      result.forEach((i) => { if (idSet.has(i.id)) zMap[i.id] = i.zIndex; });
      return result;
    });
    queueMicrotask(() => emitDelta({ type: "reorder", ids, zIndexMap: zMap }));
  }, [pushUndo, emitDelta]);

  const sendToBack = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    let zMap: Record<string, number> = {};
    setItems((prev) => {
      pushUndo(prev);
      let z = Math.min(...prev.map((i) => i.zIndex)) - ids.length;
      const result = prev.map((i) => idSet.has(i.id) ? { ...i, zIndex: z++ } : i);
      result.forEach((i) => { if (idSet.has(i.id)) zMap[i.id] = i.zIndex; });
      return result;
    });
    queueMicrotask(() => emitDelta({ type: "reorder", ids, zIndexMap: zMap }));
  }, [pushUndo, emitDelta]);

  const selectAll = useCallback(() => { setSelection(new Set(items.map((i) => i.id))); }, [items]);
  const clearSelection = useCallback(() => { setSelection(new Set()); }, []);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push([...items]);
    setItems(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [items]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push([...items]);
    setItems(next);
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }, [items]);

  const clearBoard = useCallback(() => {
    pushUndo(items);
    setItems([]);
    setSelection(new Set());
    emitDelta({ type: "clear" });
  }, [items, pushUndo, emitDelta]);

  // ---- Multi-board ----

  const createBoard = useCallback((name: string): string => {
    const id = uid();
    setBoards((prev) => [...prev, { id, name }]);
    saveBoardItems(id, []);
    return id;
  }, []);

  const switchBoard = useCallback((id: string) => {
    // Save current board first
    saveBoardItems(activeBoardRef.current, items);
    // Load new board
    const newItems = loadBoardItems(id);
    setActiveBoardId(id);
    setItems(newItems);
    setSelection(new Set());
    setViewport({ zoom: 1, panX: 0, panY: 0 });
    setViewportTouched(false);
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [items]);

  const renameBoard = useCallback((id: string, name: string) => {
    setBoards((prev) => prev.map((b) => b.id === id ? { ...b, name } : b));
  }, []);

  const deleteBoard = useCallback((id: string) => {
    setBoards((prev) => {
      const next = prev.filter((b) => b.id !== id);
      if (next.length === 0) next.push({ id: uid(), name: "Art Table" });
      if (activeBoardRef.current === id) {
        const fallback = next[0].id;
        setActiveBoardId(fallback);
        setItems(loadBoardItems(fallback));
        setSelection(new Set());
        setViewport({ zoom: 1, panX: 0, panY: 0 });
        setViewportTouched(false);
        undoStack.current = [];
        redoStack.current = [];
        setCanUndo(false);
        setCanRedo(false);
      }
      try { localStorage.removeItem(BOARD_PREFIX + id); } catch { /* */ }
      return next;
    });
  }, []);

  const duplicateBoard = useCallback((id: string): string => {
    const src = boards.find((b) => b.id === id);
    const newId = uid();
    const srcItems = id === activeBoardRef.current ? items : loadBoardItems(id);
    setBoards((prev) => [...prev, { id: newId, name: `${src?.name || "Board"} (Copy)` }]);
    saveBoardItems(newId, srcItems);
    return newId;
  }, [boards, items]);

  const loadItemsDirectly = useCallback((newItems: ArtboardItem[]) => {
    pushUndo(items);
    setItems(newItems);
    setSelection(new Set());
  }, [items, pushUndo]);

  // ---- Collab ----

  const joinRoom = useCallback((rid: string, userName: string, _password?: string) => {
    setMode("shared");
    setRoomId(rid);
    setRoomUsers([]);
    setRemoteCursors(new Map());
    // The actual WS connection is managed by useArtboardSync hook
    void userName; void _password;
  }, []);

  const leaveRoom = useCallback(() => {
    setMode("local");
    setRoomId(null);
    setRoomUsers([]);
    setRemoteCursors(new Map());
  }, []);

  const setDeltaListener = useCallback((listener: ((delta: ArtboardDelta) => void) | null) => {
    deltaListenerRef.current = listener;
  }, []);

  const applyRemoteDelta = useCallback((delta: ArtboardDelta) => {
    // Remote deltas bypass undo stack
    setItems((prev) => {
      switch (delta.type) {
        case "add": return [...prev, delta.item];
        case "add_many": return [...prev, ...delta.items];
        case "remove": { const s = new Set(delta.ids); return prev.filter((i) => !s.has(i.id)); }
        case "update": return prev.map((i) => i.id === delta.id ? { ...i, ...delta.patch } : i);
        case "move": { const s = new Set(delta.ids); return prev.map((i) => s.has(i.id) ? { ...i, x: i.x + delta.dx, y: i.y + delta.dy } : i); }
        case "resize": return prev.map((i) => i.id === delta.id ? { ...i, w: delta.w, h: delta.h } : i);
        case "reorder": return prev.map((i) => i.id in delta.zIndexMap ? { ...i, zIndex: delta.zIndexMap[i.id] } : i);
        case "clear": return [];
        case "full_sync": return delta.items;
        default: return prev;
      }
    });
  }, []);

  return (
    <ArtboardCtx.Provider value={{
      items, viewport, selection,
      setViewport, viewportTouched, markViewportTouched, resetViewportTouched,
      addItem, addItems, removeItems, updateItem, moveItems, resizeItem,
      bringToFront, sendToBack, setSelection, selectAll, clearSelection,
      undo, redo, clearBoard, canUndo, canRedo,
      boards, activeBoardId, createBoard, switchBoard, renameBoard, deleteBoard, duplicateBoard,
      loadItemsDirectly,
      mode, roomId, roomUsers, remoteCursors,
      joinRoom, leaveRoom, setDeltaListener, applyRemoteDelta, setRoomUsers, setRemoteCursors,
    }}>
      {children}
    </ArtboardCtx.Provider>
  );
}
