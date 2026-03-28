import { useState, useCallback, useRef } from "react";
import { Card, Button, Textarea } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";

const VIEW_TABS = ["Main Stage", "Ref A", "Ref B", "Ref C"];

interface EditEntry { timestamp: string; prompt: string; imageFile?: string; isOriginal?: boolean; }

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  return { is, start, end, any: set.size > 0 };
}

export function GeminiPage() {
  const [activeTab, setActiveTab] = useState("Main Stage");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"quality" | "speed">("quality");
  const busy = useBusySet();

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();

  const currentImages = gallery[activeTab] || [];
  const currentIdx = imageIdx[activeTab] ?? 0;
  const currentSrc = currentImages[currentIdx] ?? null;

  const setTabImage = useCallback((tab: string, src: string) => {
    setGallery((prev) => ({ ...prev, [tab]: [src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: 0 }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    busy.start("generate");
    try {
      const refImgs: Record<string, string> = {};
      for (const t of ["Ref A", "Ref B", "Ref C"]) {
        const arr = gallery[t] || [];
        const img = arr[imageIdx[t] ?? 0];
        if (img) refImgs[t.replace(" ", "_").toLowerCase()] = img.replace(/^data:image\/\w+;base64,/, "");
      }
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>("/gemini/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, mode, aspect_ratio: "1:1", base_image_b64: Object.values(refImgs)[0] || null, ref_images_b64: Object.keys(refImgs).length > 0 ? refImgs : null }),
      });
      if (resp.image_b64) {
        setTabImage("Main Stage", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: prompt.slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
        addToast("Image generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("generate");
  }, [prompt, mode, gallery, imageIdx, setTabImage, addToast, busy]);

  const handleCancel = useCallback(async () => {
    try { await apiFetch("/system/cancel", { method: "POST" }); } catch { /* */ }
  }, []);

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
    const a = document.createElement("a"); a.href = currentSrc; a.download = `gemini_${activeTab.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  const handleClearRef = useCallback(() => {
    if (activeTab.startsWith("Ref")) { setGallery((prev) => ({ ...prev, [activeTab]: [] })); setImageIdx((prev) => ({ ...prev, [activeTab]: 0 })); }
  }, [activeTab]);

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

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const isRefTab = activeTab.startsWith("Ref");

  useSessionRegister(
    "gemini",
    () => ({ activeTab, prompt, mode, gallery, imageIdx, editHistory }),
    (s: unknown) => {
      if (s === null) {
        setActiveTab("Main Stage"); setPrompt(""); setMode("quality");
        setGallery({}); setImageIdx({}); setEditHistory([]);
        return;
      }
      const d = s as Record<string, unknown>;
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.prompt === "string") setPrompt(d.prompt);
      if (typeof d.mode === "string") setMode(d.mode as "quality" | "speed");
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (d.editHistory) setEditHistory(d.editHistory as EditEntry[]);
    },
  );

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
            <div className="flex gap-3 mt-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: mode === "quality" ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                <input type="radio" name="gmode" checked={mode === "quality"} onChange={() => setMode("quality")} className="accent-current" /> QUALITY 2k
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: mode === "speed" ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                <input type="radio" name="gmode" checked={mode === "speed"} onChange={() => setMode("speed")} className="accent-current" /> SPEED 1k
              </label>
            </div>
          </div>
        </Card>

        <Card className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 flex flex-col flex-1 min-h-0 gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Prompt</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe image:</p>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={15} className="flex-1" placeholder="Describe what you want to see — be as detailed as you like. e.g. A futuristic city at sunset with flying cars..." disabled={busy.any} />
            <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText="Generating Image..." onClick={handleGenerate} title="Send your prompt to the AI and generate a new image">Generate Image</Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel} title="Stop the current generation">Cancel</Button>}
            <EditHistory entries={editHistory} />
          </div>
        </Card>

        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>Actions</p>
            <Button size="sm" className="w-full" onClick={handleSendToPS} title="Open the current image directly in Photoshop">Send to PS</Button>
            <Button size="sm" className="w-full" onClick={handleSaveImage} title="Save the current image to your generated images folder">Save Image</Button>
            <Button size="sm" className="w-full" title="Browse all images you've generated so far">Open Generated Images</Button>
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
          onClearImage={isRefTab ? handleClearRef : undefined}
          imageCount={currentImages.length}
          imageIndex={currentIdx}
          onPrevImage={handlePrevImage}
          onNextImage={handleNextImage}
        />
      </div>
    </div>
  );
}
