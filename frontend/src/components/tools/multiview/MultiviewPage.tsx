import { useState, useCallback, useRef, useEffect } from "react";
import { Card, Button, Textarea, Select, NumberStepper } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";

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
interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean; }

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  return { is, start, end, any: set.size > 0 };
}

export function MultiviewPage() {
  const [activeTab, setActiveTab] = useState("Main Stage");
  const [prompt, setPrompt] = useState("");
  const [dimension, setDimension] = useState("square");
  const busy = useBusySet();
  const [genText, setGenText] = useState<Record<string, string>>({});

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);

  const [genCount, setGenCount] = useState(1);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();

  useEffect(() => {
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models").then((r) => {
      setModels(r.models.filter((m) => m.multimodal));
      if (!modelId) setModelId(r.current);
    }).catch(() => {});
  }, []);

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
    if (!prompt.trim()) return;
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
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("generate");
  }, [prompt, dimension, getMainB64, modelId, setTabImage, addToast, busy]);

  const handleGenerateAll = useCallback(async () => {
    if (!prompt.trim()) return;
    busy.start("allviews");
    setGenText((p) => ({ ...p, allviews: "Generating all views..." }));
    try {
      const mainB64 = getMainB64();
      const resp = await apiFetch<{ images: Record<string, string | null>; errors: Record<string, string> }>("/gemini/multiview/generate-all", {
        method: "POST",
        body: JSON.stringify({ prompt, dimension, mode: "quality", base_image_b64: mainB64 }),
      });
      for (const [viewKey, b64] of Object.entries(resp.images)) {
        if (b64) {
          const tabName = Object.entries(VIEW_KEY_MAP).find(([, k]) => k === viewKey)?.[0] || viewKey;
          setTabImage(tabName, `data:image/png;base64,${b64}`);
        }
      }
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("allviews");
  }, [prompt, dimension, getMainB64, setTabImage, addToast, busy]);

  const handleGenerateSelected = useCallback(async () => {
    if (!prompt.trim() || activeTab === "Main Stage") return;
    busy.start("selected");
    setGenText((p) => ({ ...p, selected: `Generating ${activeTab}...` }));
    try {
      const mainB64 = getMainB64();
      const viewKey = VIEW_KEY_MAP[activeTab] || "front";
      const resp = await apiFetch<{ images: Record<string, string | null>; errors: Record<string, string> }>("/gemini/multiview/generate-all", {
        method: "POST",
        body: JSON.stringify({ prompt, dimension, mode: "quality", base_image_b64: mainB64, views: [viewKey] }),
      });
      for (const [key, b64] of Object.entries(resp.images)) {
        if (b64) {
          const tabName = Object.entries(VIEW_KEY_MAP).find(([, k]) => k === key)?.[0] || key;
          setTabImage(tabName, `data:image/png;base64,${b64}`);
        }
      }
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("selected");
  }, [prompt, dimension, activeTab, getMainB64, setTabImage, addToast, busy]);

  const handleCancel = useCallback(async () => {
    try { await apiFetch("/system/cancel", { method: "POST" }); } catch { /* */ }
  }, []);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string);
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  const handlePaste = useCallback(async () => {
    try { const items = await navigator.clipboard.read(); for (const item of items) { for (const type of item.types) { if (type.startsWith("image/")) { const blob = await item.getType(type); const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string); reader.readAsDataURL(blob); return; } } } } catch { /* */ }
  }, [activeTab, setTabImage]);

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

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.label} — ${m.resolution} (${m.time_estimate})` }));

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
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} className="flex-1" placeholder="Describe the image you want to generate..." />
            <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText="Generating Image..." onClick={handleGenerate}>Generate Image</Button>
            <Button className="w-full" onClick={() => {}}>Isolate Image</Button>
            <Button className="w-full" generating={busy.is("selected")} generatingText={genText.selected || "Generating view..."} onClick={handleGenerateSelected}>Generate Selected View</Button>
            <Button variant="primary" className="w-full" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating views..."} onClick={handleGenerateAll}>Generate All Views</Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel}>Cancel</Button>}
            <div className="flex items-center gap-3">
              <NumberStepper value={genCount} onChange={setGenCount} min={1} max={5} label="Count:" />
            </div>
            {modelOptions.length > 0 && (
              <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <EditHistory entries={editHistory} />
          </div>
        </Card>

        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>Actions</p>
            <Button size="sm" className="w-full">Send to Photoshop</Button>
            <Button size="sm" className="w-full" onClick={handleSaveImage}>Save All Images</Button>
            <Button size="sm" className="w-full">Open Generated Images</Button>
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
          onSaveImage={handleSaveImage}
          onCopyImage={handleCopyImage}
          onPasteImage={handlePaste}
          onOpenImage={handleOpenImage}
          imageCount={currentImages.length}
          imageIndex={currentIdx}
          onPrevImage={handlePrevImage}
          onNextImage={handleNextImage}
        />
      </div>
    </div>
  );
}
