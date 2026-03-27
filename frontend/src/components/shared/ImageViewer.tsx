import { useState, useRef, useCallback, useEffect } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, ChevronLeft, ChevronRight } from "lucide-react";

interface ContextMenuAction {
  label: string;
  icon?: string;
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
  onSaveImage?: () => void;
  onCopyImage?: () => void;
  onPasteImage?: () => void;
  onOpenImage?: () => void;
  onClearImage?: () => void;
  extraMenuItems?: ContextMenuItem[];
  imageCount?: number;
  imageIndex?: number;
  onPrevImage?: () => void;
  onNextImage?: () => void;
}

export function ImageViewer({
  src,
  placeholder = "No image loaded",
  showToolbar = true,
  className = "",
  onSaveImage,
  onCopyImage,
  onPasteImage,
  onOpenImage,
  onClearImage,
  extraMenuItems,
  imageCount = 0,
  imageIndex = 0,
  onPrevImage,
  onNextImage,
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

  const fitToContainer = useCallback(() => {
    if (!containerRef.current || !naturalSize.w || !naturalSize.h) {
      setZoom(1);
      setPanX(0);
      setPanY(0);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / naturalSize.w;
    const scaleY = rect.height / naturalSize.h;
    setZoom(Math.min(scaleX, scaleY) * 0.95);
    setPanX(0);
    setPanY(0);
  }, [naturalSize]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  useEffect(() => {
    fitToContainer();
  }, [src, fitToContainer]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu]);

  // Mouse wheel = zoom toward cursor
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
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

      const newPanX = cursorX - centerX - imgX * newZoom;
      const newPanY = cursorY - centerY - imgY * newZoom;

      setZoom(newZoom);
      setPanX(newPanX);
      setPanY(newPanY);
    },
    [zoom, panX, panY],
  );

  // Left-click (button 0) or middle-click (button 1) = start pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      setPanning(true);
      setPanButton(e.button);
      lastPos.current = { x: e.clientX, y: e.clientY };
      setCtxMenu(null);
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!panning) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setPanX((p) => p + dx);
      setPanY((p) => p + dy);
      lastPos.current = { x: e.clientX, y: e.clientY };
    },
    [panning],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === panButton) {
        setPanning(false);
        setPanButton(null);
      }
    },
    [panButton],
  );

  const handleMouseLeave = useCallback(() => {
    setPanning(false);
    setPanButton(null);
  }, []);

  // Right-click = context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setCtxMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [],
  );

  // Prevent middle-click autoscroll browser behavior
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventMiddle = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("mousedown", preventMiddle);
    return () => el.removeEventListener("mousedown", preventMiddle);
  }, []);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [],
  );

  useEffect(() => {
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      fitToContainer();
    }
  }, [naturalSize, fitToContainer]);

  // --- Save/Copy/Paste/Open helpers (internal defaults if no prop given) ---
  const doSaveImage = useCallback(() => {
    setCtxMenu(null);
    if (onSaveImage) { onSaveImage(); return; }
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = `image_${Date.now()}.png`;
    a.click();
  }, [src, onSaveImage]);

  const doCopyImage = useCallback(async () => {
    setCtxMenu(null);
    if (onCopyImage) { onCopyImage(); return; }
    if (!src) return;
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch { /* clipboard API may not be available */ }
  }, [src, onCopyImage]);

  const doPasteImage = useCallback(async () => {
    setCtxMenu(null);
    if (onPasteImage) { onPasteImage(); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            // Can't set state here without callback – this is fallback behavior
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    } catch { /* clipboard API may not be available */ }
  }, [onPasteImage]);

  const doOpenImage = useCallback(() => {
    setCtxMenu(null);
    if (onOpenImage) { onOpenImage(); return; }
  }, [onOpenImage]);

  const doClearImage = useCallback(() => {
    setCtxMenu(null);
    if (onClearImage) onClearImage();
  }, [onClearImage]);

  const doResetView = useCallback(() => {
    setCtxMenu(null);
    resetView();
  }, [resetView]);

  const doFitView = useCallback(() => {
    setCtxMenu(null);
    fitToContainer();
  }, [fitToContainer]);

  // Build context menu items
  const menuItems: ContextMenuItem[] = [];
  menuItems.push({ label: "Save Image", icon: "💾", onClick: doSaveImage });
  menuItems.push({ label: "Copy Image", icon: "📋", onClick: doCopyImage });
  if (onPasteImage) {
    menuItems.push({ label: "Paste Image", icon: "📥", onClick: doPasteImage });
  }
  if (onOpenImage) {
    menuItems.push({ label: "Open Image...", icon: "📂", onClick: doOpenImage });
  }
  menuItems.push({ separator: true });
  menuItems.push({ label: "Fit to View", icon: "🔍", onClick: doFitView });
  menuItems.push({ label: "Reset View (100%)", icon: "↩️", onClick: doResetView });
  if (onClearImage) {
    menuItems.push({ separator: true });
    menuItems.push({ label: "Clear", icon: "🗑️", onClick: doClearImage });
  }
  if (extraMenuItems) {
    menuItems.push({ separator: true });
    menuItems.push(...extraMenuItems);
  }

  const toolbarBtnStyle = {
    background: "transparent",
    border: "none",
    color: "var(--color-text-secondary)",
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {showToolbar && (
        <div
          className="flex items-center gap-1 px-2 py-1 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-xs mr-1" style={{ color: "var(--color-text-secondary)" }}>
            Zoom
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(0.02, z / 1.25))}
            className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
            style={toolbarBtnStyle}
            title="Zoom Out (-)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs w-12 text-center tabular-nums" style={{ color: "var(--color-text-muted)" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(50, z * 1.25))}
            className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
            style={toolbarBtnStyle}
            title="Zoom In (+)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fitToContainer}
            className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)] ml-0.5"
            style={toolbarBtnStyle}
            title="Fit to View (F)"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={resetView}
            className="p-1 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
            style={toolbarBtnStyle}
            title="Reset to 100% (R)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {imageCount > 1 && (
            <span className="ml-2 text-[10px] font-mono tabular-nums" style={{ color: "var(--color-text-secondary)" }}>
              {imageIndex + 1} / {imageCount}
            </span>
          )}
          {naturalSize.w > 0 && (
            <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>
              {naturalSize.w} x {naturalSize.h}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative select-none"
        style={{
          background: "var(--color-canvas, #343434)",
          cursor: panning ? "grabbing" : "grab",
        }}
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
              src={src}
              alt=""
              draggable={false}
              onLoad={handleImageLoad}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`,
                transformOrigin: "center center",
                maxWidth: "none",
                maxHeight: "none",
                pointerEvents: "none",
                imageRendering: zoom > 3 ? "pixelated" : "auto",
              }}
            />
            {naturalSize.w > 0 && (
              <div
                className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono z-10 pointer-events-none"
                style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-muted)" }}
              >
                {naturalSize.w} x {naturalSize.h}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {placeholder}
            </span>
          </div>
        )}

        {/* Carousel navigation arrows */}
        {imageCount > 1 && onPrevImage && onNextImage && (
          <>
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full cursor-pointer transition-all hover:scale-110"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "#E0E0E0",
                border: "none",
                opacity: imageIndex > 0 ? 1 : 0.3,
              }}
              onClick={(e) => { e.stopPropagation(); onPrevImage(); }}
              disabled={imageIndex <= 0}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full cursor-pointer transition-all hover:scale-110"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "#E0E0E0",
                border: "none",
                opacity: imageIndex < imageCount - 1 ? 1 : 0.3,
              }}
              onClick={(e) => { e.stopPropagation(); onNextImage(); }}
              disabled={imageIndex >= imageCount - 1}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Right-click context menu */}
        {ctxMenu && (
          <div
            ref={ctxMenuRef}
            className="absolute z-50"
            style={{
              left: ctxMenu.x,
              top: ctxMenu.y,
              minWidth: 180,
            }}
          >
            <div
              className="py-1 rounded shadow-lg"
              style={{
                background: "var(--color-card, #4F4F4F)",
                border: "1px solid var(--color-border, #3A3A3A)",
              }}
            >
              {menuItems.map((item, i) =>
                "separator" in item && item.separator ? (
                  <div
                    key={`sep-${i}`}
                    className="my-1"
                    style={{ borderTop: "1px solid var(--color-border, #3A3A3A)" }}
                  />
                ) : (
                  <button
                    key={i}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-[var(--color-hover)]"
                    style={{
                      color: "var(--color-text-primary, #E0E0E0)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                    onClick={(item as ContextMenuAction).onClick}
                  >
                    {"icon" in item && (item as ContextMenuAction).icon && (
                      <span className="w-4 text-center">{(item as ContextMenuAction).icon}</span>
                    )}
                    {(item as ContextMenuAction).label}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
