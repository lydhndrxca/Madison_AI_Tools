import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, ChevronDown, X, Copy, Download, ArrowLeft, ArrowRight, RefreshCw, Trash2, FolderOpen, CheckSquare, Square } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

interface DateEntry { date: string; count: number }
interface ToolEntry { name: string; dates: DateEntry[] }
interface TreeData { root: string; tools: ToolEntry[] }

interface ImageEntry {
  filename: string;
  width: number;
  height: number;
  model: string;
  view: string;
  generation_type: string;
  timestamp: string;
}

interface CtxMenu { x: number; y: number; idx: number }

const cardStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
};

export function GeneratedImagesPage() {
  const [tree, setTree] = useState<ToolEntry[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [selectedTool, setSelectedTool] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const imageCache = useRef<Map<string, ImageEntry[]>>(new Map());
  const fullImageCache = useRef<Map<string, string>>(new Map());

  const cacheKey = (tool: string, date: string) => `${tool}/${date}`;

  const fetchTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const resp = await apiFetch<TreeData>("/gallery/tree");
      setTree(resp.tools);
      setRootPath(resp.root);
    } catch { /* */ }
    setLoadingTree(false);
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const toggleTool = (name: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectDate = useCallback(async (tool: string, date: string) => {
    setSelectedTool(tool);
    setSelectedDate(date);
    setSelected(new Set());

    const key = cacheKey(tool, date);
    const cached = imageCache.current.get(key);
    if (cached) {
      setImages(cached);
      return;
    }

    setImages([]);
    setLoadingImages(true);
    try {
      const resp = await apiFetch<{ images: ImageEntry[] }>(`/gallery/images?tool=${encodeURIComponent(tool)}&date=${encodeURIComponent(date)}`);
      setImages(resp.images);
      imageCache.current.set(key, resp.images);
    } catch { /* */ }
    setLoadingImages(false);
  }, []);

  const openPreview = useCallback(async (idx: number) => {
    setPreviewIdx(idx);
    const img = images[idx];
    const fk = `${selectedTool}/${selectedDate}/${img.filename}`;
    const hit = fullImageCache.current.get(fk);
    if (hit) {
      setPreviewSrc(hit);
      setLoadingPreview(false);
      return;
    }
    setPreviewSrc(null);
    setLoadingPreview(true);
    try {
      const resp = await apiFetch<{ image_b64: string }>(`/gallery/image?tool=${encodeURIComponent(selectedTool)}&date=${encodeURIComponent(selectedDate)}&filename=${encodeURIComponent(img.filename)}`);
      if (resp.image_b64) {
        const dataUrl = `data:image/png;base64,${resp.image_b64}`;
        fullImageCache.current.set(fk, dataUrl);
        setPreviewSrc(dataUrl);
      }
    } catch { /* */ }
    setLoadingPreview(false);
  }, [images, selectedTool, selectedDate]);

  const closePreview = () => { setPreviewIdx(null); setPreviewSrc(null); };

  const navigatePreview = useCallback((dir: -1 | 1) => {
    if (previewIdx === null) return;
    const next = previewIdx + dir;
    if (next >= 0 && next < images.length) openPreview(next);
  }, [previewIdx, images.length, openPreview]);

  const getFullImageB64 = useCallback(async (idx: number): Promise<string | null> => {
    const img = images[idx];
    const fk = `${selectedTool}/${selectedDate}/${img.filename}`;
    const hit = fullImageCache.current.get(fk);
    if (hit) return hit;
    try {
      const resp = await apiFetch<{ image_b64: string }>(`/gallery/image?tool=${encodeURIComponent(selectedTool)}&date=${encodeURIComponent(selectedDate)}&filename=${encodeURIComponent(img.filename)}`);
      if (resp.image_b64) {
        const dataUrl = `data:image/png;base64,${resp.image_b64}`;
        fullImageCache.current.set(fk, dataUrl);
        return dataUrl;
      }
      return null;
    } catch { return null; }
  }, [images, selectedTool, selectedDate]);

  const copyImageAtIdx = useCallback(async (idx: number) => {
    const src = previewSrc && previewIdx === idx ? previewSrc : await getFullImageB64(idx);
    if (!src) return;
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch { /* */ }
  }, [previewSrc, previewIdx, getFullImageB64]);

  const downloadImageAtIdx = useCallback(async (idx: number) => {
    const src = previewSrc && previewIdx === idx ? previewSrc : await getFullImageB64(idx);
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = images[idx].filename;
    a.click();
  }, [previewSrc, previewIdx, images, getFullImageB64]);

  const deleteImages = useCallback(async (filenames: string[]) => {
    if (!filenames.length) return;
    if (!confirm(`Delete ${filenames.length} image${filenames.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      await apiFetch("/gallery/delete", {
        method: "POST",
        body: JSON.stringify({ tool: selectedTool, date: selectedDate, filenames }),
      });
      const remaining = (prev: ImageEntry[]) => prev.filter((img) => !filenames.includes(img.filename));
      setImages((prev) => {
        const next = remaining(prev);
        const key = cacheKey(selectedTool, selectedDate);
        if (next.length > 0) imageCache.current.set(key, next);
        else imageCache.current.delete(key);
        return next;
      });
      filenames.forEach((fn) => fullImageCache.current.delete(`${selectedTool}/${selectedDate}/${fn}`));
      setSelected((prev) => { const next = new Set(prev); filenames.forEach((f) => next.delete(f)); return next; });
      if (previewIdx !== null && filenames.includes(images[previewIdx]?.filename)) closePreview();
      fetchTree();
    } catch { /* */ }
  }, [selectedTool, selectedDate, previewIdx, images, fetchTree]);

  const openFolder = useCallback(async (tool = "", date = "") => {
    try {
      await apiFetch("/gallery/open-folder", {
        method: "POST",
        body: JSON.stringify({ tool, date }),
      });
    } catch { /* */ }
  }, []);

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === images.length) setSelected(new Set());
    else setSelected(new Set(images.map((i) => i.filename)));
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, idx });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", esc); };
  }, [ctxMenu]);

  // Keyboard navigation in preview
  useEffect(() => {
    if (previewIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      if (e.key === "ArrowLeft") navigatePreview(-1);
      if (e.key === "ArrowRight") navigatePreview(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewIdx, navigatePreview]);

  const currentImage = previewIdx !== null ? images[previewIdx] : null;
  const totalImages = tree.reduce((sum, t) => sum + t.dates.reduce((s, d) => s + d.count, 0), 0);
  const isCharTool = selectedTool.toLowerCase().includes("character");

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — folder tree */}
      <div className="shrink-0 overflow-y-auto flex flex-col" style={{ width: 240, borderRight: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <div className="flex items-center justify-between px-3 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>Generated Images</h2>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{totalImages} images across {tree.length} tools</p>
          </div>
          <button onClick={fetchTree} className="p-1 rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }} title="Refresh folder tree">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingTree ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {tree.length === 0 && !loadingTree && (
            <p className="px-3 py-4 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>No generated images found yet.</p>
          )}
          {tree.map((tool) => (
            <div key={tool.name}>
              <button
                onClick={() => toggleTool(tool.name)}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left cursor-pointer text-xs font-semibold"
                style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
              >
                {expandedTools.has(tool.name) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="truncate flex-1">{tool.name}</span>
                <span className="text-[10px] font-normal" style={{ color: "var(--color-text-muted)" }}>
                  {tool.dates.reduce((s, d) => s + d.count, 0)}
                </span>
              </button>
              {expandedTools.has(tool.name) && (
                <div className="ml-4">
                  {tool.dates.map((d) => {
                    const isActive = selectedTool === tool.name && selectedDate === d.date;
                    return (
                      <button
                        key={d.date}
                        onClick={() => selectDate(tool.name, d.date)}
                        className="flex items-center justify-between w-full px-3 py-1 text-left cursor-pointer text-[11px] rounded"
                        style={{
                          background: isActive ? "var(--color-hover)" : "transparent",
                          border: "none",
                          color: isActive ? "var(--color-foreground)" : "var(--color-text-secondary)",
                        }}
                      >
                        <span>{d.date}</span>
                        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{d.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Open Directory button */}
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={() => openFolder(selectedTool, selectedDate)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            title="Open the images folder on your computer"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Directory
          </button>
        </div>
      </div>

      {/* Main area — image grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedTool && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Select a tool and date folder to browse images</p>
              {rootPath && <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>{rootPath}</p>}
            </div>
          </div>
        )}

        {selectedTool && (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>{selectedTool}</h3>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{selectedDate} — {images.length} images</p>
              </div>
              <div className="flex items-center gap-2">
                {images.length > 0 && (
                  <button onClick={selectAll} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer"
                    style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                    title={selected.size === images.length ? "Deselect all" : "Select all images"}
                  >
                    {selected.size === images.length ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                    {selected.size > 0 ? `${selected.size} selected` : "Select All"}
                  </button>
                )}
                {selected.size > 0 && (
                  <button onClick={() => deleteImages(Array.from(selected))} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] cursor-pointer"
                    style={{ background: "rgba(139,58,58,0.3)", border: "1px solid rgba(139,58,58,0.5)", color: "#e05050" }}
                    title="Delete selected images"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete ({selected.size})
                  </button>
                )}
              </div>
            </div>

            {loadingImages && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin" style={{ color: "var(--color-text-muted)" }} />
              </div>
            )}

            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {images.map((img, i) => {
                const isSelected = selected.has(img.filename);
                return (
                  <div
                    key={img.filename}
                    className="rounded overflow-hidden cursor-pointer text-left group relative"
                    style={{ ...cardStyle, outline: isSelected ? "2px solid var(--color-accent-hover)" : "none" }}
                    onClick={() => openPreview(i)}
                    onContextMenu={(e) => handleContextMenu(e, i)}
                  >
                    {/* Selection checkbox */}
                    <div
                      className="absolute top-1.5 left-1.5 z-10 opacity-0 group-hover:opacity-100"
                      style={{ transition: "opacity 100ms", ...(isSelected ? { opacity: 1 } : {}) }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSelect(img.filename); }}
                        className="w-5 h-5 rounded flex items-center justify-center cursor-pointer"
                        style={{ background: isSelected ? "var(--color-accent-hover)" : "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }}
                      >
                        {isSelected && <span className="text-[10px]">✓</span>}
                      </button>
                    </div>

                    <div className="relative" style={{ aspectRatio: "1", background: "#2a2a2a" }}>
                      <img
                        src={`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/gallery/thumb?tool=${encodeURIComponent(selectedTool)}&date=${encodeURIComponent(selectedDate)}&filename=${encodeURIComponent(img.filename)}`}
                        alt={img.filename}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)", transition: "opacity 150ms" }}>
                        <span className="text-[10px] font-medium px-2 py-1 rounded" style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-foreground)" }}>View</span>
                      </div>
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[10px] truncate" style={{ color: "var(--color-text-primary)" }}>
                        {img.view && img.generation_type ? `${img.view} — ${img.generation_type}` : img.filename}
                      </p>
                      <p className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                        {img.width}×{img.height}{img.model ? ` · ${img.model.split("-").slice(0, 3).join("-")}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[9999] rounded shadow-lg py-1"
          style={{ background: "var(--color-card)", border: "1px solid var(--color-border)", minWidth: 180, left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="ctx-menu-item w-full text-left" onClick={() => { copyImageAtIdx(ctxMenu.idx); setCtxMenu(null); }}>Copy</button>
          <button className="ctx-menu-item w-full text-left" onClick={() => { downloadImageAtIdx(ctxMenu.idx); setCtxMenu(null); }}>Save As...</button>
          <button className="ctx-menu-item w-full text-left" onClick={() => { openPreview(ctxMenu.idx); setCtxMenu(null); }}>View Full Size</button>
          {isCharTool && (
            <button className="ctx-menu-item w-full text-left" onClick={async () => {
              const src = await getFullImageB64(ctxMenu.idx);
              if (src) { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await (await fetch(src)).blob() })]); } catch { /* */ } }
              setCtxMenu(null);
              alert("Image copied — switch to AI CharacterLab and paste it into Main Stage");
            }}>Send to AI CharacterLab</button>
          )}
          <div style={{ borderTop: "1px solid var(--color-border)", margin: "3px 0" }} />
          <button className="ctx-menu-item w-full text-left" onClick={() => { toggleSelect(images[ctxMenu.idx].filename); setCtxMenu(null); }}>
            {selected.has(images[ctxMenu.idx]?.filename) ? "Deselect" : "Select"}
          </button>
          <button className="ctx-menu-item w-full text-left" onClick={() => { deleteImages([images[ctxMenu.idx].filename]); setCtxMenu(null); }}
            style={{ color: "#e05050" }}
          >Delete</button>
        </div>
      )}

      {/* Preview overlay */}
      {previewIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(20,20,20,0.92)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}
          onContextMenu={(e) => { e.preventDefault(); if (previewIdx !== null) handleContextMenu(e, previewIdx); }}
        >
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
            <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {currentImage?.filename} — {previewIdx + 1} of {images.length}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => copyImageAtIdx(previewIdx)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] cursor-pointer" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "var(--color-text-secondary)" }} title="Copy image to clipboard">
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button onClick={() => downloadImageAtIdx(previewIdx)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] cursor-pointer" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "var(--color-text-secondary)" }} title="Save image to disk">
                <Download className="h-3 w-3" /> Save
              </button>
              <button onClick={closePreview} className="p-1 rounded cursor-pointer" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "var(--color-text-secondary)" }} title="Close preview (Esc)">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Nav arrows */}
          {previewIdx > 0 && (
            <button onClick={() => navigatePreview(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer z-10" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "var(--color-text-secondary)" }} title="Previous image (Left arrow)">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {previewIdx < images.length - 1 && (
            <button onClick={() => navigatePreview(1)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full cursor-pointer z-10" style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "var(--color-text-secondary)" }} title="Next image (Right arrow)">
              <ArrowRight className="h-5 w-5" />
            </button>
          )}

          {/* Image */}
          <div className="max-w-[85vw] max-h-[80vh] flex items-center justify-center">
            {loadingPreview && <RefreshCw className="h-6 w-6 animate-spin" style={{ color: "var(--color-text-muted)" }} />}
            {previewSrc && <img src={previewSrc} alt="" className="max-w-full max-h-[80vh] object-contain rounded" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }} />}
          </div>

          {/* Bottom metadata */}
          {currentImage && (
            <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-center gap-4 text-[10px] z-10" style={{ color: "var(--color-text-muted)", background: "linear-gradient(transparent, rgba(20,20,20,0.8))" }}>
              <span>{currentImage.width}×{currentImage.height}</span>
              {currentImage.model && <span>{currentImage.model}</span>}
              {currentImage.view && <span>{currentImage.view}</span>}
              {currentImage.generation_type && <span>{currentImage.generation_type}</span>}
              {currentImage.timestamp && <span>{new Date(currentImage.timestamp).toLocaleString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
