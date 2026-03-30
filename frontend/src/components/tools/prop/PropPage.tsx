import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Button, Select, Textarea, NumberStepper, Card } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { GroupedTabBar } from "@/components/shared/TabBar";
import { ArtboardCanvas } from "@/components/shared/ArtboardCanvas";
import type { TabDef } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useModels, type ModelInfo } from "@/hooks/ModelsContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { createHistoryEntry, pushHistory, createImageRecord } from "@/lib/imageHistory";
import type { HistoryEntry, ImageRecord, HistorySettings } from "@/lib/imageHistory";
import { XmlModal } from "@/components/shared/XmlModal";
import { ArtDirectorWidget } from "@/components/shared/ArtDirectorWidget";
import { ArtDirectorConfigModal } from "@/components/shared/ArtDirectorConfigModal";
import { ThreeDGenSidebar } from "@/components/shared/ThreeDGenSidebar";
import type { ViewImage } from "@/components/shared/ThreeDGenSidebar";
import { useArtDirector } from "@/hooks/ArtDirectorContext";
import { useActivePage } from "@/hooks/ActivePageContext";
import { DeepSearchPanel } from "@/components/shared/DeepSearchPanel";
import type { SearchResult } from "@/components/shared/DeepSearchPanel";
import { useArtboard } from "@/hooks/ArtboardContext";
import { GripVertical, ChevronDown, ChevronRight, Lock, Unlock, Save } from "lucide-react";
import { useShortcuts } from "@/hooks/useShortcuts";
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
  { id: "grid", label: "4×4 Grid", group: "stage" },
  { id: "3/4", label: "3/4", group: "views", prompt: "Three-quarter view of the prop showing its dimensional form." },
  { id: "front", label: "Front", group: "views", prompt: "Front elevation view" },
  { id: "back", label: "Back", group: "views", prompt: "Rear elevation view" },
  { id: "side", label: "Side", group: "views", prompt: "Side elevation view" },
  { id: "top", label: "Top", group: "views", prompt: "Top-down plan view" },
  { id: "artboard", label: "Art Table", group: "artboard" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
  { id: "deepSearch", label: "Deep Search", group: "search" },
];

const VIEW_TYPE_MAP: Record<string, string> = {
  main: "main", "3/4": "three_quarter", front: "front", back: "back", side: "side", top: "top",
};

/** Tab ids that hold multiview / hero images for 3D generation (gallery keys). */
const THREE_D_VIEW_TAB_IDS = ["main", "3/4", "front", "back", "side", "top"] as const;

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

type SectionId = "generate" | "identity" | "propDescription" | "attributes" | "styleFusion" | "preservation" | "upscaleRestore" | "multiview" | "saveOptions" | "threeDGen";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "identity", "propDescription", "attributes", "styleFusion", "preservation", "upscaleRestore", "multiview", "threeDGen", "saveOptions",
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
  threeDGen: "3D Gen AI",
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
  threeDGen: "Generate 3D models from your views using Meshy and Hitem3D.",
  saveOptions: "Save images, send to Photoshop, export XML, or clear your session.",
};

const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["identity", "propDescription", "attributes", "styleFusion", "preservation", "threeDGen"]);


interface LayoutState { order: SectionId[]; collapsed: Partial<Record<SectionId, boolean>>; hidden?: SectionId[] }

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
      return { order, collapsed: parsed.collapsed ?? {}, hidden: parsed.hidden };
    }
  } catch { /* */ }
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { styleFusion: true, preservation: true, upscaleRestore: true, multiview: true, threeDGen: true, saveOptions: true } };
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
  projectUid?: string;
}

export function PropPage({ instanceId = 0, active = true, projectUid }: PropPageProps) {
  const stableId = projectUid ?? String(instanceId);
  const layoutStorageKey = `madison-prop-layout-${stableId}`;
  const sessionKey = `prop-${stableId}`;
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
  const [artDirectorConfigOpen, setArtDirectorConfigOpen] = useState(false);
  const { setCurrentImage, setAttributesContext, setOnApplyFeedback } = useArtDirector();
  const appPage = useActivePage();
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
  const [editModel, setEditModel] = useState("");
  const [multiviewModel, setMultiviewModel] = useState("");
  const { models, defaultModelId } = useModels();
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const artboard = useArtboard();
  const { getSectionColor } = useCustomSections();
  const customSections = useCustomSectionState("prop");

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
  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({ identity: true, propDescription: true, attributes: true, threeDGen: true });
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

  const handleDragStart = useCallback((e: React.DragEvent, id: SectionId) => {
    const active = document.activeElement;
    if (active && e.currentTarget.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { e.preventDefault(); return; }
    dragItemRef.current = id;
  }, []);
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
    localStorage.setItem(layoutStorageKey, JSON.stringify({ order: layout.order, collapsed, hidden: layout.hidden }));
    addToast("Layout saved as default", "success");
  }, [layout.order, layout.hidden, isSectionCollapsed, addToast, layoutStorageKey]);

  const [xmlOpen, setXmlOpen] = useState(false);

  const refCounter = useRef(0);

  useEffect(() => {
    if (defaultModelId && !modelId) setModelId(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
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

  const getViewImagesForThreeD = useCallback((): ViewImage[] => {
    const out: ViewImage[] = [];
    for (const tabId of THREE_D_VIEW_TAB_IDS) {
      const imgs = gallery[tabId] || [];
      const src = imgs[imageIdx[tabId] ?? 0];
      if (!src) continue;
      const m = /^data:([^;]+);base64,(.+)$/.exec(src);
      if (!m) continue;
      const viewKey = VIEW_TYPE_MAP[tabId] ?? tabId;
      const label = BUILTIN_TABS.find((t) => t.id === tabId)?.label ?? tabId;
      out.push({ viewKey, label, base64: m[2], mimeType: m[1] });
    }
    return out;
  }, [gallery, imageIdx]);

  const handleSendSearchToArtboard = useCallback((images: SearchResult[]) => {
    const existing = artboard.items;
    let maxX = 0;
    for (const it of existing) { if (it.x + it.w > maxX) maxX = it.x + it.w; }
    const GAP = 20;
    const COLS = Math.ceil(Math.sqrt(images.length));
    const startX = existing.length > 0 ? maxX + GAP * 3 : 0;
    const newItems = images.map((img, i) => ({
      type: "image" as const, x: startX + (i % COLS) * (img.width + GAP), y: Math.floor(i / COLS) * (img.height + GAP),
      w: img.width, h: img.height, rotation: 0, content: `data:image/png;base64,${img.b64}`,
    }));
    artboard.addItems(newItems);
    setActiveTab("artboard");
  }, [artboard, setActiveTab]);

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


  // --- Fusion / preservation prompt text for requests ---
  const getDefaultSectionPrompt = useCallback((sectionId: SectionId): string => {
    switch (sectionId) {
      case "styleFusion": return buildFusionBrief(styleFusion);
      case "preservation": return preservationToConstraints(preservation);
      default: return "";
    }
  }, [styleFusion, preservation]);

  const resolveSection = useCallback((sectionId: SectionId): string => {
    if (!isSectionEnabled(sectionId)) return "";
    return getDefaultSectionPrompt(sectionId);
  }, [isSectionEnabled, getDefaultSectionPrompt]);

  const modelOptions = useMemo(() => models.map((m) => ({
    value: m.id, label: `${m.label} — ${m.resolution} (${m.time_estimate})`,
  })), [models]);

  // Prompt preview
  const [promptPreview, setPromptPreview] = useState("");
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [lastSentPrompt, setLastSentPrompt] = useState("");

  const buildPromptPreview = useCallback((): string => {
    const desc = isSectionEnabled("propDescription") ? description : "";
    if (!desc) return "(No description — enter a prop description first)";
    const parts: string[] = [];
    const idParts: string[] = [];
    if (isSectionEnabled("identity")) {
      if (propName) idParts.push(`Name: ${propName}`);
      if (propType) idParts.push(`Type: ${propType}`);
      if (setting) idParts.push(`Setting: ${setting}`);
      if (condition) idParts.push(`Condition: ${condition}`);
      if (scale) idParts.push(`Scale: ${scale}`);
    }
    let propPrompt = idParts.length ? `${idParts.join(", ")}\n\n${desc}` : desc;

    const fusionCtx = resolveSection("styleFusion");
    const lockCtx = resolveSection("preservation");
    if (fusionCtx) propPrompt += `\n\n--- Style Fusion ---\n${fusionCtx}`;
    if (lockCtx) propPrompt += `\n\n--- PRESERVATION CONSTRAINTS (HIGHEST PRIORITY) ---\n${lockCtx}`;

    parts.push("[STYLE RULES] Realistic 3D-rendered. Studio backdrop. No environmental elements.");
    if (extractMode === "recreate" && getImageB64("main")) {
      parts.push(`\n[RECREATE MODE] Main Stage image will be sent as reference.`);
      parts.push(`\nRecreate this prop as accurately as possible.\n\n${propPrompt}`);
    } else {
      parts.push(`\nGenerate a detailed prop image.\n\n${propPrompt}`);
    }
    const refImgs: string[] = [];
    if (getImageB64("main")) refImgs.push("Main Stage image");
    tabs.filter((t) => t.group === "refs").forEach((t) => { if (getImageB64(t.id)) refImgs.push(`${t.label} image`); });
    if (refImgs.length) parts.push(`\n--- Attached Images ---\n${refImgs.join("\n")}`);
    return parts.join("\n");
  }, [description, propName, propType, setting, condition, scale, extractMode, isSectionEnabled, resolveSection, getImageB64, tabs]);

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

  // Apply edit handler (uses /prop/generate with edit_prompt)
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
        const body = { ...buildRequestBody(vt), model_id: multiviewModel || modelId || undefined };
        const resp = await apiFetch<{ image_b64?: string; error?: string }>("/prop/generate", {
          method: "POST", body: JSON.stringify(body),
        });
        if (resp.error) { addToast(`${vt}: ${resp.error}`, "error"); return; }
        if (resp.image_b64) setTabImage(tab, `data:image/png;base64,${resp.image_b64}`, `${vt} view`);
      }));
    } catch (e) { addToast(String(e), "error"); }
    busy.end("allViews");
  }, [getMainImageB64, addToast, buildRequestBody, setTabImage, busy, multiviewModel, modelId]);

  // Generate selected view
  const handleGenerateSelectedView = useCallback(async () => {
    const vt = VIEW_TYPE_MAP[activeTab];
    if (!vt || vt === "main") { addToast("Select a view tab (Front, Back, Side, Top, 3/4)", "info"); return; }
    const mainImg = getMainImageB64();
    if (!mainImg) { addToast("Generate a main stage image first", "info"); return; }
    await handleGenerate(vt);
  }, [activeTab, getMainImageB64, addToast, handleGenerate]);

  // Cancel
  const handleCancel = useCallback(() => {
    cancelAllRequests();
    busy.endAll();
    try { fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/system/cancel`, { method: "POST" }); } catch { /* */ }
  }, [busy]);

  const handleGridGenerate = useCallback(async () => {
    busy.start("gen");
    setActiveTab("grid");
    try {
      const body = buildRequestBody("main");
      const res = await apiFetch<{
        cells?: string[]; full_grid_b64?: string; error?: string;
        cell_width?: number; cell_height?: number;
      }>("/prop/generate-grid", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.error) {
        addToast(res.error, "error");
      } else if (res.cells) {
        const cw = res.cell_width || 256;
        const ch = res.cell_height || 256;
        const newResults: GridGalleryResult[] = res.cells.map((b64, i) => ({
          id: `grid_${Date.now()}_${i}`,
          image_b64: b64,
          width: cw,
          height: ch,
          label: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1}`,
        }));
        if (res.full_grid_b64) {
          newResults.push({
            id: `grid_full_${Date.now()}`,
            image_b64: res.full_grid_b64,
            width: cw * 4,
            height: ch * 4,
            label: "Full",
          });
        }
        setGridResults((prev) => [...prev, ...newResults]);
        addToast("Generated 16 variations on one sheet", "success");
      } else {
        addToast("Grid generation failed", "error");
      }
    } catch (e) { addToast(e instanceof Error ? e.message : "Generation failed", "error"); }
    busy.end("gen");
  }, [buildRequestBody, addToast, busy]);

  const handleApplyEdit = useCallback(async () => {
    if (generationMode === "grid") {
      handleGridGenerate();
      return;
    }
    if (!editPrompt.trim()) return;
    const mainB64 = getMainImageB64();
    if (!mainB64) { addToast("Load an image on Main Stage first", "info"); return; }
    busy.start("apply");
    try {
      const body = {
        ...buildRequestBody("main"),
        reference_image_b64: mainB64,
        edit_prompt: editPrompt,
        model_id: editModel || modelId || undefined,
      };
      const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
        "/prop/generate", { method: "POST", body: JSON.stringify(body) },
      );
      if (res.image_b64) {
        setTabImage("main", `data:image/png;base64,${res.image_b64}`, `Edit: ${editPrompt.slice(0, 40)}`);
        setLastSentPrompt(buildPromptPreview());
      } else if (res.error) addToast(res.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("apply");
  }, [editPrompt, generationMode, handleGridGenerate, getMainImageB64, buildRequestBody, editModel, modelId, setTabImage, addToast, busy, buildPromptPreview]);

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

  const handleGridSendToMainstage = useCallback(
    (id: string) => {
      const result = gridResults.find((r) => r.id === id);
      if (!result) return;
      const src = `data:image/png;base64,${result.image_b64}`;
      const histLabel = result.label ? `Grid ${result.label}` : "From grid";
      setTabImage("main", src, histLabel);
      setActiveTab("main");
      addToast("Sent to main stage", "success");
    },
    [gridResults, setTabImage, addToast],
  );

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
      await apiFetch("/system/send-to-ps", { method: "POST", body: JSON.stringify({ images: [{ image_b64: b64, label: "AI PropLab" }] }) });
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
    setGridResults([]);
    setGridEditBusy({});
    customSections.clearAll();
    addToast("Prop session cleared", "info");
  }, [addToast, customSections]);

  useEffect(() => {
    const SK = "madison-proplab-projects";
    const clearHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) handleReset();
    };
    const saveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) {
        const state = { description, propName, propType, setting, condition, scale, attributes, lockedAttrs, styleFusion, preservation, modelId };
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = `prop_project_${instanceId + 1}.json`; a.click(); URL.revokeObjectURL(a.href);
      }
    };
    const loadHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId && detail?.data) {
        const d = detail.data as Record<string, unknown>;
        if (typeof d.description === "string") setDescription(d.description);
        if (typeof d.propName === "string") setPropName(d.propName as string);
        if (typeof d.propType === "string") setPropType(d.propType as string);
        if (typeof d.setting === "string") setSetting(d.setting as string);
        if (typeof d.condition === "string") setCondition(d.condition as string);
        if (typeof d.scale === "string") setScale(d.scale as string);
        if (d.attributes) setAttributes(d.attributes as typeof attributes);
        if (d.lockedAttrs) setLockedAttrs(d.lockedAttrs as typeof lockedAttrs);
        if (d.styleFusion) setStyleFusion(d.styleFusion as StyleFusionState);
        if (d.preservation) setPreservation(d.preservation as typeof preservation);
        if (typeof d.modelId === "string") setModelId(d.modelId);
        addToast("Project loaded", "success");
      }
    };
    window.addEventListener("project-clear", clearHandler);
    window.addEventListener("project-save", saveHandler);
    window.addEventListener("project-load", loadHandler);
    return () => {
      window.removeEventListener("project-clear", clearHandler);
      window.removeEventListener("project-save", saveHandler);
      window.removeEventListener("project-load", loadHandler);
    };
  }, [instanceId, handleReset, description, propName, propType, setting, condition, scale, attributes, lockedAttrs, styleFusion, preservation, modelId, addToast]);

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

  // Register keyboard shortcuts (only when this project tab is active)
  const { registerAction, unregisterAction } = useShortcuts();
  useEffect(() => {
    if (!active) return;
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
  }, [active, registerAction, unregisterAction, handleGenerate, handleExtractAttributes, handleEnhanceDescription, handleRandomizeFull, handleGenerateAllViews, handleSendToPS]);

  // --- Voice Director command listener ---
  const activeGenerate = generationMode === "grid" ? handleGridGenerate : () => handleGenerate();
  const voiceCmdRef = useRef({
    generate: activeGenerate,
    extract_attributes: handleExtractAttributes,
    enhance_description: handleEnhanceDescription,
    randomize: handleRandomizeFull,
    generate_all_views: handleGenerateAllViews,
    generate_selected_view: () => handleGenerateSelectedView(),
    set_field: (params: Record<string, unknown>) => {
      const f = String(params.field || "").toLowerCase();
      const v = String(params.value || "");
      if (f === "description") setDescription(v);
      else if (f === "prop_name") setPropName(v);
      else if (f === "prop_type") setPropType(v);
      else if (f === "setting") setSetting(v);
      else if (f === "condition") setCondition(v);
      else if (f === "scale") setScale(v);
    },
    show_xml: () => setXmlOpen(true),
    send_to_photoshop: handleSendToPS,
    reset: handleReset,
  });
  voiceCmdRef.current = {
    generate: activeGenerate,
    extract_attributes: handleExtractAttributes,
    enhance_description: handleEnhanceDescription,
    randomize: handleRandomizeFull,
    generate_all_views: handleGenerateAllViews,
    generate_selected_view: () => handleGenerateSelectedView(),
    set_field: (params: Record<string, unknown>) => {
      const f = String(params.field || "").toLowerCase();
      const v = String(params.value || "");
      if (f === "description") setDescription(v);
      else if (f === "prop_name") setPropName(v);
      else if (f === "prop_type") setPropType(v);
      else if (f === "setting") setSetting(v);
      else if (f === "condition") setCondition(v);
      else if (f === "scale") setScale(v);
    },
    show_xml: () => setXmlOpen(true),
    send_to_photoshop: handleSendToPS,
    reset: handleReset,
  };

  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      const cmds = voiceCmdRef.current as Record<string, unknown>;
      if (action in cmds) {
        const fn = cmds[action];
        if (typeof fn === "function") fn(params);
      }
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId;
      if (typeof tabId === "string" && tabs.some((t) => t.id === tabId)) {
        setActiveTab(tabId);
      }
    };
    window.addEventListener("switch-tab", handler);
    return () => window.removeEventListener("switch-tab", handler);
  }, [active, tabs]);

  // --- Gallery restore listener ---
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown>;
      if (d._source_tool !== "prop") return;
      if (typeof d.description === "string") setDescription(d.description);
      if (typeof d.name === "string") setPropName(d.name as string);
      if (typeof d.propType === "string") setPropType(d.propType as string);
      if (typeof d.setting === "string") setSetting(d.setting as string);
      if (typeof d.condition === "string") setCondition(d.condition as string);
      if (typeof d.scale === "string") setScale(d.scale as string);
      if (typeof d.model === "string") setModelId(d.model as string);
      if (typeof d._image_b64 === "string") {
        const src = (d._image_b64 as string).startsWith("data:") ? d._image_b64 as string : `data:image/png;base64,${d._image_b64}`;
        setGallery((prev) => ({ ...prev, main: [src] }));
        setImageIdx((prev) => ({ ...prev, main: 0 }));
        setActiveTab("main");
      }
    };
    window.addEventListener("gallery-restore", handler);
    return () => window.removeEventListener("gallery-restore", handler);
  }, [active]);

  useEffect(() => {
    if (active) {
      setCurrentImage(currentSrc || null);
    }
  }, [active, currentSrc, setCurrentImage]);

  useEffect(() => {
    if (active) {
      setAttributesContext(description || "");
    }
  }, [active, description, setAttributesContext]);

  useEffect(() => {
    if (active && appPage === "prop") {
      setOnApplyFeedback(() => (suggestion: string) => {
        setEditPrompt((prev) => prev ? `${prev}\n${suggestion}` : suggestion);

        const colonIdx = suggestion.indexOf(":");
        if (colonIdx < 0) return;
        const label = suggestion.slice(0, colonIdx).trim().toLowerCase();
        const body = suggestion.slice(colonIdx + 1).trim();
        if (!body) return;

        const attrMap: Record<string, string> = {
          material: "primaryMaterial", "primary material": "primaryMaterial",
          "secondary material": "secondaryMaterials", "secondary materials": "secondaryMaterials",
          surface: "surfaceFinish", "surface finish": "surfaceFinish", finish: "surfaceFinish",
          wear: "wearPattern", damage: "wearPattern", "wear & damage": "wearPattern", weathering: "wearPattern",
          color: "colorPalette", "color palette": "colorPalette", palette: "colorPalette",
          texture: "textureDetail", "texture detail": "textureDetail",
          function: "functionalElements", "functional elements": "functionalElements", mechanism: "functionalElements",
          decorative: "decorativeDetail", "decorative detail": "decorativeDetail", ornament: "decorativeDetail",
          lighting: "lightingEffects", "material response": "lightingEffects", reflection: "lightingEffects",
          context: "contextualStory", story: "contextualStory", "context & story": "contextualStory", lore: "contextualStory",
        };

        const matchedKey = attrMap[label] || Object.entries(attrMap).find(([k]) => label.includes(k))?.[1];
        if (matchedKey) {
          setAttributes((prev) => ({ ...prev, [matchedKey]: body }));
        }
      });
      return () => setOnApplyFeedback(null);
    }
  }, [active, appPage, setOnApplyFeedback]);

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
        title="Auto-fill fields from current image"
      >
        Extract Attributes
      </Button>
      <div>
        <select
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          value={extractMode}
          onChange={(e) => setExtractMode(e.target.value as "inspiration" | "recreate")}
          title="How strictly AI follows source image"
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
            title={`When active, Extract / Enhance / Randomize will fill in the ${lbl} panel`}
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
          title="Style folder for visual guidance"
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
          title="Add detail to existing fields"
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
          title="Fill all fields with random attributes"
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
          title="Generate image from current settings"
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
            title="AI model for generation"
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
          onChange={(e) => {
            const mode = e.target.value as "single" | "grid";
            setGenerationMode(mode);
            setActiveTab(mode === "grid" ? "grid" : "main");
          }}
          disabled={busy.any}
        >
          <option value="single">Single Image</option>
          <option value="grid">4×4 Grid (16 Variations)</option>
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
    <div className="space-y-1.5">
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
        placeholder="Describe the prop in detail — materials, shape, wear, function, history..."
        disabled={textBusy}
        data-voice-target="propDescription"
      />
      <Button size="sm" className="w-full" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhanceDescription} title="Use AI to enrich and expand your prop description and all attributes">Enhance Description</Button>
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
          title="Reset to defaults"
        >Reset</button>
        <span className="text-[10px]" style={{ color: preservation.enabled ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
          {preservation.enabled ? "Active — the AI will try to keep these traits and avoid the negatives" : "Off — no constraints, the AI has full creative freedom"}
        </span>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }} title="Elements to preserve across generations">Preserve</p>
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
                title="Remove rule"
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
          title="Add preserve rule"
        >+ Add Preserve</button>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }} title="Elements AI must avoid">Negative Constraints (must avoid)</p>
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
                title="Remove constraint"
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
          title="Add negative constraint"
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
        title="Describe what these reference images show"
      />
      {models.length > 0 && (
        <select
          className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
          value={urModelId}
          onChange={(e) => setUrModelId(e.target.value)}
          title="AI model for upscale/restore"
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
                  title="Remove"
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
            title="Add images from disk"
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
            title="Paste from clipboard"
          >Paste</button>
          {urImages.length > 0 && (
            <button
              type="button"
              onClick={() => setUrImages([])}
              className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
              style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              title="Remove all"
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
        title="Generate all character views"
      >Generate All Views</Button>
      <Button
        className="w-full"
        size="sm"
        generating={busy.is("gen")}
        generatingText="Generating..."
        onClick={handleGenerateSelectedView}
        title="Generate current view only"
      >Generate Selected View</Button>
      {modelOptions.length > 0 && (
        <div>
          <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Gemini model (multi-view)</label>
          <select
            className="w-full px-2 py-1 text-[10px] rounded-[var(--radius-sm)] truncate"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            value={multiviewModel || modelId}
            onChange={(e) => setMultiviewModel(e.target.value)}
            disabled={busy.is("allViews") || busy.is("gen")}
            title="AI model for view generation"
          >
            {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      <NumberStepper value={viewGenCount} min={1} max={10} onChange={setViewGenCount} label="Count:" />
    </div>
  );

  // --- Save section ---
  const renderSaveSection = () => (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="sm" className="w-full" onClick={handleSendToPS} title="Send to Photoshop">Send to PS</Button>
        <Button size="sm" className="w-full" onClick={() => setXmlOpen(true)} title="View prop data as XML">Show XML</Button>
        <Button size="sm" className="w-full" onClick={handleReset} title="Clear all fields and images">Clear All</Button>
        <Button size="sm" className="w-full col-span-3" onClick={handleSetDefaultLayout} title="Save panel layout as default">
          <Save className="h-3 w-3 shrink-0 inline" /> Set Default Layout
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
        <Button size="sm" className="w-full" title="Create reference sheet from all views" onClick={async () => {
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
        <Button size="sm" className="w-full" title="Export handoff ZIP" onClick={async () => {
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
          if (layout.hidden?.includes(sectionId)) return null;
          const collapsed = isSectionCollapsed(sectionId);
          const canCollapse = !NON_COLLAPSIBLE.has(sectionId);
          const canToggle = TOGGLEABLE_SECTIONS.has(sectionId);
          const enabled = isSectionEnabled(sectionId);
          const label = SECTION_LABELS[sectionId];
          const sectionColor = getSectionColor("prop", sectionId);

          const wrapSection = (children: ReactNode) => (
            <div
              key={sectionId}
              draggable
              onDragStart={(e) => handleDragStart(e, sectionId)}
              onDragOver={(e) => handleDragOver(e, sectionId)}
              onDrop={() => handleDrop(sectionId)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => { if (dragOverId === sectionId) setDragOverId(null); }}
              onMouseDown={(e) => { if (e.button === 1 && canToggle) { e.preventDefault(); toggleSectionEnabled(sectionId); } }}
              className="section-card-hover"
              style={{
                border: dragOverId === sectionId && dragItemRef.current !== sectionId
                  ? "1px solid var(--color-accent, #6a6aff)"
                  : sectionColor
                    ? `1px solid ${sectionColor}`
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
                    title={enabled ? "This panel is ON — its info will shape your generated images. Middle-click or click here to turn it off." : "This panel is OFF — its info won't be used when generating. Middle-click or click here to turn it on."}
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
          if (sectionId === "threeDGen") return wrapSection(
            <ThreeDGenSidebar embedded getViewImages={getViewImagesForThreeD} toolLabel="Prop" />
          );
          if (sectionId === "saveOptions") return wrapSection(renderSaveSection());
          return null;
        })}

        {customSections.sections.map((cs) => {
          const csCollapsed = customSections.isCollapsed(cs.id);
          const csEnabled = customSections.isEnabled(cs.id);
          const csColor = cs.color || getSectionColor("prop", `custom:${cs.id}`);
          return (
            <div
              key={`custom:${cs.id}`}
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
          title="Save panel layout as default"
        >
          <Save className="h-3 w-3" />
          Set Active Layout as Default
        </button>
      </div>

      {/* Middle Column - Edit Panel */}
      <div className="w-[320px] h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Prop</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe changes to apply:</p>
            <Textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={14} placeholder="Tell the AI what to change — e.g. Add rust to the surface, change the handle to wood, make it more weathered..." disabled={busy.is("apply")} />
            <Button variant="primary" className="w-full" generating={busy.is("apply")} generatingText="Applying..." onClick={handleApplyEdit} title="Apply edit to current image">Apply Changes</Button>
            {modelOptions.length > 0 && (
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Gemini model (edit)</label>
                <select
                  className="w-full px-2 py-1 text-[10px] rounded-[var(--radius-sm)] truncate"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  value={editModel || modelId}
                  onChange={(e) => setEditModel(e.target.value)}
                  disabled={busy.is("apply")}
                  title="AI model for edits"
                >
                  {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {!isRefTab && (
              <EditHistory
                entries={currentHistory}
                activeEntryId={activeHistoryId}
                onRestore={(entryId: string) => {
                  const entry = currentHistory.find((h) => h.id === entryId) ?? null;
                  handleHistorySelect(entry);
                }}
                onRestoreCurrent={() => handleHistorySelect(null)}
                onClearHistory={handleClearHistory}
                defaultOpen={true}
              />
            )}

            {/* Prompt Preview */}
            <div className="rounded" style={{ border: "1px solid var(--color-border)", background: "var(--color-input-bg)" }}>
              <button
                onClick={() => setPromptPreviewOpen((p) => !p)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
              >
                <span>Prompt Preview {lastSentPrompt ? "(last sent)" : ""}</span>
                {promptPreviewOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {promptPreviewOpen && (
                <div className="px-2.5 pb-2 space-y-1.5">
                  <Button
                    size="sm" className="w-full"
                    onClick={() => { setPromptPreview(buildPromptPreview()); }}
                    title="Preview full prompt"
                  >Preview Instructions</Button>
                  <pre
                    className="text-[10px] leading-relaxed whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto p-2 rounded select-text"
                    style={{ background: "var(--color-background)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                  >{promptPreview || lastSentPrompt || "Click 'Preview Instructions' to see the full prompt"}</pre>
                  {(promptPreview || lastSentPrompt) && (
                    <Button
                      size="sm" className="w-full"
                      onClick={() => {
                        navigator.clipboard.writeText(promptPreview || lastSentPrompt);
                        addToast("Prompt copied to clipboard", "success");
                      }}
                      title="Copy prompt to clipboard"
                    >Copy Prompt</Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
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
              onReorder={setTabs}
              onAddRef={handleAddRef}
              onRemoveTab={handleRemoveRef}
              noBorder
            />
          </div>
          <div className="flex items-center gap-1.5 px-2 pb-1 shrink-0">
            {busy.any && (
              <Button className="text-[11px] py-1" onClick={handleCancel} style={{ background: "rgba(220,80,80,0.15)", color: "#e05050", border: "1px solid rgba(220,80,80,0.3)" }}>Cancel</Button>
            )}
          </div>
        </div>

        {/* Image viewer */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {activeTab === "artboard" ? (
            <ArtboardCanvas />
          ) : activeTab === "deepSearch" ? (
            <DeepSearchPanel onSendToArtboard={handleSendSearchToArtboard} isActivePage={active} />
          ) : activeTab === "grid" ? (
            <GridGallery
              results={gridResults}
              title="Prop Variations"
              toolLabel="prop"
              generating={busy.is("gen")}
              emptyMessage="No grid results yet. Select 4×4 Grid mode and generate."
              onDelete={handleGridDelete}
              onCopy={handleGridCopy}
              onEditSubmit={handleGridEdit}
              onSendToMainstage={handleGridSendToMainstage}
              editBusy={gridEditBusy}
              isFavorited={(b64) => isFavorited(b64)}
              onToggleFavorite={(id, b64, w, h) => { if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "prop", label: `grid-${id}`, prompt: "", source: "grid", width: w, height: h }); }}
            />
          ) : (
            <div className="flex-1 min-w-0 relative">
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
              <ArtDirectorWidget onOpenConfig={() => setArtDirectorConfigOpen(true)} />
            </div>
          )}
        </div>
      </div>

      {/* XML Modal */}
      {xmlOpen && <XmlModal xml={xmlContent} title="Prop XML" onClose={() => setXmlOpen(false)} />}
      <ArtDirectorConfigModal open={artDirectorConfigOpen} onClose={() => setArtDirectorConfigOpen(false)} />
    </div>
  );
}
