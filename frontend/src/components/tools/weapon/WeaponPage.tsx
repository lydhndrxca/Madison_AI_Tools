import { useState, useCallback, useRef } from "react";
import { Card, Button, Textarea, Select } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";

const VIEW_TABS = ["Main Stage", "3/4", "Front", "Back", "Side", "Top", "Bottom", "Ref A", "Ref B", "Ref C"];

const VIEW_KEY_MAP: Record<string, string> = {
  "Main Stage": "main",
  "3/4": "threequarter",
  Front: "front",
  Back: "back",
  Side: "side",
  Top: "top",
  Bottom: "bottom",
};

const COMPONENTS = ["Receiver", "Barrel", "Stock", "Grip", "Magazine", "Optic", "Muzzle", "Markings"];
const FINISHES = [
  "Blued Steel", "Parkerized", "Nickel Plated", "Stainless", "Cerakote", "Anodized", "Painted",
].map((v) => ({ value: v, label: v }));

const CONDITIONS = [
  "1 - Factory New", "2 - Light Wear", "3 - Service Used", "4 - Heavily Worn", "5 - Damaged",
].map((v) => ({ value: v, label: v }));

interface EditEntry { timestamp: string; prompt: string; isOriginal?: boolean; }

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  return { is, start, end, any: set.size > 0 };
}

export function WeaponPage() {
  const [activeTab, setActiveTab] = useState("Main Stage");
  const busy = useBusySet();
  const [genText, setGenText] = useState<Record<string, string>>({});

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});

  const [editText, setEditText] = useState("");
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);
  const [weaponName, setWeaponName] = useState("");
  const [finish, setFinish] = useState("Blued Steel");
  const [condition, setCondition] = useState("1 - Factory New");
  const [components, setComponents] = useState<Record<string, string>>(
    Object.fromEntries(COMPONENTS.map((c) => [c, ""])),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();

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

  const getRefB64s = useCallback(() => {
    const refs: Record<string, string> = {};
    for (const tab of ["Ref A", "Ref B", "Ref C"]) {
      const imgs = gallery[tab] || [];
      const src = imgs[imageIdx[tab] ?? 0];
      if (src) refs[tab.toLowerCase().replace(" ", "_")] = src.replace(/^data:image\/\w+;base64,/, "");
    }
    return Object.keys(refs).length > 0 ? refs : null;
  }, [gallery, imageIdx]);

  const handleGenerate = useCallback(async () => {
    if (!editText.trim() && !weaponName.trim()) return;
    busy.start("generate");
    setGenText((p) => ({ ...p, generate: "Generating weapon..." }));
    try {
      const mainB64 = getMainB64();
      const isEdit = mainB64 && editText.trim();
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        isEdit ? "/weapon/edit" : "/weapon/generate", {
          method: "POST",
          body: JSON.stringify({ prompt: editText || `Generate a detailed ${weaponName} concept art`, weapon_name: weaponName, components, material_finish: finish, condition, view_type: "main",
            reference_image_b64: mainB64, edit_prompt: isEdit ? editText : undefined, ref_images_b64: getRefB64s(), mode: "quality" }),
        },
      );
      if (resp.image_b64) {
        setTabImage("Main Stage", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: (editText || "Initial generation").slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
        addToast("Weapon generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("generate");
  }, [editText, weaponName, components, finish, condition, getMainB64, getRefB64s, setTabImage, addToast, busy]);

  const handleExtract = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!mainB64) return;
    busy.start("extract");
    try {
      const resp = await apiFetch<{ text: string | null; error: string | null }>("/weapon/extract-attributes", { method: "POST", body: JSON.stringify({ prompt: "", image_b64: mainB64 }) });
      if (resp.text) {
        const lines = resp.text.split("\n");
        const newComps = { ...components };
        let descLines: string[] = [];
        let inDesc = false;
        for (const line of lines) {
          if (line.startsWith("DESCRIPTION:")) { inDesc = true; descLines.push(line.replace("DESCRIPTION:", "").trim()); continue; }
          if (inDesc) { descLines.push(line); continue; }
          for (const comp of COMPONENTS) { if (line.toLowerCase().startsWith(comp.toLowerCase())) { newComps[comp] = line.split(":").slice(1).join(":").trim(); } }
        }
        setComponents(newComps);
        if (descLines.length > 0) setEditText(descLines.join("\n").trim());
        addToast("Attributes extracted", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("extract");
  }, [components, getMainB64, addToast, busy]);

  const handleEnhance = useCallback(async () => {
    if (!editText.trim()) return;
    busy.start("enhance");
    try {
      const resp = await apiFetch<{ text: string | null; error: string | null }>("/weapon/enhance", { method: "POST", body: JSON.stringify({ prompt: editText }) });
      if (resp.text) { setEditText(resp.text); addToast("Description enhanced", "success"); }
      else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("enhance");
  }, [editText, addToast, busy]);

  const handleGenerateAllViews = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!mainB64) return;
    busy.start("allviews");
    const views = ["threequarter", "front", "back", "side", "top", "bottom"];
    for (const view of views) {
      const tabName = Object.entries(VIEW_KEY_MAP).find(([, v]) => v === view)?.[0] || view;
      setGenText((p) => ({ ...p, allviews: `Generating ${tabName}...` }));
      try {
        const resp = await apiFetch<{ image_b64: string | null; width: number; height: number }>("/weapon/generate", {
          method: "POST",
          body: JSON.stringify({ prompt: editText || `Detailed ${weaponName} weapon concept`, weapon_name: weaponName, components, material_finish: finish, condition, view_type: view, reference_image_b64: mainB64, mode: "quality" }),
        });
        if (resp.image_b64) setTabImage(tabName, `data:image/png;base64,${resp.image_b64}`);
      } catch { break; }
    }
    busy.end("allviews");
  }, [editText, weaponName, components, finish, condition, getMainB64, setTabImage, busy]);

  const handleCancel = useCallback(async () => {
    try { await apiFetch("/system/cancel", { method: "POST" }); } catch { /* */ }
  }, []);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string);
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  const handleUseAs = useCallback((targetView: string) => {
    const imgs = gallery["Main Stage"] || [];
    const mainSrc = imgs[imageIdx["Main Stage"] ?? 0];
    if (!mainSrc) return;
    const tabName = Object.entries(VIEW_KEY_MAP).find(([, v]) => v === targetView)?.[0] || targetView;
    setTabImage(tabName, mainSrc);
  }, [gallery, imageIdx, setTabImage]);

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc; a.download = `weapon_${activeTab.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  const handlePasteImage = useCallback(async () => {
    try { const items = await navigator.clipboard.read(); for (const item of items) { for (const type of item.types) { if (type.startsWith("image/")) { const blob = await item.getType(type); const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string); reader.readAsDataURL(blob); return; } } } } catch { /* */ }
  }, [activeTab, setTabImage]);

  const handleClearRef = useCallback(() => {
    if (activeTab.startsWith("Ref")) { setGallery((prev) => ({ ...prev, [activeTab]: [] })); setImageIdx((prev) => ({ ...prev, [activeTab]: 0 })); }
  }, [activeTab]);

  const handleReset = useCallback(() => {
    setGallery({}); setImageIdx({}); setEditHistory([]); setEditText(""); setWeaponName("");
    setComponents(Object.fromEntries(COMPONENTS.map((c) => [c, ""])));
  }, []);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const isRefTab = activeTab.startsWith("Ref");

  return (
    <div className="flex flex-col h-full">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={35} minSize={25} maxSize={50}>
          <div className="h-full flex flex-col gap-2 overflow-y-auto p-3">
            <Card>
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Weapon Selection</p>
                <input className="w-full px-3 py-1.5 text-sm" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", color: "var(--color-text-primary)" }}
                  value={weaponName} onChange={(e) => setWeaponName(e.target.value)} placeholder="Enter weapon name..." />
              </div>
            </Card>

            <div className="space-y-1.5">
              <Button className="w-full" size="sm" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtract}>Extract Attributes</Button>
              <Button className="w-full" size="sm" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhance}>Enhance Description</Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" className="w-full" onClick={handleOpenImage}>Open Image</Button>
                <Button size="sm" className="w-full" onClick={handleReset}>Reset Weapon</Button>
              </div>
            </div>

            <Card>
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Instructions</p>
                <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={6} placeholder="Describe changes..." />
              </div>
            </Card>

            <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText={genText.generate || "Generating..."} onClick={handleGenerate}>Generate / Apply Edit</Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel}>Cancel</Button>}
            <EditHistory entries={editHistory} />

            <Card>
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Weapon Components</p>
                <div className="space-y-1.5">
                  {COMPONENTS.map((comp) => (
                    <div key={comp} className="flex items-center gap-2">
                      <span className="text-xs w-16 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>{comp}</span>
                      <input className="flex-1 px-2 py-1 text-xs" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" }}
                        value={components[comp]} onChange={(e) => setComponents((c) => ({ ...c, [comp]: e.target.value }))} />
                    </div>
                  ))}
                  <Select label="Material Finish" options={FINISHES} value={finish} onChange={(e) => setFinish(e.target.value)} />
                  <Select label="Condition" options={CONDITIONS} value={condition} onChange={(e) => setCondition(e.target.value)} />
                </div>
              </div>
            </Card>

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" className="w-full" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating..."} onClick={handleGenerateAllViews}>Generate All Views</Button>
                <Button size="sm" className="w-full">Generate Selected View</Button>
                <Button size="sm" className="w-full">Send to PS</Button>
                <Button size="sm" className="w-full">Send ALL to PS</Button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <Button size="sm" className="w-full">Show XML</Button>
                <Button size="sm" className="w-full">Clear Cache</Button>
                <Button size="sm" className="w-full">Open Images</Button>
              </div>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 transition-colors hover:bg-[var(--color-border-hover)]" style={{ background: "var(--color-border)" }} />

        <Panel>
          <div className="h-full flex flex-col relative">
            <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Weapon Concept</p>
              <Button size="sm" generating={busy.is("generate")} generatingText="Generating..." onClick={handleGenerate}>Quick Generate</Button>
            </div>
            <TabBar tabs={VIEW_TABS} active={activeTab} onSelect={setActiveTab} />
            <ImageViewer
              src={currentSrc}
              placeholder={`No ${activeTab.toLowerCase()} image loaded`}
              showToolbar={true}
              onSaveImage={handleSaveImage}
              onCopyImage={handleCopyImage}
              onPasteImage={handlePasteImage}
              onOpenImage={handleOpenImage}
              onClearImage={isRefTab ? handleClearRef : undefined}
              imageCount={currentImages.length}
              imageIndex={currentIdx}
              onPrevImage={handlePrevImage}
              onNextImage={handleNextImage}
            />
            <div className="flex items-center gap-1 px-2 py-1 shrink-0 overflow-x-auto" style={{ borderTop: "1px solid var(--color-border)" }}>
              {["side", "threequarter", "front", "back", "top", "bottom"].map((view) => {
                const label = Object.entries(VIEW_KEY_MAP).find(([, v]) => v === view)?.[0] || view;
                return <Button key={view} size="sm" variant="ghost" className="!text-[10px] shrink-0" onClick={() => handleUseAs(view)}>Use as {label}</Button>;
              })}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
