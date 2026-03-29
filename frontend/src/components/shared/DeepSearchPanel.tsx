import { useState, useCallback, useRef, useEffect } from "react";
import { Button, Select } from "@/components/ui";
import {
  Search, Download, Send, Copy, Check, Loader2, X,
  ChevronLeft, ChevronRight, Plus, ImagePlus, Trash2,
  FolderPlus, RefreshCw, Star,
} from "lucide-react";
import { useToastContext } from "@/hooks/ToastContext";
import { apiFetch } from "@/hooks/useApi";

const DEPTH_OPTIONS = [
  { value: "quick", label: "Quick" },
  { value: "medium", label: "Medium" },
  { value: "deep", label: "Deep" },
];

export interface SearchResult {
  url: string;
  b64: string;
  width: number;
  height: number;
  description?: string;
  relevance?: string;
}

interface RefInput {
  id: string;
  b64: string;
  note: string;
}

interface DeepSearchPanelProps {
  onSendToArtboard?: (images: SearchResult[]) => void;
}

export function DeepSearchPanel({ onSendToArtboard }: DeepSearchPanelProps) {
  const { addToast } = useToastContext();
  const [query, setQuery] = useState("");
  const [numImages, setNumImages] = useState(12);
  const [depth, setDepth] = useState("medium");
  const [refInputs, setRefInputs] = useState<RefInput[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [libraryName, setLibraryName] = useState("");
  const [showLibraryDialog, setShowLibraryDialog] = useState(false);
  const [libraryAdded, setLibraryAdded] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  const addRefImage = useCallback((b64: string) => {
    setRefInputs((prev) => [...prev, { id: crypto.randomUUID(), b64, note: "" }]);
  }, []);

  const removeRefInput = useCallback((id: string) => {
    setRefInputs((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateRefNote = useCallback((id: string, note: string) => {
    setRefInputs((prev) => prev.map((r) => (r.id === id ? { ...r, note } : r)));
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => addRefImage(reader.result as string);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, [addRefImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => addRefImage(reader.result as string);
        reader.readAsDataURL(file);
      }
    }
  }, [addRefImage]);

  const handlePasteButton = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => addRefImage(reader.result as string);
          reader.readAsDataURL(blob);
          return;
        }
      }
      addToast("No image found in clipboard", "info");
    } catch {
      addToast("Failed to read clipboard", "error");
    }
  }, [addRefImage, addToast]);

  const handleSearch = useCallback(async (append = false) => {
    if (!query.trim() && refInputs.length === 0) return;
    setSearching(true);
    if (!append) {
      setResults([]);
      setSelected(new Set());
      setLibraryAdded(new Set());
    }
    setStatus("Starting search...");
    setSummary("");
    setExpandedIdx(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const notesContext = refInputs
      .filter((r) => r.note.trim())
      .map((r) => r.note.trim())
      .join("; ");
    const fullQuery = notesContext
      ? `${query.trim()} [Reference notes: ${notesContext}]`
      : query.trim();

    try {
      const body: Record<string, unknown> = {
        query: fullQuery,
        num_images: numImages,
        depth,
      };
      if (refInputs.length > 0) {
        body.image_b64 = refInputs[0].b64.replace(/^data:image\/[^;]+;base64,/, "");
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
            if (evt.summary) setSummary(evt.summary);
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
  }, [query, numImages, depth, refInputs, addToast]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setSearching(false);
  }, []);

  const toggleSelect = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const removeResult = useCallback((idx: number) => {
    setResults((prev) => prev.filter((_, i) => i !== idx));
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
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

  const handleCreateLibrary = useCallback(async () => {
    const name = libraryName.trim();
    if (!name) return;
    const imagesToAdd = selected.size > 0
      ? [...selected].map((i) => results[i]).filter(Boolean)
      : [...libraryAdded].map((i) => results[i]).filter(Boolean);
    if (imagesToAdd.length === 0) {
      addToast("Select images to add to the library", "info");
      return;
    }
    try {
      await apiFetch("/styles/folders", {
        method: "POST",
        body: JSON.stringify({ name, category: "reference" }),
      });
      await apiFetch(`/styles/folders/${encodeURIComponent(name)}/images`, {
        method: "POST",
        body: JSON.stringify(
          imagesToAdd.map((img, i) => ({
            filename: `ref_${Date.now()}_${i}.png`,
            data_url: `data:image/png;base64,${img.b64}`,
          })),
        ),
      });
      addToast(`Created reference library "${name}" with ${imagesToAdd.length} images`, "success");
      setShowLibraryDialog(false);
      setLibraryName("");
    } catch {
      addToast("Failed to create library", "error");
    }
  }, [libraryName, selected, libraryAdded, results, addToast]);

  const handleAddToLibrary = useCallback((idx: number) => {
    setLibraryAdded((prev) => new Set(prev).add(idx));
  }, []);

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
      e.stopPropagation();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedIdx, handleExpandNav]);

  const inputStyle: React.CSSProperties = {
    background: "var(--color-input-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
    borderRadius: 4,
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--color-background)" }}>

      {/* ── Left Panel: Inputs ── */}
      <div
        className="shrink-0 flex flex-col overflow-hidden"
        style={{
          width: 240,
          borderRight: "1px solid var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        <div className="px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[11px] font-semibold" style={{ color: "var(--color-foreground)" }}>Search Input</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {/* Query */}
          <div>
            <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--color-text-muted)" }}>What are you looking for?</label>
            <textarea
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={"e.g. 'Weathered leather textures for a medieval pouch'\nor 'Chunky sole boots with a techwear aesthetic'"}
              rows={3}
              className="w-full px-2 py-1.5 text-[11px] rounded resize-y"
              style={{ ...inputStyle, minHeight: 60 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSearch(); }
              }}
              onPaste={handlePaste}
            />
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] mb-0.5 block" style={{ color: "var(--color-text-muted)" }}>Depth</label>
              <Select value={depth} onChange={(e) => setDepth(e.target.value)} options={DEPTH_OPTIONS} style={{ fontSize: 11, padding: "3px 6px", width: "100%" }} />
            </div>
            <div style={{ width: 60 }}>
              <label className="text-[10px] mb-0.5 block" style={{ color: "var(--color-text-muted)" }}>Count</label>
              <input
                type="number" min={1} max={40} value={numImages}
                onChange={(e) => setNumImages(Math.max(1, Math.min(40, parseInt(e.target.value) || 12)))}
                className="w-full text-[11px] px-1.5 py-1 rounded"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Reference Images */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>Reference Images</label>
              <div className="flex gap-1">
                <button
                  onClick={handlePasteButton}
                  className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                >
                  Paste
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-0.5"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                >
                  <ImagePlus className="h-2.5 w-2.5" /> Add
                </button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload} />

            {refInputs.length === 0 && (
              <div
                className="rounded text-center py-4 cursor-pointer text-[10px]"
                style={{ border: "1px dashed var(--color-border)", color: "var(--color-text-muted)" }}
                onClick={() => fileInputRef.current?.click()}
              >
                Drop or paste images here
              </div>
            )}

            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {refInputs.map((ref) => (
                <div key={ref.id} className="rounded p-1.5 flex gap-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border)" }}>
                  <img src={ref.b64} alt="" className="w-10 h-10 rounded object-cover shrink-0" style={{ border: "1px solid var(--color-border)" }} />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <input
                      className="w-full text-[10px] px-1 py-0.5 rounded"
                      style={{ ...inputStyle, fontSize: 10 }}
                      placeholder="Add a note..."
                      value={ref.note}
                      onChange={(e) => updateRefNote(ref.id, e.target.value)}
                    />
                    <button
                      onClick={() => removeRefInput(ref.id)}
                      className="self-start text-[9px] cursor-pointer flex items-center gap-0.5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <Trash2 className="h-2 w-2" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Search button */}
          <div className="space-y-1.5">
            {searching ? (
              <button
                onClick={handleCancel}
                className="w-full px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium flex items-center justify-center gap-1.5"
                style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <X className="h-3 w-3" /> Cancel Search
              </button>
            ) : (
              <button
                onClick={() => handleSearch(false)}
                disabled={!query.trim() && refInputs.length === 0}
                className="w-full px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--color-text-primary)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <Search className="h-3 w-3" /> Search
              </button>
            )}
            {results.length > 0 && !searching && (
              <button
                onClick={() => handleSearch(true)}
                className="w-full px-3 py-1 text-[10px] rounded cursor-pointer flex items-center justify-center gap-1"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
              >
                <RefreshCw className="h-2.5 w-2.5" /> Search for More
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Right Panel: Results ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
        {/* Status / Summary bar */}
        {(searching || status || summary) && (
          <div className="shrink-0 px-3 py-2" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <div className="flex items-center gap-2">
              {searching && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--color-text-muted)" }} />}
              <span className="text-[10px] flex-1" style={{ color: "var(--color-text-muted)" }}>{status}</span>
              {results.length > 0 && (
                <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-secondary)" }}>{results.length} found</span>
              )}
            </div>
            {summary && (
              <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{summary}</p>
            )}
          </div>
        )}

        {/* Action bar */}
        {results.length > 0 && (
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <span className="text-[10px] mr-1" style={{ color: "var(--color-text-muted)" }}>
              {selected.size > 0 ? `${selected.size} selected` : `${results.length} results`}
            </span>
            <button
              onClick={selected.size === results.length ? () => setSelected(new Set()) : () => setSelected(new Set(results.map((_, i) => i)))}
              className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
            >
              {selected.size === results.length ? "Deselect" : "Select All"}
            </button>
            {onSendToArtboard && (
              <button
                onClick={handleSendToArtboard}
                className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-0.5"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
              >
                <Send className="h-2.5 w-2.5" /> Art Table
              </button>
            )}
            <button
              onClick={handleExport}
              className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-0.5"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
            >
              <Download className="h-2.5 w-2.5" /> Export
            </button>
            <button
              onClick={() => setShowLibraryDialog(true)}
              className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-0.5"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
            >
              <FolderPlus className="h-2.5 w-2.5" /> Create Ref Library
            </button>
          </div>
        )}

        {/* Results grid */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {results.length === 0 && !searching && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-3">
              <Search size={36} style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Deep Reference Search</p>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Search the web for reference images using AI-powered visual research.
                  Upload references, add notes describing what you need, and let the AI find matching visuals.
                </p>
                <div className="text-[10px] space-y-0.5 mt-2" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>
                  <p>Try: "Brushed brass buckles with patina for a fantasy belt"</p>
                  <p>Try: "Oversized techwear jackets with asymmetric zippers"</p>
                  <p>Try: "Hand-painted ceramic tile patterns, Moroccan style"</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {results.map((img, idx) => (
              <div
                key={`${img.url}-${idx}`}
                className="relative group rounded overflow-hidden cursor-pointer"
                style={{
                  border: selected.has(idx)
                    ? "2px solid rgba(255,255,255,0.4)"
                    : "2px solid transparent",
                  background: "var(--color-card)",
                }}
                onClick={() => toggleSelect(idx)}
                onDoubleClick={() => setExpandedIdx(idx)}
              >
                <img
                  src={`data:image/png;base64,${img.b64}`}
                  alt={img.description || "Reference image"}
                  className="w-full object-cover"
                  style={{ aspectRatio: "1" }}
                  draggable={false}
                />
                {/* Selection check */}
                {selected.has(idx) && (
                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.3)" }}>
                    <Check size={12} className="text-white" />
                  </div>
                )}
                {/* Library added star */}
                {libraryAdded.has(idx) && (
                  <div className="absolute top-1 right-1">
                    <Star size={12} fill="#facc15" className="text-yellow-400" />
                  </div>
                )}
                {/* Hover controls */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex flex-col justify-end opacity-0 group-hover:opacity-100">
                  <div className="flex gap-0.5 p-1 w-full">
                    <button
                      className="flex-1 text-[9px] py-0.5 rounded text-white cursor-pointer"
                      style={{ background: "rgba(255,255,255,0.2)" }}
                      onClick={(e) => { e.stopPropagation(); handleCopyImage(idx); }}
                    >
                      {copiedIdx === idx ? <Check size={9} className="inline" /> : <Copy size={9} className="inline" />} Copy
                    </button>
                    <button
                      className="flex-1 text-[9px] py-0.5 rounded text-white cursor-pointer"
                      style={{ background: "rgba(255,255,255,0.2)" }}
                      onClick={(e) => { e.stopPropagation(); setExpandedIdx(idx); }}
                    >
                      View
                    </button>
                    <button
                      className="text-[9px] py-0.5 px-1 rounded text-white cursor-pointer"
                      style={{ background: libraryAdded.has(idx) ? "rgba(250,204,21,0.3)" : "rgba(255,255,255,0.2)" }}
                      onClick={(e) => { e.stopPropagation(); handleAddToLibrary(idx); }}
                      title="Add to reference library"
                    >
                      <Plus size={9} className="inline" />
                    </button>
                    <button
                      className="text-[9px] py-0.5 px-1 rounded text-white cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.3)" }}
                      onClick={(e) => { e.stopPropagation(); removeResult(idx); }}
                      title="Remove"
                    >
                      <Trash2 size={9} className="inline" />
                    </button>
                  </div>
                </div>
                {/* Description & size */}
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}>
                  {img.description && (
                    <p className="text-[8px] text-gray-300 leading-tight line-clamp-2 mb-0.5">{img.description}</p>
                  )}
                  <span className="text-[8px] text-gray-400">{img.width}×{img.height}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Expanded image overlay ── */}
      {expandedIdx !== null && results[expandedIdx] && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.9)" }}
          onClick={() => setExpandedIdx(null)}
        >
          <button className="absolute top-3 right-3 text-white/70 hover:text-white cursor-pointer z-10" onClick={() => setExpandedIdx(null)}>
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
              className="max-h-[70vh] max-w-[85vw] object-contain rounded"
            />
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <span className="text-[11px] text-white/50">
                {expandedIdx + 1} / {results.length} · {results[expandedIdx].width}×{results[expandedIdx].height}
              </span>
              <button
                onClick={() => handleCopyImage(expandedIdx)}
                className="text-[10px] px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                <Copy size={10} /> Copy
              </button>
              <button
                onClick={() => {
                  const img = results[expandedIdx];
                  const link = document.createElement("a");
                  link.href = `data:image/png;base64,${img.b64}`;
                  link.download = `ref_${Date.now()}.png`;
                  link.click();
                }}
                className="text-[10px] px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                <Download size={10} /> Save
              </button>
              {onSendToArtboard && (
                <button
                  onClick={() => {
                    onSendToArtboard([results[expandedIdx]]);
                    addToast("Sent to Art Table", "success");
                  }}
                  className="text-[10px] px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                  style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  <Send size={10} /> Art Table
                </button>
              )}
              <button
                onClick={() => handleAddToLibrary(expandedIdx)}
                className="text-[10px] px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                style={{
                  background: libraryAdded.has(expandedIdx) ? "rgba(250,204,21,0.15)" : "rgba(255,255,255,0.1)",
                  color: libraryAdded.has(expandedIdx) ? "#facc15" : "rgba(255,255,255,0.8)",
                  border: `1px solid ${libraryAdded.has(expandedIdx) ? "rgba(250,204,21,0.3)" : "rgba(255,255,255,0.2)"}`,
                }}
              >
                {libraryAdded.has(expandedIdx) ? <Star size={10} fill="#facc15" /> : <Plus size={10} />}
                {libraryAdded.has(expandedIdx) ? "Added" : "Add to Library"}
              </button>
              <button
                onClick={() => { removeResult(expandedIdx); setExpandedIdx(null); }}
                className="text-[10px] px-2 py-1 rounded cursor-pointer flex items-center gap-1"
                style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <Trash2 size={10} /> Remove
              </button>
            </div>
            {results[expandedIdx].description && (
              <p className="text-[11px] text-white/60 max-w-lg text-center leading-relaxed">{results[expandedIdx].description}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Create Library Dialog ── */}
      {showLibraryDialog && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowLibraryDialog(false)}
        >
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", width: 340 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[12px] font-semibold" style={{ color: "var(--color-foreground)" }}>Create Reference Library</h3>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {selected.size > 0
                ? `${selected.size} selected images will be added.`
                : libraryAdded.size > 0
                  ? `${libraryAdded.size} starred images will be added.`
                  : "Select or star (+) images first."}
            </p>
            <input
              className="w-full px-2 py-1.5 text-[11px] rounded"
              style={inputStyle}
              placeholder="Library name..."
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateLibrary(); }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLibraryDialog(false)}
                className="px-3 py-1 text-[11px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLibrary}
                disabled={!libraryName.trim() || (selected.size === 0 && libraryAdded.size === 0)}
                className="px-3 py-1 text-[11px] rounded cursor-pointer font-medium disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.1)", color: "var(--color-text-primary)", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
