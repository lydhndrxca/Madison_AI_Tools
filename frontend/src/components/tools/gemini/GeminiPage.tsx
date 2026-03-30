import { useState, useCallback, useRef, useEffect } from "react";
import { Card, Button, Textarea } from "@/components/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { GroupedTabBar, type TabDef } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { useModels, type ModelInfo } from "@/hooks/ModelsContext";

const DEFAULT_TABS: TabDef[] = [
  { id: "main", label: "Main Stage", group: "stage" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
];

interface EditEntry { timestamp: string; prompt: string; imageFile?: string; isOriginal?: boolean; }

const DIMENSION_PRESETS = [
  { value: "1:1", label: "Square (1:1)" },
  { value: "16:9", label: "Landscape (16:9)" },
  { value: "9:16", label: "Portrait (9:16)" },
  { value: "3:4", label: "Portrait (3:4)" },
  { value: "4:3", label: "Landscape (4:3)" },
  { value: "custom", label: "Custom" },
];

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

function formatElapsed(ms: number) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
}

export function GeminiPage() {
  const [activeTab, setActiveTab] = useState("main");
  const [tabs, setTabs] = useState<TabDef[]>(DEFAULT_TABS);
  const refCounter = useRef(0);
  const [prompt, setPrompt] = useState("");
  const busy = useBusySet();

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();

  const { models, defaultModelId } = useModels();
  const [modelId, setModelId] = useState("");
  const [aspectPreset, setAspectPreset] = useState("1:1");
  const [customW, setCustomW] = useState(1024);
  const [customH, setCustomH] = useState(1024);
  const [batchCount, setBatchCount] = useState(1);

  const [completedCount, setCompletedCount] = useState(0);
  const [genStartTime, setGenStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (defaultModelId && !modelId) setModelId(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!genStartTime) return;
    const tick = setInterval(() => setElapsed(Date.now() - genStartTime), 250);
    return () => clearInterval(tick);
  }, [genStartTime]);

  const selectedModel = models.find((m) => m.id === modelId);
  const isCustomDim = aspectPreset === "custom";
  const effectiveAspect = isCustomDim ? `${customW}:${customH}` : aspectPreset;

  const currentImages = gallery[activeTab] || [];
  const currentIdx = imageIdx[activeTab] ?? 0;
  const currentSrc = currentImages[currentIdx] ?? null;

  const setTabImage = useCallback((tab: string, src: string) => {
    setGallery((prev) => ({ ...prev, [tab]: [src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: 0 }));
  }, []);

  const appendToGallery = useCallback((tab: string, src: string) => {
    setGallery((prev) => {
      const arr = prev[tab] || [];
      const next = [...arr, src];
      setImageIdx((ip) => ({ ...ip, [tab]: next.length - 1 }));
      return { ...prev, [tab]: next };
    });
  }, []);

  const handleAddRef = useCallback(() => {
    refCounter.current++;
    const letter = String.fromCharCode(68 + refCounter.current - 1); // D, E, F...
    const id = `ref${letter}`;
    setTabs((prev) => [...prev, { id, label: `Ref ${letter}`, group: "refs" }]);
    setActiveTab(id);
  }, []);

  const handleRemoveRef = useCallback((tabId: string) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (filtered.length === prev.length) return prev;
      return filtered;
    });
    setActiveTab((prev) => prev === tabId ? "main" : prev);
    setGallery((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    setImageIdx((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    busy.start("generate");
    setCompletedCount(0);
    setGenStartTime(Date.now());
    setElapsed(0);

    const refImgs: Record<string, string> = {};
    for (const t of tabs.filter((tab) => tab.group === "refs")) {
      const arr = gallery[t.id] || [];
      const img = arr[imageIdx[t.id] ?? 0];
      if (img) refImgs[t.id] = img.replace(/^data:image\/\w+;base64,/, "");
    }
    const baseB64 = Object.values(refImgs)[0] || null;
    const refMap = Object.keys(refImgs).length > 0 ? refImgs : null;

    const promises = Array.from({ length: batchCount }, (_, i) =>
      apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>("/gemini/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          mode: "quality",
          aspect_ratio: effectiveAspect,
          base_image_b64: baseB64,
          ref_images_b64: refMap,
          model_id: modelId || undefined,
        }),
      }).then((resp) => {
        setCompletedCount((c) => c + 1);
        return { ok: true as const, resp, idx: i };
      }).catch((e) => {
        setCompletedCount((c) => c + 1);
        return { ok: false as const, error: e instanceof Error ? e.message : String(e), idx: i };
      }),
    );

    const results = await Promise.all(promises);
    let hasImage = false;
    for (const r of results.sort((a, b) => a.idx - b.idx)) {
      if (r.ok && r.resp.image_b64) {
        const src = `data:image/png;base64,${r.resp.image_b64}`;
        if (!hasImage) { setTabImage("main", src); hasImage = true; }
        else { appendToGallery("main", src); }
      } else if (r.ok && r.resp.error) { addToast(r.resp.error, "error"); }
      else if (!r.ok) { addToast(r.error, "error"); }
    }

    if (hasImage) {
      setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: prompt.slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
      addToast(batchCount > 1 ? `Generated ${results.filter((r) => r.ok && r.resp.image_b64).length} images` : "Image generated", "success");
    }

    setGenStartTime(null);
    busy.end("generate");
  }, [prompt, gallery, imageIdx, tabs, modelId, effectiveAspect, batchCount, setTabImage, appendToGallery, addToast, busy]);

  const handleCancel = useCallback(async () => {
    cancelAllRequests();
    busy.endAll();
    setGenStartTime(null);
    try { await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/system/cancel`, { method: "POST" }); } catch { /* */ }
  }, [busy]);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string);
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  useClipboardPaste(
    useCallback((dataUrl: string) => setTabImage(activeTab, dataUrl), [activeTab, setTabImage]),
  );

  const handlePaste = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) setTabImage(activeTab, dataUrl);
      else addToast("No image found in clipboard", "error");
    } catch (err) {
      addToast(`Paste failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab, setTabImage, addToast]);

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc; a.download = `gemini_${activeTab.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  const handleClearRef = useCallback(() => {
    if (activeTab.startsWith("ref")) { setGallery((prev) => ({ ...prev, [activeTab]: [] })); setImageIdx((prev) => ({ ...prev, [activeTab]: 0 })); }
  }, [activeTab]);

  const handleReset = useCallback(() => {
    setGallery({}); setImageIdx({}); setEditHistory([]); setPrompt("");
    setBatchCount(1); setAspectPreset("1:1"); setCustomW(1024); setCustomH(1024);
    setTabs(DEFAULT_TABS); setActiveTab("main");
  }, []);

  const handleSendToPS = useCallback(async () => {
    if (!currentSrc) { addToast("No image to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images: [{ label: activeTab.replace(/\s+/g, "_").toLowerCase(), image_b64: currentSrc }] }) },
      );
      if (resp.ok) addToast(resp.results[0]?.message || "Sent to Photoshop", "success");
      else addToast(resp.results[0]?.message || "Failed to send", "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [currentSrc, activeTab, addToast]);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const isRefTab = activeTab.startsWith("ref");

  const selectStyle: React.CSSProperties = { background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)", maxWidth: "100%" };
  const numInputStyle: React.CSSProperties = { ...selectStyle, width: 80 };

  useSessionRegister(
    "gemini",
    () => ({ activeTab, prompt, modelId, aspectPreset, customW, customH, batchCount, tabs, gallery, imageIdx, editHistory }),
    (s: unknown) => {
      if (s === null) {
        setActiveTab("main"); setPrompt(""); setModelId("");
        setAspectPreset("1:1"); setCustomW(1024); setCustomH(1024); setBatchCount(1);
        setTabs(DEFAULT_TABS); setGallery({}); setImageIdx({}); setEditHistory([]);
        return;
      }
      const d = s as Record<string, unknown>;
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.prompt === "string") setPrompt(d.prompt);
      if (typeof d.modelId === "string") setModelId(d.modelId);
      if (typeof d.aspectPreset === "string") setAspectPreset(d.aspectPreset);
      if (typeof d.customW === "number") setCustomW(d.customW);
      if (typeof d.customH === "number") setCustomH(d.customH);
      if (typeof d.batchCount === "number") setBatchCount(d.batchCount);
      if (Array.isArray(d.tabs)) setTabs(d.tabs as TabDef[]);
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (d.editHistory) setEditHistory(d.editHistory as EditEntry[]);
    },
  );

  // --- Voice Director command listener ---
  const voiceCmdRef = useRef({ generate: handleGenerate });
  voiceCmdRef.current = { generate: handleGenerate };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      if (action === "generate") {
        if (params.prompt) setPrompt(String(params.prompt));
        setTimeout(() => voiceCmdRef.current.generate(), 50);
      }
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, []);

  // --- Gallery restore listener ---
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown>;
      if (d._source_tool !== "gemini") return;
      if (typeof d.description === "string") setPrompt(d.description);
      if (typeof d.prompt === "string") setPrompt(d.prompt as string);
      if (typeof d.model === "string") setModelId(d.model as string);
      if (typeof d._image_b64 === "string") {
        const src = (d._image_b64 as string).startsWith("data:") ? d._image_b64 as string : `data:image/png;base64,${d._image_b64}`;
        setGallery((prev) => ({ ...prev, main: [src] }));
        setImageIdx((prev) => ({ ...prev, main: 0 }));
      }
    };
    window.addEventListener("gallery-restore", handler);
    return () => window.removeEventListener("gallery-restore", handler);
  }, []);

  const isGenerating = busy.is("generate");
  const pct = batchCount > 0 && isGenerating ? (completedCount / batchCount) * 100 : 0;

  return (
    <div className="flex h-full">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Left Panel */}
      <div className="w-[350px] shrink-0 flex flex-col gap-3 overflow-y-auto p-3" style={{ borderRight: "1px solid var(--color-border)" }}>
        {/* Prompt */}
        <Card>
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Prompt</p>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} placeholder="Describe what you want to see — be as detailed as you like. e.g. A futuristic city at sunset with flying cars..." disabled={isGenerating} />
          </div>
        </Card>

        {/* Model */}
        <Card>
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Model</p>
            {models.length > 0 && (
              <select className="w-full min-w-0 px-2 py-1.5 text-xs truncate" style={selectStyle} value={modelId} onChange={(e) => setModelId(e.target.value)} title="AI model for generation">
                {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.resolution} ({m.time_estimate})</option>)}
              </select>
            )}
            {selectedModel && (
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {selectedModel.resolution}
              </p>
            )}
          </div>
        </Card>

        {/* Dimensions */}
        <Card>
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Dimensions</p>
            <select className="w-full min-w-0 px-2 py-1.5 text-xs" style={selectStyle} value={aspectPreset} onChange={(e) => setAspectPreset(e.target.value)} title="Output aspect ratio">
              {DIMENSION_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {isCustomDim && (
              <div className="flex items-center gap-2">
                <input type="number" min={64} max={8192} value={customW} onChange={(e) => setCustomW(Math.max(64, Math.min(8192, Number(e.target.value))))} className="px-2 py-1 text-xs" style={numInputStyle} />
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{"\u00d7"}</span>
                <input type="number" min={64} max={8192} value={customH} onChange={(e) => setCustomH(Math.max(64, Math.min(8192, Number(e.target.value))))} className="px-2 py-1 text-xs" style={numInputStyle} />
              </div>
            )}
          </div>
        </Card>

        {/* Generate */}
        <Card>
          <div className="px-3 py-2 space-y-2">
            <NumberStepper value={batchCount} onChange={setBatchCount} min={1} max={20} label="Count:" />
            <Button variant="primary" className="w-full" generating={isGenerating} generatingText={batchCount > 1 ? `Generating ${completedCount}/${batchCount}...` : "Generating..."} onClick={handleGenerate} title="Generate from prompt">
              Generate {batchCount > 1 ? `${batchCount} Images` : "Image"}
            </Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel} title="Cancel generation">Cancel</Button>}
          </div>
        </Card>

        {/* Input & Actions */}
        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>Input</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" className="w-full" onClick={handleOpenImage} title="Open image from disk">Open Image</Button>
              <Button size="sm" className="w-full" onClick={handlePaste} title="Paste from clipboard">Paste Image</Button>
              <Button size="sm" className="w-full" onClick={handleSendToPS} title="Send to Photoshop">Send to PS</Button>
              <Button size="sm" className="w-full" onClick={handleSaveImage} title="Save image to disk">Save Image</Button>
            </div>
            <Button size="sm" className="w-full" onClick={handleReset} title="Clear all">Reset</Button>
          </div>
        </Card>

        <EditHistory entries={editHistory} />
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <GroupedTabBar
          tabs={tabs}
          active={activeTab}
          onSelect={setActiveTab}
          onAddRef={handleAddRef}
          onRemoveTab={handleRemoveRef}
        />
        <ImageViewer
          src={currentSrc}
          placeholder={`No ${(tabs.find((t) => t.id === activeTab)?.label ?? activeTab).toLowerCase()} image loaded`}
          showToolbar={true}
          locked={isGenerating}
          onSaveImage={handleSaveImage}
          onCopyImage={handleCopyImage}
          onPasteImage={handlePaste}
          onOpenImage={handleOpenImage}
          onClearImage={isRefTab ? handleClearRef : undefined}
          imageCount={currentImages.length}
          imageIndex={currentIdx}
          onPrevImage={handlePrevImage}
          onNextImage={handleNextImage}
          isFavorited={currentSrc ? isFavorited(currentSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
          onToggleFavorite={currentSrc ? () => { const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "gemini", label: "main", source: "viewer" }); } : undefined}
        />

        {/* Progress / Status Bar */}
        {isGenerating && (
          <div className="shrink-0 flex items-center gap-3 px-3 py-1.5" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <div className="relative h-3.5 w-3.5 shrink-0">
              <div className="absolute inset-0 rounded-full animate-spin" style={{ border: "2px solid var(--color-border)", borderTopColor: "var(--color-accent)" }} />
            </div>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-input-bg)" }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent)", transition: "width 300ms", boxShadow: "0 0 6px var(--color-accent)" }} />
            </div>
            <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-text-muted)" }}>{completedCount}/{batchCount}</span>
            <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-text-muted)" }}>{formatElapsed(elapsed)}</span>
            {selectedModel && <span className="text-[10px] shrink-0 truncate max-w-[10rem]" style={{ color: "var(--color-text-muted)" }}>{selectedModel.label}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
