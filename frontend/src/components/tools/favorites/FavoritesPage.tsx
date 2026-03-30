import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Star,
  Trash2,
  Download,
  X,
  Filter,
  Copy,
  ChevronLeft,
  ChevronRight,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { useFavorites, type FavoriteItem } from "@/hooks/FavoritesContext";
import { apiFetch } from "@/hooks/useApi";
import { useImageEnhance } from "@/hooks/useImageEnhance";

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").slice(0, 60) || "unnamed";
}

function dataUrl(item: FavoriteItem): string {
  return item.image_b64.startsWith("data:") ? item.image_b64 : `data:image/png;base64,${item.image_b64}`;
}

const TOOL_LABELS: Record<string, string> = {
  character: "CharacterLab",
  prop: "PropLab",
  environment: "EnvironmentLab",
  uilab: "UI Lab",
  gemini: "Generate Image",
  weapon: "WeaponLab",
};

const btnNeutral: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.6)",
};

export function FavoritesPage() {
  const { favorites, removeFavorite, clearFavorites } = useFavorites();
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const enhancer = useImageEnhance();

  const tools = useMemo(() => Array.from(new Set(favorites.map((f) => f.tool))), [favorites]);

  const filtered = useMemo(
    () => (toolFilter === "all" ? favorites : favorites.filter((f) => f.tool === toolFilter)),
    [favorites, toolFilter],
  );

  const grouped = useMemo(
    () =>
      filtered.reduce<Record<string, FavoriteItem[]>>((acc, item) => {
        const date = new Date(item.timestamp).toLocaleDateString();
        (acc[date] ||= []).push(item);
        return acc;
      }, {}),
    [filtered],
  );

  const previewIdx = previewId ? filtered.findIndex((f) => f.id === previewId) : -1;
  const previewItem = previewIdx >= 0 ? filtered[previewIdx]! : null;

  useEffect(() => {
    if (!previewItem) {
      setPreviewSrc(null);
      setImgDims(null);
      return;
    }
    setPreviewSrc(dataUrl(previewItem));
    setImgDims(null);
  }, [previewItem?.id]);

  useEffect(() => {
    if (previewId && !filtered.some((f) => f.id === previewId)) setPreviewId(null);
  }, [previewId, filtered]);

  const openPreview = useCallback((item: FavoriteItem) => {
    setPreviewId(item.id);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewId(null);
    setPreviewSrc(null);
    setImgDims(null);
  }, []);

  const navigatePreview = useCallback(
    (dir: -1 | 1) => {
      if (previewIdx < 0 || filtered.length === 0) return;
      const next = previewIdx + dir;
      if (next >= 0 && next < filtered.length) setPreviewId(filtered[next]!.id);
    },
    [previewIdx, filtered],
  );

  useEffect(() => {
    if (previewId === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      if (e.key === "ArrowLeft") navigatePreview(-1);
      if (e.key === "ArrowRight") navigatePreview(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewId, closePreview, navigatePreview]);

  const handleCopyPreview = useCallback(async () => {
    if (!previewSrc || !previewItem) return;
    try {
      if (!navigator.clipboard?.write) return;
      const res = await fetch(previewSrc);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch { /* */ }
  }, [previewSrc, previewItem]);

  const handleSavePreview = useCallback(() => {
    if (!previewSrc || !previewItem) return;
    const a = document.createElement("a");
    a.href = previewSrc;
    a.download = `favorite_${safeFilename(previewItem.label)}_${previewItem.id.slice(0, 8)}.png`;
    a.click();
  }, [previewSrc, previewItem]);

  const handleSendToPS = useCallback(async () => {
    if (!previewSrc || !previewItem) return;
    const b64 = previewSrc.includes(",") ? previewSrc.split(",")[1]! : previewSrc;
    try {
      await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps",
        {
          method: "POST",
          body: JSON.stringify({
            images: [{ label: safeFilename(previewItem.label) || "favorite", image_b64: b64 }],
          }),
        },
      );
    } catch { /* */ }
  }, [previewSrc, previewItem]);

  const handleEnhancePreview = useCallback(
    async (mode: "upscale" | "restore") => {
      if (!previewSrc || enhancer.busy) return;
      const result = await enhancer.enhance(mode, previewSrc);
      if (result) setPreviewSrc(result);
    },
    [previewSrc, enhancer],
  );

  const handleRemovePreview = useCallback(() => {
    if (!previewItem || previewIdx < 0) return;
    const idx = previewIdx;
    const list = filtered;
    const nextLen = list.length - 1;
    let nextId: string | null = null;
    if (nextLen === 0) nextId = null;
    else if (idx >= nextLen) nextId = list[idx - 1]!.id;
    else nextId = list[idx + 1]!.id;
    removeFavorite(previewItem.id);
    setPreviewId(nextId);
  }, [previewIdx, previewItem, filtered, removeFavorite]);

  const handleExportAll = useCallback(() => {
    filtered.forEach((item, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = dataUrl(item);
        a.download = `favorite_${safeFilename(item.label)}_${item.id.slice(0, 8)}.png`;
        a.click();
      }, i * 200);
    });
  }, [filtered]);

  const w = previewItem?.width && previewItem.width > 0 ? previewItem.width : imgDims?.w;
  const h = previewItem?.height && previewItem.height > 0 ? previewItem.height : imgDims?.h;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Star className="h-5 w-5" style={{ color: "#f5a623" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Favorites
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {filtered.length} image{filtered.length !== 1 ? "s" : ""}
          </span>
        </h1>

        {tools.length > 1 && (
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
            <select
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="px-2 py-1 text-[11px] rounded"
              style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
            >
              <option value="all">All Tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>{TOOL_LABELS[t] || t}</option>
              ))}
            </select>
          </div>
        )}

        {filtered.length > 0 && (
          <>
            <button
              onClick={handleExportAll}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
              style={{ background: "rgba(42,90,42,0.3)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.5)" }}
              title="Export all as PNG"
            >
              <Download className="h-3 w-3" /> Export All
            </button>
            <button
              onClick={() => { if (window.confirm("Remove all favorites?")) { clearFavorites(); closePreview(); } }}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
              style={{ background: "rgba(90,42,42,0.3)", color: "#f06060", border: "1px solid rgba(138,74,74,0.5)" }}
              title="Clear all favorites"
            >
              <Trash2 className="h-3 w-3" /> Clear All
            </button>
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Star className="h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No favorites yet. Star images from any tool to see them here.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="mb-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 px-1" style={{ color: "var(--color-text-muted)" }}>
                {date}
              </p>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg overflow-hidden section-card-hover group relative"
                    style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                  >
                    <div
                      className="flex items-center justify-center p-1 cursor-pointer aspect-square"
                      style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.15) 0% 25%, transparent 0% 50%) 50%/16px 16px" }}
                      onClick={() => openPreview(item)}
                    >
                      <img
                        src={dataUrl(item)}
                        alt=""
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="px-2 py-1.5 flex items-center gap-1" style={{ borderTop: "1px solid var(--color-border)" }}>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)" }}>
                        {TOOL_LABELS[item.tool] || item.tool}
                      </span>
                      <span className="text-[9px] truncate flex-1" style={{ color: "var(--color-text-muted)" }}>{item.label}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFavorite(item.id); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer transition-opacity"
                        style={{ color: "var(--color-text-muted)" }}
                        title="Remove from favorites"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Preview overlay — match Generated Images layout */}
      {previewId && previewItem && previewIdx >= 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(10,10,10,0.95)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}
        >
          <button
            type="button"
            onClick={closePreview}
            className="absolute top-3 right-3 p-1.5 rounded cursor-pointer z-20"
            style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "rgba(255,255,255,0.5)" }}
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>

          <div
            className="flex rounded-lg overflow-hidden"
            style={{ maxWidth: "90vw", maxHeight: "90vh", background: "rgba(28,28,28,1)", border: "1px solid rgba(255,255,255,0.08)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center justify-center min-w-0" style={{ minWidth: 400, maxWidth: "60vw" }}>
              <div className="flex-1 flex items-center justify-center p-5 min-h-0 relative">
                {previewIdx > 0 && (
                  <button
                    type="button"
                    onClick={() => navigatePreview(-1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer z-10 opacity-50 hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}
                    title="Previous (←)"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                {previewIdx < filtered.length - 1 && (
                  <button
                    type="button"
                    onClick={() => navigatePreview(1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer z-10 opacity-50 hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}
                    title="Next (→)"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
                {previewSrc && (
                  <img
                    src={previewSrc}
                    alt=""
                    className="max-w-full max-h-[70vh] object-contain rounded"
                    style={{ boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }}
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      if (el.naturalWidth && el.naturalHeight) setImgDims({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                  />
                )}
              </div>

              <div className="text-[10px] pb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                {previewIdx + 1} of {filtered.length}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5 px-4 py-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <button type="button" onClick={handleCopyPreview} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium" style={btnNeutral} title="Copy image to clipboard">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                <button type="button" onClick={handleSavePreview} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium" style={btnNeutral} title="Save image to disk">
                  <Download className="h-3.5 w-3.5" /> Save
                </button>
                <button type="button" onClick={handleSendToPS} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium" style={btnNeutral} title="Open in Adobe Photoshop">
                  <Monitor className="h-3.5 w-3.5" /> Send to PS
                </button>
                <button
                  type="button"
                  onClick={() => handleEnhancePreview("upscale")}
                  disabled={enhancer.busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium disabled:opacity-40"
                  style={btnNeutral}
                  title="AI upscale"
                >
                  {enhancer.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[9px] font-bold">▲</span>} AI Upres
                </button>
                <button
                  type="button"
                  onClick={() => handleEnhancePreview("restore")}
                  disabled={enhancer.busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium disabled:opacity-40"
                  style={btnNeutral}
                  title="AI restore"
                >
                  {enhancer.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[9px] font-bold">✦</span>} AI Restore
                </button>
                <button
                  type="button"
                  onClick={handleRemovePreview}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] cursor-pointer font-medium"
                  style={{ ...btnNeutral, color: "rgba(255,255,255,0.45)" }}
                  title="Remove from favorites"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>

            <div
              className="shrink-0 overflow-y-auto flex flex-col"
              style={{ width: 340, borderLeft: "1px solid rgba(255,255,255,0.06)", background: "rgba(24,24,24,1)" }}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(94,201,224,0.15)", color: "#5ec9e0" }}>
                    {TOOL_LABELS[previewItem.tool] || previewItem.tool}
                  </span>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>Favorited</span>
                </div>
                <p className="text-[11px] break-words" style={{ color: "rgba(255,255,255,0.5)" }}>{previewItem.label}</p>
              </div>

              <div className="px-4 py-3 space-y-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Source</p>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{previewItem.source === "grid" ? "Grid gallery" : "Image viewer"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Favorited</p>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{new Date(previewItem.timestamp).toLocaleString()}</p>
                </div>
                {w && h ? (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Resolution</p>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.8)" }}>{w}&times;{h}</p>
                  </div>
                ) : null}
              </div>

              {previewItem.prompt ? (
                <div className="px-4 py-3 flex-1 min-h-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Prompt</p>
                  <p className="text-[11px] whitespace-pre-wrap leading-relaxed rounded p-2" style={{ color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.04)" }}>
                    {previewItem.prompt}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
