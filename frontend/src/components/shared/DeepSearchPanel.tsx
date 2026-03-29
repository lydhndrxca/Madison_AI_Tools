import { useState, useCallback, useRef, useEffect } from "react";
import { Button, Textarea, Select } from "@/components/ui";
import { Search, Download, Send, Copy, Check, Loader2, Image as ImageIcon, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useToastContext } from "@/hooks/ToastContext";

const DEPTH_OPTIONS = [
  { value: "quick", label: "Quick" },
  { value: "medium", label: "Medium" },
  { value: "deep", label: "Deep" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  url: string;
  b64: string;
  width: number;
  height: number;
  description?: string;
  relevance?: string;
}

interface DeepSearchPanelProps {
  onSendToArtboard?: (images: SearchResult[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeepSearchPanel({ onSendToArtboard }: DeepSearchPanelProps) {
  const { addToast } = useToastContext();
  const [query, setQuery] = useState("");
  const [numImages, setNumImages] = useState(12);
  const [depth, setDepth] = useState("medium");
  const [refImage, setRefImage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim() && !refImage) return;
    setSearching(true);
    setResults([]);
    setSelected(new Set());
    setStatus("Starting search...");
    setExpandedIdx(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body: Record<string, unknown> = {
        query: query.trim(),
        num_images: numImages,
        depth,
      };
      if (refImage) {
        body.image_b64 = refImage.replace(/^data:image\/\w+;base64,/, "");
      }

      const res = await fetch("/api/refsearch/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        addToast(`Search failed: ${text}`, "error");
        setSearching(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.status) setStatus(evt.status);
            if (evt.image) {
              setResults((prev) => {
                if (prev.some((r) => r.url === evt.image.url)) return prev;
                return [...prev, evt.image as SearchResult];
              });
            }
            if (evt.error) {
              addToast(evt.error, "error");
              break;
            }
            if (evt.done) break;
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus("Search cancelled.");
      } else {
        addToast(`Search error: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    } finally {
      setSearching(false);
      abortRef.current = null;
    }
  }, [query, numImages, depth, refImage, addToast]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setSearching(false);
  }, []);

  const handleRefImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRefImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handlePasteRefImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => setRefImage(reader.result as string);
          reader.readAsDataURL(blob);
          return;
        }
      }
      addToast("No image found in clipboard", "info");
    } catch {
      addToast("Failed to read clipboard", "error");
    }
  }, [addToast]);

  const toggleSelect = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(results.map((_, i) => i)));
  }, [results]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleCopyImage = useCallback(async (idx: number) => {
    const img = results[idx];
    if (!img) return;
    try {
      const blob = await fetch(`data:image/png;base64,${img.b64}`).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      addToast("Failed to copy image", "error");
    }
  }, [results, addToast]);

  const handleExport = useCallback(async () => {
    const toExport = selected.size > 0
      ? [...selected].map((i) => results[i]).filter(Boolean)
      : results;
    if (toExport.length === 0) return;

    for (const img of toExport) {
      const link = document.createElement("a");
      link.href = `data:image/png;base64,${img.b64}`;
      link.download = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      link.click();
    }
    addToast(`Exported ${toExport.length} image(s)`, "success");
  }, [selected, results, addToast]);

  const handleSendToArtboard = useCallback(() => {
    const toSend = selected.size > 0
      ? [...selected].map((i) => results[i]).filter(Boolean)
      : results;
    if (toSend.length === 0) return;
    onSendToArtboard?.(toSend);
    addToast(`Sent ${toSend.length} image(s) to Art Table`, "success");
  }, [selected, results, onSendToArtboard, addToast]);

  const handleExpandNav = useCallback((dir: -1 | 1) => {
    if (expandedIdx === null) return;
    const next = expandedIdx + dir;
    if (next >= 0 && next < results.length) setExpandedIdx(next);
  }, [expandedIdx, results.length]);

  useEffect(() => {
    if (expandedIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedIdx(null);
      if (e.key === "ArrowLeft") handleExpandNav(-1);
      if (e.key === "ArrowRight") handleExpandNav(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedIdx, handleExpandNav]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Search controls */}
      <div className="shrink-0 p-3 space-y-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex gap-2 items-start">
          <div className="flex-1 min-w-0">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe what you're looking for... e.g. 'medieval armor with dragon motifs' or 'guitars with pointy edges'"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSearch(); }
              }}
            />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {searching ? (
              <Button size="sm" variant="danger" onClick={handleCancel}>
                <X size={14} /> Cancel
              </Button>
            ) : (
              <Button size="sm" onClick={handleSearch} disabled={!query.trim() && !refImage}>
                <Search size={14} /> Search
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-[var(--color-text-muted)]">Depth</label>
            <Select value={depth} onChange={(e) => setDepth(e.target.value)} options={DEPTH_OPTIONS} style={{ fontSize: 11, padding: "2px 6px", minWidth: 80 }} />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-[var(--color-text-muted)]">Images</label>
            <input
              type="number"
              min={1}
              max={40}
              value={numImages}
              onChange={(e) => setNumImages(Math.max(1, Math.min(40, parseInt(e.target.value) || 12)))}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ width: 48, background: "var(--color-input)", color: "var(--color-foreground)", border: "1px solid var(--color-border)" }}
            />
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => fileInputRef.current?.click()} title="Upload reference image">
              <ImageIcon size={12} /> Ref Image
            </Button>
            <Button size="sm" onClick={handlePasteRefImage} title="Paste reference image from clipboard">
              Paste
            </Button>
            {refImage && (
              <div className="relative flex items-center gap-1 ml-1">
                <img src={refImage} alt="ref" className="h-6 w-6 object-cover rounded" style={{ border: "1px solid var(--color-border)" }} />
                <button onClick={() => setRefImage(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-foreground)] cursor-pointer" title="Remove reference image"><X size={12} /></button>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefImageUpload} />
        </div>
      </div>

      {/* Status bar */}
      {(searching || status) && (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-2" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          {searching && <Loader2 size={12} className="animate-spin text-[var(--color-text-muted)]" />}
          <span className="text-[10px] text-[var(--color-text-muted)]">{status}</span>
          {results.length > 0 && (
            <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">{results.length} found</span>
          )}
        </div>
      )}

      {/* Action bar */}
      {results.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 flex-wrap" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {selected.size > 0 ? `${selected.size} selected` : `${results.length} results`}
          </span>
          <Button size="sm" onClick={selected.size === results.length ? deselectAll : selectAll}>
            {selected.size === results.length ? "Deselect All" : "Select All"}
          </Button>
          {onSendToArtboard && (
            <Button size="sm" onClick={handleSendToArtboard} disabled={results.length === 0}>
              <Send size={12} /> Send to Art Table
            </Button>
          )}
          <Button size="sm" onClick={handleExport} disabled={results.length === 0}>
            <Download size={12} /> Export
          </Button>
        </div>
      )}

      {/* Results grid */}
      <div ref={gridRef} className="flex-1 min-h-0 overflow-y-auto p-2">
        {results.length === 0 && !searching && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3 opacity-50">
            <Search size={40} className="text-[var(--color-text-muted)]" />
            <div className="space-y-1">
              <p className="text-sm text-[var(--color-text-muted)]">Deep Reference Search</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Search the web for reference images using AI-powered visual research.
                Describe what you need or upload a reference image to find similar visuals.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {results.map((img, idx) => (
            <div
              key={`${img.url}-${idx}`}
              className="relative group rounded overflow-hidden cursor-pointer"
              style={{
                border: selected.has(idx) ? "2px solid var(--color-accent, #3b82f6)" : "2px solid transparent",
                background: "var(--color-card)",
              }}
              onClick={() => toggleSelect(idx)}
              onDoubleClick={() => setExpandedIdx(idx)}
            >
              <img
                src={`data:image/png;base64,${img.b64}`}
                alt={img.description || "Reference image"}
                className="w-full object-cover"
                style={{ aspectRatio: "1", objectFit: "cover" }}
                draggable={false}
              />
              {selected.has(idx) && (
                <div className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--color-accent, #3b82f6)" }}>
                  <Check size={12} className="text-white" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end opacity-0 group-hover:opacity-100">
                <div className="flex gap-1 p-1 w-full">
                  <button
                    className="flex-1 text-[10px] py-0.5 rounded text-white cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.2)" }}
                    onClick={(e) => { e.stopPropagation(); handleCopyImage(idx); }}
                    title="Copy image"
                  >
                    {copiedIdx === idx ? <Check size={10} className="inline" /> : <Copy size={10} className="inline" />}
                    {" "}Copy
                  </button>
                  <button
                    className="flex-1 text-[10px] py-0.5 rounded text-white cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.2)" }}
                    onClick={(e) => { e.stopPropagation(); setExpandedIdx(idx); }}
                    title="Expand"
                  >
                    View
                  </button>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5" style={{ background: "rgba(0,0,0,0.5)" }}>
                <span className="text-[9px] text-gray-300">{img.width}×{img.height}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expanded image overlay */}
      {expandedIdx !== null && results[expandedIdx] && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setExpandedIdx(null)}
        >
          <button
            className="absolute top-3 right-3 text-white/70 hover:text-white cursor-pointer z-10"
            onClick={() => setExpandedIdx(null)}
          >
            <X size={24} />
          </button>

          {expandedIdx > 0 && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white cursor-pointer z-10"
              onClick={(e) => { e.stopPropagation(); handleExpandNav(-1); }}
            >
              <ChevronLeft size={36} />
            </button>
          )}
          {expandedIdx < results.length - 1 && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white cursor-pointer z-10"
              onClick={(e) => { e.stopPropagation(); handleExpandNav(1); }}
            >
              <ChevronRight size={36} />
            </button>
          )}

          <div className="flex flex-col items-center gap-3 max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:image/png;base64,${results[expandedIdx].b64}`}
              alt={results[expandedIdx].description || "Reference"}
              className="max-h-[75vh] max-w-[85vw] object-contain rounded"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60">
                {expandedIdx + 1} of {results.length} · {results[expandedIdx].width}×{results[expandedIdx].height}
              </span>
              <Button size="sm" onClick={() => handleCopyImage(expandedIdx)}>
                <Copy size={12} /> Copy
              </Button>
              <Button size="sm" onClick={() => {
                const img = results[expandedIdx];
                const link = document.createElement("a");
                link.href = `data:image/png;base64,${img.b64}`;
                link.download = `ref_${Date.now()}.png`;
                link.click();
              }}>
                <Download size={12} /> Save
              </Button>
              {onSendToArtboard && (
                <Button size="sm" onClick={() => {
                  onSendToArtboard([results[expandedIdx]]);
                  addToast("Sent to Art Table", "success");
                }}>
                  <Send size={12} /> Art Table
                </Button>
              )}
            </div>
            {results[expandedIdx].description && (
              <p className="text-xs text-white/50 max-w-md text-center">{results[expandedIdx].description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
