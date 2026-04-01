import {
  useState, useCallback, useRef, useEffect, useMemo,
  type CSSProperties,
  type MouseEvent as RME,
} from "react";
import { useArtboard, type ArtboardItem } from "@/hooks/ArtboardContext";
import { useArtboardSync } from "@/hooks/useArtboardSync";
import { apiFetch } from "@/hooks/useApi";
import { useImageEnhance } from "@/hooks/useImageEnhance";
import { useToastContext } from "@/hooks/ToastContext";
import { expDecay } from "@/lib/easing";
import { AnnotationToolbar, AnnotationCanvas, type Annotation, type AnnotationType } from "./AnnotationLayer";

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
    viewportTouched, markViewportTouched, resetViewportTouched,
    mode, roomId, roomUsers, remoteCursors,
    joinRoom, leaveRoom,
  } = useArtboard();
  const { addToast } = useToastContext();
  const { send: wsSend, sendCursor, setCredentials } = useArtboardSync();
  const enhancer = useImageEnhance();
  const { zoom, panX, panY } = viewport;
  const worldRef = useRef<HTMLDivElement>(null);
  const dragAccumRef = useRef({ dx: 0, dy: 0 });
  const dragWsThrottleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeAccumRef = useRef({ w: 0, h: 0 });
  const cursorOverlayRef = useRef<HTMLDivElement>(null);

  const [annotationsByBoard, setAnnotationsByBoard] = useState<Record<string, Annotation[]>>({});
  const annotations = annotationsByBoard[activeBoardId] ?? [];
  const setAnnotations = useCallback(
    (next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
      setAnnotationsByBoard((prev) => {
        const cur = prev[activeBoardId] ?? [];
        const resolved = typeof next === "function" ? (next as (p: Annotation[]) => Annotation[])(cur) : next;
        return { ...prev, [activeBoardId]: resolved };
      });
    },
    [activeBoardId],
  );

  const [annotationTool, setAnnotationTool] = useState<AnnotationType | null>(null);
  const [annotationColor, setAnnotationColor] = useState("#ff4444");
  const [annotationLineWidth, setAnnotationLineWidth] = useState(3);
  const [annotationVisible, setAnnotationVisible] = useState(true);

  const annotationWorldPlacement = useMemo(() => {
    const PAD = 600;
    const MIN_W = 1200;
    const MIN_H = 1200;
    let minX = -MIN_W / 2;
    let maxX = MIN_W / 2;
    let minY = -MIN_H / 2;
    let maxY = MIN_H / 2;
    for (const it of items) {
      minX = Math.min(minX, it.x - PAD);
      minY = Math.min(minY, it.y - PAD);
      maxX = Math.max(maxX, it.x + it.w + PAD);
      maxY = Math.max(maxY, it.y + it.h + PAD);
    }
    for (const a of annotations) {
      for (const p of a.points) {
        minX = Math.min(minX, p.x - PAD);
        minY = Math.min(minY, p.y - PAD);
        maxX = Math.max(maxX, p.x + PAD);
        maxY = Math.max(maxY, p.y + PAD);
      }
      if (a.type === "text" && a.text && a.points.length >= 1) {
        const p = a.points[0];
        const fs = Math.max(14, a.lineWidth * 5);
        maxX = Math.max(maxX, p.x + a.text.length * fs * 0.55 + PAD);
        maxY = Math.max(maxY, p.y + PAD);
      }
    }
    const w = Math.max(MIN_W, maxX - minX);
    const h = Math.max(MIN_H, maxY - minY);
    return { x: minX, y: minY, width: w, height: h };
  }, [items, annotations]);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  const zoomTextRef = useRef<HTMLSpanElement>(null);
  const viewportCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  /** Apply viewport changes directly to the DOM — zero React re-renders. */
  const applyViewportDOM = useCallback((v: { zoom: number; panX: number; panY: number }) => {
    viewportRef.current = v;
    const wEl = worldRef.current;
    if (wEl) wEl.style.transform = `translate(-50%, -50%) translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
    const cEl = containerRef.current;
    if (cEl) {
      const d = DOT_SPACING * v.zoom;
      cEl.style.backgroundSize = `${d}px ${d}px`;
      cEl.style.backgroundPosition = `${v.panX}px ${v.panY}px`;
    }
    const zt = zoomTextRef.current;
    if (zt) zt.textContent = `${Math.round(v.zoom * 100)}%`;
  }, []);

  /** Sync viewportRef to React state (triggers one re-render for settled UI). */
  const commitViewport = useCallback(() => {
    setViewport(viewportRef.current);
  }, [setViewport]);

  /** Debounced commit for rapid-fire events like scroll wheel. */
  const scheduleViewportCommit = useCallback(() => {
    if (viewportCommitTimer.current) clearTimeout(viewportCommitTimer.current);
    viewportCommitTimer.current = setTimeout(() => { commitViewport(); viewportCommitTimer.current = null; }, 150);
  }, [commitViewport]);

  const [dragging, setDragging] = useState<{ ids: string[]; startX: number; startY: number; moved: boolean } | null>(null);
  const dragLastRef = useRef<{ x: number; y: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startY: number; origW: number; origH: number } | null>(null);
  const [marquee, setMarquee] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);

  // Crop tool state
  const [cropMode, setCropMode] = useState(false);
  const [cropTarget, setCropTarget] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [cropDrawing, setCropDrawing] = useState(false);
  const [styleLibModal, setStyleLibModal] = useState<{ imageIds: string[] } | null>(null);
  const [slFolders, setSlFolders] = useState<{ name: string; category: string }[]>([]);
  const [slNewName, setSlNewName] = useState("");
  const [slCategory, setSlCategory] = useState<"general" | "ui">("general");
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const middlePanRef = useRef({ lastX: 0, lastY: 0 });
  const middlePanCleanupRef = useRef<(() => void) | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const spacePanRef = useRef({ lastX: 0, lastY: 0 });

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
  const [joinRemoteHost, setJoinRemoteHost] = useState("");
  const [activeRooms, setActiveRooms] = useState<{ code: string; name: string; user_count: number; host: string }[]>([]);
  const [hostIpInfo, setHostIpInfo] = useState<{ ips: string[]; port: number } | null>(null);

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
  // Must use native event listener with { passive: false } so preventDefault() works.
  // React's onWheel is passive by default in modern browsers, silently ignoring preventDefault.
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewportRef.current;

      let next: { zoom: number; panX: number; panY: number };
      if (e.ctrlKey) {
        const cx = r.width / 2, cy = r.height / 2;
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const wx = (mx - cx - v.panX) / v.zoom, wy = (my - cy - v.panY) / v.zoom;
        const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const nz = Math.min(20, Math.max(0.05, v.zoom * f));
        next = { zoom: nz, panX: mx - cx - wx * nz, panY: my - cy - wy * nz };
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.deltaX !== 0 && !e.shiftKey)) {
        next = { zoom: v.zoom, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY };
      } else {
        const cx = r.width / 2, cy = r.height / 2;
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const wx = (mx - cx - v.panX) / v.zoom, wy = (my - cy - v.panY) / v.zoom;
        const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const nz = Math.min(20, Math.max(0.05, v.zoom * f));
        next = { zoom: nz, panX: mx - cx - wx * nz, panY: my - cy - wy * nz };
      }
      applyViewportDOM(next);
      scheduleViewportCommit();
      markViewportTouched();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyViewportDOM, scheduleViewportCommit, markViewportTouched]);

  // ---------------------------------------------------------------------------
  // Middle-mouse pan
  // ---------------------------------------------------------------------------
  const middlePanActiveRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;

    const applyPanSteps = (clientXs: number[], clientYs: number[]) => {
      let dx = 0;
      let dy = 0;
      let lx = middlePanRef.current.lastX;
      let ly = middlePanRef.current.lastY;
      for (let i = 0; i < clientXs.length; i++) {
        dx += clientXs[i]! - lx;
        dy += clientYs[i]! - ly;
        lx = clientXs[i]!;
        ly = clientYs[i]!;
      }
      middlePanRef.current = { lastX: lx, lastY: ly };
      if (dx === 0 && dy === 0) return;
      const v = viewportRef.current;
      applyViewportDOM({ zoom: v.zoom, panX: v.panX + dx, panY: v.panY + dy });
      markViewportTouched();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      middlePanCleanupRef.current?.();
      const pid = e.pointerId;
      middlePanRef.current = { lastX: e.clientX, lastY: e.clientY };
      middlePanActiveRef.current = true;
      setIsMiddlePanning(true);

      const onMove = (ev: PointerEvent) => {
        if (!middlePanActiveRef.current || ev.pointerId !== pid) return;
        const coalesced = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
        const xs: number[] = [];
        const ys: number[] = [];
        if (coalesced.length > 0) {
          for (const c of coalesced) {
            xs.push(c.clientX);
            ys.push(c.clientY);
          }
        } else {
          xs.push(ev.clientX);
          ys.push(ev.clientY);
        }
        applyPanSteps(xs, ys);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endPan);
        window.removeEventListener("pointercancel", endPan);
        middlePanCleanupRef.current = null;
      };

      const endPan = (ev: PointerEvent) => {
        if (ev.type === "pointerup" && ev.pointerId !== pid) return;
        if (!middlePanActiveRef.current) return;
        middlePanActiveRef.current = false;
        setIsMiddlePanning(false);
        commitViewport();
        cleanup();
      };

      middlePanCleanupRef.current = cleanup;
      // Attach immediately so the first pointer moves after mousedown are not dropped (React effect delay caused chunky jumps).
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endPan);
      window.addEventListener("pointercancel", endPan);
    };

    // Prevent the browser's native auto-scroll on middle-click
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) { e.preventDefault(); }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("mousedown", onMouseDown);
    return () => {
      middlePanCleanupRef.current?.();
      middlePanActiveRef.current = false;
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("mousedown", onMouseDown);
    };
  }, [applyViewportDOM, commitViewport, markViewportTouched]);

  // ---------------------------------------------------------------------------
  // Space + drag pan (hold Space, then left-click drag to pan)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement) && !(e.target as HTMLElement)?.isContentEditable) {
        e.preventDefault();
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
        setSpacePanning(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  useEffect(() => {
    if (!spacePanning) return;
    const onMove = (e: MouseEvent) => {
      const last = spacePanRef.current;
      const v = viewportRef.current;
      applyViewportDOM({ zoom: v.zoom, panX: v.panX + e.clientX - last.lastX, panY: v.panY + e.clientY - last.lastY });
      spacePanRef.current = { lastX: e.clientX, lastY: e.clientY };
      markViewportTouched();
    };
    const onUp = () => { commitViewport(); setSpacePanning(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [spacePanning, applyViewportDOM, commitViewport, markViewportTouched]);

  // ---------------------------------------------------------------------------
  // Fit viewport to show all items
  // ---------------------------------------------------------------------------
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const fitToExtents = useCallback(() => {
    const cur = itemsRef.current;
    if (cur.length === 0) { const v = { zoom: 1, panX: 0, panY: 0 }; applyViewportDOM(v); setViewport(v); return; }
    const el = containerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of cur) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + (it.w || 100));
      maxY = Math.max(maxY, it.y + (it.h || 100));
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw <= 0 || bh <= 0) return;

    const PAD = 60;
    const scaleX = (r.width - PAD * 2) / bw;
    const scaleY = (r.height - PAD * 2) / bh;
    const nz = Math.min(scaleX, scaleY, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const v = { zoom: nz, panX: -cx * nz, panY: -cy * nz };
    applyViewportDOM(v);
    setViewport(v);
  }, [applyViewportDOM, setViewport]);

  // Auto-fit only on first visit; subsequent visits restore the previous viewport
  useEffect(() => {
    if (!viewportTouched) requestAnimationFrame(() => fitToExtents());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------
  const screenToWorld = useCallback((cX: number, cY: number) => {
    const el = containerRef.current; if (!el) return { wx: 0, wy: 0 };
    const r = el.getBoundingClientRect();
    const v = viewportRef.current;
    return { wx: (cX - r.left - r.width / 2 - v.panX) / v.zoom, wy: (cY - r.top - r.height / 2 - v.panY) / v.zoom };
  }, []);

  const sortedItemsDesc = useMemo(() => [...items].sort((a, b) => b.zIndex - a.zIndex), [items]);

  const hitTest = useCallback((wx: number, wy: number): ArtboardItem | null => {
    for (const it of sortedItemsDesc)
      if (wx >= it.x && wx <= it.x + it.w && wy >= it.y && wy <= it.y + it.h) return it;
    return null;
  }, [sortedItemsDesc]);

  // ---------------------------------------------------------------------------
  // Mouse handlers (drag items / marquee select)
  // ---------------------------------------------------------------------------
  // Crop apply: uses canvas to crop the image content
  const applyCrop = useCallback(() => {
    if (!cropTarget || !cropRect) return;
    const item = items.find((i) => i.id === cropTarget);
    if (!item || item.type !== "image") { setCropMode(false); setCropTarget(null); setCropRect(null); setCropDrawing(false); return; }
    const x1 = Math.min(cropRect.sx, cropRect.cx), y1 = Math.min(cropRect.sy, cropRect.cy);
    const x2 = Math.max(cropRect.sx, cropRect.cx), y2 = Math.max(cropRect.sy, cropRect.cy);
    const cw = x2 - x1, ch = y2 - y1;
    if (cw < 5 || ch < 5) { setCropMode(false); setCropTarget(null); setCropRect(null); setCropDrawing(false); return; }
    const img = new Image();
    img.onload = () => {
      const scaleX = img.naturalWidth / item.w, scaleY = img.naturalHeight / item.h;
      const sx = (x1 - item.x) * scaleX, sy = (y1 - item.y) * scaleY;
      const sw = cw * scaleX, sh = ch * scaleY;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw); canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, canvas.width, canvas.height);
      const cropped = canvas.toDataURL("image/png");
      updateItem(cropTarget, { content: cropped, x: x1, y: y1, w: cw, h: ch });
      setCropMode(false); setCropTarget(null); setCropRect(null); setCropDrawing(false);
    };
    img.src = item.content;
  }, [cropTarget, cropRect, items, updateItem]);

  const cancelCrop = useCallback(() => { setCropMode(false); setCropTarget(null); setCropRect(null); setCropDrawing(false); }, []);

  const handleMouseDown = useCallback((e: RME, directItem?: ArtboardItem) => {
    if (e.button !== 0 || editingText) return;
    if (annotationTool && annotationVisible) return;
    setCtxMenu(null);

    // Space+drag pan: left-click while space held → pan
    if (spaceHeldRef.current) {
      e.preventDefault();
      spacePanRef.current = { lastX: e.clientX, lastY: e.clientY };
      setSpacePanning(true);
      return;
    }

    // Crop mode: clicking on an image starts the crop rectangle
    // If a crop rect is already drawn (waiting for confirm/cancel), ignore new clicks
    if (cropMode) {
      if (cropRect && !cropDrawing) return;
      const w = screenToWorld(e.clientX, e.clientY);
      const hit = directItem ?? hitTest(w.wx, w.wy);
      if (hit && hit.type === "image") {
        setCropTarget(hit.id);
        setCropRect({ sx: w.wx, sy: w.wy, cx: w.wx, cy: w.wy });
        setCropDrawing(true);
      }
      return;
    }

    const w = screenToWorld(e.clientX, e.clientY);
    const hit = directItem ?? hitTest(w.wx, w.wy);
    if (hit) {
      let next = new Set(selection);
      if (e.shiftKey) { if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id); setSelection(next); }
      else if (!next.has(hit.id)) { next = new Set([hit.id]); setSelection(next); }
      setDragging({ ids: [...next], startX: e.clientX, startY: e.clientY, moved: false });
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      dragAccumRef.current = { dx: 0, dy: 0 };
    } else {
      if (!e.shiftKey) clearSelection();
      setMarquee({ sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY });
    }
  }, [screenToWorld, hitTest, selection, setSelection, clearSelection, editingText, annotationTool, annotationVisible, cropMode, cropRect, cropDrawing]);

  const handleMouseMove = useCallback((e: RME | MouseEvent) => {
    if (cropMode && cropDrawing && cropRect) {
      const w = screenToWorld(e.clientX, e.clientY);
      setCropRect((prev) => prev ? { ...prev, cx: w.wx, cy: w.wy } : null);
      return;
    }
    if (dragging) {
      const last = dragLastRef.current; if (!last) return;
      if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) <= DRAG_THRESHOLD) return;
      if (!dragging.moved) {
        setDragging((d) => d ? { ...d, moved: true } : null);
        dragLastRef.current = { x: e.clientX, y: e.clientY };
        if (!dragWsThrottleRef.current && mode === "shared") {
          const ids = dragging.ids;
          let sentDx = 0, sentDy = 0;
          dragWsThrottleRef.current = setInterval(() => {
            const { dx, dy } = dragAccumRef.current;
            const ddx = dx - sentDx, ddy = dy - sentDy;
            if (ddx !== 0 || ddy !== 0) {
              wsSend({ op: "delta", type: "move", ids, dx: ddx, dy: ddy });
              sentDx = dx; sentDy = dy;
            }
          }, 33);
        }
        return;
      }
      const z = viewportRef.current.zoom;
      const ddx = (e.clientX - last.x) / z;
      const ddy = (e.clientY - last.y) / z;
      dragAccumRef.current.dx += ddx;
      dragAccumRef.current.dy += ddy;
      const wEl = worldRef.current;
      if (wEl) {
        for (const id of dragging.ids) {
          const el = wEl.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null;
          if (el) el.style.translate = `${dragAccumRef.current.dx}px ${dragAccumRef.current.dy}px`;
        }
      }
      dragLastRef.current = { x: e.clientX, y: e.clientY };
    } else if (marquee) { setMarquee((m) => m ? { ...m, cx: e.clientX, cy: e.clientY } : null); }
    else if (resizing) {
      const z = viewportRef.current.zoom;
      const nw = Math.max(20, resizing.origW + (e.clientX - resizing.startX) / z);
      const nh = Math.max(20, resizing.origH + (e.clientY - resizing.startY) / z);
      resizeAccumRef.current = { w: nw, h: nh };
      const wEl = worldRef.current;
      if (wEl) {
        const el = wEl.querySelector(`[data-item-id="${resizing.id}"]`) as HTMLElement | null;
        if (el) { el.style.width = `${nw}px`; el.style.height = `${nh}px`; }
      }
    }
  }, [dragging, marquee, resizing, cropMode, cropDrawing, cropRect, screenToWorld, mode, wsSend]);

  const handleMouseUp = useCallback((e: RME | MouseEvent) => {
    if (e.button !== 0) return;
    if (cropDrawing) { setCropDrawing(false); return; }
    if (dragging) {
      if (dragWsThrottleRef.current) { clearInterval(dragWsThrottleRef.current); dragWsThrottleRef.current = null; }
      if (!dragging.moved && dragging.ids.length === 1) setSelection(new Set([dragging.ids[0]]));
      const { dx, dy } = dragAccumRef.current;
      if (dx !== 0 || dy !== 0) moveItems(dragging.ids, dx, dy);
      const wEl = worldRef.current;
      if (wEl) {
        for (const id of dragging.ids) {
          const el = wEl.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null;
          if (el) el.style.translate = "";
        }
      }
      dragAccumRef.current = { dx: 0, dy: 0 };
    }
    if (resizing) {
      const { w, h } = resizeAccumRef.current;
      if (w > 0 && h > 0) resizeItem(resizing.id, w, h);
      const wEl = worldRef.current;
      if (wEl) {
        const el = wEl.querySelector(`[data-item-id="${resizing.id}"]`) as HTMLElement | null;
        if (el) { el.style.width = ""; el.style.height = ""; }
      }
      resizeAccumRef.current = { w: 0, h: 0 };
    }
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
  }, [cropDrawing, dragging, marquee, resizing, items, selection, screenToWorld, setSelection, moveItems, resizeItem]);

  useEffect(() => {
    if (!dragging && !marquee && !resizing && !cropDrawing) return;
    const mv = (e: MouseEvent) => handleMouseMove(e);
    const up = (e: MouseEvent) => handleMouseUp(e);
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [dragging, marquee, resizing, cropDrawing, handleMouseMove, handleMouseUp]);

  const handleResizeStart = useCallback((e: RME, item: ArtboardItem) => {
    e.stopPropagation(); e.preventDefault();
    setResizing({ id: item.id, startX: e.clientX, startY: e.clientY, origW: item.w, origH: item.h });
    resizeAccumRef.current = { w: item.w, h: item.h };
  }, []);

  // ---------------------------------------------------------------------------
  // Image ingestion helper
  // ---------------------------------------------------------------------------
  const ingestImage = useCallback((dataUrl: string, wx: number, wy: number) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      addItem({ type: "image", x: wx - w / 2, y: wy - h / 2, w, h, rotation: 0, content: dataUrl });
    };
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
      setAnnotations([]);
      addToast(`Loaded "${name}"`, "success");
      setSaveLoadModal(null);
    } catch { addToast("Load failed", "error"); }
  }, [loadItemsDirectly, addToast, setAnnotations]);

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
      try { setHostIpInfo(await apiFetch<{ ips: string[]; port: number }>("/artboard/my-ip")); } catch { /* */ }
    } catch { addToast("Failed to create room", "error"); }
  }, [shareUserName, shareRoomName, sharePassword, items, joinRoom, addToast, setCredentials]);

  const handleJoinRoom = useCallback(() => {
    if (!joinCode.trim() || !joinUserName.trim()) return;
    setCredentials(joinUserName.trim(), joinPassword || undefined);
    const rh = joinRemoteHost.trim() || undefined;
    joinRoom(joinCode.trim().toUpperCase(), joinUserName.trim(), joinPassword || undefined, rh);
    setShareModal(null);
  }, [joinCode, joinUserName, joinPassword, joinRemoteHost, joinRoom, setCredentials]);

  const openShareModal = useCallback(async () => {
    setShareModal("share");
    setShareRoomName(activeBoard?.name || "");
    setSharePassword("");
    setShareUserName("");
  }, [activeBoard]);

  const openJoinModal = useCallback(async () => {
    setShareModal("join");
    setJoinCode(""); setJoinPassword(""); setJoinUserName(""); setJoinRemoteHost("");
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
          if (Array.isArray(parsed)) { loadItemsDirectly(parsed); setAnnotations([]); addToast("Imported", "success"); }
        } catch { addToast("Invalid JSON file", "error"); }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadItemsDirectly, addToast, setAnnotations]);

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------
  const handleContextMenu = useCallback((e: RME) => {
    e.preventDefault(); e.stopPropagation();
    if (annotationTool && annotationVisible) return;
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
      if (imgIds.length > 0) {
        mi.push({ label: "Add to Style Library\u2026", action: () => { setCtxMenu(null); openStyleLibModal(imgIds); }, separator: true });
        mi.push({
          label: enhancer.busy ? "AI Upres (processing\u2026)" : "AI Upres",
          separator: true,
          action: () => {
            setCtxMenu(null);
            if (enhancer.busy) return;
            (async () => {
              for (const id of imgIds) {
                const item = items.find((i) => i.id === id);
                if (!item) continue;
                const result = await enhancer.enhance("upscale", item.content);
                if (result) {
                  const img = new Image();
                  img.onload = () => updateItem(id, { content: result, w: img.naturalWidth, h: img.naturalHeight });
                  img.src = result;
                }
              }
              addToast("AI Upres complete", "success");
            })();
          },
        });
        mi.push({
          label: enhancer.busy ? "AI Restore (processing\u2026)" : "AI Restore",
          action: () => {
            setCtxMenu(null);
            if (enhancer.busy) return;
            (async () => {
              for (const id of imgIds) {
                const item = items.find((i) => i.id === id);
                if (!item) continue;
                const result = await enhancer.enhance("restore", item.content);
                if (result) updateItem(id, { content: result });
              }
              addToast("AI Restore complete", "success");
            })();
          },
        });
      }
      setCtxMenu({ x: e.clientX, y: e.clientY, items: mi });
    } else {
      const mi: CtxMenuItem[] = [
        { label: "Paste Image", action: () => { setCtxMenu(null); doPaste(w.wx, w.wy); } },
        { label: "Add Text", action: () => { setCtxMenu(null); addItem({ type: "text", x: w.wx - 100, y: w.wy - 20, w: 200, h: 40, rotation: 0, content: "Text", fontSize: 16, fontColor: "#ffffff" }); } },
        { label: "Add Frame", action: () => { setCtxMenu(null); addItem({ type: "frame", x: w.wx - 150, y: w.wy - 100, w: 300, h: 200, rotation: 0, content: "", borderColor: "rgba(255,255,255,0.5)", borderWidth: 2 }); } },
      ];
      if (items.length > 0) mi.push({ label: "Clear Board", action: () => { setCtxMenu(null); clearBoard(); setAnnotations([]); }, danger: true, separator: true });
      setCtxMenu({ x: e.clientX, y: e.clientY, items: mi });
    }
  }, [screenToWorld, hitTest, selection, items, setSelection, removeItems, bringToFront, sendToBack, addItem, clearBoard, doCopy, doPaste, openStyleLibModal, enhancer, updateItem, addToast, setAnnotations, annotationTool, annotationVisible]);

  useEffect(() => { const d = () => setCtxMenu(null); window.addEventListener("click", d); return () => window.removeEventListener("click", d); }, []);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) { e.preventDefault(); e.stopPropagation(); removeItems([...selection]); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "a") { e.preventDefault(); e.stopPropagation(); selectAll(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "c") { e.preventDefault(); e.stopPropagation(); doCopy(); }
      else if (e.key === "Escape") { e.stopPropagation(); clearSelection(); setEditingText(null); setAnnotationTool(null); cancelCrop(); }
      else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); fitToExtents(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selection, removeItems, undo, redo, selectAll, clearSelection, doCopy, fitToExtents]);

  // Native paste event for direct image paste from clipboard
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || !e.clipboardData) return;
      for (const it of Array.from(e.clipboardData.items)) {
        if (it.type.startsWith("image/")) {
          e.preventDefault(); const f = it.getAsFile(); if (!f) continue;
          let tx = 0, ty = 0;
          const el = containerRef.current;
          if (el) { const rect = el.getBoundingClientRect(); const c = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2); tx = c.wx; ty = c.wy; }
          const r = new FileReader();
          r.onload = () => ingestImage(String(r.result), tx, ty);
          r.readAsDataURL(f); return;
        }
      }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [ingestImage, screenToWorld]);

  // ---------------------------------------------------------------------------
  // Derived render state
  // ---------------------------------------------------------------------------
  const ds = DOT_SPACING * zoom;
  const marqueeRect = marquee ? { left: Math.min(marquee.sx, marquee.cx), top: Math.min(marquee.sy, marquee.cy), width: Math.abs(marquee.cx - marquee.sx), height: Math.abs(marquee.cy - marquee.sy) } : null;
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.zIndex - b.zIndex), [items]);
  const grabbing = Boolean(dragging?.moved || isMiddlePanning || spacePanning);

  // Remote cursors -- smooth interpolation via requestAnimationFrame (DOM-only, no React state)
  const smoothCursorsRef = useRef<Map<string, { x: number; y: number; tx: number; ty: number; color: string; name: string; lastUpdate: number }>>(new Map());

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

  // Animation loop for smooth cursor movement — direct DOM manipulation (no React setState)
  useEffect(() => {
    if (mode !== "shared") return;
    let prevTime = performance.now();
    let rafId = 0;
    const tick = (time: number) => {
      const dt = Math.min((time - prevTime) / 1000, 0.1);
      prevTime = time;
      const now = Date.now();
      const overlay = cursorOverlayRef.current;
      if (overlay) {
        let idx = 0;
        smoothCursorsRef.current.forEach((c) => {
          c.x = expDecay(c.x, c.tx, CURSOR_SMOOTH_HALFLIFE, dt);
          c.y = expDecay(c.y, c.ty, CURSOR_SMOOTH_HALFLIFE, dt);
          const age = now - c.lastUpdate;
          if (age < CURSOR_FADE_MS) {
            const opacity = age > CURSOR_FADE_MS - 1000 ? (CURSOR_FADE_MS - age) / 1000 : 1;
            let el = overlay.children[idx] as HTMLDivElement | undefined;
            if (!el) {
              el = document.createElement("div");
              el.style.cssText = "position:absolute;pointer-events:none;z-index:999999;";
              el.innerHTML = '<svg width="16" height="20" viewBox="0 0 16 20" fill="none" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))"><path d="M0 0L16 12L8 12L4 20L0 0Z"/></svg><span style="position:absolute;left:14px;top:12px;font-size:9px;font-weight:500;padding:0 4px 1px;border-radius:3px;white-space:nowrap;color:#fff"></span>';
              overlay.appendChild(el);
            }
            el.style.left = c.x + "px";
            el.style.top = c.y + "px";
            el.style.opacity = String(opacity);
            el.style.display = "";
            const path = el.querySelector("path");
            if (path) path.setAttribute("fill", c.color);
            const span = el.querySelector("span") as HTMLElement | null;
            if (span) { span.style.background = c.color; span.textContent = c.name; }
            idx++;
          }
        });
        for (let i = idx; i < overlay.children.length; i++) {
          (overlay.children[i] as HTMLElement).style.display = "none";
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  const tbBtn = "p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]";
  const tbStyle: CSSProperties = { background: "transparent", border: "none", color: "var(--color-text-secondary)" };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-full w-full flex flex-col" style={{ background: "#2a2a2a" }}>
      {/* Top bar: board switcher + actions */}
      <div className="flex items-center gap-1 px-2 py-1 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        {/* Board dropdown */}
        <div className="relative" ref={boardDropRef}>
          <button className="flex items-center gap-1 px-1.5 py-1 text-[11px] rounded cursor-pointer transition-colors hover:bg-[var(--color-hover)]" style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }} onClick={() => setBoardDropdownOpen((p) => !p)}>
            {activeBoard?.name || "Board"} <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{"\u25BE"}</span>
          </button>
          {boardDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-[9999] py-1 rounded-md shadow-lg min-w-[200px]" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
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
              <div className="mx-2 my-1 h-px" style={{ background: "var(--color-border)" }} />
              <button className="w-full text-left px-2 py-1 text-[11px] cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }} onClick={() => { const id = createBoard("New Board"); switchBoard(id); setBoardDropdownOpen(false); }} onMouseEnter={(e) => { (e.currentTarget).style.background = "rgba(255,255,255,0.06)"; }} onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}>+ New Board</button>
            </div>
          )}
        </div>

        <span className="w-px h-4 mx-0.5" style={{ background: "var(--color-border)" }} />

        <button className={tbBtn} style={tbStyle} onClick={openSaveModal} title="Save board to server">
          <span className="text-[11px]">Save</span>
        </button>
        <button className={tbBtn} style={tbStyle} onClick={openLoadModal} title="Load board from server">
          <span className="text-[11px]">Load</span>
        </button>
        <button className={tbBtn} style={tbStyle} onClick={handleExportJson} title="Export board as JSON">
          <span className="text-[11px]">Export</span>
        </button>
        <button className={tbBtn} style={tbStyle} onClick={handleImportJson} title="Import board from JSON">
          <span className="text-[11px]">Import</span>
        </button>

        <span className="w-px h-4 mx-0.5" style={{ background: "var(--color-border)" }} />

        {mode === "local" ? (
          <>
            <button className={tbBtn} style={tbStyle} onClick={openShareModal} title="Share this board with others">
              <span className="text-[11px]">Share</span>
            </button>
            <button className={tbBtn} style={tbStyle} onClick={openJoinModal} title="Join a shared board">
              <span className="text-[11px]">Join</span>
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(80,160,255,0.1)", color: "rgba(80,160,255,0.8)", border: "1px solid rgba(80,160,255,0.2)" }}>Room: {roomId}</span>
            {roomUsers.map((u) => (
              <span key={u.name} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: u.color + "18", color: u.color, border: `1px solid ${u.color}33` }}>{u.name}</span>
            ))}
            <button className={tbBtn} style={{ ...tbStyle, color: "#e55" }} onClick={leaveRoom} title="Leave the shared room">
              <span className="text-[11px]">Leave</span>
            </button>
          </div>
        )}

        <span className="w-px h-4 mx-0.5" style={{ background: "var(--color-border)" }} />
        <button
          className={tbBtn}
          style={{ ...tbStyle, ...(cropMode ? { background: "rgba(80,160,255,0.15)", color: "rgba(80,160,255,0.9)", border: "1px solid rgba(80,160,255,0.3)" } : {}) }}
          onClick={() => { if (cropMode) cancelCrop(); else { setCropMode(true); clearSelection(); setAnnotationTool(null); } }}
          title={cropMode ? "Cancel crop mode" : "Crop tool — click and drag on an image to crop it"}
        >
          <span className="text-[11px]">{cropMode ? "✂ Cancel" : "✂ Crop"}</span>
        </button>

        <div className="flex-1" />
        <span className="text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>{items.length} items</span>
      </div>

      <AnnotationToolbar
        annotations={annotations}
        onAnnotationsChange={setAnnotations}
        activeTool={annotationTool}
        onToolChange={setAnnotationTool}
        visible={annotationVisible}
        onVisibilityChange={setAnnotationVisible}
        color={annotationColor}
        onColorChange={setAnnotationColor}
        lineWidth={annotationLineWidth}
        onLineWidthChange={setAnnotationLineWidth}
      />
      {annotationTool !== null && (
        <div className="flex items-center gap-1.5 px-2 py-1 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Stroke</span>
          <input
            type="range"
            min={1}
            max={20}
            value={annotationLineWidth}
            onChange={(e) => setAnnotationLineWidth(Number(e.target.value))}
            className="w-24 h-3"
          />
          <span className="text-[10px] w-6 text-center tabular-nums" style={{ color: "var(--color-text-muted)" }}>{annotationLineWidth}</span>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden select-none outline-none" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: `${ds}px ${ds}px`, backgroundPosition: `${panX}px ${panY}px`, cursor: spacePanning || isMiddlePanning ? "grabbing" : spaceHeld ? "grab" : grabbing ? "grabbing" : cropMode ? "crosshair" : annotationTool && annotationVisible ? "crosshair" : "default" }} onMouseDown={(e) => handleMouseDown(e)} onContextMenu={handleContextMenu} tabIndex={0} onMouseMove={mode === "shared" ? (e) => { const w = screenToWorld(e.clientX, e.clientY); sendCursor(w.wx, w.wy); } : undefined}>
        {/* World-space container */}
        <div ref={worldRef} style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`, pointerEvents: "none" }}>
          {sortedItems.map((item) => {
            const isSel = selection.has(item.id);
            return (
              <div key={item.id} data-item-id={item.id} style={{ position: "absolute", left: item.x, top: item.y, width: item.w, height: item.h, pointerEvents: "auto", outline: isSel ? "2px dashed rgba(80,160,255,0.9)" : "none", outlineOffset: 2, boxShadow: isSel ? "0 0 12px rgba(80,160,255,0.25)" : "none", cursor: grabbing ? "grabbing" : "grab" }}
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, item); }}
                onDoubleClick={() => { if (item.type === "text") setEditingText(item.id); }}>
                {item.type === "image" && (
                  <div className="relative" style={{ width: "100%", height: "100%" }}>
                    <img src={item.content} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", border: item.borderWidth ? `${item.borderWidth}px solid ${item.borderColor || "#888"}` : "none" }} />
                    <span
                      className="text-[10px] font-mono pointer-events-none leading-none whitespace-nowrap"
                      style={{ position: "absolute", left: 4, bottom: 4, color: "rgba(255,255,255,0.4)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                    >
                      {Math.round(item.w)} x {Math.round(item.h)}
                    </span>
                  </div>
                )}
                {item.type === "text" && (editingText === item.id
                  ? <textarea autoFocus defaultValue={item.content} onBlur={(e) => { updateItem(item.id, { content: e.target.value }); setEditingText(null); }} onKeyDown={(e) => { if (e.key === "Escape") setEditingText(null); }} onMouseDown={(e) => e.stopPropagation()} className="w-full h-full resize-none outline-none p-1" style={{ background: "rgba(0,0,0,0.4)", color: item.fontColor || "#fff", fontSize: item.fontSize || 16, border: "1px solid rgba(80,160,255,0.5)" }} />
                  : <div style={{ width: "100%", height: "100%", color: item.fontColor || "#fff", fontSize: item.fontSize || 16, padding: 4, overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.content}</div>)}
                {item.type === "frame" && <div style={{ width: "100%", height: "100%", border: `${item.borderWidth || 2}px solid ${item.borderColor || "rgba(255,255,255,0.35)"}`, borderRadius: 4 }} />}
                {isSel && <div style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, background: "rgba(80,160,255,0.9)", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 2, cursor: "nwse-resize", pointerEvents: "auto" }} onMouseDown={(e) => handleResizeStart(e, item)} />}
              </div>
            );
          })}

          <AnnotationCanvas
            width={annotationWorldPlacement.width}
            height={annotationWorldPlacement.height}
            worldPlacement={annotationWorldPlacement}
            zoom={zoom}
            visible={annotationVisible}
            annotations={annotations}
            onAnnotationsChange={setAnnotations}
            activeTool={annotationTool}
            color={annotationColor}
            lineWidth={annotationLineWidth}
          />

          {/* Remote cursors — DOM-managed by RAF loop via cursorOverlayRef */}
          <div ref={cursorOverlayRef} />
        </div>

        {/* Marquee selection rectangle */}
        {marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2 && <div style={{ position: "fixed", left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height, background: "rgba(80,160,255,0.12)", border: "1px solid rgba(80,160,255,0.5)", pointerEvents: "none", zIndex: 9990 }} />}

        {/* Crop overlay */}
        {cropMode && cropTarget && cropRect && (() => {
          const x1 = Math.min(cropRect.sx, cropRect.cx), y1 = Math.min(cropRect.sy, cropRect.cy);
          const x2 = Math.max(cropRect.sx, cropRect.cx), y2 = Math.max(cropRect.sy, cropRect.cy);
          const cw = x2 - x1, ch = y2 - y1;
          if (cw < 2 || ch < 2) return null;
          const el = containerRef.current;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cx = r.width / 2, cy = r.height / 2;
          const left = cx + panX + x1 * zoom;
          const top = cy + panY + y1 * zoom;
          const w = cw * zoom;
          const h = ch * zoom;
          return (
            <>
              <div style={{ position: "absolute", left, top, width: w, height: h, border: "2px dashed rgba(255,200,0,0.9)", background: "rgba(255,200,0,0.08)", pointerEvents: "none", zIndex: 9991 }} />
              <div className="flex items-center gap-1" style={{ position: "absolute", left: left + w / 2 - 60, top: top + h + 8, zIndex: 9992 }}>
                <button
                  className="px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
                  style={{ background: "rgba(255,200,0,0.9)", border: "none", color: "#222" }}
                  onClick={applyCrop}
                >Crop</button>
                <button
                  className="px-2.5 py-1 text-[11px] rounded cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)" }}
                  onClick={cancelCrop}
                >Cancel</button>
              </div>
            </>
          );
        })()}

        {/* Crop mode hint */}
        {cropMode && !cropRect && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-[11px] font-medium" style={{ background: "rgba(255,200,0,0.15)", border: "1px solid rgba(255,200,0,0.3)", color: "rgba(255,200,0,0.9)", zIndex: 9991 }}>
            Click and drag on an image to crop it
          </div>
        )}

        {/* Info bar */}
        <div className="absolute bottom-2 left-3 flex items-center gap-2 px-2.5 py-1 rounded-md" style={{ background: "rgba(0,0,0,0.5)", zIndex: 10 }}>
          <span ref={zoomTextRef} className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{Math.round(zoom * 100)}%</span>
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{items.length} item{items.length !== 1 ? "s" : ""}{selection.size > 0 ? ` \u00b7 ${selection.size} selected` : ""}</span>
          {items.length > 0 && (
            <button
              onClick={fitToExtents}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer"
              style={{ color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.08)", border: "none" }}
              title="Fit all items in view (Home)"
            >Fit</button>
          )}
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
                {mode === "shared" && roomId ? (
                  <>
                    <div className="rounded p-3 text-center space-y-2" style={{ background: "rgba(80,160,255,0.08)", border: "1px solid rgba(80,160,255,0.3)" }}>
                      <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--color-text-muted)" }}>Room Code</div>
                      <div className="text-2xl font-mono font-bold tracking-[0.3em]" style={{ color: "rgba(80,160,255,1)" }}>{roomId}</div>
                    </div>
                    {hostIpInfo && hostIpInfo.ips.length > 0 && (
                      <div className="rounded p-3 space-y-1.5" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)" }}>
                        <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "rgba(34,197,94,0.8)" }}>
                          Share this with the person joining
                        </div>
                        {hostIpInfo.ips.map((ip) => (
                          <div key={ip} className="flex items-center gap-2">
                            <code className="text-xs font-mono font-bold flex-1" style={{ color: "var(--color-text-primary)" }}>
                              {ip}:{hostIpInfo.port}
                            </code>
                            <button
                              className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
                              style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}
                              onClick={() => { navigator.clipboard?.writeText(`${ip}:${hostIpInfo.port}`); addToast("Copied!", "success"); }}
                            >Copy</button>
                          </div>
                        ))}
                        <div className="text-[9px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                          They enter this as "Host Address" when joining. Same network = use these IPs directly.
                          Different networks = you may need port forwarding on your router (port {hostIpInfo.port}) and your public IP.
                        </div>
                      </div>
                    )}
                    <button onClick={() => { setShareModal(null); setHostIpInfo(null); }} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer" style={{ background: "rgba(80,160,255,0.9)", color: "#fff", border: "none" }}>Done</button>
                  </>
                ) : (
                  <>
                    <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Room name\u2026" value={shareRoomName} onChange={(e) => setShareRoomName(e.target.value)} />
                    <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Your display name\u2026" value={shareUserName} onChange={(e) => setShareUserName(e.target.value)} autoFocus />
                    <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Password (optional)" value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} />
                    <button onClick={handleCreateRoom} disabled={!shareUserName.trim()} className="w-full px-3 py-1.5 text-xs rounded font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "rgba(80,160,255,0.9)", color: "#fff", border: "none" }}>Create Shared Room</button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>Join Shared Art Table</div>
                <div className="rounded p-2 space-y-1.5" style={{ background: "rgba(255,165,0,0.06)", border: "1px solid rgba(255,165,0,0.2)" }}>
                  <label className="text-[10px] font-medium block" style={{ color: "rgba(255,165,0,0.8)" }}>Host Address (required for remote)</label>
                  <input className="w-full px-2 py-1.5 text-xs rounded font-mono" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="e.g. 192.168.1.50:8420 or leave blank if same machine" value={joinRemoteHost} onChange={(e) => setJoinRemoteHost(e.target.value)} />
                  <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                    The host sees their address after creating a room. Enter it here to connect remotely.
                  </div>
                </div>
                <input className="w-full px-2 py-1.5 text-xs rounded font-mono tracking-widest" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Room code\u2026" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoFocus />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Your display name\u2026" value={joinUserName} onChange={(e) => setJoinUserName(e.target.value)} />
                <input className="w-full px-2 py-1.5 text-xs rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} placeholder="Password (if required)" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} />
                {activeRooms.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Active Rooms (local server)</label>
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
