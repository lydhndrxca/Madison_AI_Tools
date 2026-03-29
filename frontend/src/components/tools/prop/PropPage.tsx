import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Button, Select, Textarea, NumberStepper } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { GroupedTabBar } from "@/components/shared/TabBar";
import { ArtboardCanvas } from "@/components/shared/ArtboardCanvas";
import type { TabDef } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { createHistoryEntry, pushHistory, createImageRecord } from "@/lib/imageHistory";
import type { HistoryEntry, ImageRecord, HistorySettings } from "@/lib/imageHistory";
import { XmlModal } from "@/components/shared/XmlModal";
import { GripVertical, ChevronDown, ChevronRight, Lock, Unlock, Save, Pencil } from "lucide-react";
import { useShortcuts } from "@/hooks/useShortcuts";
import { usePromptOverrides } from "@/hooks/PromptOverridesContext";
import { EditPromptModal } from "@/components/shared/EditPromptModal";
import { useCustomSections } from "@/hooks/CustomSectionsContext";
import { useCustomSectionState } from "@/hooks/useCustomSectionState";
import { CustomSectionRenderer } from "@/components/shared/CustomSectionRenderer";
import { GridGallery } from "@/components/shared/GridGallery";
import type { GridGalleryResult } from "@/components/shared/GridGallery";
import { StyleFusionPanel, buildFusionBrief, EMPTY_FUSION } from "@/components/shared/StyleFusionPanel";
import type { StyleFusionState } from "@/components/shared/StyleFusionPanel";

// ---------------------------------------------------------------------------
// Tab model
// ---------------------------------------------------------------------------

const BUILTIN_TABS: TabDef[] = [
  { id: "main", label: "Main Stage", group: "stage", prompt: "Three-quarter hero shot showing the prop from its most visually interesting angle." },
  { id: "3/4", label: "3/4", group: "views", prompt: "Three-quarter view of the prop showing its dimensional form." },
  { id: "front", label: "Front", group: "views", prompt: "Front elevation view" },
  { id: "back", label: "Back", group: "views", prompt: "Rear elevation view" },
  { id: "side", label: "Side", group: "views", prompt: "Side elevation view" },
  { id: "top", label: "Top", group: "views", prompt: "Top-down plan view" },
  { id: "artboard", label: "Art Table", group: "artboard" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
];

const VIEW_TYPE_MAP: Record<string, string> = {
  main: "main", "3/4": "three_quarter", front: "front", back: "back", side: "side", top: "top",
};

// ---------------------------------------------------------------------------
// Prop domain data (mirrors backend)
// ---------------------------------------------------------------------------

const PROP_TYPE_OPTIONS = [
  "", "furniture", "hand tool", "weapon", "vehicle part", "container", "lighting",
  "electronics", "decorative object", "industrial equipment", "food / vessel",
  "textile / soft prop", "architectural element", "toy / game piece", "scientific instrument", "other",
].map((v) => ({ value: v, label: v || "—" }));

const SETTING_OPTIONS = [
  "", "contemporary", "near-future", "far-future sci-fi", "medieval", "renaissance",
  "industrial revolution", "art deco", "mid-century modern", "post-apocalyptic",
  "fantasy", "steampunk", "historical (unspecified)", "studio / neutral",
].map((v) => ({ value: v, label: v || "—" }));

const CONDITION_OPTIONS = [
  "", "pristine / mint", "light wear", "moderate wear", "heavy wear",
  "damaged / broken", "weathered / outdoor aged", "restored", "unfinished / raw", "stylized clean",
].map((v) => ({ value: v, label: v || "—" }));

const SCALE_OPTIONS = [
  "", "hand-held", "pocket-scale", "tabletop", "furniture-scale",
  "human-scale (wearable)", "room-scale / large", "miniature / maquette", "monumental",
].map((v) => ({ value: v, label: v || "—" }));

const PROP_ATTRIBUTE_GROUPS = [
  { label: "Primary Material", key: "primaryMaterial" },
  { label: "Secondary Materials", key: "secondaryMaterials" },
  { label: "Surface Finish", key: "surfaceFinish" },
  { label: "Wear & Damage", key: "wearPattern" },
  { label: "Color Palette", key: "colorPalette" },
  { label: "Texture Detail", key: "textureDetail" },
  { label: "Functional Elements", key: "functionalElements" },
  { label: "Decorative Detail", key: "decorativeDetail" },
  { label: "Material Response", key: "lightingEffects" },
  { label: "Context & Story", key: "contextualStory" },
];

const ATTR_KEYS = PROP_ATTRIBUTE_GROUPS.map((g) => g.key);

// ---------------------------------------------------------------------------
// Preservation Lock
// ---------------------------------------------------------------------------

interface PreserveToggle { key: string; label: string; prompt: string; enabled: boolean }
interface PreservationLockState { enabled: boolean; preserves: PreserveToggle[]; negatives: { id: string; text: string; enabled: boolean }[] }

const DEFAULT_PRESERVES: PreserveToggle[] = [
  { key: "keepMaterials", label: "Keep materials", prompt: "Do NOT change the materials", enabled: false },
  { key: "keepColors", label: "Keep colors", prompt: "Do NOT change the color palette", enabled: false },
  { key: "keepWear", label: "Keep wear pattern", prompt: "Do NOT change the wear and damage pattern", enabled: false },
  { key: "keepFunctional", label: "Keep functional elements", prompt: "Do NOT change the functional elements", enabled: false },
  { key: "keepDecorative", label: "Keep decorative details", prompt: "Do NOT change the decorative details", enabled: false },
  { key: "keepScale", label: "Keep proportions / scale", prompt: "Do NOT change the proportions or scale", enabled: false },
];

const DEFAULT_NEGATIVES: PreservationLockState["negatives"] = [
  { id: "neg1", text: "No text / labels on prop", enabled: false },
  { id: "neg2", text: "No fantasy elements", enabled: false },
];

const EMPTY_PRESERVATION: PreservationLockState = {
  enabled: true,
  preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })),
  negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })),
};

let _negIdCounter = 100;

// ---------------------------------------------------------------------------
// Style Fusion
// ---------------------------------------------------------------------------

const TAKE_OPTIONS = [
  "overall vibe", "silhouette", "material & texture", "color palette",
  "detail work & hardware", "cultural reference", "attitude & energy",
];

function preservationToConstraints(pres: PreservationLockState): string {
  if (!pres.enabled) return "";
  const lines: string[] = [];
  for (const p of pres.preserves) { if (p.enabled) lines.push(p.prompt); }
  for (const n of pres.negatives) { if (n.enabled) lines.push(`MUST AVOID: ${n.text}`); }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Layout system
// ---------------------------------------------------------------------------

type SectionId = "generate" | "identity" | "propDescription" | "attributes" | "styleFusion" | "preservation" | "upscaleRestore" | "multiview" | "saveOptions";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "identity", "propDescription", "attributes", "styleFusion", "preservation", "upscaleRestore", "multiview", "saveOptions",
];

const SECTION_LABELS: Record<SectionId, string> = {
  generate: "Generate Prop Image",
  identity: "Prop Identity",
  propDescription: "Prop Description",
  attributes: "Prop Attributes",
  styleFusion: "Style Fusion",
  preservation: "Preservation Lock",
  upscaleRestore: "AI Upscale & Restore",
  multiview: "Multi-View Generation",
  saveOptions: "Save Options",
};

const SECTION_TIPS: Record<SectionId, string> = {
  generate: "Generate new images, extract details from images, or randomize a prop.",
  identity: "Basic identity — prop type, setting/era, condition, and scale.",
  propDescription: "Freeform text description of the prop. The more detail, the better.",
  attributes: "Material, surface, wear, color, and detail attributes. Fine-tune how your prop looks.",
  styleFusion: "Blend two different style influences together for a unique look.",
  preservation: "Lock specific traits so the AI keeps them when regenerating.",
  upscaleRestore: "Make images bigger and sharper (Upscale) or fix AI artifacts (Restore).",
  multiview: "Generate consistent front, back, side, and top views of your prop.",
  saveOptions: "Save images, send to Photoshop, export XML, or clear your session.",
};

const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["identity", "propDescription", "attributes", "styleFusion", "preservation"]);
const PROMPT_EDITABLE_SECTIONS: Set<SectionId> = new Set(["styleFusion", "preservation"]);

interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean }

interface LayoutState { order: SectionId[]; collapsed: Partial<Record<SectionId, boolean>> }

function layoutStorageKeyFor(instanceId: number) {
  return `madison-prop-layout${instanceId ? `-${instanceId}` : ""}`;
}

function loadDefaultLayout(key?: string): LayoutState {
  try {
    const raw = localStorage.getItem(key || "madison-prop-layout");
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set<SectionId>(DEFAULT_SECTION_ORDER);
      const order = parsed.order.filter((id) => allIds.has(id));
      for (const id of DEFAULT_SECTION_ORDER) { if (!order.includes(id)) order.push(id); }
      return { order, collapsed: parsed.collapsed ?? {} };
    }
  } catch { /* */ }
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { styleFusion: true, preservation: true, upscaleRestore: true, multiview: true, saveOptions: true } };
}

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

const inputStyle = { background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PropPageProps {
  instanceId?: number;
  active?: boolean;
}

export function PropPage({ instanceId = 0, active = true }: PropPageProps) {
  const layoutStorageKey = layoutStorageKeyFor(instanceId);
  const sessionKey = `prop${instanceId ? `-${instanceId}` : ""}`;
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [activeTab, setActiveTab] = useState("main");
  const busy = useBusySet();
  const textBusy = busy.is("extract") || busy.is("enhance") || busy.is("randomize");

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [imageRecords, setImageRecords] = useState<Record<string, ImageRecord>>({});
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // Prop identity
  const [propName, setPropName] = useState("");
  const [propType, setPropType] = useState("");
  const [setting, setSetting] = useState("");
  const [condition, setCondition] = useState("");
  const [scale, setScale] = useState("");

  // Prop description
  const [description, setDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");

  // Prop attributes
  const [attributes, setAttributes] = useState<Record<string, string>>(
    Object.fromEntries(ATTR_KEYS.map((k) => [k, ""])),
  );

  // Locked attributes (per key)
  const [lockedAttrs, setLockedAttrs] = useState<Record<string, boolean>>(
    Object.fromEntries(ATTR_KEYS.map((k) => [k, false])),
  );

  const [styleFusion, setStyleFusion] = useState<StyleFusionState>({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
  const [preservation, setPreservation] = useState<PreservationLockState>({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });

  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);

  const [lockedSections, setLockedSections] = useState({ identity: false, propDescription: false, attributes: false, styleFusion: false, preservation: false });
  type LockableSection = keyof typeof lockedSections;
  const toggleLock = useCallback((key: LockableSection, val: boolean) => {
    setLockedSections((prev) => ({ ...prev, [key]: val }));
  }, []);

  const [genCount, setGenCount] = useState(1);
  const [generationMode, setGenerationMode] = useState<"single" | "grid">("single");
  const [gridResults, setGridResults] = useState<GridGalleryResult[]>([]);
  const [gridEditBusy, setGridEditBusy] = useState<Record<string, boolean>>({});
  const [viewGenCount, setViewGenCount] = useState(1);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const promptOverrides = usePromptOverrides();
  const { getSectionColor, setSectionColor } = useCustomSections();
  const customSections = useCustomSectionState("prop");
  const TOOL_ID = "prop";
  const [promptEditSection, setPromptEditSection] = useState<SectionId | null>(null);
  const [promptCtxMenu, setPromptCtxMenu] = useState<{ x: number; y: number; section: SectionId } | null>(null);

  // Layout
  const [layout, setLayout] = useState<LayoutState>(() => loadDefaultLayout(layoutStorageKey));
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);
  const dragItemRef = useRef<SectionId | null>(null);

  // Extract targets
  type ExtractTarget = "identity" | "description" | "attributes";
  const [extractTargets, setExtractTargets] = useState<Record<ExtractTarget, boolean>>({ identity: true, description: true, attributes: true });
  const [extractMode, setExtractMode] = useState<"inspiration" | "recreate">("inspiration");

  // Upscale & Restore
  const [urMode, setUrMode] = useState<"upscale" | "restore">("upscale");
  const [urScale, setUrScale] = useState<"x2" | "x3" | "x4">("x2");
  const [urContext, setUrContext] = useState("");
  const [urModelId, setUrModelId] = useState("");
  const [urImages, setUrImages] = useState<string[]>([]);
  const urFileRef = useRef<HTMLInputElement>(null);

  // Section ON/OFF
  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({ identity: true, propDescription: true, attributes: true });
  const isSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return true;
    return sectionEnabled[id] === true;
  }, [sectionEnabled]);
  const toggleSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return;
    setSectionEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const isSectionCollapsed = useCallback((id: SectionId) => {
    if (NON_COLLAPSIBLE.has(id)) return false;
    return layout.collapsed[id] ?? false;
  }, [layout.collapsed]);

  const toggleSectionCollapse = useCallback((id: SectionId) => {
    if (NON_COLLAPSIBLE.has(id)) return;
    setLayout((prev) => ({ ...prev, collapsed: { ...prev.collapsed, [id]: !prev.collapsed[id] } }));
  }, []);

  const handleDragStart = useCallback((id: SectionId) => { dragItemRef.current = id; }, []);
  const handleDragOver = useCallback((e: React.DragEvent, id: SectionId) => { e.preventDefault(); setDragOverId(id); }, []);
  const handleDrop = useCallback((targetId: SectionId) => {
    const from = dragItemRef.current;
    if (from && targetId && from !== targetId) {
      setLayout((prev) => {
        const order = [...prev.order];
        const fromIdx = order.indexOf(from);
        const toIdx = order.indexOf(targetId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, from);
        return { ...prev, order };
      });
    }
    dragItemRef.current = null;
    setDragOverId(null);
  }, []);
  const handleDragEnd = useCallback(() => { dragItemRef.current = null; setDragOverId(null); }, []);

  const handleSetDefaultLayout = useCallback(() => {
    const collapsed: Partial<Record<SectionId, boolean>> = {};
    for (const id of layout.order) { if (NON_COLLAPSIBLE.has(id)) continue; collapsed[id] = isSectionCollapsed(id); }
    localStorage.setItem(layoutStorageKey, JSON.stringify({ order: layout.order, collapsed }));
    addToast("Layout saved as default", "success");
  }, [layout.order, isSectionCollapsed, addToast, layoutStorageKey]);

  const [xmlOpen, setXmlOpen] = useState(false);

  const refCounter = useRef(0);

  useEffect(() => {
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models").then((r) => {
      setModels(r.models.filter((m) => m.multimodal));
      if (!modelId) setModelId(r.current);
    }).catch(() => {});
    apiFetch<{ name: string; guidance_text: string }[]>("/styles/folders?category=general").then((folders) => {
      setStyleLibraryFolders(folders);
    }).catch(() => {});
  }, []);

  // --- Helpers ---

  const currentImages = gallery[activeTab] || [];
  const currentIdx = imageIdx[activeTab] ?? 0;
  const currentSrc = currentImages[currentIdx] ?? null;
  const isRefTab = activeTab.startsWith("ref");

  const historyKey = `${activeTab}:${currentIdx}`;
  const currentRecord = imageRecords[historyKey];
  const currentHistory = currentRecord?.history ?? [];

  const getSettingsSnapshot = useCallback((): HistorySettings => ({
    description, age: "", race: "", gender: "", build: "", editPrompt,
  }), [description, editPrompt]);

  const addHistoryEntry = useCallback((tab: string, idx: number, label: string, imageSrc: string) => {
    if (tabs.find((t) => t.id === tab)?.group === "refs") return;
    const key = `${tab}:${idx}`;
    setImageRecords((prev) => {
      const existing = prev[key] ?? createImageRecord(tab, idx, imageSrc);
      const entry = createHistoryEntry(label, imageSrc, getSettingsSnapshot());
      return { ...prev, [key]: pushHistory(existing, entry) };
    });
  }, [tabs, getSettingsSnapshot]);

  const setTabImage = useCallback((tab: string, src: string, label = "Generation") => {
    setGallery((prev) => ({ ...prev, [tab]: [src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: 0 }));
    addHistoryEntry(tab, 0, label, src);
  }, [addHistoryEntry]);

  const clipboardPasteCb = useCallback((dataUrl: string) => setTabImage(activeTab, dataUrl, "Pasted image"), [activeTab, setTabImage]);
  useClipboardPaste(activeTab === "artboard" ? undefined : clipboardPasteCb);

  const handlePasteImage = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) { setTabImage(activeTab, dataUrl, "Pasted image"); }
      else { addToast("No image found in clipboard", "info"); }
    } catch { addToast("Paste failed", "error"); }
  }, [activeTab, setTabImage, addToast]);

  const appendToGallery = useCallback((tab: string, src: string, label = "Generation") => {
    setGallery((prev) => {
      const arr = [...(prev[tab] || []), src];
      const newIdx = arr.length - 1;
      setImageIdx((p) => ({ ...p, [tab]: newIdx }));
      addHistoryEntry(tab, newIdx, label, src);
      return { ...prev, [tab]: arr };
    });
  }, [addHistoryEntry]);

  const getImageB64 = useCallback((tab: string) => {
    const imgs = gallery[tab] || [];
    const src = imgs[imageIdx[tab] ?? 0];
    return src ? src.replace(/^data:image\/\w+;base64,/, "") : null;
  }, [gallery, imageIdx]);

  const getMainImageB64 = useCallback(() => getImageB64("main"), [getImageB64]);

  // --- Tab management ---
  const handleAddRef = useCallback(() => {
    refCounter.current++;
    const letter = String.fromCharCode(68 + refCounter.current - 1);
    const id = `ref${letter}`;
    setTabs((prev) => [...prev, { id, label: `Ref ${letter}`, group: "refs" }]);
    setActiveTab(id);
  }, []);

  const handleRemoveRef = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTab((prev) => prev === tabId ? "main" : prev);
    setGallery((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    setImageIdx((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
  }, []);

  const handleEditTabPrompt = useCallback((tabId: string, newPrompt: string) => {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, prompt: newPrompt } : t));
  }, []);

  // --- Prompt override helpers ---
  const getDefaultSectionPrompt = useCallback((sectionId: SectionId): string => {
    switch (sectionId) {
      case "styleFusion": return buildFusionBrief(styleFusion);
      case "preservation": return preservationToConstraints(preservation);
      default: return "";
    }
  }, [styleFusion, preservation]);

  const resolveSection = useCallback((sectionId: SectionId): string => {
    if (!isSectionEnabled(sectionId)) return "";
    const override = promptOverrides.getOverride(TOOL_ID, sectionId);
    if (override !== null) return override;
    return getDefaultSectionPrompt(sectionId);
  }, [isSectionEnabled, promptOverrides, getDefaultSectionPrompt]);

  // --- Build request body ---
  const buildRequestBody = useCallback((viewType: string) => {
    const refImgs: string[] = [];
    for (const t of tabs) {
      if (t.group === "refs") {
        const b = getImageB64(t.id);
        if (b) refImgs.push(b);
      }
    }

    const fusionCtx = resolveSection("styleFusion");
    const lockCtx = resolveSection("preservation");

    let styleGuidance = "";
    if (styleLibraryFolder) {
      const folder = styleLibraryFolders.find((f) => f.name === styleLibraryFolder);
      if (folder?.guidance_text) styleGuidance = folder.guidance_text;
    }

    return {
      description: isSectionEnabled("propDescription") ? description : "",
      name: isSectionEnabled("identity") ? propName : "",
      prop_type: isSectionEnabled("identity") ? propType : "",
      setting: isSectionEnabled("identity") ? setting : "",
      condition: isSectionEnabled("identity") ? condition : "",
      scale: isSectionEnabled("identity") ? scale : "",
      attributes: isSectionEnabled("attributes") ? attributes : {},
      view_type: viewType,
      reference_image_b64: getMainImageB64(),
      ref_images: refImgs.length > 0 ? refImgs : undefined,
      model_id: modelId || undefined,
      style_context: undefined,
      fusion_context: fusionCtx || undefined,
      fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      style_guidance: styleGuidance || undefined,
      lock_constraints: lockCtx || undefined,
      recreate_mode: extractMode === "recreate" && !!getMainImageB64(),
      custom_sections_context: customSections.getPromptContributions() || undefined,
      custom_section_images: customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean) || undefined,
    };
  }, [tabs, getImageB64, getMainImageB64, description, propName, propType, setting, condition, scale, attributes, styleFusion, preservation, modelId, extractMode, isSectionEnabled, styleLibraryFolder, styleLibraryFolders, customSections.getPromptContributions, customSections.getImageAttachments]);

  // --- Generate ---
  const handleGenerate = useCallback(async (viewType?: string) => {
    const vt = viewType || VIEW_TYPE_MAP[activeTab] || "main";
    const tab = viewType ? Object.entries(VIEW_TYPE_MAP).find(([, v]) => v === viewType)?.[0] ?? activeTab : activeTab;
    busy.start("gen");
    try {
      const body = buildRequestBody(vt);
      const calls = Array.from({ length: genCount }, () =>
        apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>("/prop/generate", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
      const results = await Promise.all(calls);
      let first = true;
      for (const resp of results) {
        if (resp.error) { addToast(resp.error, "error"); continue; }
        if (resp.image_b64) {
          const src = `data:image/png;base64,${resp.image_b64}`;
          if (first) { setTabImage(tab, src, "Prop generation"); first = false; }
          else { appendToGallery(tab, src, "Prop generation"); }
        }
      }
    } catch (e) { addToast(String(e), "error"); }
    busy.end("gen");
  }, [activeTab, genCount, buildRequestBody, addToast, setTabImage, appendToGallery, busy]);

  // Quick generate (main stage)
  const handleQuickGenerate = useCallback(() => handleGenerate("main"), [handleGenerate]);

  // Generate all views
  const handleGenerateAllViews = useCallback(async () => {
    const mainImg = getMainImageB64();
    if (!mainImg) { addToast("Generate a main stage image first", "info"); return; }
    const views = ["three_quarter", "front", "back", "side", "top"];
    busy.start("allViews");
    try {
      await Promise.all(views.map(async (vt) => {
        const tab = Object.entries(VIEW_TYPE_MAP).find(([, v]) => v === vt)?.[0];
        if (!tab) return;
        const body = buildRequestBody(vt);
        const resp = await apiFetch<{ image_b64?: string; error?: string }>("/prop/generate", {
          method: "POST", body: JSON.stringify(body),
        });
        if (resp.error) { addToast(`${vt}: ${resp.error}`, "error"); return; }
        if (resp.image_b64) setTabImage(tab, `data:image/png;base64,${resp.image_b64}`, `${vt} view`);
      }));
    } catch (e) { addToast(String(e), "error"); }
    busy.end("allViews");
  }, [getMainImageB64, addToast, buildRequestBody, setTabImage, busy]);

  // Generate selected view
  const handleGenerateSelectedView = useCallback(async () => {
    const vt = VIEW_TYPE_MAP[activeTab];
    if (!vt || vt === "main") { addToast("Select a view tab (Front, Back, Side, Top, 3/4)", "info"); return; }
    const mainImg = getMainImageB64();
    if (!mainImg) { addToast("Generate a main stage image first", "info"); return; }
    await handleGenerate(vt);
  }, [activeTab, getMainImageB64, addToast, handleGenerate]);

  // Cancel
  const handleCancel = useCallback(() => { cancelAllRequests(); busy.endAll(); }, [busy]);

  const handleGridGenerate = useCallback(async () => {
    busy.start("gen");
    try {
      const body = buildRequestBody("main");
      const promises = Array.from({ length: 16 }, (_, i) =>
        apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>("/prop/generate", {
          method: "POST",
          body: JSON.stringify(body),
        }).then((resp) => ({ ok: true as const, resp, idx: i }))
         .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), idx: i })),
      );
      const results = await Promise.all(promises);
      const newResults: GridGalleryResult[] = [];
      for (const r of results.sort((a, b) => a.idx - b.idx)) {
        if (r.ok && r.resp.image_b64) {
          newResults.push({
            id: `grid_${Date.now()}_${r.idx}`,
            image_b64: r.resp.image_b64,
            width: r.resp.width || 1024,
            height: r.resp.height || 1024,
          });
        } else if (r.ok && r.resp.error) { addToast(r.resp.error, "error"); }
        else if (!r.ok) { addToast(r.error, "error"); }
      }
      setGridResults((prev) => [...prev, ...newResults]);
      addToast(`Generated ${newResults.length} images`, "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("gen");
  }, [buildRequestBody, addToast, busy]);

  const handleGridDelete = useCallback((id: string) => {
    setGridResults((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleGridCopy = useCallback(async (id: string) => {
    const result = gridResults.find((r) => r.id === id);
    if (!result) return;
    try {
      const resp = await fetch(`data:image/png;base64,${result.image_b64}`);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      addToast("Copied to clipboard", "success");
    } catch { addToast("Copy failed", "error"); }
  }, [gridResults, addToast]);

  const handleGridEdit = useCallback(async (id: string, editText: string) => {
    const result = gridResults.find((r) => r.id === id);
    if (!result) return;
    setGridEditBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
        "/prop/generate",
        {
          method: "POST",
          body: JSON.stringify({
            ...buildRequestBody("main"),
            reference_image_b64: result.image_b64,
            edit_prompt: editText,
          }),
        },
      );
      if (res.error) { addToast(res.error, "error"); }
      else if (res.image_b64) {
        setGridResults((prev) =>
          prev.map((r) => r.id === id ? { ...r, image_b64: res.image_b64!, width: res.width || r.width, height: res.height || r.height } : r),
        );
        addToast("Cell updated", "success");
      }
    } catch (e) { addToast(e instanceof Error ? e.message : "Edit failed", "error"); }
    setGridEditBusy((prev) => ({ ...prev, [id]: false }));
  }, [gridResults, buildRequestBody, addToast]);

  // Extract attributes
  const handleExtractAttributes = useCallback(async () => {
    const imgB64 = getMainImageB64();
    if (!description.trim() && !imgB64) { addToast("Add a description or image first", "info"); return; }
    busy.start("extract");
    try {
      const resp = await apiFetch<{
        description?: string; propType?: string; setting?: string; condition?: string; scale?: string;
        attributes?: Record<string, string>; error?: string;
      }>("/prop/extract-attributes", {
        method: "POST", body: JSON.stringify({ description, image_b64: imgB64 }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("extract"); return; }
      if (extractTargets.description && resp.description && !lockedSections.propDescription) setDescription(resp.description);
      if (extractTargets.identity && !lockedSections.identity) {
        if (resp.propType) setPropType(resp.propType);
        if (resp.setting) setSetting(resp.setting);
        if (resp.condition) setCondition(resp.condition);
        if (resp.scale) setScale(resp.scale);
      }
      if (extractTargets.attributes && resp.attributes && !lockedSections.attributes) {
        setAttributes((prev) => {
          const next = { ...prev };
          for (const key of ATTR_KEYS) {
            if (!lockedAttrs[key] && resp.attributes![key]) next[key] = resp.attributes![key];
          }
          return next;
        });
      }
      addToast("Attributes extracted", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("extract");
  }, [description, getMainImageB64, addToast, extractTargets, lockedSections, lockedAttrs, busy]);

  // Enhance description
  const handleEnhanceDescription = useCallback(async () => {
    busy.start("enhance");
    try {
      const resp = await apiFetch<{
        description?: string; name?: string; propType?: string; setting?: string;
        condition?: string; scale?: string; attributes?: Record<string, string>; error?: string;
      }>("/prop/enhance", {
        method: "POST", body: JSON.stringify({ description, name: propName, propType, setting, condition, scale, attributes }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("enhance"); return; }
      if (resp.description && !lockedSections.propDescription) setDescription(resp.description);
      if (!lockedSections.identity) {
        if (resp.name) setPropName(resp.name);
        if (resp.propType) setPropType(resp.propType);
        if (resp.setting) setSetting(resp.setting);
        if (resp.condition) setCondition(resp.condition);
        if (resp.scale) setScale(resp.scale);
      }
      if (resp.attributes && !lockedSections.attributes) {
        setAttributes((prev) => {
          const next = { ...prev };
          for (const key of ATTR_KEYS) { if (!lockedAttrs[key] && resp.attributes![key]) next[key] = resp.attributes![key]; }
          return next;
        });
      }
      addToast("Prop enhanced", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("enhance");
  }, [description, propName, propType, setting, condition, scale, attributes, lockedSections, lockedAttrs, addToast, busy]);

  // Randomize full
  const handleRandomizeFull = useCallback(async () => {
    busy.start("randomize");
    try {
      const resp = await apiFetch<{
        description?: string; name?: string; propType?: string; setting?: string;
        condition?: string; scale?: string; attributes?: Record<string, string>; error?: string;
      }>("/prop/randomize-full", {
        method: "POST", body: JSON.stringify({ description, name: propName, propType, setting, condition, scale, attributes }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("randomize"); return; }
      if (resp.description && !lockedSections.propDescription) setDescription(resp.description);
      if (!lockedSections.identity) {
        if (resp.name) setPropName(resp.name);
        if (resp.propType) setPropType(resp.propType);
        if (resp.setting) setSetting(resp.setting);
        if (resp.condition) setCondition(resp.condition);
        if (resp.scale) setScale(resp.scale);
      }
      if (resp.attributes && !lockedSections.attributes) {
        setAttributes((prev) => {
          const next = { ...prev };
          for (const key of ATTR_KEYS) { if (!lockedAttrs[key] && resp.attributes![key]) next[key] = resp.attributes![key]; }
          return next;
        });
      }
      addToast("Random prop generated", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("randomize");
  }, [description, propName, propType, setting, condition, scale, attributes, lockedSections, lockedAttrs, addToast, busy]);

  // Upscale / Restore
  const handleUpscaleRestore = useCallback(async () => {
    const images = urImages.length > 0 ? urImages : (getMainImageB64() ? [`data:image/png;base64,${getMainImageB64()}`] : []);
    if (images.length === 0) { addToast("No image to process", "info"); return; }
    const endpoint = urMode === "upscale" ? "/prop/upscale" : "/prop/restore";
    busy.start("ur");
    try {
      for (const src of images) {
        const b64 = src.replace(/^data:image\/\w+;base64,/, "");
        const body: Record<string, unknown> = { image_b64: b64, model_id: urModelId || modelId || undefined };
        if (urMode === "upscale") (body as Record<string, unknown>).scale_factor = urScale;
        if (urContext) body.context = urContext;
        const resp = await apiFetch<{ image_b64?: string; error?: string }>(endpoint, { method: "POST", body: JSON.stringify(body) });
        if (resp.error) { addToast(resp.error, "error"); continue; }
        if (resp.image_b64) appendToGallery("main", `data:image/png;base64,${resp.image_b64}`, urMode === "upscale" ? "Upscaled" : "Restored");
      }
    } catch (e) { addToast(String(e), "error"); }
    busy.end("ur");
  }, [urImages, urMode, urScale, urContext, urModelId, modelId, getMainImageB64, addToast, appendToGallery, busy]);

  // Show XML
  const xmlContent = useMemo(() => {
    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Prop>"];
    lines.push(`  <Name>${propName}</Name>`);
    lines.push(`  <Type>${propType}</Type>`);
    lines.push(`  <Setting>${setting}</Setting>`);
    lines.push(`  <Condition>${condition}</Condition>`);
    lines.push(`  <Scale>${scale}</Scale>`);
    lines.push(`  <Description>${description}</Description>`);
    lines.push("  <Attributes>");
    for (const g of PROP_ATTRIBUTE_GROUPS) {
      lines.push(`    <${g.key}>${attributes[g.key] || ""}</${g.key}>`);
    }
    lines.push("  </Attributes>");
    lines.push("</Prop>");
    return lines.join("\n");
  }, [propName, propType, setting, condition, scale, description, attributes]);

  // Send to PS
  const handleSendToPS = useCallback(async () => {
    const b64 = getMainImageB64();
    if (!b64) { addToast("No image to send", "info"); return; }
    try {
      await apiFetch("/system/send-to-ps", { method: "POST", body: JSON.stringify({ image_b64: b64, label: "AI PropLab" }) });
      addToast("Sent to Photoshop", "success");
    } catch (e) { addToast(String(e), "error"); }
  }, [getMainImageB64, addToast]);

  // Clear all
  const handleReset = useCallback(() => {
    setGallery({});
    setImageIdx({});
    setImageRecords({});
    setDescription("");
    setEditPrompt("");
    setPropName("");
    setPropType("");
    setSetting("");
    setCondition("");
    setScale("");
    setAttributes(Object.fromEntries(ATTR_KEYS.map((k) => [k, ""])));
    setLockedAttrs(Object.fromEntries(ATTR_KEYS.map((k) => [k, false])));
    setStyleFusion({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
    setPreservation({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });
    setTabs(BUILTIN_TABS);
    setActiveTab("main");
    addToast("Prop session cleared", "info");
  }, [addToast]);

  // Listen for project-clear event from ProjectTabsWrapper
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === "madison-proplab-projects" && detail?.instanceId === instanceId) {
        handleReset();
      }
    };
    window.addEventListener("project-clear", handler);
    return () => window.removeEventListener("project-clear", handler);
  }, [instanceId, handleReset]);

  // History navigation
  const handleHistorySelect = useCallback((entry: HistoryEntry | null) => {
    if (!entry) { setActiveHistoryId(null); return; }
    setActiveHistoryId(entry.id);
    const key = historyKey;
    const record = imageRecords[key];
    if (!record) return;
    const found = record.history.find((h) => h.id === entry.id);
    if (found) {
      const src = found.image_b64.startsWith("data:") ? found.image_b64 : `data:image/png;base64,${found.image_b64}`;
      setGallery((prev) => ({
        ...prev,
        [activeTab]: prev[activeTab]?.map((img, i) => i === currentIdx ? src : img) || [src],
      }));
    }
  }, [historyKey, imageRecords, activeTab, currentIdx]);

  const handleClearHistory = useCallback(() => {
    setImageRecords((prev) => {
      const next = { ...prev };
      delete next[historyKey];
      return next;
    });
    setActiveHistoryId(null);
  }, [historyKey]);

  // Handle context menu actions from ImageViewer
  const handleClearImage = useCallback(() => {
    setGallery((prev) => {
      const arr = prev[activeTab];
      if (!arr || arr.length === 0) return prev;
      const next = [...arr];
      next[currentIdx] = "";
      return { ...prev, [activeTab]: next.filter(Boolean) };
    });
  }, [activeTab, currentIdx]);

  const handleClearAllGenerated = useCallback(() => {
    setGallery((prev) => ({ ...prev, [activeTab]: [] }));
    setImageIdx((prev) => ({ ...prev, [activeTab]: 0 }));
  }, [activeTab]);

  // Session management
  useSessionRegister(
    sessionKey,
    () => ({
      description, propName, propType, setting, condition, scale, attributes,
      lockedAttrs, lockedSections, styleFusion, preservation, sectionEnabled,
      extractTargets, extractMode, modelId, genCount, layout, tabs, activeTab,
    }),
    (s: unknown) => {
      if (s === null) { handleReset(); return; }
      const data = s as Record<string, unknown>;
      if (typeof data.description === "string") setDescription(data.description);
      if (typeof data.propName === "string") setPropName(data.propName);
      if (typeof data.propType === "string") setPropType(data.propType);
      if (typeof data.setting === "string") setSetting(data.setting);
      if (typeof data.condition === "string") setCondition(data.condition);
      if (typeof data.scale === "string") setScale(data.scale);
      if (data.attributes) setAttributes(data.attributes as Record<string, string>);
      if (data.lockedAttrs) setLockedAttrs(data.lockedAttrs as Record<string, boolean>);
      if (data.lockedSections) setLockedSections(data.lockedSections as typeof lockedSections);
      if (data.styleFusion) setStyleFusion(data.styleFusion as StyleFusionState);
      if (data.preservation) setPreservation(data.preservation as PreservationLockState);
      if (data.sectionEnabled) setSectionEnabled(data.sectionEnabled as Partial<Record<SectionId, boolean>>);
      if (data.extractTargets) setExtractTargets(data.extractTargets as Record<ExtractTarget, boolean>);
      if (typeof data.extractMode === "string") setExtractMode(data.extractMode as "inspiration" | "recreate");
      if (typeof data.modelId === "string") setModelId(data.modelId);
      if (typeof data.genCount === "number") setGenCount(data.genCount);
      if (data.layout) setLayout(data.layout as LayoutState);
      if (Array.isArray(data.tabs)) setTabs(data.tabs as TabDef[]);
      if (typeof data.activeTab === "string") setActiveTab(data.activeTab);
    },
  );

  // Register keyboard shortcuts
  const { registerAction, unregisterAction } = useShortcuts();
  useEffect(() => {
    registerAction("propGenerate", () => handleGenerate());
    registerAction("propExtract", handleExtractAttributes);
    registerAction("propEnhance", handleEnhanceDescription);
    registerAction("propRandomize", handleRandomizeFull);
    registerAction("propAllViews", handleGenerateAllViews);
    registerAction("propShowXml", () => setXmlOpen(true));
    registerAction("propSendPS", handleSendToPS);
    return () => {
      for (const id of ["propGenerate", "propExtract", "propEnhance", "propRandomize", "propAllViews", "propShowXml", "propSendPS"]) {
        unregisterAction(id);
      }
    };
  }, [registerAction, unregisterAction, handleGenerate, handleExtractAttributes, handleEnhanceDescription, handleRandomizeFull, handleGenerateAllViews, handleSendToPS]);

  // --- Randomize a single attribute ---
  const randomizeAttr = useCallback((key: string) => {
    const group = PROP_ATTRIBUTE_GROUPS.find((g) => g.key === key);
    if (!group) return;
    // We don't have full common/rare arrays on the frontend, so just call the backend randomize
    // For a quick local option: use a placeholder prompt
    setAttributes((prev) => ({ ...prev, [key]: `(randomize ${group.label})` }));
  }, []);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  // --- Generate section ---
  const renderGenerateSection = () => (
    <>
      <Button
        className="w-full"
        generating={busy.is("extract")}
        generatingText="Extracting..."
        onClick={handleExtractAttributes}
        disabled={textBusy}
        title="Analyze the current image and description to populate identity/attributes"
      >
        Extract Attributes
      </Button>
      <div>
        <select
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          value={extractMode}
          onChange={(e) => setExtractMode(e.target.value as "inspiration" | "recreate")}
          title="Controls how the source image is used when generating."
        >
          <option value="inspiration">Generate from description only</option>
          <option value="recreate">Match source image exactly</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-1 px-0.5">
        {([
          ["identity", "Identity"],
          ["description", "Description"],
          ["attributes", "Attributes"],
        ] as [ExtractTarget, string][]).map(([key, lbl]) => (
          <button
            key={key}
            type="button"
            onClick={() => setExtractTargets((p) => ({ ...p, [key]: !p[key] }))}
            className="px-2 py-0.5 text-[9px] rounded cursor-pointer select-none transition-colors"
            style={{
              background: extractTargets[key] ? "var(--color-accent)" : "var(--color-input-bg)",
              color: extractTargets[key] ? "var(--color-foreground)" : "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              fontWeight: extractTargets[key] ? 600 : 400,
            }}
            title={`When active, Extract / Enhance / Randomize will fill in the ${lbl} section`}
          >{lbl}</button>
        ))}
      </div>
      <div>
        <span className="text-xs font-medium block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Style Library</span>
        <select
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] min-w-0 truncate"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
          value={styleLibraryFolder}
          onChange={(e) => setStyleLibraryFolder(e.target.value)}
          title="Pick a style folder to guide the look of your generated images."
        >
          <option value="">Default (Gemini)</option>
          {styleLibraryFolders.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          className="w-full"
          generating={busy.is("enhance")}
          generatingText="Enhancing..."
          onClick={handleEnhanceDescription}
          disabled={textBusy}
          title="Enhance existing fields with richer detail"
        >
          Enhance
        </Button>
        <Button
          size="sm"
          className="w-full"
          generating={busy.is("randomize")}
          generatingText="Randomizing..."
          onClick={handleRandomizeFull}
          disabled={textBusy}
          title="Generate a random prop with all attributes filled in"
        >
          Randomize
        </Button>
      </div>
      <div className="pt-1">
        <Button
          variant="primary"
          className="w-full"
          size="lg"
          generating={busy.is("gen")}
          generatingText="Generating..."
          onClick={generationMode === "grid" ? handleGridGenerate : () => handleGenerate()}
          disabled={busy.is("gen")}
          title="Generate a new prop image based on all enabled sections"
        >
          Generate Prop Image
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <NumberStepper value={genCount} min={1} max={20} onChange={setGenCount} label="Count:" />
        {models.length > 0 && (
          <select
            className="min-w-0 flex-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            title="Select the AI model for image generation"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label} — {m.resolution}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Generation View</label>
        <select
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          value={generationMode}
          onChange={(e) => setGenerationMode(e.target.value as "single" | "grid")}
          disabled={busy.any}
        >
          <option value="single">Single Image</option>
          <option value="grid">4×4 Grid (16 images)</option>
        </select>
      </div>
    </>
  );

  // --- Identity section ---
  const renderIdentitySection = () => (
    <>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Name</label>
        <input value={propName} onChange={(e) => setPropName(e.target.value)} placeholder="e.g. Rustic Lantern" className="w-full text-[11px] px-2 py-1 rounded" style={inputStyle} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Prop Type</label>
        <Select options={PROP_TYPE_OPTIONS} value={propType} onChange={(e) => setPropType(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Setting / Era</label>
        <Select options={SETTING_OPTIONS} value={setting} onChange={(e) => setSetting(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Condition</label>
        <Select options={CONDITION_OPTIONS} value={condition} onChange={(e) => setCondition(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Scale</label>
        <Select options={SCALE_OPTIONS} value={scale} onChange={(e) => setScale(e.target.value)} disabled={textBusy} />
      </div>
    </>
  );

  // --- Description section ---
  const renderDescriptionSection = () => (
    <div>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
        placeholder="Describe the prop in detail — materials, shape, wear, function, history..."
        disabled={textBusy}
        data-voice-target="propDescription"
      />
    </div>
  );

  // --- Attributes section ---
  const renderAttributesSection = () => (
    <>
      {PROP_ATTRIBUTE_GROUPS.map((g) => (
        <div key={g.key}>
          <div className="flex items-center gap-1 mb-0.5">
            <label className="text-[10px] font-medium flex-1" style={{ color: "var(--color-text-muted)" }}>{g.label}</label>
            <button
              onClick={(e) => { e.stopPropagation(); setLockedAttrs((p) => ({ ...p, [g.key]: !p[g.key] })); }}
              className="p-0.5 rounded"
              style={{ background: "transparent", border: "none", color: lockedAttrs[g.key] ? "var(--color-text-primary)" : "var(--color-text-muted)", cursor: "pointer" }}
              title={lockedAttrs[g.key] ? "Locked — AI won't change this" : "Unlocked — AI can update this"}
            >
              {lockedAttrs[g.key] ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            </button>
          </div>
          <input
            value={attributes[g.key] || ""}
            onChange={(e) => setAttributes((p) => ({ ...p, [g.key]: e.target.value }))}
            placeholder={`e.g. ${g.label.toLowerCase()} description...`}
            className="w-full text-[11px] px-2 py-1 rounded"
            style={inputStyle}
            disabled={textBusy}
            data-voice-target={`propAttr-${g.key}`}
          />
        </div>
      ))}
    </>
  );

  // --- Style Fusion section ---
  const renderStyleFusionSection = () => (
    <StyleFusionPanel
      fusion={styleFusion}
      onChange={setStyleFusion}
      takeOptions={TAKE_OPTIONS}
      disabled={textBusy}
    />
  );

  // --- Preservation section ---
  const renderPreservationSection = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPreservation((p) => ({ ...p, enabled: !p.enabled }))}
          className="px-2 py-0.5 text-[10px] rounded cursor-pointer font-medium"
          style={{
            background: preservation.enabled ? "var(--color-accent)" : "var(--color-input-bg)",
            color: preservation.enabled ? "var(--color-foreground)" : "var(--color-text-muted)",
            border: "1px solid var(--color-border)",
          }}
          title={preservation.enabled ? "Turn off preservation rules" : "Turn on preservation rules so the AI respects your constraints"}
        >{preservation.enabled ? "ON" : "OFF"}</button>
        <button
          onClick={() => setPreservation({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) })}
          className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          title="Reset all preservation rules back to their defaults"
        >Reset</button>
        <span className="text-[10px]" style={{ color: preservation.enabled ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
          {preservation.enabled ? "Active — the AI will try to keep these traits and avoid the negatives" : "Off — no constraints, the AI has full creative freedom"}
        </span>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }} title="Check the things you want the AI to keep the same when regenerating">Preserve</p>
        <div className="space-y-1">
          {preservation.preserves.map((p, i) => (
            <div key={p.key} className="flex items-center gap-2 group">
              <button
                onClick={() => setPreservation((prev) => {
                  const next = { ...prev, preserves: [...prev.preserves] };
                  next.preserves[i] = { ...next.preserves[i], enabled: !next.preserves[i].enabled };
                  return next;
                })}
                className="w-3.5 h-3.5 rounded-sm shrink-0 cursor-pointer flex items-center justify-center text-[8px]"
                style={{
                  background: p.enabled ? "var(--color-accent)" : "var(--color-input-bg)",
                  border: "1px solid var(--color-border)",
                  color: p.enabled ? "var(--color-foreground)" : "transparent",
                }}
              >{p.enabled ? "✓" : ""}</button>
              <span className="text-xs flex-1" style={{ color: p.enabled ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>{p.label}</span>
              <button
                onClick={() => setPreservation((prev) => ({ ...prev, preserves: prev.preserves.filter((_, j) => j !== i) }))}
                className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer"
                style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                title="Remove this preserve rule"
              >✕</button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const label = prompt("New preserve constraint:", "Keep ...");
            if (!label?.trim()) return;
            const p = label.trim();
            setPreservation((prev) => ({
              ...prev,
              preserves: [...prev.preserves, { key: `custom_${Date.now()}`, label: p, prompt: `Do NOT change: ${p}`, enabled: true }],
            }));
          }}
          className="mt-1.5 px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          title="Add a new rule telling the AI what to keep unchanged — e.g. Keep face, Keep hairstyle"
        >+ Add Preserve</button>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }} title="List things the AI should never include in the generated image">Negative Constraints (must avoid)</p>
        <div className="space-y-1">
          {preservation.negatives.map((n, i) => (
            <div key={n.id} className="flex items-center gap-2 group">
              <button
                onClick={() => setPreservation((prev) => {
                  const next = { ...prev, negatives: [...prev.negatives] };
                  next.negatives[i] = { ...next.negatives[i], enabled: !next.negatives[i].enabled };
                  return next;
                })}
                className="w-3.5 h-3.5 rounded-sm shrink-0 cursor-pointer flex items-center justify-center text-[8px]"
                style={{
                  background: n.enabled ? "var(--color-accent)" : "var(--color-input-bg)",
                  border: "1px solid var(--color-border)",
                  color: n.enabled ? "var(--color-foreground)" : "transparent",
                }}
              >{n.enabled ? "✓" : ""}</button>
              <input
                className="flex-1 px-2 py-1 text-xs min-w-0"
                style={inputStyle}
                value={n.text}
                onChange={(e) => setPreservation((prev) => ({
                  ...prev,
                  negatives: prev.negatives.map((nn, j) => j === i ? { ...nn, text: e.target.value } : nn),
                }))}
              />
              <button
                onClick={() => setPreservation((prev) => ({ ...prev, negatives: prev.negatives.filter((_, j) => j !== i) }))}
                className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer"
                style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                title="Remove this negative constraint"
              >✕</button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setPreservation((prev) => ({
            ...prev,
            negatives: [...prev.negatives, { id: `neg${++_negIdCounter}`, text: "", enabled: true }],
          }))}
          className="mt-1.5 px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          title="Add something the AI must avoid — e.g. No crown, No fantasy elements"
        >+ Add Negative</button>
      </div>
    </div>
  );

  // --- Upscale / Restore section ---
  const renderUpscaleRestoreSection = () => (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {(["upscale", "restore"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setUrMode(m)}
            className="flex-1 px-2 py-1.5 text-xs rounded cursor-pointer font-medium"
            style={{
              background: urMode === m ? "var(--color-accent)" : "var(--color-input-bg)",
              color: urMode === m ? "var(--color-foreground)" : "var(--color-text-muted)",
              border: `1px solid ${urMode === m ? "var(--color-accent)" : "var(--color-border)"}`,
            }}
          >{m === "upscale" ? "Upscale" : "Restore"}</button>
        ))}
      </div>
      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        {urMode === "upscale"
          ? "Makes images bigger and sharper without changing content"
          : "Fixes AI artifacts, blur, and noise by redrawing the image cleanly"}
      </p>
      {urMode === "upscale" && (
        <div className="flex items-center gap-2">
          <span className="text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>Scale:</span>
          <div className="flex gap-1">
            {(["x2", "x3", "x4"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setUrScale(s)}
                className="px-2.5 py-0.5 text-[11px] rounded cursor-pointer"
                style={{
                  background: urScale === s ? "var(--color-accent)" : "var(--color-input-bg)",
                  color: urScale === s ? "var(--color-foreground)" : "var(--color-text-muted)",
                  border: `1px solid ${urScale === s ? "var(--color-accent)" : "var(--color-border)"}`,
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}
      <input
        className="w-full px-2 py-1 text-xs"
        style={inputStyle}
        placeholder="Optional context — e.g. pixel art icons, game UI screenshots"
        value={urContext}
        onChange={(e) => setUrContext(e.target.value)}
        title="Give the AI a hint about what kind of images these are for better results"
      />
      {models.length > 0 && (
        <select
          className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
          value={urModelId}
          onChange={(e) => setUrModelId(e.target.value)}
          title="Choose which AI model to use for upscaling or restoring"
        >
          <option value="">Auto (best available)</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      )}
      <div
        className="rounded p-2 text-center"
        style={{ border: "1px dashed var(--color-border)", background: "var(--color-input-bg)" }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          Array.from(e.dataTransfer.files).forEach((file) => {
            if (!file.type.startsWith("image/")) return;
            const reader = new FileReader();
            reader.onload = () => setUrImages((prev) => [...prev, reader.result as string]);
            reader.readAsDataURL(file);
          });
        }}
      >
        {urImages.length === 0 && (
          <p className="text-[10px] py-2" style={{ color: "var(--color-text-muted)" }}>
            Defaults to Main Stage image. Drag images here or click Add.
          </p>
        )}
        {urImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {urImages.map((src, i) => (
              <div key={i} className="relative group" style={{ width: 56, height: 56 }}>
                <img src={src} alt="" className="w-full h-full object-cover rounded" />
                <button
                  type="button"
                  onClick={() => setUrImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100"
                  style={{ background: "var(--color-error)", color: "#fff" }}
                  title="Remove this image"
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 justify-center flex-wrap">
          <input
            ref={urFileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              Array.from(e.target.files || []).forEach((file) => {
                const reader = new FileReader();
                reader.onload = () => setUrImages((prev) => [...prev, reader.result as string]);
                reader.readAsDataURL(file);
              });
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => urFileRef.current?.click()}
            className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
            title="Add images from your computer"
          >+ Add Images</button>
          <button
            type="button"
            onClick={async () => {
              try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                  const imgType = item.types.find((t) => t.startsWith("image/"));
                  if (imgType) {
                    const blob = await item.getType(imgType);
                    const reader = new FileReader();
                    reader.onload = () => setUrImages((prev) => [...prev, reader.result as string]);
                    reader.readAsDataURL(blob);
                  }
                }
              } catch { addToast("Could not read clipboard", "info"); }
            }}
            className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
            title="Paste images from your clipboard"
          >Paste</button>
          {urImages.length > 0 && (
            <button
              type="button"
              onClick={() => setUrImages([])}
              className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
              style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              title="Remove all images"
            >Clear All</button>
          )}
        </div>
      </div>
      <Button
        variant="primary"
        className="w-full"
        size="sm"
        generating={busy.is("ur")}
        generatingText="Processing..."
        onClick={handleUpscaleRestore}
        title={urMode === "upscale" ? "Upscale images — makes them bigger and sharper" : "Restore images — fixes AI artifacts and blur"}
      >{urMode === "upscale" ? "Upscale" : "Restore"}</Button>
    </div>
  );

  // --- Multiview section ---
  const renderMultiviewSection = () => (
    <div className="space-y-1.5">
      <Button
        className="w-full"
        size="sm"
        generating={busy.is("allViews")}
        generatingText="Generating views..."
        onClick={handleGenerateAllViews}
        title="Generate 3/4, front, back, side, and top views from the main stage image"
      >Generate All Views</Button>
      <Button
        className="w-full"
        size="sm"
        generating={busy.is("gen")}
        generatingText="Generating..."
        onClick={handleGenerateSelectedView}
        title="Generate only the currently selected view"
      >Generate Selected View</Button>
      <NumberStepper value={viewGenCount} min={1} max={10} onChange={setViewGenCount} label="Count:" />
    </div>
  );

  // --- Save section ---
  const renderSaveSection = () => (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="sm" className="w-full" onClick={handleSendToPS} title="Send the current image to Photoshop">Send to PS</Button>
        <Button size="sm" className="w-full" onClick={() => setXmlOpen(true)} title="Show the XML representation of this prop">Show XML</Button>
        <Button size="sm" className="w-full" onClick={handleReset} title="Clear all prop data and images">Clear All</Button>
        <Button size="sm" className="w-full col-span-3" onClick={handleSetDefaultLayout} title="Save current section order and collapsed states as default">
          <Save className="h-3 w-3 shrink-0 inline" /> Set Default Layout
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
        <Button size="sm" className="w-full" title="Composite all views into a single reference sheet" onClick={async () => {
          const imgs: {label: string; image_b64: string}[] = [];
          for (const tab of ["main","3/4","front","back","side","top"] as const) {
            const b64 = getImageB64(tab);
            if (b64) imgs.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
          }
          if (imgs.length === 0) { addToast("No view images to export", "info"); return; }
          try {
            const res = await (await import("@/hooks/useApi")).apiFetch<{image_b64: string}>("/export/consistency-sheet", {
              method: "POST", body: JSON.stringify({ images: imgs, layout: imgs.length <= 2 ? "1x4" : "2x2", title: "", include_labels: true })
            });
            const a = document.createElement("a"); a.href = `data:image/png;base64,${res.image_b64}`; a.download = `prop_ref_sheet_${Date.now()}.png`; a.click();
          } catch (e) { addToast("Failed to generate ref sheet", "error"); }
        }}>Ref Sheet</Button>
        <Button size="sm" className="w-full" title="Export a complete handoff package as ZIP" onClick={async () => {
          const imgs: {label: string; image_b64: string}[] = [];
          for (const tab of ["main","3/4","front","back","side","top"] as const) {
            const b64 = getImageB64(tab);
            if (b64) imgs.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
          }
          if (imgs.length === 0) { addToast("No view images to export", "info"); return; }
          try {
            const res = await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/export/package`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ images: imgs, xml_data: "", prompt_text: "", settings: {}, palette: [], include_ref_sheet: true, tool_name: "prop", character_name: "prop" })
            });
            if (!res.ok) throw new Error("Export failed");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `prop_export_${Date.now()}.zip`; a.click();
            URL.revokeObjectURL(url);
          } catch (e) { addToast("Failed to export package", "error"); }
        }}>Export ZIP</Button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* LEFT PANEL */}
      <div
        className="w-[400px] h-full shrink-0 overflow-y-auto p-3 space-y-2"
        style={{ borderRight: "1px solid var(--color-border)" }}
      >
        {layout.order.map((sectionId) => {
          const collapsed = isSectionCollapsed(sectionId);
          const canCollapse = !NON_COLLAPSIBLE.has(sectionId);
          const canToggle = TOGGLEABLE_SECTIONS.has(sectionId);
          const enabled = isSectionEnabled(sectionId);
          const label = SECTION_LABELS[sectionId];
          const isPromptEditable = PROMPT_EDITABLE_SECTIONS.has(sectionId);
          const sectionHasOverride = isPromptEditable && promptOverrides.hasOverride(TOOL_ID, sectionId);
          const sectionColor = getSectionColor(TOOL_ID, sectionId);

          const wrapSection = (children: ReactNode) => (
            <div
              key={sectionId}
              draggable
              onDragStart={() => handleDragStart(sectionId)}
              onDragOver={(e) => handleDragOver(e, sectionId)}
              onDrop={() => handleDrop(sectionId)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => { if (dragOverId === sectionId) setDragOverId(null); }}
              onMouseDown={(e) => { if (e.button === 1 && canToggle) { e.preventDefault(); toggleSectionEnabled(sectionId); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                setPromptCtxMenu({ x: e.clientX, y: e.clientY, section: sectionId });
              }}
              className="section-card-hover"
              style={{
                border: dragOverId === sectionId && dragItemRef.current !== sectionId
                  ? "1px solid var(--color-accent, #6a6aff)"
                  : sectionColor
                    ? `1px solid ${sectionColor}`
                    : sectionHasOverride
                      ? "1px solid var(--color-accent)"
                      : "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-card)",
                opacity: enabled ? 1 : 0.4,
                transition: "opacity 0.15s ease, filter 0.15s ease",
              }}
            >
              <div
                className="flex items-center px-1 shrink-0"
                style={{ borderBottom: collapsed ? "none" : "1px solid var(--color-border)" }}
              >
                <span className="cursor-grab active:cursor-grabbing px-1 py-1.5" style={{ color: "var(--color-text-muted)" }}>
                  <GripVertical className="h-3 w-3" />
                </span>
                {sectionColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sectionColor }} />}
                {canCollapse ? (
                  <button
                    type="button"
                    onClick={() => toggleSectionCollapse(sectionId)}
                    className="flex-1 flex items-center gap-1.5 py-1.5 text-left cursor-pointer"
                    style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
                    title={SECTION_TIPS[sectionId]}
                  >
                    {collapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                    <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
                    {sectionHasOverride && <Pencil className="h-2.5 w-2.5 shrink-0" style={{ color: "var(--color-accent)" }} />}
                  </button>
                ) : (
                  <span className="flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }} title={SECTION_TIPS[sectionId]}>
                    {label}
                  </span>
                )}
                {(sectionId in lockedSections) && (
                  <span
                    role="button"
                    onClick={() => toggleLock(sectionId as LockableSection, !lockedSections[sectionId as LockableSection])}
                    className="inline-flex items-center justify-center w-5 h-5 rounded select-none cursor-pointer"
                    style={{
                      background: lockedSections[sectionId as LockableSection] ? "rgba(255,255,255,0.12)" : "transparent",
                      color: lockedSections[sectionId as LockableSection] ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                    }}
                    title={lockedSections[sectionId as LockableSection]
                      ? "Locked — AI won't change these fields when you Extract, Enhance, or Randomize. You can still edit them yourself."
                      : "Unlocked — AI can update these fields when you use Extract, Enhance, or Randomize."}
                  >
                    {lockedSections[sectionId as LockableSection]
                      ? <Lock className="h-3 w-3" />
                      : <Unlock className="h-3 w-3" />}
                  </span>
                )}
                {canToggle && (
                  <button
                    type="button"
                    onClick={() => toggleSectionEnabled(sectionId)}
                    className="px-1.5 py-0.5 text-[9px] rounded font-semibold cursor-pointer shrink-0 select-none"
                    style={{
                      background: enabled ? "var(--color-accent)" : "var(--color-input-bg)",
                      color: enabled ? "var(--color-foreground)" : "var(--color-text-muted)",
                      border: "1px solid var(--color-border)",
                    }}
                    title={enabled ? "This section is ON — its info will shape your generated images. Middle-click or click here to turn it off." : "This section is OFF — its info won't be used when generating. Middle-click or click here to turn it on."}
                  >
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}
              </div>
              {!collapsed && <div className="px-3 pt-1 pb-3 space-y-2 overflow-hidden">{children}</div>}
            </div>
          );

          if (sectionId === "generate") return wrapSection(renderGenerateSection());
          if (sectionId === "identity") return wrapSection(renderIdentitySection());
          if (sectionId === "propDescription") return wrapSection(renderDescriptionSection());
          if (sectionId === "attributes") return wrapSection(renderAttributesSection());
          if (sectionId === "styleFusion") return wrapSection(renderStyleFusionSection());
          if (sectionId === "preservation") return wrapSection(renderPreservationSection());
          if (sectionId === "upscaleRestore") return wrapSection(renderUpscaleRestoreSection());
          if (sectionId === "multiview") return wrapSection(renderMultiviewSection());
          if (sectionId === "saveOptions") return wrapSection(renderSaveSection());
          return null;
        })}

        {customSections.sections.map((cs) => {
          const csCollapsed = customSections.isCollapsed(cs.id);
          const csEnabled = customSections.isEnabled(cs.id);
          const csColor = cs.color || getSectionColor(TOOL_ID, `custom:${cs.id}`);
          return (
            <div
              key={`custom:${cs.id}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setPromptCtxMenu({ x: e.clientX, y: e.clientY, section: `custom:${cs.id}` as SectionId });
              }}
              className="section-card-hover"
              style={{
                border: csColor ? `1px solid ${csColor}` : "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-card)",
                opacity: csEnabled ? 1 : 0.4,
                transition: "opacity 0.15s ease",
              }}
            >
              <div className="flex items-center px-1 shrink-0" style={{ borderBottom: csCollapsed ? "none" : "1px solid var(--color-border)" }}>
                <span className="cursor-grab active:cursor-grabbing px-1 py-1.5" style={{ color: "var(--color-text-muted)" }}>
                  <GripVertical className="h-3 w-3" />
                </span>
                {csColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: csColor }} />}
                <button
                  type="button"
                  onClick={() => customSections.toggleCollapsed(cs.id)}
                  className="flex-1 flex items-center gap-1.5 py-1.5 text-left cursor-pointer"
                  style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
                >
                  {csCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                  <span className="text-xs font-semibold uppercase tracking-wider">{cs.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => customSections.toggleEnabled(cs.id)}
                  className="px-1.5 py-0.5 text-[9px] rounded font-semibold cursor-pointer shrink-0 select-none"
                  style={{
                    background: csEnabled ? "var(--color-accent)" : "var(--color-input-bg)",
                    color: csEnabled ? "var(--color-foreground)" : "var(--color-text-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {csEnabled ? "ON" : "OFF"}
                </button>
              </div>
              {!csCollapsed && (
                <div className="px-3 pt-1 pb-3 space-y-2 overflow-hidden">
                  <CustomSectionRenderer
                    section={cs}
                    values={customSections.values[cs.id] ?? {}}
                    onChange={(blockId, val) => customSections.setValue(cs.id, blockId, val)}
                    disabled={busy.any}
                  />
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleSetDefaultLayout}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-[10px] font-medium cursor-pointer transition-colors"
          style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px dashed var(--color-border)" }}
          title="Remember how you've arranged these panels — next time you open the app, they'll be in the same order and open/closed state"
        >
          <Save className="h-3 w-3" />
          Set Active Layout as Default
        </button>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Tab bar + quick actions row */}
        <div className="flex items-end shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex-1 min-w-0 overflow-hidden">
            <GroupedTabBar
              tabs={tabs}
              active={activeTab}
              onSelect={setActiveTab}
              onAddRef={handleAddRef}
              onRemoveTab={handleRemoveRef}
              onEditTabPrompt={handleEditTabPrompt}
              noBorder
            />
          </div>
          <div className="flex items-center gap-1.5 px-2 pb-1 shrink-0">
            <Button className="text-[11px] py-1" onClick={handleQuickGenerate} disabled={busy.is("gen")}>Quick Generate</Button>
            {busy.any && (
              <Button className="text-[11px] py-1" onClick={handleCancel} style={{ background: "rgba(220,80,80,0.15)", color: "#e05050", border: "1px solid rgba(220,80,80,0.3)" }}>Cancel</Button>
            )}
          </div>
        </div>

        {/* Image viewer + history */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {activeTab === "artboard" ? (
            <ArtboardCanvas />
          ) : generationMode === "grid" && activeTab === "main" && gridResults.length > 0 ? (
            <div className="flex-1 min-w-0">
              <GridGallery
                results={gridResults}
                title="Prop Variations"
                toolLabel="prop"
                generating={busy.is("gen")}
                emptyMessage="No grid results yet. Switch to grid mode and generate."
                onDelete={handleGridDelete}
                onCopy={handleGridCopy}
                onEditSubmit={handleGridEdit}
                editBusy={gridEditBusy}
                isFavorited={(b64) => isFavorited(b64)}
                onToggleFavorite={(id, b64, w, h) => { if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "prop", label: `grid-${id}`, prompt: "", source: "grid", width: w, height: h }); }}
              />
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <ImageViewer
                  src={currentSrc}
                  imageCount={currentImages.length}
                  imageIndex={currentIdx}
                  onPrevImage={() => setImageIdx((p) => ({ ...p, [activeTab]: Math.max(0, (p[activeTab] ?? 0) - 1) }))}
                  onNextImage={() => setImageIdx((p) => ({ ...p, [activeTab]: Math.min((gallery[activeTab]?.length ?? 1) - 1, (p[activeTab] ?? 0) + 1) }))}
                  onPasteImage={handlePasteImage}
                  onClearImage={handleClearImage}
                  onClearAllImages={handleClearAllGenerated}
                  onImageEdited={(newSrc: string, label: string) => appendToGallery(activeTab, newSrc, label)}
                  locked={busy.any}
                  isFavorited={currentSrc ? isFavorited(currentSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
                  onToggleFavorite={currentSrc ? () => { const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "prop", label: activeTab || "main", source: "viewer" }); } : undefined}
                />
              </div>
              <div className="w-[200px] shrink-0 overflow-y-auto" style={{ borderLeft: "1px solid var(--color-border)" }}>
                <EditHistory
                  entries={currentHistory}
                  activeEntryId={activeHistoryId}
                  onRestore={(entryId: string) => {
                    const entry = currentHistory.find((h) => h.id === entryId) ?? null;
                    handleHistorySelect(entry);
                  }}
                  onRestoreCurrent={() => handleHistorySelect(null)}
                  onClearHistory={handleClearHistory}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* XML Modal */}
      {xmlOpen && <XmlModal xml={xmlContent} title="Prop XML" onClose={() => setXmlOpen(false)} />}

      {/* Section context menu (prompt edit + color) */}
      {promptCtxMenu && (() => {
        const isCustom = promptCtxMenu.section.startsWith("custom:");
        const isEditable = !isCustom && PROMPT_EDITABLE_SECTIONS.has(promptCtxMenu.section);
        const colorKey = isCustom ? promptCtxMenu.section : promptCtxMenu.section;
        const currentColor = getSectionColor(TOOL_ID, colorKey);
        return (
          <div className="fixed inset-0 z-[55]" onClick={() => setPromptCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPromptCtxMenu(null); }}>
            <div
              className="absolute py-1 rounded-md shadow-lg"
              style={{
                left: promptCtxMenu.x, top: promptCtxMenu.y,
                background: "var(--color-card)", border: "1px solid var(--color-border)",
                minWidth: 200, zIndex: 56,
              }}
            >
              {isEditable && (
                <>
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs cursor-pointer"
                    style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    onClick={() => { setPromptEditSection(promptCtxMenu.section); setPromptCtxMenu(null); }}
                  >
                    <Pencil className="h-3 w-3 inline mr-2" style={{ verticalAlign: "-2px" }} />
                    Edit Prompt
                  </button>
                  {promptOverrides.hasOverride(TOOL_ID, promptCtxMenu.section) && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs cursor-pointer"
                      style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onClick={() => { promptOverrides.clearOverride(TOOL_ID, promptCtxMenu.section); setPromptCtxMenu(null); addToast("Prompt reset to default", "info"); }}
                    >
                      Reset Prompt to Default
                    </button>
                  )}
                  <div className="my-1" style={{ borderTop: "1px solid var(--color-border)" }} />
                </>
              )}
              <div className="px-3 py-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                  Section Color
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {["#808080", "#e05050", "#e09040", "#d0c040", "#50b060", "#40a0d0", "#6070e0", "#a060d0", "#d060a0"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setSectionColor(TOOL_ID, colorKey, c); setPromptCtxMenu(null); }}
                      className="w-4 h-4 rounded-full cursor-pointer shrink-0"
                      style={{ background: c, border: currentColor === c ? "2px solid white" : "1px solid var(--color-border)" }}
                    />
                  ))}
                  <input
                    type="color"
                    value={currentColor || "#808080"}
                    onChange={(e) => { setSectionColor(TOOL_ID, colorKey, e.target.value); }}
                    className="w-4 h-4 rounded cursor-pointer border-0 p-0"
                    title="Custom color"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {currentColor && (
                    <button
                      type="button"
                      onClick={() => { setSectionColor(TOOL_ID, colorKey, undefined); setPromptCtxMenu(null); }}
                      className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit prompt modal */}
      {promptEditSection && (
        <EditPromptModal open sectionLabel={SECTION_LABELS[promptEditSection]} defaultText={getDefaultSectionPrompt(promptEditSection)} currentText={promptOverrides.getOverride(TOOL_ID, promptEditSection) ?? getDefaultSectionPrompt(promptEditSection)} hasOverride={promptOverrides.hasOverride(TOOL_ID, promptEditSection)} onSave={(text) => { promptOverrides.setOverride(TOOL_ID, promptEditSection, text); setPromptEditSection(null); addToast("Prompt saved", "success"); }} onReset={() => { promptOverrides.clearOverride(TOOL_ID, promptEditSection); addToast("Prompt reset to default", "info"); }} onClose={() => setPromptEditSection(null)} />
      )}
    </div>
  );
}
