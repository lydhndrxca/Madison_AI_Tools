import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight, Maximize, Minimize } from "lucide-react";
import { EditorToolbar, STYLE_PRESETS } from "./editor/EditorToolbar";
import type { EditorTool, OutpaintDir } from "./editor/EditorToolbar";
import * as Mask from "./editor/maskEngine";
import { apiFetch } from "@/hooks/useApi";
import { useShortcuts } from "@/hooks/useShortcuts";

interface ContextMenuAction {
  label: string;
  onClick: () => void;
  separator?: false;
}

interface ContextMenuSeparator {
  separator: true;
}

type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

interface ImageViewerProps {
  src?: string | null;
  placeholder?: string;
  showToolbar?: boolean;
  className?: string;
  locked?: boolean;
  onSaveImage?: () => void;
  onCopyImage?: () => void;
  onPasteImage?: () => void;
  onOpenImage?: () => void;
  onClearImage?: () => void;
  onClearAllImages?: () => void;
  onImageEdited?: (newSrc: string, label: string) => void;
  imageCount?: number;
  imageIndex?: number;
  onPrevImage?: () => void;
  onNextImage?: () => void;
  refImages?: string[];
  styleContext?: string;
}

export function ImageViewer({
  src,
  placeholder = "No image loaded",
  showToolbar = true,
  className = "",
  locked = false,
  onSaveImage,
  onCopyImage,
  onPasteImage,
  onOpenImage,
  onClearImage,
  onClearAllImages,
  onImageEdited,
  imageCount = 0,
  imageIndex = 0,
  onPrevImage,
  onNextImage,
  refImages = [],
  styleContext = "",
}: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [panning, setPanning] = useState(false);
  const [panButton, setPanButton] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // Inpainting state
  const [inpaintMode, setInpaintMode] = useState(false);
  const [editorTool, setEditorTool] = useState<EditorTool>("brush");
  const [brushSize, setBrushSize] = useState(30);
  const [hasMask, setHasMask] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const prevDrawPos = useRef<{ x: number; y: number } | null>(null);

  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Marquee/lasso state
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);

  // Outpaint preview
  const [outpaintPreview, setOutpaintPreview] = useState<{ dir: OutpaintDir; px: number } | null>(null);

  // Fullscreen mode
  const [fullscreen, setFullscreen] = useState(false);
  const [fsZoom, setFsZoom] = useState(1);
  const [fsPanX, setFsPanX] = useState(0);
  const [fsPanY, setFsPanY] = useState(0);
  const [fsPanning, setFsPanning] = useState(false);
  const fsLastPos = useRef({ x: 0, y: 0 });
  const fsContainerRef = useRef<HTMLDivElement>(null);

  const fitToContainer = useCallback(() => {
    if (!containerRef.current || !naturalSize.w || !naturalSize.h) {
      setZoom(1); setPanX(0); setPanY(0); return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / naturalSize.w;
    const scaleY = rect.height / naturalSize.h;
    setZoom(Math.min(scaleX, scaleY) * 0.95);
    setPanX(0); setPanY(0);
  }, [naturalSize]);

  const prevSrcRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const hadImage = !!prevSrcRef.current;
    prevSrcRef.current = src;
    if (!hadImage && src) fitToContainer();
  }, [src, fitToContainer]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [ctxMenu]);

  // Resize mask canvas when image natural size changes
  useEffect(() => {
    if (maskCanvasRef.current && naturalSize.w > 0 && naturalSize.h > 0) {
      Mask.resizeMask(maskCanvasRef.current, naturalSize.w, naturalSize.h);
    }
  }, [naturalSize]);

  // Clear mask when source image changes
  useEffect(() => {
    if (maskCanvasRef.current) { Mask.clearMask(maskCanvasRef.current); setHasMask(false); }
  }, [src]);

  // Register image viewer tool shortcuts via the shortcuts system
  const { registerAction: regAction, unregisterAction: unregAction } = useShortcuts();
  useEffect(() => {
    const guard = (fn: () => void) => () => { if (!lockedRef.current) fn(); };
    regAction("toolBrush", guard(() => { setEditorTool("brush"); setInpaintMode(true); }));
    regAction("toolEraser", guard(() => { setEditorTool("eraser"); setInpaintMode(true); }));
    regAction("toolMarquee", guard(() => { setEditorTool("marquee"); setInpaintMode(true); }));
    regAction("toolLasso", guard(() => { setEditorTool("lasso"); setInpaintMode(true); }));
    regAction("toolSmartSelect", guard(() => { setEditorTool("smartSelect"); setInpaintMode(true); }));
    regAction("brushSmaller", guard(() => setBrushSize((s) => Math.max(2, s - 5))));
    regAction("brushLarger", guard(() => setBrushSize((s) => Math.min(200, s + 5))));
    return () => {
      for (const id of ["toolBrush", "toolEraser", "toolMarquee", "toolLasso", "toolSmartSelect", "brushSmaller", "brushLarger"]) {
        unregAction(id);
      }
    };
  }, [regAction, unregAction]);

  // Robust pan via native pointer events + pointer capture.
  // Prevents middle-click autoscroll and ensures smooth vertical + horizontal pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let captured = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        captured = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!captured) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      setPanX((p) => p + dx);
      setPanY((p) => p + dy);
    };
    const onUp = (e: PointerEvent) => {
      if (captured && e.button === 1) {
        captured = false;
        el.releasePointerCapture(e.pointerId);
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", () => { captured = false; });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const imgX = (cursorX - centerX - panX) / zoom;
    const imgY = (cursorY - centerY - panY) / zoom;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.02, Math.min(50, zoom * factor));
    setPanX(cursorX - centerX - imgX * newZoom);
    setPanY(cursorY - centerY - imgY * newZoom);
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  // Convert screen coords to image coords
  const screenToImage = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current || !naturalSize.w) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const imgX = (clientX - rect.left - cx - panX) / zoom + naturalSize.w / 2;
    const imgY = (clientY - rect.top - cy - panY) / zoom + naturalSize.h / 2;
    return { x: imgX, y: imgY };
  }, [panX, panY, zoom, naturalSize]);

  const isDrawingTool = editorTool === "brush" || editorTool === "eraser" || editorTool === "smartErase";

  // Holding Shift while the brush tool is selected acts as eraser
  const getDrawMode = (e: { shiftKey: boolean }): "brush" | "eraser" => {
    if (editorTool === "eraser") return "eraser";
    if (editorTool === "brush" && e.shiftKey) return "eraser";
    return "brush";
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setCtxMenu(null);
    if (e.button === 1) return;
    if (e.button === 2) return;
    if (!locked && inpaintMode && src && e.button === 0) {
      const pos = screenToImage(e.clientX, e.clientY);
      if (!pos) return;
      if (isDrawingTool && maskCanvasRef.current) {
        e.preventDefault();
        drawingRef.current = true;
        prevDrawPos.current = null;
        Mask.drawStroke(maskCanvasRef.current, pos.x, pos.y, null, brushSize, getDrawMode(e));
        prevDrawPos.current = pos;
        setHasMask(Mask.maskHasContent(maskCanvasRef.current));
        return;
      }
      if (editorTool === "marquee") { e.preventDefault(); setMarqueeStart(pos); setMarqueeEnd(pos); return; }
      if (editorTool === "lasso") { e.preventDefault(); setLassoPoints([pos]); return; }
    }
    if (e.button === 0) {
      e.preventDefault(); setPanning(true); setPanButton(0); lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }, [locked, inpaintMode, src, isDrawingTool, editorTool, brushSize, screenToImage]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (locked) { setBrushCursor(null); }
    if (!locked && inpaintMode && isDrawingTool) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setBrushCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (panning) {
      setPanX((p) => p + e.clientX - lastPos.current.x);
      setPanY((p) => p + e.clientY - lastPos.current.y);
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (inpaintMode && drawingRef.current && maskCanvasRef.current) {
      const pos = screenToImage(e.clientX, e.clientY);
      if (!pos) return;
      Mask.drawStroke(maskCanvasRef.current, pos.x, pos.y, prevDrawPos.current, brushSize, getDrawMode(e));
      prevDrawPos.current = pos;
      setHasMask(Mask.maskHasContent(maskCanvasRef.current));
      return;
    }
    if (editorTool === "marquee" && marqueeStart) {
      const pos = screenToImage(e.clientX, e.clientY);
      if (pos) setMarqueeEnd(pos);
      return;
    }
    if (editorTool === "lasso" && lassoPoints.length > 0) {
      const pos = screenToImage(e.clientX, e.clientY);
      if (pos) setLassoPoints((prev) => [...prev, pos]);
    }
  }, [locked, panning, inpaintMode, editorTool, brushSize, marqueeStart, lassoPoints, screenToImage]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === panButton) { setPanning(false); setPanButton(null); }
    if (drawingRef.current) { drawingRef.current = false; prevDrawPos.current = null; }
    if (editorTool === "marquee" && marqueeStart && marqueeEnd && maskCanvasRef.current) {
      const x = Math.min(marqueeStart.x, marqueeEnd.x);
      const y = Math.min(marqueeStart.y, marqueeEnd.y);
      const w = Math.abs(marqueeEnd.x - marqueeStart.x);
      const h = Math.abs(marqueeEnd.y - marqueeStart.y);
      if (w > 2 && h > 2) { Mask.fillRect(maskCanvasRef.current, x, y, w, h); setHasMask(true); }
      setMarqueeStart(null); setMarqueeEnd(null);
    }
    if (editorTool === "lasso" && lassoPoints.length > 2 && maskCanvasRef.current) {
      Mask.fillPolygon(maskCanvasRef.current, lassoPoints);
      setHasMask(true);
      setLassoPoints([]);
    }
  }, [panButton, editorTool, marqueeStart, marqueeEnd, lassoPoints]);

  const handleMouseLeave = useCallback(() => {
    setPanning(false); setPanButton(null);
    drawingRef.current = false; prevDrawPos.current = null;
    setBrushCursor(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (locked) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [locked]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const prevNatRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const prev = prevNatRef.current;
    prevNatRef.current = naturalSize;
    if (naturalSize.w > 0 && naturalSize.h > 0 && (prev.w === 0 || prev.h === 0)) {
      fitToContainer();
    }
  }, [naturalSize, fitToContainer]);

  // --- Context menu helpers ---
  const doAction = useCallback((fn?: () => void) => () => { setCtxMenu(null); fn?.(); }, []);

  const menuItems: ContextMenuItem[] = [
    { label: "Copy", onClick: doAction(onCopyImage) },
    { label: "Paste", onClick: doAction(onPasteImage) },
    { label: "Open", onClick: doAction(onOpenImage) },
    { label: "Save", onClick: doAction(onSaveImage) },
    { separator: true },
    { label: "Fit to View", onClick: doAction(fitToContainer) },
    { separator: true },
    { label: "Clear", onClick: doAction(onClearImage) },
  ];
  if (onClearAllImages) {
    menuItems.push({ label: "Clear All Generated", onClick: doAction(onClearAllImages) });
  }

  // --- Editor action handlers ---
  const getImageB64 = useCallback(() => {
    if (!src) return null;
    return src.replace(/^data:image\/\w+;base64,/, "");
  }, [src]);

  const handleApplyInpaint = useCallback(async (prompt: string) => {
    if (!src || !maskCanvasRef.current || !Mask.maskHasContent(maskCanvasRef.current)) return;
    setEditorBusy(true);
    try {
      const compositeB64 = await Mask.exportMaskComposite(maskCanvasRef.current, src);
      const resp = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/inpaint", {
        method: "POST", body: JSON.stringify({ image_b64: getImageB64(), mask_composite_b64: compositeB64, prompt, ref_images: refImages, style_context: styleContext }),
      });
      if (resp.image_b64 && onImageEdited) {
        onImageEdited(`data:image/png;base64,${resp.image_b64}`, `Inpaint: ${prompt.slice(0, 40)}`);
        Mask.clearMask(maskCanvasRef.current); setHasMask(false);
        setInpaintMode(false);
      }
    } catch { /* toast handled by apiFetch */ }
    setEditorBusy(false);
  }, [src, getImageB64, onImageEdited, refImages, styleContext]);

  const handleSmartSelect = useCallback(async (subject: string) => {
    if (!src) { console.warn("[SmartSelect] No image loaded"); return; }
    if (!subject.trim()) { console.warn("[SmartSelect] No subject entered"); return; }
    setEditorBusy(true);
    try {
      const resp = await apiFetch<{ mask_b64?: string; error?: string }>("/editor/smart-select", {
        method: "POST", body: JSON.stringify({ image_b64: getImageB64(), subject }),
      });
      if (resp.mask_b64 && maskCanvasRef.current) {
        await Mask.applyMaskImage(maskCanvasRef.current, `data:image/png;base64,${resp.mask_b64}`);
        setHasMask(true);
        setInpaintMode(true);
      } else if (resp.error) {
        console.error("[SmartSelect]", resp.error);
      } else {
        console.warn("[SmartSelect] No mask returned from API");
      }
    } catch (err) {
      console.error("[SmartSelect] Request failed:", err);
    }
    setEditorBusy(false);
  }, [src, getImageB64]);

  const handleSmartErase = useCallback(async () => {
    if (!src || !maskCanvasRef.current || !Mask.maskHasContent(maskCanvasRef.current)) return;
    setEditorBusy(true);
    try {
      const compositeB64 = await Mask.exportMaskComposite(maskCanvasRef.current, src);
      const resp = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/smart-erase", {
        method: "POST", body: JSON.stringify({ image_b64: getImageB64(), mask_composite_b64: compositeB64, ref_images: refImages, style_context: styleContext }),
      });
      if (resp.image_b64 && onImageEdited) {
        onImageEdited(`data:image/png;base64,${resp.image_b64}`, "Smart erase");
        Mask.clearMask(maskCanvasRef.current); setHasMask(false);
        setInpaintMode(false);
      }
    } catch { /* */ }
    setEditorBusy(false);
  }, [src, getImageB64, onImageEdited, refImages, styleContext]);

  const handleOutpaint = useCallback(async (dir: OutpaintDir, px: number, prompt: string) => {
    if (!src) return;
    setEditorBusy(true);
    setOutpaintPreview({ dir, px });
    try {
      const resp = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/outpaint", {
        method: "POST", body: JSON.stringify({ image_b64: getImageB64(), direction: dir, expand_px: px, prompt, ref_images: refImages, style_context: styleContext }),
      });
      if (resp.image_b64 && onImageEdited) {
        onImageEdited(`data:image/png;base64,${resp.image_b64}`, `Outpaint ${dir} +${px}px`);
        setInpaintMode(false);
      }
    } catch { /* */ }
    setOutpaintPreview(null);
    setEditorBusy(false);
  }, [src, getImageB64, onImageEdited, refImages, styleContext]);

  const handleRemoveBg = useCallback(async (replacement: string) => {
    if (!src) return;
    setEditorBusy(true);
    try {
      const resp = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/remove-bg", {
        method: "POST", body: JSON.stringify({ image_b64: getImageB64(), replacement }),
      });
      if (resp.image_b64 && onImageEdited) {
        onImageEdited(`data:image/png;base64,${resp.image_b64}`, "Remove background");
        setInpaintMode(false);
      }
    } catch { /* */ }
    setEditorBusy(false);
  }, [src, getImageB64, onImageEdited, refImages, styleContext]);

  const handleStyleTransfer = useCallback(async (presetId: string, custom: string) => {
    if (!src) return;
    setEditorBusy(true);
    try {
      const preset = STYLE_PRESETS.find((s) => s.id === presetId);
      const resp = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/style-transfer", {
        method: "POST", body: JSON.stringify({
          image_b64: getImageB64(),
          style_preset: presetId,
          custom_prompt: presetId === "custom" ? custom : (preset?.prompt || ""),
          ref_images: refImages, style_context: styleContext,
        }),
      });
      if (resp.image_b64 && onImageEdited) {
        onImageEdited(`data:image/png;base64,${resp.image_b64}`, `Style: ${preset?.label || custom.slice(0, 30)}`);
        setInpaintMode(false);
      }
    } catch { /* */ }
    setEditorBusy(false);
  }, [src, getImageB64, onImageEdited, refImages, styleContext]);

  const handleClearMask = useCallback(() => {
    if (maskCanvasRef.current) { Mask.clearMask(maskCanvasRef.current); setHasMask(false); }
  }, []);

  const toolbarBtnStyle = { background: "transparent", border: "none", color: "var(--color-text-secondary)" };

  const imgTransform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
  const showBrushCursor = inpaintMode && isDrawingTool && !panning;
  const canvasCursor = showBrushCursor ? "none" : inpaintMode && (editorTool === "marquee" || editorTool === "lasso") ? "crosshair" : panning ? "grabbing" : "default";

  const handleToolChange = useCallback((tool: EditorTool) => {
    setEditorTool(tool);
    setInpaintMode(true);
  }, []);

  // --- Fullscreen helpers ---

  const enterFullscreen = useCallback(() => {
    if (!src) return;
    setFullscreen(true);
    setFsPanX(0);
    setFsPanY(0);
    // Fit image into screen
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      const sw = window.innerWidth;
      const sh = window.innerHeight;
      const scale = Math.min(sw / naturalSize.w, sh / naturalSize.h, 1);
      setFsZoom(scale);
    } else {
      setFsZoom(1);
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, [src, naturalSize]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  const fsFitToScreen = useCallback(() => {
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      const sw = window.innerWidth;
      const sh = window.innerHeight;
      const scale = Math.min(sw / naturalSize.w, sh / naturalSize.h, 1);
      setFsZoom(scale);
    }
    setFsPanX(0);
    setFsPanY(0);
  }, [naturalSize]);

  // Register fullscreen shortcuts via the shortcuts system
  const enterFsRef = useRef(enterFullscreen);
  enterFsRef.current = enterFullscreen;
  const exitFsRef = useRef(exitFullscreen);
  exitFsRef.current = exitFullscreen;
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;

  useEffect(() => {
    regAction("toggleFullscreen", () => {
      if (fullscreenRef.current) exitFsRef.current();
      else enterFsRef.current();
    });
    regAction("exitFullscreen", () => {
      if (fullscreenRef.current) exitFsRef.current();
    });
    return () => { unregAction("toggleFullscreen"); unregAction("exitFullscreen"); };
  }, [regAction, unregAction]);

  // Exit our state if browser exits fullscreen via F11 or other means
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && fullscreen) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [fullscreen]);

  // Fullscreen mouse handlers
  const handleFsWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setFsZoom((z) => Math.max(0.02, Math.min(50, z * factor)));
  }, []);

  const handleFsMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      setFsPanning(true);
      fsLastPos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleFsMouseMove = useCallback((e: React.MouseEvent) => {
    if (!fsPanning) return;
    const dx = e.clientX - fsLastPos.current.x;
    const dy = e.clientY - fsLastPos.current.y;
    fsLastPos.current = { x: e.clientX, y: e.clientY };
    setFsPanX((px) => px + dx);
    setFsPanY((py) => py + dy);
  }, [fsPanning]);

  const handleFsMouseUp = useCallback(() => setFsPanning(false), []);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {showToolbar && (
        <div className="flex items-center gap-1 px-2 py-1 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-xs mr-1" style={{ color: "var(--color-text-secondary)" }}>Zoom</span>
          <button onClick={() => setZoom((z) => Math.max(0.02, z / 1.25))} className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]" style={toolbarBtnStyle} title="Zoom out — make the image smaller (keyboard shortcut: minus key)">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs w-12 text-center tabular-nums" style={{ color: "var(--color-text-muted)" }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(50, z * 1.25))} className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]" style={toolbarBtnStyle} title="Zoom in — make the image bigger (keyboard shortcut: plus key)">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={fitToContainer} className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)] ml-0.5" style={toolbarBtnStyle} title="Fit the whole image in the window (keyboard shortcut: F)">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={enterFullscreen} className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)] ml-0.5" style={toolbarBtnStyle} title="View in full screen (Ctrl+F) — Escape to exit">
            <Maximize className="h-3.5 w-3.5" />
          </button>
          {imageCount > 1 && (
            <span className="ml-2 text-[10px] font-mono tabular-nums" style={{ color: "var(--color-text-secondary)" }}>
              {imageIndex + 1} / {imageCount}
            </span>
          )}
          {naturalSize.w > 0 && (
            <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>
              {naturalSize.w} x {naturalSize.h}{" · "}{naturalSize.w > naturalSize.h ? "Landscape" : naturalSize.w < naturalSize.h ? "Portrait" : "Square"}
            </span>
          )}
        </div>
      )}

      <EditorToolbar
        activeTool={editorTool} onToolChange={handleToolChange}
        brushSize={brushSize} onBrushSizeChange={setBrushSize}
        hasMask={hasMask} onClearMask={handleClearMask}
        onApplyInpaint={handleApplyInpaint}
        onSmartSelect={handleSmartSelect}
        onSmartErase={handleSmartErase}
        onOutpaint={handleOutpaint}
        onRemoveBg={handleRemoveBg}
        onStyleTransfer={handleStyleTransfer}
        busy={editorBusy}
        locked={locked}
      />

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative select-none"
        style={{ background: "var(--color-canvas, #343434)", cursor: canvasCursor }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        {src ? (
          <>
            <img
              src={src} alt="" draggable={false} onLoad={handleImageLoad}
              style={{
                position: "absolute", left: "50%", top: "50%",
                transform: imgTransform, transformOrigin: "center center",
                maxWidth: "none", maxHeight: "none", pointerEvents: "none",
                imageRendering: zoom > 3 ? "pixelated" : "auto",
              }}
            />
            {/* Mask overlay canvas — always mounted so it's ready */}
            <canvas
              ref={maskCanvasRef}
              style={{
                position: "absolute", left: "50%", top: "50%",
                transform: imgTransform, transformOrigin: "center center",
                pointerEvents: "none", opacity: inpaintMode ? 0.45 : 0,
                width: naturalSize.w, height: naturalSize.h,
              }}
            />
            {/* Lasso outline while drawing */}
            {lassoPoints.length > 1 && (
              <svg
                style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: imgTransform, transformOrigin: "center center",
                  pointerEvents: "none", overflow: "visible",
                  width: naturalSize.w, height: naturalSize.h,
                }}
                viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
              >
                <polyline
                  points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2 / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                />
                <polyline
                  points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none" stroke="rgba(255,60,60,0.6)" strokeWidth={1 / zoom}
                />
              </svg>
            )}
            {/* Marquee outline while dragging */}
            {marqueeStart && marqueeEnd && (
              <svg
                style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: imgTransform, transformOrigin: "center center",
                  pointerEvents: "none", overflow: "visible",
                  width: naturalSize.w, height: naturalSize.h,
                }}
                viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
              >
                <rect
                  x={Math.min(marqueeStart.x, marqueeEnd.x)} y={Math.min(marqueeStart.y, marqueeEnd.y)}
                  width={Math.abs(marqueeEnd.x - marqueeStart.x)} height={Math.abs(marqueeEnd.y - marqueeStart.y)}
                  fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2 / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                />
              </svg>
            )}
            {/* Outpaint preview dashed border */}
            {outpaintPreview && (
              <div style={{
                position: "absolute", left: "50%", top: "50%",
                transform: imgTransform, transformOrigin: "center center",
                pointerEvents: "none",
                width: naturalSize.w + (outpaintPreview.dir === "left" || outpaintPreview.dir === "right" || outpaintPreview.dir === "all" ? outpaintPreview.px * (outpaintPreview.dir === "all" ? 2 : 1) : 0),
                height: naturalSize.h + (outpaintPreview.dir === "top" || outpaintPreview.dir === "bottom" || outpaintPreview.dir === "all" ? outpaintPreview.px * (outpaintPreview.dir === "all" ? 2 : 1) : 0),
                marginLeft: outpaintPreview.dir === "left" || outpaintPreview.dir === "all" ? -outpaintPreview.px : 0,
                marginTop: outpaintPreview.dir === "top" || outpaintPreview.dir === "all" ? -outpaintPreview.px : 0,
                border: "2px dashed rgba(255,255,255,0.4)",
                boxSizing: "border-box",
              }} />
            )}
            {naturalSize.w > 0 && (
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono z-10 pointer-events-none"
                style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-muted)" }}>
                {naturalSize.w} x {naturalSize.h}{" · "}{naturalSize.w > naturalSize.h ? "Landscape" : naturalSize.w < naturalSize.h ? "Portrait" : "Square"}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>{placeholder}</span>
          </div>
        )}

        {imageCount > 1 && onPrevImage && onNextImage && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full cursor-pointer transition-all hover:scale-110"
              style={{ background: "rgba(0,0,0,0.6)", color: "#E0E0E0", border: "none", opacity: imageIndex > 0 ? 1 : 0.3 }}
              onClick={(e) => { e.stopPropagation(); onPrevImage(); }} disabled={imageIndex <= 0}>
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full cursor-pointer transition-all hover:scale-110"
              style={{ background: "rgba(0,0,0,0.6)", color: "#E0E0E0", border: "none", opacity: imageIndex < imageCount - 1 ? 1 : 0.3 }}
              onClick={(e) => { e.stopPropagation(); onNextImage(); }} disabled={imageIndex >= imageCount - 1}>
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {ctxMenu && (
          <div ref={ctxMenuRef} className="absolute z-50" style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 180 }}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="py-1 rounded shadow-lg" style={{ background: "var(--color-card, #4F4F4F)", border: "1px solid var(--color-border, #3A3A3A)" }}>
              {menuItems.map((item, i) =>
                "separator" in item && item.separator ? (
                  <div key={`sep-${i}`} className="my-1" style={{ borderTop: "1px solid var(--color-border, #3A3A3A)" }} />
                ) : (
                  <button key={i}
                    className="ctx-menu-item"
                    onClick={(item as ContextMenuAction).onClick}>
                    {(item as ContextMenuAction).label}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        {showBrushCursor && brushCursor && (
          <div
            style={{
              position: "absolute",
              left: brushCursor.x,
              top: brushCursor.y,
              width: brushSize * zoom,
              height: brushSize * zoom,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: "1.5px solid rgba(255,255,255,0.8)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              pointerEvents: "none",
              zIndex: 40,
            }}
          />
        )}
        {/* No overlay during generation — user can still zoom and pan */}
      </div>

      {/* Fullscreen portal overlay */}
      {fullscreen && src && createPortal(
        <div
          ref={fsContainerRef}
          style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#000", cursor: fsPanning ? "grabbing" : "grab" }}
          onWheel={handleFsWheel}
          onMouseDown={handleFsMouseDown}
          onMouseMove={handleFsMouseMove}
          onMouseUp={handleFsMouseUp}
          onMouseLeave={handleFsMouseUp}
        >
          <img
            src={src} alt="" draggable={false}
            style={{
              position: "absolute", left: "50%", top: "50%",
              transform: `translate(-50%, -50%) translate(${fsPanX}px, ${fsPanY}px) scale(${fsZoom})`,
              transformOrigin: "center center",
              maxWidth: "none", maxHeight: "none", pointerEvents: "none",
              imageRendering: fsZoom > 3 ? "pixelated" : "auto",
            }}
          />

          {/* Carousel arrows */}
          {imageCount > 1 && onPrevImage && onNextImage && (
            <>
              <button className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full cursor-pointer transition-all hover:scale-110"
                style={{ background: "rgba(255,255,255,0.1)", color: "#E0E0E0", border: "none", opacity: imageIndex > 0 ? 1 : 0.3 }}
                onClick={(e) => { e.stopPropagation(); onPrevImage(); }} disabled={imageIndex <= 0}>
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full cursor-pointer transition-all hover:scale-110"
                style={{ background: "rgba(255,255,255,0.1)", color: "#E0E0E0", border: "none", opacity: imageIndex < imageCount - 1 ? 1 : 0.3 }}
                onClick={(e) => { e.stopPropagation(); onNextImage(); }} disabled={imageIndex >= imageCount - 1}>
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Bottom toolbar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 py-2 z-10"
            style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
            <button onClick={() => setFsZoom((z) => Math.max(0.02, z / 1.25))} className="p-1.5 rounded cursor-pointer hover:bg-white/10" style={{ background: "transparent", border: "none", color: "#ccc" }} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs font-mono tabular-nums" style={{ color: "#aaa", minWidth: 48, textAlign: "center" }}>{Math.round(fsZoom * 100)}%</span>
            <button onClick={() => setFsZoom((z) => Math.min(50, z * 1.25))} className="p-1.5 rounded cursor-pointer hover:bg-white/10" style={{ background: "transparent", border: "none", color: "#ccc" }} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button onClick={fsFitToScreen} className="p-1.5 rounded cursor-pointer hover:bg-white/10" style={{ background: "transparent", border: "none", color: "#ccc" }} title="Fit to screen">
              <Maximize2 className="h-4 w-4" />
            </button>
            <button onClick={exitFullscreen} className="p-1.5 rounded cursor-pointer hover:bg-white/10" style={{ background: "transparent", border: "none", color: "#ccc" }} title="Exit full screen (Escape)">
              <Minimize className="h-4 w-4" />
            </button>
            {imageCount > 1 && (
              <span className="text-[10px] font-mono tabular-nums" style={{ color: "#888" }}>{imageIndex + 1} / {imageCount}</span>
            )}
            {naturalSize.w > 0 && (
              <span className="text-[10px] font-mono" style={{ color: "#666" }}>
                {naturalSize.w} x {naturalSize.h}
              </span>
            )}
          </div>

          {/* Top-right hint */}
          <div className="absolute top-3 right-3 z-10 px-2 py-1 rounded text-[10px]" style={{ background: "rgba(0,0,0,0.5)", color: "#888" }}>
            Esc to exit
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
