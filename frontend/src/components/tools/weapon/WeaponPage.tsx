import { useState, useCallback, useRef, useEffect } from "react";
import { Card, Button, Textarea, Select } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister, useSessionContext } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { XmlModal } from "@/components/shared/XmlModal";
import { ArtDirectorWidget } from "@/components/shared/ArtDirectorWidget";
import { ArtDirectorConfigModal } from "@/components/shared/ArtDirectorConfigModal";
import { useArtDirector } from "@/hooks/ArtDirectorContext";
import { DeepSearchPanel } from "@/components/shared/DeepSearchPanel";
import type { SearchResult } from "@/components/shared/DeepSearchPanel";

interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean; }

const VIEW_TABS = ["Main Stage", "3/4", "Front", "Back", "Side", "Top", "Bottom", "Deep Search", "Ref A", "Ref B", "Ref C"];

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
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

interface WeaponPageProps {
  active?: boolean;
}

export function WeaponPage({ active = true }: WeaponPageProps) {
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
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const [artDirectorConfigOpen, setArtDirectorConfigOpen] = useState(false);
  const { setCurrentImage, setAttributesContext } = useArtDirector();

  useEffect(() => {
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models").then((r) => {
      setModels(r.models.filter((m) => m.multimodal));
      if (!modelId) setModelId(r.current);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            reference_image_b64: mainB64, edit_prompt: isEdit ? editText : undefined, ref_images_b64: getRefB64s(), mode: "quality", model_id: modelId || undefined }),
        },
      );
      if (resp.image_b64) {
        setTabImage("Main Stage", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: (editText || "Initial generation").slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
        addToast("Weapon generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("generate");
  }, [editText, weaponName, components, finish, condition, modelId, getMainB64, getRefB64s, setTabImage, addToast, busy]);

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
    setGenText((p) => ({ ...p, allviews: "Generating all views..." }));
    const promises = views.map((view) => {
      const tabName = Object.entries(VIEW_KEY_MAP).find(([, v]) => v === view)?.[0] || view;
      return apiFetch<{ image_b64: string | null; width: number; height: number }>("/weapon/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: editText || `Detailed ${weaponName} weapon concept`, weapon_name: weaponName, components, material_finish: finish, condition, view_type: view, reference_image_b64: mainB64, mode: "quality", model_id: modelId || undefined }),
      }).then((resp) => ({ ok: true as const, resp, tabName }))
        .catch(() => ({ ok: false as const, resp: null, tabName }));
    });
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.ok && r.resp?.image_b64) setTabImage(r.tabName, `data:image/png;base64,${r.resp.image_b64}`);
    }
    busy.end("allviews");
  }, [editText, weaponName, components, finish, condition, modelId, getMainB64, setTabImage, busy]);

  const handleGenerateSelectedView = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!mainB64 || activeTab === "Main Stage" || activeTab.startsWith("Ref")) return;
    const viewType = VIEW_KEY_MAP[activeTab] || activeTab.toLowerCase();
    busy.start("selview");
    setGenText((p) => ({ ...p, selview: `Generating ${activeTab}...` }));
    try {
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number }>("/weapon/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: editText || `Detailed ${weaponName} weapon concept`, weapon_name: weaponName, components, material_finish: finish, condition, view_type: viewType, reference_image_b64: mainB64, mode: "quality", model_id: modelId || undefined }),
      });
      if (resp.image_b64) setTabImage(activeTab, `data:image/png;base64,${resp.image_b64}`);
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("selview");
  }, [editText, weaponName, components, finish, condition, modelId, activeTab, getMainB64, setTabImage, addToast, busy]);

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

  // Global Ctrl+V paste — uses Electron native clipboard for external images
  useClipboardPaste(
    useCallback((dataUrl: string) => setTabImage(activeTab, dataUrl), [activeTab, setTabImage]),
  );

  const handlePasteImage = useCallback(async () => {
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

  const handleClearRef = useCallback(() => {
    if (activeTab.startsWith("Ref")) { setGallery((prev) => ({ ...prev, [activeTab]: [] })); setImageIdx((prev) => ({ ...prev, [activeTab]: 0 })); }
  }, [activeTab]);

  const handleReset = useCallback(() => {
    setGallery({}); setImageIdx({}); setEditHistory([]); setEditText(""); setWeaponName("");
    setComponents(Object.fromEntries(COMPONENTS.map((c) => [c, ""])));
  }, []);

  const handleSendToPS = useCallback(async () => {
    if (!currentSrc) { addToast("No image to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images: [{ label: `weapon_${activeTab.replace(/\s+/g, "_").toLowerCase()}`, image_b64: currentSrc }] }) },
      );
      if (resp.ok) addToast(resp.results[0]?.message || "Sent to Photoshop", "success");
      else addToast(resp.results[0]?.message || "Failed to send", "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [currentSrc, activeTab, addToast]);

  const handleSendAllToPS = useCallback(async () => {
    const viewTabs = ["Main Stage", "3/4", "Front", "Back", "Side", "Top", "Bottom"];
    const images: { label: string; image_b64: string }[] = [];
    for (const tab of viewTabs) {
      const imgs = gallery[tab] || [];
      const src = imgs[imageIdx[tab] ?? 0];
      if (src) images.push({ label: `weapon_${tab.replace(/\s+/g, "_").toLowerCase()}`, image_b64: src });
    }
    if (images.length === 0) { addToast("No view images to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string; ok?: boolean }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images }) },
      );
      const sent = resp.results.filter((r) => r.ok).length;
      addToast(`Sent ${sent} image${sent !== 1 ? "s" : ""} to Photoshop`, sent > 0 ? "success" : "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [gallery, imageIdx, addToast]);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const isRefTab = activeTab.startsWith("Ref");

  const { clearAll: clearAllSession } = useSessionContext();
  const handleClearCache = useCallback(() => {
    clearAllSession();
    apiFetch("/system/clear-cache", { method: "POST" }).catch(() => {});
    addToast("All session cache cleared", "success");
  }, [clearAllSession, addToast]);

  const [showXml, setShowXml] = useState(false);
  const buildWeaponXml = useCallback(() => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const tag = (name: string, val: string, indent = "  ") => val ? `${indent}<${name}>${esc(val)}</${name}>` : "";
    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Weapon>"];
    lines.push(tag("Name", weaponName));
    lines.push(tag("Description", editText));
    lines.push(tag("MaterialFinish", finish));
    lines.push(tag("Condition", condition));
    lines.push("  <Components>");
    for (const [key, val] of Object.entries(components)) {
      if (val) lines.push(`    <${key}>${esc(val)}</${key}>`);
    }
    lines.push("  </Components>");
    lines.push("</Weapon>");
    return lines.filter((l) => l).join("\n");
  }, [weaponName, editText, finish, condition, components]);

  useSessionRegister(
    "weapon",
    () => ({ activeTab, editText, weaponName, finish, condition, components, gallery, imageIdx, editHistory, modelId }),
    (s: unknown) => {
      if (s === null) {
        setActiveTab("Main Stage"); setEditText(""); setWeaponName("");
        setFinish("Blued Steel"); setCondition("1 - Factory New");
        setComponents(Object.fromEntries(COMPONENTS.map((c) => [c, ""])));
        setGallery({}); setImageIdx({}); setEditHistory([]); setModelId("");
        return;
      }
      const d = s as Record<string, unknown>;
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.editText === "string") setEditText(d.editText);
      if (typeof d.weaponName === "string") setWeaponName(d.weaponName);
      if (typeof d.finish === "string") setFinish(d.finish);
      if (typeof d.condition === "string") setCondition(d.condition);
      if (d.components) setComponents(d.components as Record<string, string>);
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (d.editHistory) setEditHistory(d.editHistory as EditEntry[]);
      if (typeof d.modelId === "string") setModelId(d.modelId);
    },
  );

  useEffect(() => {
    if (active) {
      setCurrentImage(currentSrc || null);
    }
  }, [active, currentSrc, setCurrentImage]);

  useEffect(() => {
    if (active) {
      setAttributesContext(editText || "");
    }
  }, [active, editText, setAttributesContext]);

  // --- Voice Director command listener ---
  const voiceCmdRef = useRef({
    generate: handleGenerate,
    extract_attributes: handleExtract,
    enhance_description: handleEnhance,
    generate_all_views: handleGenerateAllViews,
    send_to_photoshop: handleSendToPS,
    save_image: handleSaveImage,
  });
  voiceCmdRef.current = {
    generate: handleGenerate,
    extract_attributes: handleExtract,
    enhance_description: handleEnhance,
    generate_all_views: handleGenerateAllViews,
    send_to_photoshop: handleSendToPS,
    save_image: handleSaveImage,
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      if (action === "generate" && params.description) setEditText(String(params.description));
      const cmds = voiceCmdRef.current as Record<string, unknown>;
      if (action in cmds) {
        const fn = cmds[action];
        if (typeof fn === "function") fn();
      }
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, []);

  // --- Gallery restore listener ---
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown>;
      if (d._source_tool !== "weapon") return;
      if (typeof d.weapon_name === "string") setWeaponName(d.weapon_name as string);
      if (typeof d.material_finish === "string") setFinish(d.material_finish as string);
      if (typeof d.condition === "string") setCondition(d.condition as string);
      if (typeof d.model === "string") setModelId(d.model as string);
      if (typeof d._image_b64 === "string") {
        const src = (d._image_b64 as string).startsWith("data:") ? d._image_b64 as string : `data:image/png;base64,${d._image_b64}`;
        setGallery((prev) => ({ ...prev, "Main Stage": [src] }));
        setImageIdx((prev) => ({ ...prev, "Main Stage": 0 }));
        setActiveTab("Main Stage");
      }
    };
    window.addEventListener("gallery-restore", handler);
    return () => window.removeEventListener("gallery-restore", handler);
  }, []);

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
                  value={weaponName} onChange={(e) => setWeaponName(e.target.value)} placeholder="Name your weapon, e.g. Stormbreaker Axe, Plasma Rifle MK-II..." disabled={busy.is("extract") || busy.is("enhance")} />
              </div>
            </Card>

            <div className="space-y-1.5">
              <Button className="w-full" size="sm" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtract} title="Analyze the current image and fill in all weapon details automatically">Extract Attributes</Button>
              <Button className="w-full" size="sm" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhance} title="Polish and add more detail to what you've already written">Enhance Description</Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" className="w-full" onClick={handleOpenImage} title="Load an image from your computer">Open Image</Button>
                <Button size="sm" className="w-full" onClick={handleReset} title="Clear everything and start fresh">Reset Weapon</Button>
              </div>
            </div>

            <Card>
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Instructions</p>
                <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={6} placeholder="Tell the AI what to change — e.g. Make the blade longer, add rust, change the grip material..." disabled={busy.is("generate")} />
              </div>
            </Card>

            <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText={genText.generate || "Generating..."} onClick={handleGenerate} title="Generate a new weapon image or apply your edit instructions to the current one">Generate / Apply Edit</Button>
            {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel} title="Stop the current generation">Cancel</Button>}
            <EditHistory entries={editHistory} />

            <Card>
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Weapon Components</p>
                <div className="space-y-1.5">
                  {COMPONENTS.map((comp) => (
                    <div key={comp} className="flex items-center gap-2">
                      <span className="text-xs w-16 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>{comp}</span>
                      <input className="flex-1 px-2 py-1 text-xs" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" }}
                        value={components[comp]} onChange={(e) => setComponents((c) => ({ ...c, [comp]: e.target.value }))} disabled={busy.is("extract") || busy.is("enhance")} />
                    </div>
                  ))}
                  <Select label="Material Finish" options={FINISHES} value={finish} onChange={(e) => setFinish(e.target.value)} disabled={busy.is("extract") || busy.is("enhance")} />
                  <Select label="Condition" options={CONDITIONS} value={condition} onChange={(e) => setCondition(e.target.value)} disabled={busy.is("extract") || busy.is("enhance")} />
                </div>
              </div>
            </Card>

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" className="w-full" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating..."} onClick={handleGenerateAllViews} title="Generate front, back, and side views of your weapon at once">Generate All Views</Button>
                <Button size="sm" className="w-full" generating={busy.is("selview")} generatingText={genText.selview || "Generating..."} onClick={handleGenerateSelectedView} title="Generate only the view you have selected">Generate Selected View</Button>
                <Button size="sm" className="w-full" onClick={handleSendToPS} title="Open the current image in Photoshop">Send to PS</Button>
                <Button size="sm" className="w-full" onClick={handleSendAllToPS} title="Open all view images in Photoshop">Send ALL to PS</Button>
              </div>
              {models.length > 0 && (
                <select className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }} value={modelId} onChange={(e) => setModelId(e.target.value)} title="Choose which AI model generates your weapon images">
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.resolution} ({m.time_estimate})</option>)}
                </select>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <Button size="sm" className="w-full" onClick={() => setShowXml(true)} title="View the weapon data as XML for saving or sharing">Show XML</Button>
                <Button size="sm" className="w-full" onClick={handleClearCache} title="Clear cached AI data for this session">Clear Cache</Button>
                <Button size="sm" className="w-full" title="Browse all generated weapon images">Open Images</Button>
              </div>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 transition-colors hover:bg-[var(--color-border-hover)]" style={{ background: "var(--color-border)" }} />

        <Panel>
          <div className="h-full flex flex-col relative">
            <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Weapon Concept</p>
              <Button size="sm" generating={busy.is("generate")} generatingText="Generating..." onClick={handleGenerate} title="Quickly regenerate the weapon using your current settings">Quick Generate</Button>
            </div>
            <TabBar tabs={VIEW_TABS} active={activeTab} onSelect={setActiveTab} />
            {activeTab === "Deep Search" ? (
              <DeepSearchPanel />
            ) : (
              <div className="relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                <ImageViewer
                  src={currentSrc}
                  placeholder={`No ${activeTab.toLowerCase()} image loaded`}
                  showToolbar={true}
                  locked={busy.any}
                  onSaveImage={handleSaveImage}
                  onCopyImage={handleCopyImage}
                  onPasteImage={handlePasteImage}
                  onOpenImage={handleOpenImage}
                  onClearImage={isRefTab ? handleClearRef : undefined}
                  imageCount={currentImages.length}
                  imageIndex={currentIdx}
                  onPrevImage={handlePrevImage}
                  onNextImage={handleNextImage}
                  isFavorited={currentSrc ? isFavorited(currentSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
                  onToggleFavorite={currentSrc ? () => { const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "weapon", label: activeTab || "main", source: "viewer" }); } : undefined}
                />
                <ArtDirectorWidget onOpenConfig={() => setArtDirectorConfigOpen(true)} />
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-1 shrink-0 overflow-x-auto" style={{ borderTop: "1px solid var(--color-border)" }}>
              {["side", "threequarter", "front", "back", "top", "bottom"].map((view) => {
                const label = Object.entries(VIEW_KEY_MAP).find(([, v]) => v === view)?.[0] || view;
                return <Button key={view} size="sm" variant="ghost" className="!text-[10px] shrink-0" onClick={() => handleUseAs(view)}>Use as {label}</Button>;
              })}
            </div>
          </div>
        </Panel>
      </PanelGroup>
      {showXml && <XmlModal xml={buildWeaponXml()} title="Weapon XML" onClose={() => setShowXml(false)} />}
      <ArtDirectorConfigModal open={artDirectorConfigOpen} onClose={() => setArtDirectorConfigOpen(false)} />
    </div>
  );
}
