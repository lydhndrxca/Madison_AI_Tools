import {
  useState, useCallback, useRef, useEffect, useMemo,
  type MouseEvent as RME, type WheelEvent as RWE,
} from "react";
import { useArtboard, type ArtboardItem } from "@/hooks/ArtboardContext";
import { useArtboardSync } from "@/hooks/useArtboardSync";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { expDecay } from "@/lib/easing";

const DRAG_THRESHOLD = 3;
const DOT_SPACING = 40;
const CURSOR_FADE_MS = 5000;
const CURSOR_SMOOTH_HALFLIFE = 0.06;

function rectsIntersect(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

interface CtxMenuItem { label: string; action: () => void; danger?: boolean; separator?: boolean }

export function ArtboardCanvas() {
  const {
    items, viewport, selection, setViewport, addItem, removeItems, updateItem,
    moveItems, resizeItem, bringToFront, sendToBack, setSelection, selectAll,
    clearSelection, undo, redo, clearBoard,
    boards, activeBoardId, createBoard, switchBoard, renameBoard, deleteBoard, duplicateBoard,
    loadItemsDirectly,
    mode, roomId, roomUsers, remoteCursors,
    joinRoom, leaveRoom,
  } = useArtboard();
  const { addToast } = useToastContext();
  const { sendCursor, setCredentials } = useArtboardSync();
  const { zoom, panX, panY } = viewport;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const [dragging, setDragging] = useState<{ ids: string[]; startX: number; startY: number; moved: boolean } | null>(null);
  const dragLastRef = useRef<{ x: number; y: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startY: number; origW: number; origH: number } | null>(null);
  const [marquee, setMarquee] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [styleLibModal, setStyleLibModal] = useState<{ imageIds: string[] } | null>(null);
  const [slFolders, setSlFolders] = useState<{ name: string; category: string }[]>([]);
  const [slNewName, setSlNewName] = useState("");
  const [slCategory, setSlCategory] = useState<"general" | "ui">("general");
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const middlePanRef = useRef({ lastX: 0, lastY: 0 });

  // Board switcher state
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const [renamingBoard, setRenamingBoard] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const boardDropRef = useRef<HTMLDivElement>(null);

  // Share/Join modal state
  const [shareModal, setShareModal] = useState<"share" | "join" | null>(null);
  const [shareRoomName, setShareRoomName] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [shareUserName, setShareUserName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinUserName, setJoinUserName] = useState("");
  const [activeRooms, setActiveRooms] = useState<{ code: string; name: string; user_count: number; host: string }[]>([]);

  // Save/Load modal state
  const [saveLoadModal, setSaveLoadModal] = useState<"save" | "load" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savedBoards, setSavedBoards] = useState<{ name: string; item_count: number; thumbnail: string | null; updated_at: string }[]>([]);

  // Close board dropdown on outside click
  useEffect(() => {
    if (!boardDropdownOpen) return;
    const h = (e: MouseEvent) => { if (boardDropRef.current && !boardDropRef.current.contains(e.target as Node)) setBoardDropdownOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [boardDropdownOpen]);

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  // ---------------------------------------------------------------------------
  // Zoom with zoom-to-cursor
  // ---------------------------------------------------------------------------
  const handleWheel = useCallback((e: RWE<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const v = viewportRef.current;
    const wx = (mx - cx - v.panX) / v.zoom, wy = (my - cy - v.panY) / v.zoom;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nz = Math.min(20, Math.max(0.05, v.zoom * f));
    setViewport({ zoom: nz, panX: mx - cx - wx * nz, panY: my - cy - wy * nz });
  }, [setViewport]);

  // ---------------------------------------------------------------------------
  // Middle-mouse pan
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      middlePanRef.current = { lastX: e.clientX, lastY: e.clientY };
      setIsMiddlePanning(true);
    };
    const onMove = (e: PointerEvent) => {
      if ((e.buttons & 4) === 0) return;
      const { lastX, lastY } = middlePanRef.current;
      middlePanRef.current = { lastX: e.clientX, lastY: e.clientY };
      const v = viewportRef.current;
      setViewport({ zoom: v.zoom, panX: v.panX + e.clientX - lastX, panY: v.panY + e.clientY - lastY });
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 1) { setIsMiddlePanning(false); try { el.releasePointerCapture(e.pointerId); } catch {} }
    };
    el.addEventListener("pointerdown", onDown); el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp); el.removeEventListener("pointercancel", onUp); };
  }, [setViewport]);

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------
  const screenToWorld = useCallback((cX: number, cY: number) => {
    const el = containerRef.current; if (!el) return { wx: 0, wy: 0 };
    const r = el.getBoundingClientRect();
    return { wx: (cX - r.left - r.width / 2 - panX) / zoom, wy: (cY - r.top - r.height / 2 - panY) / zoom };
  }, [panX, panY, zoom]);

  const hitTest = useCallback((wx: number, wy: number): ArtboardItem | null => {
    for (const it of [...items].sort((a, b) => b.zIndex - a.zIndex))
      if (wx >= it.x && wx <= it.x + it.w && wy >= it.y && wy <= it.y + it.h) return it;
    return null;
  }, [items]);

  // ---------------------------------------------------------------------------
  // Mouse handlers (drag items / marquee select)
  // ---------------------------------------------------------------------------
  const handleMouseDown = useCallback((e: RME, directItem?: ArtboardItem) => {
    if (e.button !== 0 || editingText) return;
    setCtxMenu(null);
    const w = screenToWorld(e.clientX, e.clientY);
    const hit = directItem ?? hitTest(w.wx, w.wy);
    if (hit) {
      let next = new Set(selection);
      if (e.shiftKey) { if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id); setSelection(next); }
      else if (!next.has(hit.id)) { next = new Set([hit.id]); setSelection(next); }
      setDragging({ ids: [...next], startX: e.clientX, startY: e.clientY, moved: false });
      dragLastRef.current = { x: e.clientX, y: e.clientY };
    } else {
      if (!e.shiftKey) clearSelection();
      setMarquee({ sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY });
    }
  }, [screenToWorld, hitTest, selection, setSelection, clearSelection, editingText]);

  const handleMouseMove = useCallback((e: RME | MouseEvent) => {
    if (dragging) {
      const last = dragLastRef.current; if (!last) return;
      if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) <= DRAG_THRESHOLD) return;
      if (!dragging.moved) { setDragging((d) => d ? { ...d, moved: true } : null); dragLastRef.current = { x: e.clientX, y: e.clientY }; return; }
      moveItems(dragging.ids, (e.clientX - last.x) / zoom, (e.clientY - last.y) / zoom);
      dragLastRef.current = { x: e.clientX, y: e.clientY };
    } else if (marquee) { setMarquee((m) => m ? { ...m, cx: e.clientX, cy: e.clientY } : null); }
    else if (resizing) { resizeItem(resizing.id, Math.max(20, resizing.origW + (e.clientX - resizing.startX) / zoom), Math.max(20, resizing.origH + (e.clientY - resizing.startY) / zoom)); }
  }, [dragging, marquee, resizing, moveItems, resizeItem, zoom]);

  const handleMouseUp = useCallback((e: RME | MouseEvent) => {
    if (e.button !== 0) return;
    if (dragging && !dragging.moved && dragging.ids.length === 1) setSelection(new Set([dragging.ids[0]]));
    if (marquee) {
      const w1 = screenToWorld(Math.min(marquee.sx, marquee.cx), Math.min(marquee.sy, marquee.cy));
      const w2 = screenToWorld(Math.max(marquee.sx, marquee.cx), Math.max(marquee.sy, marquee.cy));
      const mw = Math.abs(w2.wx - w1.wx), mh = Math.abs(w2.wy - w1.wy);
      if (mw > 2 || mh > 2) {
        const ids = new Set(items.filter((i) => rectsIntersect(Math.min(w1.wx, w2.wx), Math.min(w1.wy, w2.wy), mw, mh, i.x, i.y, i.w, i.h)).map((i) => i.id));
        if (e.shiftKey) { const m = new Set(selection); ids.forEach((id) => m.add(id)); setSelection(m); } else setSelection(ids);
      }
      setMarquee(null);
    }
    setDragging(null); dragLastRef.current = null; setResizing(null);
  }, [dragging, marquee, items, selection, screenToWorld, setSelection]);

  useEffect(() => {
    if (!dragging && !marquee && !resizing) return;
    const mv = (e: MouseEvent) => handleMouseMove(e);
    const up = (e: MouseEvent) => handleMouseUp(e);
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [dragging, marquee, resizing, handleMouseMove, handleMouseUp]);

  const handleResizeStart = useCallback((e: RME, item: ArtboardItem) => {
    e.stopPropagation(); e.preventDefault();
    setResizing({ id: item.id, startX: e.clientX, startY: e.clientY, origW: item.w, origH: item.h });
  }, []);

  // ---------------------------------------------------------------------------
  // Image ingestion helper
  // ---------------------------------------------------------------------------
  const ingestImage = useCallback((dataUrl: string, wx: number, wy: number) => {
    const img = new Image();
    img.onload = () => { let w = img.naturalWidth, h = img.naturalHeight; if (w > 512) { h = (h * 512) / w; w = 512; } addItem({ type: "image", x: wx - w / 2, y: wy - h / 2, w, h, rotation: 0, content: dataUrl }); };
    img.src = dataUrl;
  }, [addItem]);

  // ---------------------------------------------------------------------------
  // Clipboard actions
  // ---------------------------------------------------------------------------
  const doCopy = useCallback(async () => {
    const img = items.find((i) => selection.has(i.id) && i.type === "image");
    if (!img) { addToast("No image selected", "info"); return; }
    try { const r = await fetch(img.content); const b = await r.blob(); await navigator.clipboard.write([new ClipboardItem({ [b.type]: b })]); addToast("Copied", "success"); } catch { addToast("Copy failed", "error"); }
  }, [items, selection, addToast]);

  const doPaste = useCallback(async (wx?: number, wy?: number) => {
    let tx = 0, ty = 0;
    if (wx !== undefined && wy !== undefined) { tx = wx; ty = wy; }
    else { const el = containerRef.current; if (el) { const r = el.getBoundingClientRect(); const c = screenToWorld(r.left + r.width / 2, r.top + r.height / 2); tx = c.wx; ty = c.wy; } }
    try {
      const ci = await navigator.clipboard.read();
      for (const c of ci) { const it = c.types.find((t) => t.startsWith("image/")); if (it) { const blob = await c.getType(it); const du = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); }); ingestImage(du, tx, ty); return; } }
      addToast("No image on clipboard", "info");
    } catch { addToast("Paste failed", "error"); }
  }, [screenToWorld, ingestImage, addToast]);

  // ---------------------------------------------------------------------------
  // Style Library integration
  // ---------------------------------------------------------------------------
  const openStyleLibModal = useCallback(async (imageIds: string[]) => {
    setStyleLibModal({ imageIds }); setSlNewName(""); setSlCategory("general");
    try { setSlFolders(await apiFetch<{ name: string; category: string }[]>("/styles/folders")); } catch { setSlFolders([]); }
  }, []);

  const handleAddToStyleLib = useCallback(async (folderName: string) => {
    if (!styleLibModal) return;
    const imgs = styleLibModal.imageIds.map((id) => items.find((i) => i.id === id)).filter((i): i is ArtboardItem => !!i && i.type === "image");
    if (!imgs.length) return;
    try { await apiFetch(`/styles/folders/${encodeURIComponent(folderName)}/images`, { method: "POST", body: JSON.stringify(imgs.map((i, idx) => ({ filename: `${i.id}_${idx}.png`, data_url: i.content }))) }); addToast(`Added to "${folderName}"`, "success"); } catch { addToast("Failed", "error"); }
    setStyleLibModal(null);
  }, [styleLibModal, items, addToast]);

  const handleCreateStyleFolder = useCallback(async () => {
    if (!slNewName.trim()) return;
    try { await apiFetch("/styles/folders", { method: "POST", body: JSON.stringify({ name: slNewName.trim(), category: slCategory }) }); await handleAddToStyleLib(slNewName.trim()); } catch { addToast("Failed to create folder", "error"); }
    setSlNewName("");
  }, [slNewName, slCategory, handleAddToStyleLib, addToast]);

  // ---------------------------------------------------------------------------
  // Save / Load board to backend
  // ---------------------------------------------------------------------------
  const handleSaveBoard = useCallback(async () => {
    if (!saveName.trim()) return;
    try {
      await apiFetch("/artboard/boards", { method: "POST", body: JSON.stringify({ name: saveName.trim(), items }) });
      addToast(`Saved "${saveName.trim()}"`, "success");
      setSaveLoadModal(null);
    } catch { addToast("Save failed", "error"); }
  }, [saveName, items, addToast]);

  const handleLoadBoard = useCallback(async (name: string) => {
    try {
      const data = await apiFetch<{ items: ArtboardItem[] }>(`/artboard/boards/${encodeURIComponent(name)}`);
      loadItemsDirectly(data.items);
      addToast(`Loaded "${name}"`, "success");
      setSaveLoadModal(null);
    } catch { addToast("Load failed", "error"); }
  }, [loadItemsDirectly, addToast]);

  const handleDeleteSavedBoard = useCallback(async (name: string) => {
    try {
      await apiFetch(`/artboard/boards/${encodeURIComponent(name)}`, { method: "DELETE" });
      setSavedBoards((prev) => prev.filter((b) => b.name !== name));
      addToast(`Deleted "${name}"`, "success");
    } catch { addToast("Delete failed", "error"); }
  }, [addToast]);

  const openSaveModal = useCallback(() => { setSaveName(activeBoard?.name || ""); setSaveLoadModal("save"); }, [activeBoard]);
  const openLoadModal = useCallback(async () => {
    setSaveLoadModal("load");
    try { setSavedBoards(await apiFetch<typeof savedBoards>("/artboard/boards")); } catch { setSavedBoards([]); }
  }, []);

  // ---------------------------------------------------------------------------
  // Share / Join room
  // ---------------------------------------------------------------------------
  const handleCreateRoom = useCallback(async () => {
    if (!shareUserName.trim()) return;
    try {
      const res = await apiFetch<{ code: string }>("/artboard/rooms", { method: "POST", body: JSON.stringify({ name: shareRoomName.trim() || "Shared Board", password: sharePassword || null, items }) });
      setCredentials(shareUserName.trim(), sharePassword || undefined);
      joinRoom(res.code, shareUserName.trim(), sharePassword || undefined);
      addToast(`Room created: ${res.code}`, "success");
      setShareModal(null);
    } catch { addToast("Failed to create room", "error"); }
  }, [shareUserName, shareRoomName, sharePassword, items, joinRoom, addToast, setCredentials]);

  const handleJoinRoom = useCallback(() => {
    if (!joinCode.trim() || !joinUserName.trim()) return;
    setCredentials(joinUserName.trim(), joinPassword || undefined);
    joinRoom(joinCode.trim().toUpperCase(), joinUserName.trim(), joinPassword || undefined);
    setShareModal(null);
  }, [joinCode, joinUserName, joinPassword, joinRoom, setCredentials]);

  const openShareModal = useCallback(async () => {
    setShareModal("share");
    setShareRoomName(activeBoard?.name || "");
    setSharePassword("");
    setShareUserName("");
  }, [activeBoard]);

  const openJoinModal = useCallback(async () => {
    setShareModal("join");
    setJoinCode(""); setJoinPassword(""); setJoinUserName("");
    try { setActiveRooms(await apiFetch<typeof activeRooms>("/artboard/rooms")); } catch { setActiveRooms([]); }
  }, []);

  // ---------------------------------------------------------------------------
  // Export / Import JSON
  // ---------------------------------------------------------------------------
  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${activeBoard?.name || "artboard"}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [items, activeBoard]);

  const handleImportJson = useCallback(() => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as ArtboardItem[];
          if (Array.isArray(parsed)) { loadItemsDirectly(parsed); addToast("Imported", "success"); }
        } catch { addToast("Invalid JSON file", "error"); }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadItemsDirectly, addToast]);

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------
  const handleContextMenu = useCallback((e: RME) => {
    e.preventDefault(); e.stopPropagation();
    const w = screenToWorld(e.clientX, e.clientY);
    const hit = hitTest(w.wx, w.wy);
    if (hit) {
      if (!selection.has(hit.id)) setSelection(new Set([hit.id]));
      const ids = selection.has(hit.id) ? [...selection] : [hit.id];
      const imgIds = ids.filter((id) => items.find((i) => i.id === id)?.type === "image");
      const mi: CtxMenuItem[] = [
        { label: "Copy", action: () => { setCtxMenu(null); doCopy(); } },
        { label: "Delete", action: () => { setCtxMenu(null); removeItems(ids); }, danger: true },
        { label: "Bring to Front", action: () => { setCtxMenu(null); bringToFront(ids); } },
        { label: "Send to Back", action: () => { setCtxMenu(null); sendToBack(ids); } },
      ];
      if (imgIds.length > 0) mi.push({ label: "Add to Style Library\u2026", action: () => { setCtxMenu(null); openStyleLibModal(imgIds); }, separator: true });
      setCtxMenu({ x: e.clientX, y: e.clientY, items: mi });
    } else {
      const mi: CtxMenuItem[] = [
        { label: "Paste Image", action: () => { setCtxMenu(null); doPaste(w.wx, w.wy); } },
        { label: "Add Text", action: () => { setCtxMenu(null); addItem({ type: "text", x: w.wx - 100, y: w.wy - 20, w: 200, h: 40, rotation: 0, content: "Text", fontSize: 16, fontColor: "#ffffff" }); } },
        { label: "Add Frame", action: () => { setCtxMenu(null); addItem({ type: "frame", x: w.wx - 150, y: w.wy - 100, w: 300, h: 200, rotation: 0, content: "", borderColor: "rgba(255,255,255,0.5)", borderWidth: 2 }); } },
      ];
      if (items.length > 0) mi.push({ label: "Clear Board", action: () => { setCtxMenu(null); clearBoard(); }, danger: true, separator: true });
      setCtxMenu({ x: e.clientX, y: e.clientY, items: mi });
    }
  }, [screenToWorld, hitTest, selection, items, setSelection, removeItems, bringToFront, sendToBack, addItem, clearBoard, doCopy, doPaste, openStyleLibModal]);

  useEffect(() => { const d = () => setCtxMenu(null); window.addEventListener("click", d); return () => window.removeEventListener("click", d); }, []);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) { e.preventDefault(); removeItems([...selection]); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "a") { e.preventDefault(); selectAll(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "c") { e.preventDefault(); doCopy(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "v") { e.preventDefault(); doPaste(); }
      else if (e.key === "Escape") { clearSelection(); setEditingText(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selection, removeItems, undo, redo, selectAll, clearSelection, doCopy, doPaste]);

  // Native paste event for direct image paste from clipboard
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || !e.clipboardData) return;
      for (const it of Array.from(e.clipboardData.items)) {
        if (it.type.startsWith("image/")) {
          e.preventDefault(); const f = it.getAsFile(); if (!f) continue;
          const r = new FileReader();
          r.onload = () => ingestImage(String(r.result), 0, 0);
          r.readAsDataURL(f); return;
        }
      }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [ingestImage]);

  // ---------------------------------------------------------------------------
  // Derived render state
  // ---------------------------------------------------------------------------
  const ds = DOT_SPACING * zoom;
  const marqueeRect = marquee ? { left: Math.min(marquee.sx, marquee.cx), top: Math.min(marquee.sy, marquee.cy), width: Math.abs(marquee.cx - marquee.sx), height: Math.abs(marquee.cy - marquee.sy) } : null;
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.zIndex - b.zIndex), [items]);
  const grabbing = Boolean(dragging?.moved || isMiddlePanning);

  // Remote cursors -- smooth interpolation via requestAnimationFrame
  const smoothCursorsRef = useRef<Map<string, { x: number; y: number; tx: number; ty: number; color: string; name: string; lastUpdate: number }>>(new Map());
  const [smoothCursors, setSmoothCursors] = useState<{ name: string; color: string; x: number; y: number; opacity: number }[]>([]);

  // Sync target positions from incoming cursor data
  useEffect(() => {
    remoteCursors.forEach((c, key) => {
      const existing = smoothCursorsRef.current.get(key);
      if (existing) { existing.tx = c.x; existing.ty = c.y; existing.lastUpdate = c.lastUpdate; }
      else smoothCursorsRef.current.set(key, { x: c.x, y: c.y, tx: c.x, ty: c.y, color: c.color, name: c.name, lastUpdate: c.lastUpdate });
    });
    // Remove cursors no longer in the map
    smoothCursorsRef.current.forEach((_, key) => { if (!remoteCursors.has(key)) smoothCursorsRef.current.delete(key); });
  }, [remoteCursors]);

  // Animation loop for smooth cursor movement
  useEffect(() => {
    if (mode !== "shared") return;
    let prevTime = performance.now();
    let rafId = 0;
    const tick = (time: number) => {
      const dt = Math.min((time - prevTime) / 1000, 0.1);
      prevTime = time;
      const now = Date.now();
      const arr: { name: string; color: string; x: number; y: number; opacity: number }[] = [];
      smoothCursorsRef.current.forEach((c) => {
        c.x = expDecay(c.x, c.tx, CURSOR_SMOOTH_HALFLIFE, dt);
        c.y = expDecay(c.y, c.ty, CURSOR_SMOOTH_HALFLIFE, dt);
        const age = now - c.lastUpdate;
        if (age < CURSOR_FADE_MS) {
          const opacity = age > CURSOR_FADE_MS - 1000 ? (CURSOR_FADE_MS - age) / 1000 : 1;
          arr.push({ name: c.name, color: c.color, x: c.x, y: c.y, opacity });
        }
      });
      setSmoothCursors(arr);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  const btnBase = "px-2 py-1 text-[11px] rounded cursor-pointer transition-colors";
  const btnStyle: React.CSSProperties = { background: "rgba(255,255,255,0.08)", color: "var(--color-text-primary, #ddd)", border: "1px solid rgba(255,255,255,0.12)" };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-full w-full flex flex-col" style={{ background: "#2a2a2a" }}>
      {/* Top bar: board switcher + actions */}
      <div className="flex items-center gap-1.5 px-2 py-1 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
        {/* Board dropdown */}
        <div className="relative" ref={boardDropRef}>
          <button className={btnBase} style={btnStyle} onClick={() => setBoardDropdownOpen((p) => !p)}>
            {activeBoard?.name || "Board"} <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>{"\u25BE"}</span>
          </button>
          {boardDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-[9999] py-1 rounded-md shadow-lg min-w-[200px]" style={{ background: "var(--color-card, #2f2f2f)", border: "1px solid var(--color-border, rgba(255,255,255,0.12))" }}>
              {boards.map((b) => (
                <div key={b.id} className="flex items-center gap-1 px-2 py-1 group" onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.06)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>
                  {renamingBoard === b.id ? (
                    <input autoFocus className="flex-1 text-[11px] px-1 py-0.5 rounded" style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => { if (renameValue.trim()) renameBoard(b.id, renameValue.trim()); setRenamingBoard(null); }} onKeyDown={(e) => { if (e.key === "Enter") { if (renameValue.trim()) renameBoard(b.id, renameValue.trim()); setRenamingBoard(null); } if (e.key === "Escape") setRenamingBoard(null); }} />
                  ) : (
                    <button className="flex-1 text-left text-[11px] cursor-pointer" style={{ background: "transparent", border: "none", color: b.id === activeBoardId ? "var(--color-foreground)" : "var(--color-text-primary)", fontWeight: b.id === activeBoardId ? 600 : 400 }} onClick={() => { switchBoard(b.id); setBoardDropdownOpen(false); }} onDoubleClick={() => { setRenamingBoard(b.id); setRenameValue(b.name); }}>
                      {b.name}
                    </button>
                  )}
                  <button className="text-[10px] opacity-0 group-hover:opacity-60 cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }} onClick={() => { duplicateBoard(b.id); }} title="Duplicate">{"\u2398"}</button>
                  {boards.length > 1 && (
                    <button className="text-[10px] opacity-0 group-hover:opacity-60 cursor-pointer" style={{ background: "transparent", border: "none", color: "#e55" }} onClick={() => { deleteBoard(b.id); if (boards.length <= 1) setBoardDropdownOpen(false); }} title="Delete">{"\u2715"}</button>
                  )}
                </div>
              ))}
              <div className="mx-2 my-1 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
              <button className="w-full text-left px-2 py-1 text-[11px] cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }} onClick={() => { const id = createBoard("New Board"); switchBoard(id); setBoardDropdownOpen(false); }} onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.06)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>+ New Board</button>
            </div>
          )}
        </div>

        <div className="w-px h-4 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />

        {/* Save / Load */}
        <button className={btnBase} style={btnStyle} onClick={openSaveModal}>Save</button>
        <button className={btnBase} style={btnStyle} onClick={openLoadModal}>Load</button>
        <button className={btnBase} style={btnStyle} onClick={handleExportJson}>Export</button>
        <button className={btnBase} style={btnStyle} onClick={handleImportJson}>Import</button>

        <div className="w-px h-4 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />

        {/* Share / Join */}
        {mode === "local" ? (
          <>
            <button className={btnBase} style={{ ...btnStyle, background: "rgba(80,160,255,0.15)", borderColor: "rgba(80,160,255,0.3)" }} onClick={openShareModal}>Share</button>
            <button className={btnBase} style={btnStyle} onClick={openJoinModal}>Join</button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(80,160,255,0.15)", color: "rgba(80,160,255,0.9)", border: "1px solid rgba(80,160,255,0.3)" }}>Room: {roomId}</span>
            {roomUsers.map((u) => (
              <span key={u.name} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: u.color + "22", color: u.color, border: `1px solid ${u.color}44` }}>{u.name}</span>
            ))}
            <button className={btnBase} style={{ ...btnStyle, color: "#e55" }} onClick={leaveRoom}>Leave</button>
          </div>
        )}

        <div className="flex-1" />
        <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{items.length} items</span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden select-none outline-none" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: `${ds}px ${ds}px`, backgroundPosition: `${panX}px ${panY}px`, cursor: grabbing ? "grabbing" : "default" }} onWheel={handleWheel} onMouseDown={(e) => handleMouseDown(e)} onContextMenu={handleContextMenu} tabIndex={0} onMouseMove={mode === "shared" ? (e) => { const w = screenToWorld(e.clientX, e.clientY); sendCursor(w.wx, w.wy); } : undefined}>
        {/* World-space container */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`, pointerEvents: "none" }}>
          {sortedItems.map((item) => {
            const isSel = selection.has(item.id);
            return (
              <div key={item.id} style={{ position: "absolute", left: item.x, top: item.y, width: item.w, height: item.h, pointerEvents: "auto", outline: isSel ? "2px dashed rgba(80,160,255,0.9)" : "none", outlineOffset: 2, boxShadow: isSel ? "0 0 12px rgba(80,160,255,0.25)" : "none", cursor: grabbing ? "grabbing" : "grab" }}
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, item); }}
                onDoubleClick={() => { if (item.type === "text") setEditingText(item.id); }}>
                {item.type === "image" && <img src={item.content} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", border: item.borderWidth ? `${item.borderWidth}px solid ${item.borderColor || "#888"}` : "none" }} />}
                {item.type === "text" && (editingText === item.id
                  ? <textarea autoFocus defaultValue={item.content} onBlur={(e) => { updateItem(item.id, { content: e.target.value }); setEditingText(null); }} onKeyDown={(e) => { if (e.key === "Escape") setEditingText(null); }} onMouseDown={(e) => e.stopPropagation()} className="w-full h-full resize-none outline-none p-1" style={{ background: "rgba(0,0,0,0.4)", color: item.fontColor || "#fff", fontSize: item.fontSize || 16, border: "1px solid rgba(80,160,255,0.5)" }} />
                  : <div style={{ width: "100%", height: "100%", color: item.fontColor || "#fff", fontSize: item.fontSize || 16, padding: 4, overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.content}</div>)}
                {item.type === "frame" && <div style={{ width: "100%", height: "100%", border: `${item.borderWidth || 2}px solid ${item.borderColor || "rgba(255,255,255,0.35)"}`, borderRadius: 4 }} />}
                {isSel && <div style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, background: "rgba(80,160,255,0.9)", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 2, cursor: "nwse-resize", pointerEvents: "auto" }} onMouseDown={(e) => handleResizeStart(e, item)} />}
              </div>
            );
          })}

          {/* Remote cursors (smoothly interpolated via expDecay) */}
          {smoothCursors.map((c) => (
            <div key={c.name} style={{ position: "absolute", left: c.x, top: c.y, pointerEvents: "none", opacity: c.opacity, zIndex: 999999 }}>
              <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.5))` }}>
                <path d="M0 0L16 12L8 12L4 20L0 0Z" fill={c.color} />
              </svg>
              <span className="text-[9px] font-medium px-1 py-0.5 rounded whitespace-nowrap" style={{ position: "absolute", left: 14, top: 12, background: c.color, color: "#fff" }}>{c.name}</span>
            </div>
          ))}
        </div>

        {/* Marquee selection rectangle */}
        {marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2 && <div style={{ position: "fixed", left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height, background: "rgba(80,160,255,0.12)", border: "1px solid rgba(80,160,255,0.5)", pointerEvents: "none", zIndex: 9990 }} />}

        {/* Info bar */}
        <div className="absolute bottom-2 left-3 flex items-center gap-2 px-2.5 py-1 rounded-md pointer-events-none" style={{ background: "rgba(0,0,0,0.5)", zIndex: 10 }}>
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{Math.round(zoom * 100)}%</span>
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{items.length} item{items.length !== 1 ? "s" : ""}{selection.size > 0 ? ` \u00b7 ${selection.size} selected` : ""}</span>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="fixed z-[9999] py-1 rounded-md shadow-lg min-w-[180px]" style={{ left: ctxMenu.x, top: ctxMenu.y, background: "var(--color-card, #2f2f2f)", border: "1px solid var(--color-border, rgba(255,255,255,0.12))" }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {ctxMenu.items.map((mi, idx) => mi.separator && !mi.label ? <div key={idx} className="my-1 h-px" style={{ background: "var(--color-border, rgba(255,255,255,0.1))" }} /> : (
            <button key={idx} onClick={() => mi.action()} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors cursor-pointer" style={{ background: "transparent", border: "none", color: mi.danger ? "#e55" : "var(--color-text-primary, #ddd)" }} onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>{mi.label}</button>
          ))}
        </div>
      )}

      {/* Style Library modal */}
      {styleLibModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setStyleLibModal(null)}>
          <div className="rounded-lg shadow-xl p-5 flex flex-col gap-3" style={{ background: "var(--color-card, #2a2a2a)", border: "1px solid var(--color-border)", width: 380, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>Add {styleLibModal.imageIds.length} Image{styleLibModal.imageIds.length > 1 ? "s" : ""} to Style Library</div>
            {slFolders.length > 0 && <div className="space-y-1"><label className="text-[10px] font-medium block" style={{ color: "var(--color-text-muted)" }}>Existing Folder</label><div className="max-h-[140px] overflow-y-auto space-y-0.5">{slFolders.map((f) => <button key={f.name} onClick={() => handleAddToStyleLib(f.name)} className="w-full text-left px-2.5 py-1.5 text-[12px] rounded transition-colors cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }} onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>{f.name} <span style={{ color: "var(--color-text-muted)" }}>({f.category})</span></button>)}</div></div>}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Create New Folder</label>
              <input className="w-full px-2 py-1.5 text-xs rounded mb-2" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Folder name\u2026" value={slNewName} onChange={(e) => setSlNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateStyleFolder(); }} autoFocus />
              <div className="flex items-center gap-3 mb-2">
                <label className="text-[11px] flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--color-text-primary)" }}><input type="radio" name="ab-sl-cat" checked={slCategory === "general"} onChange={() => setSlCategory("general")} /> General</label>
                <label className="text-[11px] flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--color-text-primary)" }}><input type="radio" name="ab-sl-cat" checked={slCategory === "ui"} onChange={() => setSlCategory("ui")} /> UI</label>
              </div>
              <button onClick={handleCreateStyleFolder} disabled={!slNewName.trim()} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>Create & Add</button>
            </div>
            <button onClick={() => setStyleLibModal(null)} className="text-[11px] cursor-pointer self-end" style={{ background: "transparent", color: "var(--color-text-muted)", border: "none" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Save / Load modal */}
      {saveLoadModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSaveLoadModal(null)}>
          <div className="rounded-lg shadow-xl p-5 flex flex-col gap-3" style={{ background: "var(--color-card, #2a2a2a)", border: "1px solid var(--color-border)", width: 400, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>{saveLoadModal === "save" ? "Save Board to Server" : "Load Board from Server"}</div>
            {saveLoadModal === "save" ? (
              <div className="space-y-2">
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Board name\u2026" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSaveBoard(); }} autoFocus />
                <button onClick={handleSaveBoard} disabled={!saveName.trim()} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>Save ({items.length} items)</button>
              </div>
            ) : (
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {savedBoards.length === 0 && <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>No saved boards found.</p>}
                {savedBoards.map((b) => (
                  <div key={b.name} className="flex items-center gap-2 px-2 py-1.5 rounded transition-colors group" onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.06)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>
                    <button className="flex-1 text-left text-[12px] cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }} onClick={() => handleLoadBoard(b.name)}>{b.name} <span style={{ color: "var(--color-text-muted)" }}>({b.item_count} items)</span></button>
                    <button className="text-[10px] opacity-0 group-hover:opacity-60 cursor-pointer" style={{ background: "transparent", border: "none", color: "#e55" }} onClick={() => handleDeleteSavedBoard(b.name)} title="Delete">{"\u2715"}</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setSaveLoadModal(null)} className="text-[11px] cursor-pointer self-end" style={{ background: "transparent", color: "var(--color-text-muted)", border: "none" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Share / Join modal */}
      {shareModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShareModal(null)}>
          <div className="rounded-lg shadow-xl p-5 flex flex-col gap-3" style={{ background: "var(--color-card, #2a2a2a)", border: "1px solid var(--color-border)", width: 400, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
            {shareModal === "share" ? (
              <>
                <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>Share Art Table</div>
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Room name\u2026" value={shareRoomName} onChange={(e) => setShareRoomName(e.target.value)} />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Your display name\u2026" value={shareUserName} onChange={(e) => setShareUserName(e.target.value)} autoFocus />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Password (optional)" value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} />
                <button onClick={handleCreateRoom} disabled={!shareUserName.trim()} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "rgba(80,160,255,0.9)", color: "#fff", border: "none" }}>Create Shared Room</button>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>Join Shared Art Table</div>
                <input className="w-full px-2 py-1.5 text-xs rounded font-mono tracking-widest" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Room code\u2026" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoFocus />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Your display name\u2026" value={joinUserName} onChange={(e) => setJoinUserName(e.target.value)} />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Password (if required)" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} />
                {activeRooms.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Active Rooms</label>
                    <div className="max-h-[120px] overflow-y-auto space-y-0.5">
                      {activeRooms.map((r) => (
                        <button key={r.code} className="w-full text-left px-2 py-1 text-[11px] rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }} onClick={() => setJoinCode(r.code)} onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.06)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>
                          <span className="font-mono" style={{ color: "rgba(80,160,255,0.9)" }}>{r.code}</span> {r.name} <span style={{ color: "var(--color-text-muted)" }}>({r.user_count} user{r.user_count !== 1 ? "s" : ""})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={handleJoinRoom} disabled={!joinCode.trim() || !joinUserName.trim()} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "rgba(80,160,255,0.9)", color: "#fff", border: "none" }}>Join Room</button>
              </>
            )}
            <button onClick={() => setShareModal(null)} className="text-[11px] cursor-pointer self-end" style={{ background: "transparent", color: "var(--color-text-muted)", border: "none" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
