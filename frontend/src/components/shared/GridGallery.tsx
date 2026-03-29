import { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, X, Minus, Plus, FolderPlus, Monitor, Star } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridGalleryResult {
  id: string;
  image_b64: string;
  width: number;
  height: number;
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
  }, []);

  useEffect(() => {
    if (!expandedId) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setExpandedId(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedId]);

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

  const expandedResult = expandedId ? results.find((r) => r.id === expandedId) : null;

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
            {results.map((result) => {
              const isBusy = editBusy[result.id] ?? false;
              const editVal = editTexts[result.id] || "";
              return (
                <div
                  key={result.id}
                  className="rounded overflow-hidden section-card-hover"
                  style={{ background: "var(--color-card)" }}
                >
                  {/* Thumbnail — double click to expand */}
                  <div
                    className="flex items-center justify-center p-1 cursor-pointer"
                    style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.15) 0% 25%, transparent 0% 50%) 50%/16px 16px" }}
                    onDoubleClick={() => handleExpand(result.id)}
                    title="Double-click to expand"
                  >
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
      {expandedResult && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[9998] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
          onClick={(e) => { if (e.target === overlayRef.current) handleCollapse(); }}
        >
          <div
            className="relative flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={handleCollapse}
              className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full cursor-pointer"
              style={{ background: "rgba(0,0,0,0.7)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Large image */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, rgba(40,40,40,1) 0% 50%) 50%/20px 20px" }}
            >
              <img
                src={`data:image/png;base64,${expandedResult.image_b64}`}
                alt=""
                className="block"
                style={{
                  maxWidth: "70vw",
                  maxHeight: "65vh",
                  objectFit: "contain",
                  imageRendering: expandedResult.width <= 256 ? "pixelated" : "auto",
                }}
              />
            </div>

            <p className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
              {expandedResult.width}×{expandedResult.height}
            </p>

            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button onClick={() => onCopy(expandedResult.id)} className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(42,74,90,0.5)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.6)" }}>Copy</button>
              <button onClick={() => { const l = document.createElement("a"); l.href = `data:image/png;base64,${expandedResult.image_b64}`; l.download = `${toolLabel}_${expandedResult.id}.png`; l.click(); }} className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(42,90,42,0.5)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.6)" }}>Export</button>
              <button onClick={() => handleSendToPhotoshop(expandedResult.id)} className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(42,58,106,0.5)", color: "#5e9eff", border: "1px solid rgba(58,90,138,0.6)" }}>Send to Photoshop</button>
              {onSendToMainstage && (
                <button onClick={() => { onSendToMainstage(expandedResult.id); handleCollapse(); }} className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(42,90,106,0.45)", color: "#5ec9e0", border: "1px solid rgba(74,138,148,0.6)" }}>
                  <Monitor className="h-3.5 w-3.5" /> Send to Mainstage
                </button>
              )}
              {onRegenerate && (
                <button onClick={() => { onRegenerate(expandedResult.id); handleCollapse(); }} className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(106,42,154,0.4)", color: "#b07ee8", border: "1px solid rgba(140,80,180,0.5)" }}>Regenerate</button>
              )}
              <button onClick={() => { onDelete(expandedResult.id); handleCollapse(); }} className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium" style={{ background: "rgba(90,42,42,0.5)", color: "#f06060", border: "1px solid rgba(138,74,74,0.6)" }}>Delete</button>
              {onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(expandedResult.id, expandedResult.image_b64, expandedResult.width, expandedResult.height)}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
                  style={{
                    background: isFavorited?.(expandedResult.image_b64) ? "rgba(245,166,35,0.35)" : "rgba(245,166,35,0.15)",
                    color: isFavorited?.(expandedResult.image_b64) ? "#f5a623" : "#b08840",
                    border: `1px solid ${isFavorited?.(expandedResult.image_b64) ? "rgba(245,166,35,0.6)" : "rgba(180,140,60,0.4)"}`,
                  }}
                >
                  <Star className="h-3.5 w-3.5" style={isFavorited?.(expandedResult.image_b64) ? { fill: "#f5a623" } : undefined} />
                  {isFavorited?.(expandedResult.image_b64) ? "Unfavorite" : "Favorite"}
                </button>
              )}
            </div>

            {/* Green fringe trim controls */}
            {onUpdateImage && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>Alpha Border:</span>
                <button
                  onClick={() => handleTrimAlpha(expandedResult.id, 1)}
                  disabled={!!trimBusy[expandedResult.id]}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                  style={{ background: "rgba(42,90,42,0.4)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.5)" }}
                  title="Shrink alpha border by 1px (removes green fringe)"
                >
                  <Minus className="h-3 w-3" /> Shrink
                </button>
                <button
                  onClick={() => handleTrimAlpha(expandedResult.id, -1)}
                  disabled={!!trimBusy[expandedResult.id]}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                  style={{ background: "rgba(42,58,106,0.4)", color: "#5e9eff", border: "1px solid rgba(58,90,138,0.5)" }}
                  title="Expand alpha border by 1px"
                >
                  <Plus className="h-3 w-3" /> Expand
                </button>
                {trimBusy[expandedResult.id] && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "rgba(255,255,255,0.5)" }} />}
              </div>
            )}

            {/* Style Library actions */}
            {showStyleLibrary && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>Style Library:</span>
                {styleLibraryFolders.length > 0 && (
                  <select
                    className="px-2 py-1 text-[11px] rounded"
                    style={{ background: "rgba(30,30,30,0.9)", color: "#ccc", border: "1px solid rgba(255,255,255,0.15)" }}
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
                  onClick={() => handleCreateStyleLib(expandedResult.id)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded cursor-pointer font-medium"
                  style={{ background: "rgba(106,42,154,0.3)", color: "#b07ee8", border: "1px solid rgba(140,80,180,0.4)" }}
                  title="Create a new style library folder from this image"
                >
                  <FolderPlus className="h-3 w-3" /> New Style
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
