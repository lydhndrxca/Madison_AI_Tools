import { useState, useCallback, useRef, useEffect } from "react";
import { Card, Button, Textarea, Select, NumberStepper } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { useModels, type ModelInfo } from "@/hooks/ModelsContext";
import { useGenerationStatus } from "@/hooks/GenerationStatusContext";

const VIEW_TABS = ["Main Stage", "3/4", "Front", "Back", "Side", "Top", "Bottom"];
const DIMENSIONS = [
  { value: "square", label: "Square (1:1)" },
  { value: "portrait", label: "Portrait (9:16)" },
  { value: "landscape", label: "Landscape (16:9)" },
];

const VIEW_KEY_MAP: Record<string, string> = {
  "Main Stage": "main",
  "3/4": "threequarter",
  Front: "front",
  Back: "back",
  Side: "side",
  Top: "top",
  Bottom: "bottom",
};

interface EditEntry { timestamp: string; prompt: string; isOriginal?: boolean; }

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

export function MultiviewPage() {
  const [activeTab, setActiveTab] = useState("Main Stage");
  const [prompt, setPrompt] = useState("");
  const [dimension, setDimension] = useState("square");
  const busy = useBusySet();
  const genStatus = useGenerationStatus();
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (busy.any && !prevBusyRef.current) genStatus.startPage("multiview");
    else if (!busy.any && prevBusyRef.current) genStatus.endPage("multiview");
    prevBusyRef.current = busy.any;
  }, [busy.any, genStatus]);
  const [genText, setGenText] = useState<Record<string, string>>({});

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);

  const [genCount, setGenCount] = useState(1);
  const { models, defaultModelId } = useModels();
  const [modelId, setModelId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();

  useEffect(() => {
    if (defaultModelId && !modelId) setModelId(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentImages = gallery[activeTab] || [];
  const currentIdx = imageIdx[activeTab] ?? 0;
  const currentSrc = currentImages[currentIdx] ?? null;

  const setTabImage = useCallback((tab: string, src: string) => {
    setGallery((prev) => ({ ...prev, [tab]: [src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: 0 }));
  }, []);

  const getMainB64 = useCallback(() => {
    const imgs = gallery["Main Stage"] || [];
    const src = imgs[imageIdx["Main Stage"] ?? 0];
    return src ? src.replace(/^data:image\/\w+;base64,/, "") : null;
  }, [gallery, imageIdx]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      addToast("Enter a prompt first", "error");
      return;
    }
    busy.start("generate");
    setGenText((p) => ({ ...p, generate: "Generating image..." }));
    try {
      const base = getMainB64();
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>("/gemini/multiview/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, mode: "quality", aspect_ratio: dimension, base_image_b64: base, model_id: modelId || undefined }),
      });
      if (resp.image_b64) {
        setTabImage("Main Stage", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: prompt.slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
        addToast("Image generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      busy.end("generate");
    }
  }, [prompt, dimension, getMainB64, modelId, setTabImage, addToast, busy]);

  const mergeResponseIntoGallery = useCallback(
    (resp: { images?: Record<string, string | null> | null; errors?: Record<string, string> | null }) => {
      const images = resp.images ?? {};
      const errs = resp.errors ?? {};
      let got = 0;
      for (const [viewKey, b64] of Object.entries(images)) {
        if (b64) {
          const tabName = Object.entries(VIEW_KEY_MAP).find(([, k]) => k === viewKey)?.[0] || viewKey;
          setTabImage(tabName, `data:image/png;base64,${b64}`);
          got += 1;
        }
      }
      if (errs._global) addToast(errs._global, "error");
      for (const [k, v] of Object.entries(errs)) {
        if (k !== "_global") addToast(`${k}: ${v}`, "error");
      }
      if (got > 0) addToast(`Generated ${got} view(s)`, "success");
      else if (!errs._global && Object.keys(errs).length === 0) {
        addToast("No images returned — check API key, Main Stage image, or prompt", "error");
      }
    },
    [setTabImage, addToast],
  );

  const handleGenerateAll = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!prompt.trim() && !mainB64) {
      addToast("Load an image on Main Stage, or enter a prompt", "error");
      return;
    }
    busy.start("allviews");
    setGenText((p) => ({ ...p, allviews: "Generating all views..." }));
    try {
      const resp = await apiFetch<{ images: Record<string, string | null>; errors: Record<string, string> }>("/gemini/multiview/generate-all", {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim(),
          dimension,
          mode: "quality",
          base_image_b64: mainB64,
          model_id: modelId || undefined,
        }),
      });
      mergeResponseIntoGallery(resp);
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      busy.end("allviews");
    }
  }, [prompt, dimension, getMainB64, modelId, mergeResponseIntoGallery, addToast, busy]);

  const handleGenerateSelected = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!prompt.trim() && !mainB64) {
      addToast("Load an image on Main Stage, or enter a prompt", "error");
      return;
    }
    if (activeTab === "Main Stage") {
      addToast("Select a view tab (Front, Back, Side, etc.) — not Main Stage", "error");
      return;
    }
    const viewKey = VIEW_KEY_MAP[activeTab] || "front";
    const n = Math.max(1, Math.min(5, genCount));
    busy.start("selected");
    setGenText((p) => ({ ...p, selected: n > 1 ? `Generating ${n}× ${activeTab}...` : `Generating ${activeTab}...` }));
    try {
      if (n === 1) {
        const resp = await apiFetch<{ images: Record<string, string | null>; errors: Record<string, string> }>("/gemini/multiview/generate-all", {
          method: "POST",
          body: JSON.stringify({
            prompt: prompt.trim(),
            dimension,
            mode: "quality",
            base_image_b64: mainB64,
            views: [viewKey],
            model_id: modelId || undefined,
          }),
        });
        mergeResponseIntoGallery(resp);
      } else {
        const promises = Array.from({ length: n }, () =>
          apiFetch<{ images: Record<string, string | null>; errors: Record<string, string> }>("/gemini/multiview/generate-all", {
            method: "POST",
            body: JSON.stringify({
              prompt: prompt.trim(),
              dimension,
              mode: "quality",
              base_image_b64: mainB64,
              views: [viewKey],
              model_id: modelId || undefined,
            }),
          }),
        );
        const all = await Promise.all(promises);
        const blobs: string[] = [];
        for (let i = 0; i < all.length; i++) {
          const resp = all[i];
          const b64 = resp.images?.[viewKey];
          if (b64) blobs.push(`data:image/png;base64,${b64}`);
          else {
            const err = resp.errors?.[viewKey] || resp.errors?._global || "No image";
            addToast(`${activeTab} #${i + 1}: ${err}`, "error");
          }
        }
        if (blobs.length > 0) {
          setGallery((prev) => ({ ...prev, [activeTab]: blobs }));
          setImageIdx((prev) => ({ ...prev, [activeTab]: blobs.length - 1 }));
          addToast(`Generated ${blobs.length} image(s) for ${activeTab}`, "success");
        }
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      busy.end("selected");
    }
  }, [prompt, dimension, activeTab, getMainB64, modelId, genCount, mergeResponseIntoGallery, setTabImage, addToast, busy]);

  const handleCancel = useCallback(async () => {
    cancelAllRequests();
    busy.endAll();
    try { await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/system/cancel`, { method: "POST" }); } catch { /* */ }
  }, [busy]);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string);
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  // Global Ctrl+V paste — uses Electron native clipboard for external images
  useClipboardPaste(
    useCallback((dataUrl: string) => setTabImage(activeTab, dataUrl), [activeTab, setTabImage]),
  );

  const handlePaste = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) {
        setTabImage(activeTab, dataUrl);
      } else {
        addToast("No image found in clipboard", "error");
      }
    } catch (err) {
      addToast(`Paste failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab, setTabImage, addToast]);

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc; a.download = `multiview_${activeTab.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  const handleReset = useCallback(() => { setGallery({}); setImageIdx({}); setEditHistory([]); setPrompt(""); }, []);

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

  const handleImageEdited = useCallback((newSrc: string, label: string) => {
    const idx = currentIdx;
    setGallery((prev) => {
      const arr = [...(prev[activeTab] || [])];
      arr[idx] = newSrc;
      return { ...prev, [activeTab]: arr };
    });
    setEditHistory((prev) => [{ timestamp: new Date().toISOString(), prompt: label }, ...prev]);
  }, [activeTab, currentIdx]);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.label} — ${m.resolution} (${m.time_estimate})` }));

  useSessionRegister(
    "multiview",
    () => ({ activeTab, prompt, dimension, gallery, imageIdx, editHistory, genCount, modelId }),
    (s: unknown) => {
      if (s === null) {
        setActiveTab("Main Stage"); setPrompt(""); setDimension("square");
        setGallery({}); setImageIdx({}); setEditHistory([]);
        setGenCount(1); setModelId("");
        return;
      }
      const d = s as Record<string, unknown>;
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.prompt === "string") setPrompt(d.prompt);
      if (typeof d.dimension === "string") setDimension(d.dimension);
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (d.editHistory) setEditHistory(d.editHistory as EditEntry[]);
      if (typeof d.genCount === "number") setGenCount(d.genCount);
      if (typeof d.modelId === "string") setModelId(d.modelId);
    },
  );

  // --- Voice Director command listener ---
  const voiceCmdRef = useRef({ generate: handleGenerate, allViews: handleGenerateAll, selectedView: handleGenerateSelected });
  voiceCmdRef.current = { generate: handleGenerate, allViews: handleGenerateAll, selectedView: handleGenerateSelected };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      if (action === "generate") {
        if (params.prompt) setPrompt(String(params.prompt));
        setTimeout(() => voiceCmdRef.current.generate(), 50);
      } else if (action === "generate_all_views") voiceCmdRef.current.allViews();
      else if (action === "generate_selected_view") voiceCmdRef.current.selectedView();
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, []);

  return (
    <div className="flex h-full">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Left Panel */}
      <div className="w-[350px] shrink-0 flex flex-col gap-3 overflow-y-auto p-3" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>Input</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" className="w-full" onClick={handleOpenImage}>Open Image</Button>
              <Button size="sm" className="w-full" onClick={handleCopyImage}>Copy Image</Button>
              <Button size="sm" className="w-full" onClick={handlePaste}>Paste Image</Button>
              <Button size="sm" className="w-full" onClick={handleReset}>Reset</Button>
            </div>
          </div>
        </Card>

        <Card className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 flex flex-col flex-1 min-h-0 gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Prompt</p>
            <Select label="Image Dimensions" options={DIMENSIONS} value={dimension} onChange={(e) => setDimension(e.target.value)} />
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe image:</p>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} className="flex-1" placeholder="Describe what you want to see — e.g. A medieval sword with ornate handle..." disabled={busy.any} />
            <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText="Generating Image..." onClick={handleGenerate} title="Generate a new image from your prompt">Generate Image</Button>
            <Button variant="primary" className="w-full" generating={busy.is("selected")} generatingText={genText.selected || "Generating view..."} onClick={handleGenerateSelected} title="Generate current view only">Generate Selected View</Button>
            <Button variant="primary" className="w-full" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating views..."} onClick={handleGenerateAll} title="Generate all views at once">Generate All Views</Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel} title="Stop the current generation">Cancel</Button>}
            <div className="flex items-center gap-3">
              <NumberStepper value={genCount} onChange={setGenCount} min={1} max={5} label="Count:" />
            </div>
            {modelOptions.length > 0 && (
              <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} value={modelId} onChange={(e) => setModelId(e.target.value)} title="AI model for generation">
                {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <EditHistory entries={editHistory} />
          </div>
        </Card>

        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>Actions</p>
            <Button size="sm" className="w-full" onClick={handleSendToPS} title="Open the current image in Photoshop">Send to PS</Button>
            <Button size="sm" className="w-full" onClick={handleSaveImage} title="Save the current view image">Save Image</Button>
          </div>
        </Card>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <TabBar tabs={VIEW_TABS} active={activeTab} onSelect={setActiveTab} />
        <ImageViewer
          src={currentSrc}
          placeholder={`No ${activeTab.toLowerCase()} image loaded`}
          showToolbar={true}
          locked={busy.any}
          onSaveImage={handleSaveImage}
          onCopyImage={handleCopyImage}
          onPasteImage={handlePaste}
          onOpenImage={handleOpenImage}
          onImageEdited={handleImageEdited}
          imageCount={currentImages.length}
          imageIndex={currentIdx}
          onPrevImage={handlePrevImage}
          onNextImage={handleNextImage}
          isFavorited={currentSrc ? isFavorited(currentSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
          onToggleFavorite={currentSrc ? () => {
            const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, "");
            if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); }
            else addFavorite({ image_b64: b64, tool: "multiview", label: activeTab || "main", source: "viewer" });
          } : undefined}
        />
      </div>
    </div>
  );
}
