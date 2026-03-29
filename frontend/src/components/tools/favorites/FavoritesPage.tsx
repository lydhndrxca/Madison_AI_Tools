import { useState, useCallback } from "react";
import { Star, Trash2, Download, X, Filter } from "lucide-react";
import { useFavorites, type FavoriteItem } from "@/hooks/FavoritesContext";

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").slice(0, 60) || "unnamed";
}

const TOOL_LABELS: Record<string, string> = {
  character: "CharacterLab",
  prop: "PropLab",
  environment: "EnvironmentLab",
  uilab: "UI Lab",
  gemini: "Generate Image",
  weapon: "WeaponLab",
};

export function FavoritesPage() {
  const { favorites, removeFavorite, clearFavorites } = useFavorites();
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [expandedItem, setExpandedItem] = useState<FavoriteItem | null>(null);

  const tools = Array.from(new Set(favorites.map((f) => f.tool)));

  const filtered = toolFilter === "all" ? favorites : favorites.filter((f) => f.tool === toolFilter);

  const grouped = filtered.reduce<Record<string, FavoriteItem[]>>((acc, item) => {
    const date = new Date(item.timestamp).toLocaleDateString();
    (acc[date] ||= []).push(item);
    return acc;
  }, {});

  const handleCopy = useCallback(async (item: FavoriteItem) => {
    try {
      if (!navigator.clipboard?.write) return;
      const src = item.image_b64.startsWith("data:") ? item.image_b64 : `data:image/png;base64,${item.image_b64}`;
      const res = await fetch(src);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch { /* */ }
  }, []);

  const handleExport = useCallback((item: FavoriteItem) => {
    const a = document.createElement("a");
    a.href = item.image_b64.startsWith("data:") ? item.image_b64 : `data:image/png;base64,${item.image_b64}`;
    a.download = `favorite_${safeFilename(item.label)}_${item.id.slice(0, 8)}.png`;
    a.click();
  }, []);

  const handleExportAll = useCallback(() => {
    filtered.forEach((item, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = item.image_b64.startsWith("data:") ? item.image_b64 : `data:image/png;base64,${item.image_b64}`;
        a.download = `favorite_${safeFilename(item.label)}_${item.id.slice(0, 8)}.png`;
        a.click();
      }, i * 200);
    });
  }, [filtered]);

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
              title="Export all visible favorites as PNG files"
            >
              <Download className="h-3 w-3" /> Export All
            </button>
            <button
              onClick={() => { if (window.confirm("Remove all favorites?")) { clearFavorites(); setExpandedItem(null); } }}
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
                      onClick={() => setExpandedItem(item)}
                    >
                      <img
                        src={`data:image/png;base64,${item.image_b64}`}
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

      {/* Expanded overlay */}
      {expandedItem && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
          onClick={() => setExpandedItem(null)}
        >
          <div className="relative flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setExpandedItem(null)}
              className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full cursor-pointer"
              style={{ background: "rgba(0,0,0,0.7)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="rounded-lg overflow-hidden" style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, rgba(40,40,40,1) 0% 50%) 50%/20px 20px" }}>
              <img
                src={`data:image/png;base64,${expandedItem.image_b64}`}
                alt=""
                style={{ maxWidth: "70vw", maxHeight: "65vh", objectFit: "contain" }}
              />
            </div>
            {expandedItem.prompt && (
              <p className="text-[11px] max-w-lg text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
                {expandedItem.prompt.slice(0, 200)}{expandedItem.prompt.length > 200 ? "\u2026" : ""}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(expandedItem)}
                className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(42,74,90,0.5)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.6)" }}
              >Copy</button>
              <button
                onClick={() => handleExport(expandedItem)}
                className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(42,90,42,0.5)", color: "#4ec9a0", border: "1px solid rgba(74,138,74,0.6)" }}
              >Export</button>
              <button
                onClick={() => { removeFavorite(expandedItem.id); setExpandedItem(null); }}
                className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(90,42,42,0.5)", color: "#f06060", border: "1px solid rgba(138,74,74,0.6)" }}
              >Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
