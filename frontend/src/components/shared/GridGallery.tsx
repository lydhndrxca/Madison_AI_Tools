import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react";
import { Loader2, X, Minus, Plus, FolderPlus, Monitor, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";
import { useImageEnhance } from "@/hooks/useImageEnhance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridGalleryResult {
  id: string;
  image_b64: string;
  width: number;
  height: number;
  /** Grid cell label like "A1", "B2", etc. */
  label?: string;
}

export interface GridGalleryProps {
  results: GridGalleryResult[];
  title?: string;
  generating?: boolean;
  emptyMessage?: string;
  toolLabel?: string;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  onEditSubmit: (id: string, editPrompt: string) => void;
  onRegenerate?: (id: string) => void;
  onUpdateImage?: (id: string, newB64: string, w: number, h: number) => void;
  onSendToMainstage?: (id: string) => void;
  editBusy?: Record<string, boolean>;
  showStyleLibrary?: boolean;
  styleLibraryFolders?: { name: string }[];
  onRefreshStyleFolders?: () => void;
  isFavorited?: (image_b64: string) => boolean;
  onToggleFavorite?: (id: string, image_b64: string, width: number, height: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GridGallery({
  results,
  title = "Results",
  generating = false,
  emptyMessage = "No results yet. Generate to see images here.",
  toolLabel = "image",
  onDelete,
  onCopy,
  onEditSubmit,
  onRegenerate,
  onUpdateImage,
  onSendToMainstage,
  editBusy = {},
  showStyleLibrary = false,
  styleLibraryFolders = [],
  onRefreshStyleFolders,
  isFavorited,
  onToggleFavorite,
}: GridGalleryProps) {
  const [editTexts, setEditTexts] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trimBusy, setTrimBusy] = useState<Record<string, boolean>>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const zoomViewportRef = useRef<HTMLDivElement>(null);
  const [expandZoom, setExpandZoom] = useState(1);
  const [expandPan, setExpandPan] = useState({ x: 0, y: 0 });
  const [expandPanning, setExpandPanning] = useState(false);
  const expandPanDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const enhancer = useImageEnhance();
  const [enhancingId, setEnhancingId] = useState<string | null>(null);

  const handleEditChange = useCallback((id: string, text: string) => {
    setEditTexts((prev) => ({ ...prev, [id]: text }));
  }, []);

  const handleEditSend = useCallback((id: string) => {
    const text = (editTexts[id] || "").trim();
    if (!text) return;
    onEditSubmit(id, text);
    setEditTexts((prev) => ({ ...prev, [id]: "" }));
  }, [editTexts, onEditSubmit]);

  const handleExpand = useCallback((id: string) => {
    setExpandedId(id);
  }, []);

  const handleCollapse = useCallback(() => {
    setExpandedId(null);
    setExpandZoom(1);
    setExpandPan({ x: 0, y: 0 });
    setExpandPanning(false);
    expandPanDragRef.current = null;
  }, []);

  const expandedIdx = expandedId ? results.findIndex((r) => r.id === expandedId) : -1;
  const expandedResult = expandedIdx >= 0 ? results[expandedIdx] : null;

  const goExpandPrev = useCallback(() => {
    if (!expandedId || results.length === 0) return;
    const idx = results.findIndex((r) => r.id === expandedId);
    if (idx < 0) return;
    const next = (idx - 1 + results.length) % results.length;
    setExpandedId(results[next].id);
  }, [expandedId, results]);

  const goExpandNext = useCallback(() => {
    if (!expandedId || results.length === 0) return;
    const idx = results.findIndex((r) => r.id === expandedId);
    if (idx < 0) return;
    const next = (idx + 1) % results.length;
    setExpandedId(results[next].id);
  }, [expandedId, results]);

  useEffect(() => {
    if (expandedId && results.every((r) => r.id !== expandedId)) {
      handleCollapse();
    }
  }, [expandedId, results, handleCollapse]);

  useEffect(() => {
    if (!expandedId) return;
    setExpandZoom(1);
    setExpandPan({ x: 0, y: 0 });
  }, [expandedId]);

  useEffect(() => {
    if (!expandedId) return;
    const el = zoomViewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setExpandZoom((z) => Math.min(4, Math.max(0.25, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [expandedId]);

  useEffect(() => {
    if (!expandedId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCollapse();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goExpandPrev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goExpandNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedId, handleCollapse, goExpandPrev, goExpandNext]);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent) => { if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [ctxMenu]);

  const handleGridContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const handleEnhance = useCallback(async (id: string, mode: "upscale" | "restore") => {
    const result = results.find((r) => r.id === id);
    if (!result || !onUpdateImage || enhancer.busy) return;
    setEnhancingId(id);
    const src = `data:image/png;base64,${result.image_b64}`;
    const enhanced = await enhancer.enhance(mode, src);
    if (enhanced) {
      const raw = enhanced.replace(/^data:image\/[^;]+;base64,/, "");
      const img = new Image();
      img.onload = () => onUpdateImage(id, raw, img.naturalWidth, img.naturalHeight);
      img.src = enhanced;
    }
    setEnhancingId(null);
  }, [results, onUpdateImage, enhancer]);

  const handleTrimAlpha = useCallback(async (id: string, pixels: number) => {
    const result = results.find((r) => r.id === id);
    if (!result || !onUpdateImage) return;
    setTrimBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await apiFetch<{ image_b64: string; width: number; height: number }>(
        "/uilab/trim-alpha",
        { method: "POST", body: JSON.stringify({ image_b64: result.image_b64, pixels }) },
      );
      onUpdateImage(id, res.image_b64, res.width, res.height);
    } catch { /* */ }
    setTrimBusy((prev) => ({ ...prev, [id]: false }));
  }, [results, onUpdateImage]);

  const handleSendToPhotoshop = useCallback(async (id: string) => {
    const result = results.find((r) => r.id === id);
    if (!result) return;
    try {
      await apiFetch("/system/send-to-ps", {
        method: "POST",
        body: JSON.stringify({ images: [{ label: `${toolLabel}_${id}`, image_b64: result.image_b64 }] }),
      });
    } catch { /* */ }
  }, [results, toolLabel]);

  const handleAddToStyleLib = useCallback(async (id: string, folderName: string) => {
    const result = results.find((r) => r.id === id);
    if (!result) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(folderName)}/images`, {
        method: "POST",
        body: JSON.stringify([{ filename: `${toolLabel}_${id}.png`, data_url: `data:image/png;base64,${result.image_b64}` }]),
      });
    } catch { /* */ }
  }, [results, toolLabel]);

  const handleCreateStyleLib = useCallback(async (id: string) => {
    const name = window.prompt("New UI style folder name:");
    if (!name?.trim()) return;
    try {
      await apiFetch("/styles/folders", { method: "POST", body: JSON.stringify({ name: name.trim(), category: "ui" }) });
      await handleAddToStyleLib(id, name.trim());
      onRefreshStyleFolders?.();
    } catch { /* */ }
  }, [handleAddToStyleLib, onRefreshStyleFolders]);

  const previewActionBtn: CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.6)",
  };
  const expandedDeleteBtnStyle: CSSProperties = { ...previewActionBtn, color: "rgba(255,255,255,0.45)" };

  const navCircleBtn =
    "flex items-center justify-center w-10 h-10 rounded-full cursor-pointer shrink-0 transition-opacity hover:opacity-95";

  const cellLabelFor = (result: GridGalleryResult, idx: number) =>
    result.label || `${String.fromCharCode(65 + Math.floor(idx / 4))}${(idx % 4) + 1}`;

  const expandedOverlayLabel =
    expandedResult && expandedIdx >= 0 ? cellLabelFor(expandedResult, expandedIdx) : null;
  const expandedFavorited = expandedResult ? !!isFavorited?.(expandedResult.image_b64) : false;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      <div className="flex items-center px-4 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-sm font-semibold flex-1" style={{ color: "var(--color-text-primary)" }}>
          {title}
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {results.length} {toolLabel}{results.length !== 1 ? "s" : ""}
          {generating && " — generating…"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {results.length === 0 && !generating ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{emptyMessage}</p>
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {results.map((result, idx) => {
              const isBusy = editBusy[result.id] ?? false;
              const editVal = editTexts[result.id] || "";
              return (
                <div
                  key={result.id}
                  className="rounded overflow-hidden section-card-hover"
                  style={{ background: "var(--color-card)" }}
                >
                  {/* Thumbnail — double click to expand, right-click for AI enhance */}
                  <div
                    className="flex items-center justify-center p-1 cursor-pointer relative"
                    style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.15) 0% 25%, transparent 0% 50%) 50%/16px 16px" }}
                    onDoubleClick={() => handleExpand(result.id)}
                    onContextMenu={(e) => handleGridContextMenu(e, result.id)}
                    title="Double-click to expand · Right-click for AI Upres / Restore"
                  >
                    <span
                      className="absolute top-1 left-1 text-[9px] font-bold px-1 rounded z-[1]"
                      style={{ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.7)" }}
                    >
                      {result.label || `${String.fromCharCode(65 + Math.floor(idx / 4))}${(idx % 4) + 1}`}
                    </span>
                    {enhancingId === result.id && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
                        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "rgba(255,255,255,0.7)" }} />
                      </div>
                    )}
                    <img
                      src={`data:image/png;base64,${result.image_b64}`}
                      alt=""
                      className="max-w-full max-h-[160px] object-contain"
                      style={{ imageRendering: result.width <= 256 ? "pixelated" : "auto" }}
                    />
                  </div>

                  <div className="px-2 py-1.5 space-y-1" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <p className="text-[10px] text-center" style={{ color: "var(--color-text-muted)" }}>
                      {result.width}×{result.height}
                    </p>

                    <div className="flex gap-1">
                      <button
                        onClick={() => onCopy(result.id)}
                        className="flex-1 px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                        style={{ background: "rgba(42,74,90,0.3)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.5)" }}
                        title="Copy image to clipboard"
                      >Copy</button>
                      <button
                        onClick={() => {
                          const link = document.createElement("a");
                          link.href = `data:image/png;base64,${result.image_b64}`;
                          link.download = `${toolLabel}_${result.id}.png`;
                          link.click();
                        }}
                        className="flex-1 px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                        style={{ background: "rgba(42,90,42,0.3)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.5)" }}
                        title="Export as PNG"
                      >Export</button>
                      <button
                        onClick={() => onDelete(result.id)}
                        className="flex-1 px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                        style={{ background: "rgba(90,42,42,0.3)", color: "#f06060", border: "1px solid rgba(138,74,74,0.5)" }}
                        title="Remove this result"
                      >Delete</button>
                      {onToggleFavorite && (
                        <button
                          onClick={() => onToggleFavorite(result.id, result.image_b64, result.width, result.height)}
                          className="px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                          style={{
                            background: isFavorited?.(result.image_b64) ? "rgba(245,166,35,0.25)" : "rgba(245,166,35,0.1)",
                            color: isFavorited?.(result.image_b64) ? "#f5a623" : "#b08840",
                            border: `1px solid ${isFavorited?.(result.image_b64) ? "rgba(245,166,35,0.5)" : "rgba(180,140,60,0.3)"}`,
                          }}
                          title={isFavorited?.(result.image_b64) ? "Remove from favorites" : "Add to favorites (saves as standalone image)"}
                        >
                          <Star className="h-2.5 w-2.5 inline" style={isFavorited?.(result.image_b64) ? { fill: "#f5a623" } : undefined} />
                        </button>
                      )}
                    </div>

                    {/* Regenerate + Send to Mainstage */}
                    <div className="flex gap-1">
                      {onRegenerate && (
                        <button
                          onClick={() => onRegenerate(result.id)}
                          disabled={isBusy}
                          className="flex-1 px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                          style={{ background: "rgba(106,42,154,0.2)", color: "#b07ee8", border: "1px solid rgba(140,80,180,0.4)" }}
                          title="Generate another batch using this image as reference"
                        >Regen</button>
                      )}
                      {onSendToMainstage && (
                        <button
                          onClick={() => onSendToMainstage(result.id)}
                          className="flex-1 flex items-center justify-center gap-0.5 px-1 py-0.5 text-[9px] rounded cursor-pointer font-medium"
                          style={{ background: "rgba(42,90,106,0.25)", color: "#5ec9e0", border: "1px solid rgba(74,138,148,0.5)" }}
                          title="Send to Mainstage for editing"
                        >
                          <Monitor className="h-2.5 w-2.5" /> Stage
                        </button>
                      )}
                    </div>

                    <div className="flex gap-1 items-center">
                      <input
                        className="flex-1 min-w-0 px-1.5 py-0.5 text-[10px] rounded"
                        style={{
                          background: "var(--color-input-bg)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                        placeholder="Edit prompt…"
                        value={editVal}
                        onChange={(e) => handleEditChange(result.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSend(result.id); } }}
                        disabled={isBusy}
                        title="Type a prompt to modify this image, then press Enter or click Send"
                      />
                      <button
                        onClick={() => handleEditSend(result.id)}
                        disabled={isBusy || !editVal.trim()}
                        className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer font-medium shrink-0 flex items-center gap-1"
                        style={{
                          background: isBusy ? "var(--color-input-bg)" : "rgba(42,58,106,0.4)",
                          color: isBusy ? "var(--color-text-muted)" : "#5e9eff",
                          border: `1px solid ${isBusy ? "var(--color-border)" : "rgba(58,90,138,0.5)"}`,
                          opacity: !editVal.trim() && !isBusy ? 0.5 : 1,
                        }}
                        title="Send edit prompt for this image"
                      >
                        {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                        {isBusy ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Expanded image overlay ──────────────────────────────── */}
      {expandedResult && expandedOverlayLabel != null && (
          <div
            ref={overlayRef}
            className="fixed inset-0 z-[9998] flex flex-col items-center justify-center px-14 py-6"
            style={{ background: "rgba(0,0,0,0.88)" }}
            onClick={(e) => { if (e.target === overlayRef.current) handleCollapse(); }}
          >
            <button
              type="button"
              aria-label="Previous image"
              className={navCircleBtn}
              style={{
                position: "fixed",
                left: 16,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 10000,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "rgba(255,255,255,0.9)",
              }}
              onClick={(e) => { e.stopPropagation(); goExpandPrev(); }}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              className={navCircleBtn}
              style={{
                position: "fixed",
                right: 16,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 10000,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "rgba(255,255,255,0.9)",
              }}
              onClick={(e) => { e.stopPropagation(); goExpandNext(); }}
            >
              <ChevronRight className="h-6 w-6" />
            </button>

            <div
              className="relative flex flex-col items-stretch gap-3 w-full max-w-[min(92vw,1200px)] max-h-[90vh] min-h-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleCollapse}
                className="absolute -top-1 -right-1 z-10 p-1.5 rounded-full cursor-pointer"
                style={{ background: "rgba(0,0,0,0.7)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>

              <header className="text-center shrink-0 pt-1 pr-8">
                <p className="text-sm font-medium tracking-wide" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {expandedOverlayLabel} · {expandedIdx + 1} of {results.length}
                </p>
                <h2 className="text-xl font-semibold mt-0.5" style={{ color: "rgba(255,255,255,0.95)" }}>
                  Cell {expandedOverlayLabel}
                </h2>
              </header>

              <div
                ref={zoomViewportRef}
                className="flex-1 min-h-0 flex items-center justify-center rounded-lg overflow-hidden select-none"
                style={{
                  background: "repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, rgba(40,40,40,1) 0% 50%) 50%/20px 20px",
                  cursor: expandZoom > 1 ? (expandPanning ? "grabbing" : "grab") : "default",
                }}
                onPointerDown={(e) => {
                  if (expandZoom <= 1) return;
                  e.preventDefault();
                  (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  setExpandPanning(true);
                  expandPanDragRef.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    originX: expandPan.x,
                    originY: expandPan.y,
                  };
                }}
                onPointerMove={(e) => {
                  const d = expandPanDragRef.current;
                  if (!d) return;
                  setExpandPan({
                    x: d.originX + (e.clientX - d.startX),
                    y: d.originY + (e.clientY - d.startY),
                  });
                }}
                onPointerUp={(e) => {
                  if (expandPanDragRef.current) {
                    expandPanDragRef.current = null;
                    setExpandPanning(false);
                    try {
                      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                    } catch { /* */ }
                  }
                }}
                onPointerCancel={() => {
                  expandPanDragRef.current = null;
                  setExpandPanning(false);
                }}
              >
                <div
                  style={{
                    transform: `translate(${expandPan.x}px, ${expandPan.y}px) scale(${expandZoom})`,
                    transformOrigin: "center center",
                  }}
                >
                  <img
                    src={`data:image/png;base64,${expandedResult.image_b64}`}
                    alt=""
                    className="block max-w-[min(78vw,1000px)] max-h-[min(58vh,720px)] object-contain pointer-events-none"
                    draggable={false}
                    style={{
                      imageRendering: expandedResult.width <= 256 ? "pixelated" : "auto",
                    }}
                  />
                </div>
              </div>

              <p className="text-xs font-mono text-center shrink-0" style={{ color: "rgba(255,255,255,0.45)" }}>
                {expandedResult.width}×{expandedResult.height}
                {expandZoom !== 1 && ` · ${Math.round(expandZoom * 100)}%`}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 shrink-0">
                <button type="button" onClick={() => onCopy(expandedResult.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium" style={previewActionBtn} title="Copy image to clipboard">
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const l = document.createElement("a");
                    l.href = `data:image/png;base64,${expandedResult.image_b64}`;
                    l.download = `${toolLabel}_${expandedResult.id}.png`;
                    l.click();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                  style={previewActionBtn}
                  title="Save image to disk"
                >
                  Save
                </button>
                <button type="button" onClick={() => handleSendToPhotoshop(expandedResult.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium" style={previewActionBtn} title="Open in Adobe Photoshop">
                  Send to Photoshop
                </button>
                {onUpdateImage && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleEnhance(expandedResult.id, "upscale")}
                      disabled={enhancer.busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium disabled:opacity-40"
                      style={previewActionBtn}
                      title="Upscale this image using AI — makes it bigger and sharper"
                    >
                      {enhancingId === expandedResult.id ? "Processing…" : "AI Upres"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEnhance(expandedResult.id, "restore")}
                      disabled={enhancer.busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium disabled:opacity-40"
                      style={previewActionBtn}
                      title="Restore this image using AI — fixes artifacts and blur"
                    >
                      {enhancingId === expandedResult.id ? "Processing…" : "AI Restore"}
                    </button>
                  </>
                )}
                {onSendToMainstage && (
                  <button
                    type="button"
                    onClick={() => { onSendToMainstage(expandedResult.id); handleCollapse(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                    style={previewActionBtn}
                    title="Send to Mainstage for editing"
                  >
                    <Monitor className="h-3.5 w-3.5" /> Send to Mainstage
                  </button>
                )}
                {onToggleFavorite && (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(expandedResult.id, expandedResult.image_b64, expandedResult.width, expandedResult.height)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                    style={previewActionBtn}
                    title={expandedFavorited ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star className="h-3.5 w-3.5" style={expandedFavorited ? { fill: "rgba(255,255,255,0.5)" } : undefined} />
                    {expandedFavorited ? "Unfavorite" : "Favorite"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { onDelete(expandedResult.id); handleCollapse(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                  style={expandedDeleteBtnStyle}
                  title="Remove this result"
                >
                  Delete
                </button>
                {onRegenerate && (
                  <button
                    type="button"
                    onClick={() => { onRegenerate(expandedResult.id); handleCollapse(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                    style={previewActionBtn}
                    title="Generate another batch using this image as reference"
                  >
                    Regenerate
                  </button>
                )}
              </div>

              {onUpdateImage && (
                <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 rounded-lg shrink-0" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>Alpha Border:</span>
                  <button
                    type="button"
                    onClick={() => handleTrimAlpha(expandedResult.id, 1)}
                    disabled={!!trimBusy[expandedResult.id]}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                    style={previewActionBtn}
                    title="Shrink alpha border by 1px (removes green fringe)"
                  >
                    <Minus className="h-3 w-3" /> Shrink
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTrimAlpha(expandedResult.id, -1)}
                    disabled={!!trimBusy[expandedResult.id]}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                    style={previewActionBtn}
                    title="Expand alpha border by 1px"
                  >
                    <Plus className="h-3 w-3" /> Expand
                  </button>
                  {trimBusy[expandedResult.id] && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "rgba(255,255,255,0.5)" }} />}
                </div>
              )}

              {showStyleLibrary && (
                <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 rounded-lg shrink-0" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>Style Library:</span>
                  {styleLibraryFolders.length > 0 && (
                    <select
                      className="px-2 py-1 text-[11px] rounded"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAddToStyleLib(expandedResult.id, e.target.value);
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="" disabled>Add to folder…</option>
                      {styleLibraryFolders.map((f) => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCreateStyleLib(expandedResult.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                    style={previewActionBtn}
                    title="Create a new style library folder from this image"
                  >
                    <FolderPlus className="h-3 w-3" /> New Style
                  </button>
                </div>
              )}
            </div>
          </div>
      )}

      {/* Right-click context menu for grid items */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[9999] rounded shadow-lg py-1"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 180, left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="ctx-menu-item w-full text-left" onClick={() => { onCopy(ctxMenu.id); setCtxMenu(null); }}>Copy</button>
          <button className="ctx-menu-item w-full text-left" onClick={() => { handleExpand(ctxMenu.id); setCtxMenu(null); }}>View Full Size</button>
          {onSendToMainstage && (
            <button className="ctx-menu-item w-full text-left" onClick={() => { onSendToMainstage(ctxMenu.id); setCtxMenu(null); }}>Send to Mainstage</button>
          )}
          {onUpdateImage && (
            <>
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "3px 0" }} />
              <button
                className="ctx-menu-item w-full text-left"
                onClick={() => { setCtxMenu(null); handleEnhance(ctxMenu.id, "upscale"); }}
                style={enhancer.busy ? { opacity: 0.4 } : undefined}
              >{enhancer.busy ? "AI Upres (processing…)" : "AI Upres"}</button>
              <button
                className="ctx-menu-item w-full text-left"
                onClick={() => { setCtxMenu(null); handleEnhance(ctxMenu.id, "restore"); }}
                style={enhancer.busy ? { opacity: 0.4 } : undefined}
              >{enhancer.busy ? "AI Restore (processing…)" : "AI Restore"}</button>
            </>
          )}
          <div style={{ borderTop: "1px solid var(--color-border)", margin: "3px 0" }} />
          <button className="ctx-menu-item w-full text-left" onClick={() => { onDelete(ctxMenu.id); setCtxMenu(null); }} style={{ color: "#e05050" }}>Delete</button>
        </div>
      )}
    </div>
  );
}
