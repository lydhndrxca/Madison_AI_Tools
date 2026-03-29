import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button, Select, Textarea, NumberStepper, Card } from "@/components/ui";
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
import { ArtDirectorWidget } from "@/components/shared/ArtDirectorWidget";
import { ArtDirectorConfigModal } from "@/components/shared/ArtDirectorConfigModal";
import { useArtDirector } from "@/hooks/ArtDirectorContext";
import { DeepSearchPanel } from "@/components/shared/DeepSearchPanel";
import type { SearchResult } from "@/components/shared/DeepSearchPanel";
import { useArtboard } from "@/hooks/ArtboardContext";
import { GripVertical, ChevronDown, ChevronRight, Lock, Unlock, Save, Upload } from "lucide-react";
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
  { id: "main", label: "Hero Shot", group: "stage", prompt: "Dramatic establishing angle showing the environment at its most visually compelling." },
  { id: "player_pov", label: "Player POV", group: "views", prompt: "First-person camera height, natural gameplay perspective." },
  { id: "birds_eye", label: "Bird's Eye", group: "views", prompt: "Top-down overhead showing layout, paths, cover positions." },
  { id: "panoramic", label: "Panoramic", group: "views", prompt: "Ultra-wide cinematic establishing shot." },
  { id: "detail", label: "Detail", group: "views", prompt: "Tight crop on a signature material or architectural detail." },
  { id: "artboard", label: "Art Table", group: "artboard" },
  { id: "deepSearch", label: "Deep Search", group: "search" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
];

const VIEW_TYPE_MAP: Record<string, string> = {
  main: "main", player_pov: "player_pov", birds_eye: "birds_eye", panoramic: "panoramic", detail: "detail",
};

// ---------------------------------------------------------------------------
// Environment domain data (mirrors backend)
// ---------------------------------------------------------------------------

const BIOME_OPTIONS = [
  "", "urban", "suburban", "industrial", "rural", "forest", "jungle", "desert",
  "arctic", "mountain", "coastal", "underground", "interior", "rooftop",
  "wasteland", "sci-fi",
].map((v) => ({ value: v, label: v || "—" }));

const GAME_CONTEXT_OPTIONS = [
  "", "battle royale open world", "close-quarters CQB", "linear corridor",
  "verticality-focused", "vehicle-friendly", "sniper overwatch",
  "mixed engagement",
].map((v) => ({ value: v, label: v || "—" }));

const TIME_OF_DAY_OPTIONS = [
  "", "dawn", "golden hour", "midday", "overcast", "dusk", "blue hour",
  "night (moonlit)", "night (artificial)", "storm",
].map((v) => ({ value: v, label: v || "—" }));

const SEASON_WEATHER_OPTIONS = [
  "", "clear spring", "summer heat haze", "autumn fog", "winter snow",
  "rain", "dust storm", "overcast", "dynamic mixed",
].map((v) => ({ value: v, label: v || "—" }));

const SCALE_OPTIONS = [
  "", "small POI", "medium compound", "large landmark", "vista / panorama",
  "interior room", "interior complex",
].map((v) => ({ value: v, label: v || "—" }));

const ENV_ATTRIBUTE_GROUPS = [
  { label: "Architecture Style", key: "architectureStyle" },
  { label: "Ground / Terrain", key: "groundTerrain" },
  { label: "Vegetation", key: "vegetation" },
  { label: "Atmospheric Effects", key: "atmosphericEffects" },
  { label: "Lighting Mood", key: "lightingMood" },
  { label: "Color Palette", key: "colorPalette" },
  { label: "Material Focus", key: "materialFocus" },
  { label: "Props / Clutter", key: "propsClutter" },
  { label: "Sightlines / Composition", key: "sightlinesComposition" },
  { label: "Narrative Elements", key: "narrativeElements" },
];

const ATTR_KEYS = ENV_ATTRIBUTE_GROUPS.map((g) => g.key);

const STYLE_DIRECTION_OPTIONS = [
  { value: "photorealistic concept art", label: "Photorealistic Concept Art" },
  { value: "stylized painterly", label: "Stylized Painterly" },
  { value: "moody cinematic", label: "Moody Cinematic" },
  { value: "clean architectural viz", label: "Clean Architectural Viz" },
];

// ---------------------------------------------------------------------------
// Preservation Lock
// ---------------------------------------------------------------------------

interface PreserveToggle { key: string; label: string; prompt: string; enabled: boolean }
interface PreservationLockState { enabled: boolean; preserves: PreserveToggle[]; negatives: { id: string; text: string; enabled: boolean }[] }

const DEFAULT_PRESERVES: PreserveToggle[] = [
  { key: "keepComposition", label: "Keep composition / layout", prompt: "Do NOT change the composition or spatial layout", enabled: false },
  { key: "keepTimeOfDay", label: "Keep time of day", prompt: "Do NOT change the time of day or sun position", enabled: false },
  { key: "keepColorPalette", label: "Keep color palette", prompt: "Do NOT change the overall color palette", enabled: false },
  { key: "keepArchitecture", label: "Keep architecture style", prompt: "Do NOT change the architectural style or building forms", enabled: false },
  { key: "keepScale", label: "Keep scale / proportions", prompt: "Do NOT change the scale or spatial proportions", enabled: false },
  { key: "keepAtmosphere", label: "Keep weather / atmosphere", prompt: "Do NOT change the weather, fog, or atmospheric effects", enabled: false },
];

const DEFAULT_NEGATIVES: PreservationLockState["negatives"] = [
  { id: "neg1", text: "No text / labels / UI overlays", enabled: false },
  { id: "neg2", text: "No people or characters", enabled: false },
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
  "overall vibe", "architecture style", "material & texture", "color palette",
  "lighting mood", "atmospheric effects", "vegetation style", "narrative tone",
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

type SectionId = "generate" | "identity" | "envDescription" | "attributes" | "reimagine" | "styleFusion" | "preservation" | "upscaleRestore" | "multiview" | "saveOptions";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "identity", "envDescription", "attributes", "reimagine", "styleFusion", "preservation", "upscaleRestore", "multiview", "saveOptions",
];

const SECTION_LABELS: Record<SectionId, string> = {
  generate: "Generate Environment Concept",
  identity: "Environment Identity",
  envDescription: "Environment Description",
  attributes: "Environment Attributes",
  reimagine: "Game Screenshot Reimagine",
  styleFusion: "Style Fusion",
  preservation: "Preservation Lock",
  upscaleRestore: "AI Upscale & Restore",
  multiview: "Multi-View Generation",
  saveOptions: "Save Options",
};

const SECTION_TIPS: Record<SectionId, string> = {
  generate: "Generate new environment concepts, extract details from images, or randomize.",
  identity: "Core identity — biome, game context, time of day, weather, and scale.",
  envDescription: "Freeform text description of the environment. More detail produces better results.",
  attributes: "Architecture, terrain, vegetation, atmosphere, and more. Fine-tune the environment.",
  reimagine: "Upload a game screenshot and reimagine it as finished concept art.",
  styleFusion: "Blend two different style influences together for a unique look.",
  preservation: "Lock specific traits so the AI keeps them when regenerating.",
  upscaleRestore: "Make images bigger and sharper (Upscale) or fix AI artifacts (Restore).",
  multiview: "Generate consistent views: Player POV, Bird's Eye, Panoramic, Detail.",
  saveOptions: "Save images, send to Photoshop, export XML, or clear your session.",
};

const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["identity", "envDescription", "attributes", "reimagine", "styleFusion", "preservation"]);

interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean }

interface LayoutState { order: SectionId[]; collapsed: Partial<Record<SectionId, boolean>> }

function layoutStorageKeyFor(instanceId: number) {
  return `madison-env-layout${instanceId ? `-${instanceId}` : ""}`;
}

function loadDefaultLayout(key?: string): LayoutState {
  try {
    const raw = localStorage.getItem(key || "madison-env-layout");
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set<SectionId>(DEFAULT_SECTION_ORDER);
      const order = parsed.order.filter((id) => allIds.has(id));
      for (const id of DEFAULT_SECTION_ORDER) { if (!order.includes(id)) order.push(id); }
      return { order, collapsed: parsed.collapsed ?? {} };
    }
  } catch { /* */ }
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { reimagine: true, styleFusion: true, preservation: true, upscaleRestore: true, multiview: true, saveOptions: true } };
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

interface EnvironmentPageProps {
  instanceId?: number;
  active?: boolean;
}

export function EnvironmentPage({ instanceId = 0, active = true }: EnvironmentPageProps) {
  const layoutStorageKey = layoutStorageKeyFor(instanceId);
  const sessionKey = `environment${instanceId ? `-${instanceId}` : ""}`;
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [activeTab, setActiveTab] = useState("main");
  const busy = useBusySet();
  const textBusy = busy.is("extract") || busy.is("enhance") || busy.is("randomize");

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});
  const [imageRecords, setImageRecords] = useState<Record<string, ImageRecord>>({});
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // Environment identity
  const [envName, setEnvName] = useState("");
  const [biome, setBiome] = useState("");
  const [gameContext, setGameContext] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("");
  const [seasonWeather, setSeasonWeather] = useState("");
  const [envScale, setEnvScale] = useState("");

  // Environment description
  const [description, setDescription] = useState("");
  const [artDirectorConfigOpen, setArtDirectorConfigOpen] = useState(false);
  const { setCurrentImage, setAttributesContext } = useArtDirector();
  const [editPrompt, setEditPrompt] = useState("");

  // Environment attributes
  const [attributes, setAttributes] = useState<Record<string, string>>(
    Object.fromEntries(ATTR_KEYS.map((k) => [k, ""])),
  );

  const [lockedAttrs, setLockedAttrs] = useState<Record<string, boolean>>(
    Object.fromEntries(ATTR_KEYS.map((k) => [k, false])),
  );

  const [styleFusion, setStyleFusion] = useState<StyleFusionState>({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
  const [preservation, setPreservation] = useState<PreservationLockState>({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });

  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);

  const [lockedSections, setLockedSections] = useState({ identity: false, envDescription: false, attributes: false, styleFusion: false, preservation: false });
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const artboard = useArtboard();
  const { getSectionColor } = useCustomSections();
  const customSections = useCustomSectionState("env");

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

  // Game Screenshot Reimagine
  const [reimagineScreenshots, setReimagineScreenshots] = useState<string[]>([]);
  const [reimagineContext, setReimagineContext] = useState("");
  const [reimagineStyle, setReimagineStyle] = useState("photorealistic concept art");
  const reimagineFileRef = useRef<HTMLInputElement>(null);

  // Section ON/OFF
  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({ identity: true, envDescription: true, attributes: true });
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


  // --- Build request body ---
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
    const desc = isSectionEnabled("envDescription") ? description : "";
    if (!desc) return "(No description — enter an environment description first)";
    const parts: string[] = [];
    const idParts: string[] = [];
    if (isSectionEnabled("identity")) {
      if (envName) idParts.push(`Name: ${envName}`);
      if (biome) idParts.push(`Biome: ${biome}`);
      if (gameContext) idParts.push(`Context: ${gameContext}`);
      if (timeOfDay) idParts.push(`Time: ${timeOfDay}`);
      if (seasonWeather) idParts.push(`Season/Weather: ${seasonWeather}`);
      if (envScale) idParts.push(`Scale: ${envScale}`);
    }
    let envPrompt = idParts.length ? `${idParts.join(", ")}\n\n${desc}` : desc;

    const fusionCtx = resolveSection("styleFusion");
    const lockCtx = resolveSection("preservation");
    if (fusionCtx) envPrompt += `\n\n--- Style Fusion ---\n${fusionCtx}`;
    if (lockCtx) envPrompt += `\n\n--- PRESERVATION CONSTRAINTS (HIGHEST PRIORITY) ---\n${lockCtx}`;

    parts.push("[STYLE RULES] Cinematic environment concept art. Wide composition.");
    if (extractMode === "recreate" && getImageB64("main")) {
      parts.push(`\n[RECREATE MODE] Main Stage image will be sent as reference.`);
      parts.push(`\nRecreate this environment as accurately as possible.\n\n${envPrompt}`);
    } else {
      parts.push(`\nGenerate a detailed environment image.\n\n${envPrompt}`);
    }
    const refImgs: string[] = [];
    if (getImageB64("main")) refImgs.push("Main Stage image");
    tabs.filter((t) => t.group === "refs").forEach((t) => { if (getImageB64(t.id)) refImgs.push(`${t.label} image`); });
    if (refImgs.length) parts.push(`\n--- Attached Images ---\n${refImgs.join("\n")}`);
    return parts.join("\n");
  }, [description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, extractMode, isSectionEnabled, resolveSection, getImageB64, tabs]);

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
      description: isSectionEnabled("envDescription") ? description : "",
      name: isSectionEnabled("identity") ? envName : "",
      biome: isSectionEnabled("identity") ? biome : "",
      game_context: isSectionEnabled("identity") ? gameContext : "",
      time_of_day: isSectionEnabled("identity") ? timeOfDay : "",
      season_weather: isSectionEnabled("identity") ? seasonWeather : "",
      env_scale: isSectionEnabled("identity") ? envScale : "",
      attributes: isSectionEnabled("attributes") ? attributes : {},
      view_type: viewType,
      reference_image_b64: getMainImageB64(),
      ref_images: refImgs.length > 0 ? refImgs : undefined,
      model_id: modelId || undefined,
      fusion_context: fusionCtx || undefined,
      fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      style_guidance: styleGuidance || undefined,
      lock_constraints: lockCtx || undefined,
      recreate_mode: extractMode === "recreate" && !!getMainImageB64(),
      custom_sections_context: customSections.getPromptContributions() || undefined,
      custom_section_images: customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean) || undefined,
    };
  }, [tabs, getImageB64, getMainImageB64, description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes, styleFusion, preservation, modelId, extractMode, isSectionEnabled, styleLibraryFolder, styleLibraryFolders, customSections.getPromptContributions, customSections.getImageAttachments]);

  // Apply edit handler (uses /environment/generate with edit_prompt)
  const handleApplyEdit = useCallback(async () => {
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
        "/environment/generate", { method: "POST", body: JSON.stringify(body) },
      );
      if (res.image_b64) {
        setTabImage("main", `data:image/png;base64,${res.image_b64}`, `Edit: ${editPrompt.slice(0, 40)}`);
        setLastSentPrompt(buildPromptPreview());
      } else if (res.error) addToast(res.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("apply");
  }, [editPrompt, getMainImageB64, buildRequestBody, editModel, modelId, setTabImage, addToast, busy, buildPromptPreview]);

  // --- Generate ---
  const handleGenerate = useCallback(async (viewType?: string) => {
    const vt = viewType || VIEW_TYPE_MAP[activeTab] || "main";
    const tab = viewType ? Object.entries(VIEW_TYPE_MAP).find(([, v]) => v === viewType)?.[0] ?? activeTab : activeTab;
    busy.start("gen");
    try {
      const body = buildRequestBody(vt);
      const calls = Array.from({ length: genCount }, () =>
        apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>("/env/generate", {
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
          if (first) { setTabImage(tab, src, "Environment generation"); first = false; }
          else { appendToGallery(tab, src, "Environment generation"); }
        }
      }
    } catch (e) { addToast(String(e), "error"); }
    busy.end("gen");
  }, [activeTab, genCount, buildRequestBody, addToast, setTabImage, appendToGallery, busy]);

  const handleQuickGenerate = useCallback(() => handleGenerate("main"), [handleGenerate]);

  const handleGenerateAllViews = useCallback(async () => {
    const mainImg = getMainImageB64();
    if (!mainImg) { addToast("Generate a hero shot image first", "info"); return; }
    const views = ["player_pov", "birds_eye", "panoramic", "detail"];
    busy.start("allViews");
    try {
      await Promise.all(views.map(async (vt) => {
        const tab = Object.entries(VIEW_TYPE_MAP).find(([, v]) => v === vt)?.[0];
        if (!tab) return;
        const body = { ...buildRequestBody(vt), model_id: multiviewModel || modelId || undefined };
        const resp = await apiFetch<{ image_b64?: string; error?: string }>("/env/generate", {
          method: "POST", body: JSON.stringify(body),
        });
        if (resp.error) { addToast(`${vt}: ${resp.error}`, "error"); return; }
        if (resp.image_b64) setTabImage(tab, `data:image/png;base64,${resp.image_b64}`, `${vt} view`);
      }));
    } catch (e) { addToast(String(e), "error"); }
    busy.end("allViews");
  }, [getMainImageB64, addToast, buildRequestBody, setTabImage, busy]);

  const handleGenerateSelectedView = useCallback(async () => {
    const vt = VIEW_TYPE_MAP[activeTab];
    if (!vt || vt === "main") { addToast("Select a view tab (Player POV, Bird's Eye, Panoramic, Detail)", "info"); return; }
    const mainImg = getMainImageB64();
    if (!mainImg) { addToast("Generate a hero shot image first", "info"); return; }
    await handleGenerate(vt);
  }, [activeTab, getMainImageB64, addToast, handleGenerate]);

  const handleCancel = useCallback(() => { cancelAllRequests(); busy.endAll(); }, [busy]);

  const handleGridGenerate = useCallback(async () => {
    busy.start("gen");
    try {
      const body = buildRequestBody("main");
      const promises = Array.from({ length: 16 }, (_, i) =>
        apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>("/env/generate", {
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
      if (newResults.length > 0) addToast(`Generated ${newResults.length} images`, "success");
      else addToast("All grid generation attempts failed", "error");
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
        "/env/generate",
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
        description?: string; biome?: string; gameContext?: string; timeOfDay?: string;
        seasonWeather?: string; scale?: string;
        attributes?: Record<string, string>; error?: string;
      }>("/env/extract-attributes", {
        method: "POST", body: JSON.stringify({ description, image_b64: imgB64 }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("extract"); return; }
      if (extractTargets.description && resp.description && !lockedSections.envDescription) setDescription(resp.description);
      if (extractTargets.identity && !lockedSections.identity) {
        if (resp.biome) setBiome(resp.biome);
        if (resp.gameContext) setGameContext(resp.gameContext);
        if (resp.timeOfDay) setTimeOfDay(resp.timeOfDay);
        if (resp.seasonWeather) setSeasonWeather(resp.seasonWeather);
        if (resp.scale) setEnvScale(resp.scale);
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
        description?: string; name?: string; biome?: string; gameContext?: string;
        timeOfDay?: string; seasonWeather?: string; scale?: string;
        attributes?: Record<string, string>; error?: string;
      }>("/env/enhance", {
        method: "POST", body: JSON.stringify({ description, name: envName, biome, gameContext, timeOfDay, seasonWeather, scale: envScale, attributes }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("enhance"); return; }
      if (resp.description && !lockedSections.envDescription) setDescription(resp.description);
      if (!lockedSections.identity) {
        if (resp.name) setEnvName(resp.name);
        if (resp.biome) setBiome(resp.biome);
        if (resp.gameContext) setGameContext(resp.gameContext);
        if (resp.timeOfDay) setTimeOfDay(resp.timeOfDay);
        if (resp.seasonWeather) setSeasonWeather(resp.seasonWeather);
        if (resp.scale) setEnvScale(resp.scale);
      }
      if (resp.attributes && !lockedSections.attributes) {
        setAttributes((prev) => {
          const next = { ...prev };
          for (const key of ATTR_KEYS) { if (!lockedAttrs[key] && resp.attributes![key]) next[key] = resp.attributes![key]; }
          return next;
        });
      }
      addToast("Environment enhanced", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("enhance");
  }, [description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes, lockedSections, lockedAttrs, addToast, busy]);

  // Randomize full
  const handleRandomizeFull = useCallback(async () => {
    busy.start("randomize");
    try {
      const resp = await apiFetch<{
        description?: string; name?: string; biome?: string; gameContext?: string;
        timeOfDay?: string; seasonWeather?: string; scale?: string;
        attributes?: Record<string, string>; error?: string;
      }>("/env/randomize-full", {
        method: "POST", body: JSON.stringify({ description, name: envName, biome, gameContext, timeOfDay, seasonWeather, scale: envScale, attributes }),
      });
      if (resp.error) { addToast(resp.error, "error"); busy.end("randomize"); return; }
      if (resp.description && !lockedSections.envDescription) setDescription(resp.description);
      if (!lockedSections.identity) {
        if (resp.name) setEnvName(resp.name);
        if (resp.biome) setBiome(resp.biome);
        if (resp.gameContext) setGameContext(resp.gameContext);
        if (resp.timeOfDay) setTimeOfDay(resp.timeOfDay);
        if (resp.seasonWeather) setSeasonWeather(resp.seasonWeather);
        if (resp.scale) setEnvScale(resp.scale);
      }
      if (resp.attributes && !lockedSections.attributes) {
        setAttributes((prev) => {
          const next = { ...prev };
          for (const key of ATTR_KEYS) { if (!lockedAttrs[key] && resp.attributes![key]) next[key] = resp.attributes![key]; }
          return next;
        });
      }
      addToast("Random environment generated", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("randomize");
  }, [description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes, lockedSections, lockedAttrs, addToast, busy]);

  // Reimagine screenshot
  const handleReimagine = useCallback(async () => {
    if (reimagineScreenshots.length === 0) { addToast("Upload a game screenshot first", "info"); return; }
    busy.start("reimagine");
    try {
      for (const src of reimagineScreenshots) {
        const b64 = src.replace(/^data:image\/\w+;base64,/, "");
        const resp = await apiFetch<{ image_b64?: string; error?: string }>("/env/reimagine", {
          method: "POST",
          body: JSON.stringify({
            image_b64: b64,
            context: reimagineContext,
            style_direction: reimagineStyle,
            model_id: modelId || undefined,
          }),
        });
        if (resp.error) { addToast(resp.error, "error"); continue; }
        if (resp.image_b64) {
          appendToGallery("main", `data:image/png;base64,${resp.image_b64}`, "Reimagined");
        }
      }
      addToast("Screenshot reimagined", "success");
    } catch (e) { addToast(String(e), "error"); }
    busy.end("reimagine");
  }, [reimagineScreenshots, reimagineContext, reimagineStyle, modelId, addToast, appendToGallery, busy]);

  // Reimagine file handling
  const handleReimagineFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setReimagineScreenshots((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  // Upscale / Restore
  const handleUpscaleRestore = useCallback(async () => {
    const images = urImages.length > 0 ? urImages : (getMainImageB64() ? [`data:image/png;base64,${getMainImageB64()}`] : []);
    if (images.length === 0) { addToast("No image to process", "info"); return; }
    const endpoint = urMode === "upscale" ? "/env/upscale" : "/env/restore";
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
    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Environment>"];
    lines.push(`  <Name>${envName}</Name>`);
    lines.push(`  <Biome>${biome}</Biome>`);
    lines.push(`  <GameContext>${gameContext}</GameContext>`);
    lines.push(`  <TimeOfDay>${timeOfDay}</TimeOfDay>`);
    lines.push(`  <SeasonWeather>${seasonWeather}</SeasonWeather>`);
    lines.push(`  <Scale>${envScale}</Scale>`);
    lines.push(`  <Description>${description}</Description>`);
    lines.push("  <Attributes>");
    for (const g of ENV_ATTRIBUTE_GROUPS) {
      lines.push(`    <${g.key}>${attributes[g.key] || ""}</${g.key}>`);
    }
    lines.push("  </Attributes>");
    lines.push("</Environment>");
    return lines.join("\n");
  }, [envName, biome, gameContext, timeOfDay, seasonWeather, envScale, description, attributes]);

  // Send to PS
  const handleSendToPS = useCallback(async () => {
    const b64 = getMainImageB64();
    if (!b64) { addToast("No image to send", "info"); return; }
    try {
      await apiFetch("/system/send-to-ps", { method: "POST", body: JSON.stringify({ image_b64: b64, label: "AI Environment Lab" }) });
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
    setEnvName("");
    setBiome("");
    setGameContext("");
    setTimeOfDay("");
    setSeasonWeather("");
    setEnvScale("");
    setAttributes(Object.fromEntries(ATTR_KEYS.map((k) => [k, ""])));
    setLockedAttrs(Object.fromEntries(ATTR_KEYS.map((k) => [k, false])));
    setStyleFusion({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
    setPreservation({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });
    setReimagineScreenshots([]);
    setReimagineContext("");
    setReimagineStyle("photorealistic concept art");
    setTabs(BUILTIN_TABS);
    setActiveTab("main");
    setGridResults([]);
    setGridEditBusy({});
    customSections.clearAll();
    addToast("Environment session cleared", "info");
  }, [addToast, customSections]);

  useEffect(() => {
    const SK = "madison-envlab-projects";
    const clearHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) handleReset();
    };
    const saveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) {
        const state = { description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes, lockedAttrs, styleFusion, preservation, modelId };
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = `environment_project_${instanceId + 1}.json`; a.click(); URL.revokeObjectURL(a.href);
      }
    };
    const loadHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId && detail?.data) {
        const d = detail.data as Record<string, unknown>;
        if (typeof d.description === "string") setDescription(d.description);
        if (typeof d.envName === "string") setEnvName(d.envName as string);
        if (typeof d.biome === "string") setBiome(d.biome as string);
        if (typeof d.gameContext === "string") setGameContext(d.gameContext as string);
        if (typeof d.timeOfDay === "string") setTimeOfDay(d.timeOfDay as string);
        if (typeof d.seasonWeather === "string") setSeasonWeather(d.seasonWeather as string);
        if (typeof d.envScale === "string") setEnvScale(d.envScale as string);
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
  }, [instanceId, handleReset, description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes, lockedAttrs, styleFusion, preservation, modelId, addToast]);

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
      description, envName, biome, gameContext, timeOfDay, seasonWeather, envScale, attributes,
      lockedAttrs, lockedSections, styleFusion, preservation, sectionEnabled,
      extractTargets, extractMode, modelId, genCount, layout, tabs, activeTab,
      reimagineContext, reimagineStyle,
    }),
    (s: unknown) => {
      if (s === null) { handleReset(); return; }
      const data = s as Record<string, unknown>;
      if (typeof data.description === "string") setDescription(data.description);
      if (typeof data.envName === "string") setEnvName(data.envName);
      if (typeof data.biome === "string") setBiome(data.biome);
      if (typeof data.gameContext === "string") setGameContext(data.gameContext);
      if (typeof data.timeOfDay === "string") setTimeOfDay(data.timeOfDay);
      if (typeof data.seasonWeather === "string") setSeasonWeather(data.seasonWeather);
      if (typeof data.envScale === "string") setEnvScale(data.envScale);
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
      if (typeof data.reimagineContext === "string") setReimagineContext(data.reimagineContext);
      if (typeof data.reimagineStyle === "string") setReimagineStyle(data.reimagineStyle);
    },
  );

  // Register keyboard shortcuts (only when this project tab is active)
  const { registerAction, unregisterAction } = useShortcuts();
  useEffect(() => {
    if (!active) return;
    registerAction("envGenerate", () => handleGenerate());
    registerAction("envExtract", handleExtractAttributes);
    registerAction("envEnhance", handleEnhanceDescription);
    registerAction("envRandomize", handleRandomizeFull);
    registerAction("envReimagine", handleReimagine);
    registerAction("envAllViews", handleGenerateAllViews);
    registerAction("envShowXml", () => setXmlOpen(true));
    registerAction("envSendPS", handleSendToPS);
    return () => {
      for (const id of ["envGenerate", "envExtract", "envEnhance", "envRandomize", "envReimagine", "envAllViews", "envShowXml", "envSendPS"]) {
        unregisterAction(id);
      }
    };
  }, [active, registerAction, unregisterAction, handleGenerate, handleExtractAttributes, handleEnhanceDescription, handleRandomizeFull, handleReimagine, handleGenerateAllViews, handleSendToPS]);

  // --- Voice Director command listener ---
  const voiceCmdRef = useRef({
    generate: () => handleGenerate(),
    extract_attributes: handleExtractAttributes,
    enhance_description: handleEnhanceDescription,
    randomize: handleRandomizeFull,
    reimagine: handleReimagine,
    generate_all_views: handleGenerateAllViews,
    generate_selected_view: () => handleGenerateSelectedView(),
    set_field: (params: Record<string, unknown>) => {
      const f = String(params.field || "").toLowerCase();
      const v = String(params.value || "");
      if (f === "description") setDescription(v);
      else if (f === "env_name") setEnvName(v);
      else if (f === "biome") setBiome(v);
      else if (f === "game_context") setGameContext(v);
      else if (f === "time_of_day") setTimeOfDay(v);
      else if (f === "season_weather") setSeasonWeather(v);
      else if (f === "env_scale") setEnvScale(v);
    },
    show_xml: () => setXmlOpen(true),
    send_to_photoshop: handleSendToPS,
    reset: handleReset,
  });
  voiceCmdRef.current = {
    generate: () => handleGenerate(),
    extract_attributes: handleExtractAttributes,
    enhance_description: handleEnhanceDescription,
    randomize: handleRandomizeFull,
    reimagine: handleReimagine,
    generate_all_views: handleGenerateAllViews,
    generate_selected_view: () => handleGenerateSelectedView(),
    set_field: (params: Record<string, unknown>) => {
      const f = String(params.field || "").toLowerCase();
      const v = String(params.value || "");
      if (f === "description") setDescription(v);
      else if (f === "env_name") setEnvName(v);
      else if (f === "biome") setBiome(v);
      else if (f === "game_context") setGameContext(v);
      else if (f === "time_of_day") setTimeOfDay(v);
      else if (f === "season_weather") setSeasonWeather(v);
      else if (f === "env_scale") setEnvScale(v);
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

  // --- Gallery restore listener ---
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown>;
      if (d._source_tool !== "environment") return;
      if (typeof d.description === "string") setDescription(d.description);
      if (typeof d.name === "string") setEnvName(d.name as string);
      if (typeof d.biome === "string") setBiome(d.biome as string);
      if (typeof d.game_context === "string") setGameContext(d.game_context as string);
      if (typeof d.time_of_day === "string") setTimeOfDay(d.time_of_day as string);
      if (typeof d.season_weather === "string") setSeasonWeather(d.season_weather as string);
      if (typeof d.env_scale === "string") setEnvScale(d.env_scale as string);
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

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const wrapSection = (id: SectionId, children: React.ReactNode) => {
    const collapsed = isSectionCollapsed(id);
    const isToggleable = TOGGLEABLE_SECTIONS.has(id);
    const isEnabled = isSectionEnabled(id);
    const isCollapsible = !NON_COLLAPSIBLE.has(id);
    const sectionColor = getSectionColor("env", id);
    return (
      <div
        key={id}
        draggable
        onDragStart={() => handleDragStart(id)}
        onDragOver={(e) => handleDragOver(e, id)}
        onDrop={() => handleDrop(id)}
        onDragEnd={handleDragEnd}
        onDragLeave={() => { if (dragOverId === id) setDragOverId(null); }}
        onMouseDown={(e) => { if (e.button === 1 && isToggleable) { e.preventDefault(); toggleSectionEnabled(id); } }}
        className="section-card-hover"
        style={{
          border: dragOverId === id && dragItemRef.current !== id
            ? "1px solid var(--color-accent, #6a6aff)"
            : sectionColor
              ? `1px solid ${sectionColor}`
              : "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--color-card)",
          opacity: isEnabled ? 1 : 0.4,
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
          {isCollapsible ? (
            <button
              type="button"
              onClick={() => toggleSectionCollapse(id)}
              className="flex-1 flex items-center gap-1.5 py-1.5 text-left cursor-pointer"
              style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
              title={SECTION_TIPS[id]}
            >
              {collapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
              <span className="text-xs font-semibold uppercase tracking-wider">{SECTION_LABELS[id]}</span>
            </button>
          ) : (
            <span className="flex-1 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }} title={SECTION_TIPS[id]}>
              {SECTION_LABELS[id]}
            </span>
          )}
          {(id in lockedSections) && (
            <span
              role="button"
              onClick={() => toggleLock(id as LockableSection, !lockedSections[id as LockableSection])}
              className="inline-flex items-center justify-center w-5 h-5 rounded select-none cursor-pointer"
              style={{
                background: lockedSections[id as LockableSection] ? "rgba(255,255,255,0.12)" : "transparent",
                color: lockedSections[id as LockableSection] ? "var(--color-text-secondary)" : "var(--color-text-muted)",
              }}
              title={lockedSections[id as LockableSection]
                ? "Locked — AI won't change these fields"
                : "Unlocked — AI can update these fields"}
            >
              {lockedSections[id as LockableSection] ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            </span>
          )}
          {isToggleable && (
            <button
              type="button"
              onClick={() => toggleSectionEnabled(id)}
              className="px-1.5 py-0.5 text-[9px] rounded font-semibold cursor-pointer shrink-0 select-none"
              style={{
                background: isEnabled ? "var(--color-accent)" : "var(--color-input-bg)",
                color: isEnabled ? "var(--color-foreground)" : "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
              title={isEnabled ? "ON" : "OFF"}
            >
              {isEnabled ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {!collapsed && <div className="px-3 pt-1 pb-3 space-y-2 overflow-hidden">{children}</div>}
      </div>
    );
  };

  const renderSection = (id: SectionId) => {
    switch (id) {
      case "generate":
        return wrapSection(id, renderGenerateSection());
      case "identity":
        return wrapSection(id, renderIdentitySection());
      case "envDescription":
        return wrapSection(id, renderDescriptionSection());
      case "attributes":
        return wrapSection(id, renderAttributesSection());
      case "reimagine":
        return wrapSection(id, renderReimagineSection());
      case "styleFusion":
        return wrapSection(id, renderStyleFusionSection());
      case "preservation":
        return wrapSection(id, renderPreservationSection());
      case "upscaleRestore":
        return wrapSection(id, renderUpscaleRestoreSection());
      case "multiview":
        return wrapSection(id, renderMultiviewSection());
      case "saveOptions":
        return wrapSection(id, renderSaveSection());
      default:
        return null;
    }
  };

  // --- Generate section ---
  const renderGenerateSection = () => (
    <>
      <Button className="w-full" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtractAttributes} disabled={textBusy} title="Analyze the current image and description to populate identity/attributes">
        Extract Attributes
      </Button>
      <div>
        <select
          value={extractMode}
          onChange={(e) => setExtractMode(e.target.value as "inspiration" | "recreate")}
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          title="Controls how the source image is used when generating"
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
        ] as [ExtractTarget, string][]).map(([key, label]) => (
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
            title={`When active, Extract will fill the ${label} panel`}
          >{label}</button>
        ))}
      </div>
      <div>
        <span className="text-xs font-medium block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Style Library</span>
        <select
          value={styleLibraryFolder}
          onChange={(e) => setStyleLibraryFolder(e.target.value)}
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] min-w-0 truncate"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
          title="Select a style library folder for style guidance"
        >
          <option value="">Default (Gemini)</option>
          {styleLibraryFolders.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" className="w-full" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhanceDescription} disabled={textBusy} title="Enhance existing fields with richer detail">
          Enhance
        </Button>
        <Button size="sm" className="w-full" generating={busy.is("randomize")} generatingText="Randomizing..." onClick={handleRandomizeFull} disabled={textBusy} title="Generate a random environment with all attributes filled in">
          Randomize
        </Button>
      </div>
      <div className="pt-1">
        <Button variant="primary" className="w-full" size="lg" generating={busy.is("gen")} generatingText="Generating..." onClick={generationMode === "grid" ? handleGridGenerate : () => handleGenerate()} title="Generate a new environment concept based on all enabled panels">
          Generate Environment
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <NumberStepper value={genCount} min={1} max={20} onChange={setGenCount} label="Count:" />
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="min-w-0 flex-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
          title="Select the AI model for image generation"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label} — {m.resolution}</option>
          ))}
        </select>
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
        <input value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="e.g. Harbor District, Outpost Ridge" className="w-full text-[11px] px-2 py-1 rounded" style={inputStyle} disabled={textBusy} data-voice-target="envName" />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Biome / Setting</label>
        <Select options={BIOME_OPTIONS} value={biome} onChange={(e) => setBiome(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Game Context</label>
        <Select options={GAME_CONTEXT_OPTIONS} value={gameContext} onChange={(e) => setGameContext(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Time of Day</label>
        <Select options={TIME_OF_DAY_OPTIONS} value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Season / Weather</label>
        <Select options={SEASON_WEATHER_OPTIONS} value={seasonWeather} onChange={(e) => setSeasonWeather(e.target.value)} disabled={textBusy} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Scale</label>
        <Select options={SCALE_OPTIONS} value={envScale} onChange={(e) => setEnvScale(e.target.value)} disabled={textBusy} />
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
        placeholder="Describe the environment — location, architecture, mood, time of day, narrative details..."
        disabled={textBusy}
        data-voice-target="envDescription"
      />
    </div>
  );

  // --- Attributes section ---
  const renderAttributesSection = () => (
    <>
      {ENV_ATTRIBUTE_GROUPS.map((g) => (
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
            data-voice-target={`envAttr-${g.key}`}
          />
        </div>
      ))}
    </>
  );

  // --- Game Screenshot Reimagine section ---
  const renderReimagineSection = () => (
    <>
      <div
        className="border border-dashed rounded p-3 text-center cursor-pointer"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        onClick={() => reimagineFileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer.files;
          Array.from(files).forEach((file) => {
            if (!file.type.startsWith("image/")) return;
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                setReimagineScreenshots((prev) => [...prev, reader.result as string]);
              }
            };
            reader.readAsDataURL(file);
          });
        }}
      >
        <Upload className="h-5 w-5 mx-auto mb-1 opacity-50" />
        <p className="text-[11px]">Drop game screenshots here or click to browse</p>
        <input
          ref={reimagineFileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleReimagineFileChange}
        />
      </div>

      {reimagineScreenshots.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {reimagineScreenshots.map((src, i) => (
            <div key={i} className="relative w-16 h-10 rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              <img src={src} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => setReimagineScreenshots((prev) => prev.filter((_, j) => j !== i))}
                className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center text-[10px]"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer" }}
              >&times;</button>
            </div>
          ))}
        </div>
      )}

      <Textarea
        value={reimagineContext}
        onChange={(e) => setReimagineContext(e.target.value)}
        rows={3}
        placeholder="What is this area? What should it become? Add context for the reimagination..."
        disabled={busy.is("reimagine")}
        data-voice-target="reimagineContext"
      />

      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Style Direction</label>
        <select
          value={reimagineStyle}
          onChange={(e) => setReimagineStyle(e.target.value)}
          className="w-full text-[11px] px-2 py-1 rounded-[var(--radius-sm)]"
          style={inputStyle}
        >
          {STYLE_DIRECTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <Button
        className="w-full"
        size="sm"
        generating={busy.is("reimagine")}
        generatingText="Reimagining..."
        onClick={handleReimagine}
        disabled={busy.is("reimagine") || reimagineScreenshots.length === 0}
        title="Transform uploaded screenshots into finished environment concept art"
      >
        Reimagine Screenshot
      </Button>
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
          type="button"
          onClick={() => setPreservation((p) => ({ ...p, enabled: !p.enabled }))}
          className="px-2 py-0.5 text-[10px] rounded cursor-pointer font-medium"
          style={{ background: preservation.enabled ? "var(--color-accent)" : "var(--color-input-bg)", color: preservation.enabled ? "var(--color-foreground)" : "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          title={preservation.enabled ? "Turn off preservation rules" : "Turn on preservation rules so the AI respects your constraints"}
        >{preservation.enabled ? "ON" : "OFF"}</button>
        <button
          type="button"
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
                type="button"
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
                type="button"
                onClick={() => setPreservation((prev) => ({ ...prev, preserves: prev.preserves.filter((_, j) => j !== i) }))}
                className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer"
                style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                title="Remove this preserve rule"
              >✕</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const label = prompt("New preserve constraint:", "Keep ...");
            if (!label?.trim()) return;
            const pl = label.trim();
            setPreservation((prev) => ({
              ...prev,
              preserves: [...prev.preserves, { key: `custom_${Date.now()}`, label: pl, prompt: `Do NOT change: ${pl}`, enabled: true }],
            }));
          }}
          className="mt-1.5 px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          title="Add a new rule telling the AI what to keep unchanged"
        >+ Add Preserve</button>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }} title="List things the AI should never include in the generated image">Negative Constraints (must avoid)</p>
        <div className="space-y-1">
          {preservation.negatives.map((n, i) => (
            <div key={n.id} className="flex items-center gap-2 group">
              <button
                type="button"
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
                value={n.text}
                onChange={(e) => setPreservation((prev) => ({
                  ...prev,
                  negatives: prev.negatives.map((nn, j) => j === i ? { ...nn, text: e.target.value } : nn),
                }))}
                className="flex-1 min-w-0 px-2 py-0.5 text-xs rounded-[var(--radius-sm)]"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setPreservation((prev) => ({ ...prev, negatives: prev.negatives.filter((_, j) => j !== i) }))}
                className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0"
                style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                title="Remove this negative constraint"
              >✕</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPreservation((prev) => ({
            ...prev,
            negatives: [...prev.negatives, { id: `neg${++_negIdCounter}`, text: "", enabled: true }],
          }))}
          className="mt-1.5 px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          title="Add a negative constraint"
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
            type="button"
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
                type="button"
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
        className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
        style={inputStyle}
        placeholder="Optional context — e.g. pixel art icons, game UI screenshots"
        value={urContext}
        onChange={(e) => setUrContext(e.target.value)}
        title="Give the AI a hint about what kind of images these are for better results"
      />
      <select
        value={urModelId || modelId}
        onChange={(e) => setUrModelId(e.target.value)}
        className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
        title="Choose which AI model to use for upscaling or restoring"
      >
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div
        className="rounded p-2 text-center"
        style={{ border: "1px dashed var(--color-border)", background: "var(--color-input-bg)" }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
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
          <input ref={urFileRef} type="file" accept="image/*" multiple className="hidden"
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
      >Generate</Button>
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
        title="Generate Player POV, Bird's Eye, Panoramic, and Detail views from the hero shot"
      >Generate All Views</Button>
      <Button
        className="w-full"
        size="sm"
        onClick={handleGenerateSelectedView}
        title="Generate only the currently selected view"
      >Generate Selected View</Button>
      {modelOptions.length > 0 && (
        <div>
          <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Gemini model (multi-view)</label>
          <select
            className="w-full px-2 py-1 text-[10px] rounded-[var(--radius-sm)] truncate"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            value={multiviewModel || modelId}
            onChange={(e) => setMultiviewModel(e.target.value)}
            disabled={busy.is("allViews")}
            title="Model used for Generate All Views and Generate Selected View."
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
        <Button size="sm" className="w-full" onClick={handleSendToPS} title="Send the current image to Photoshop">Send to PS</Button>
        <Button size="sm" className="w-full" onClick={() => setXmlOpen(true)} title="Show the XML representation of this environment">Show XML</Button>
        <Button size="sm" className="w-full" onClick={handleReset} title="Clear all environment data and images">Clear All</Button>
      </div>
      <div className="pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
        <Button size="sm" className="w-full" title="Export a complete handoff package as ZIP" onClick={async () => {
          const imgs: {label: string; image_b64: string}[] = [];
          for (const tab of ["main","player_pov","birds_eye","panoramic","detail"] as const) {
            const b64 = getImageB64(tab);
            if (b64) imgs.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
          }
          if (imgs.length === 0) { addToast("No view images to export", "info"); return; }
          try {
            const res = await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/export/package`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ images: imgs, xml_data: "", prompt_text: "", settings: {}, palette: [], include_ref_sheet: true, tool_name: "environment", character_name: "environment" })
            });
            if (!res.ok) throw new Error("Export failed");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `env_export_${Date.now()}.zip`; a.click();
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
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL */}
      <div
        className="w-[400px] h-full shrink-0 overflow-y-auto p-3 space-y-2"
        style={{ borderRight: "1px solid var(--color-border)" }}
      >
        {layout.order.map((id) => renderSection(id))}

        {customSections.sections.map((cs) => {
          const csCollapsed = customSections.isCollapsed(cs.id);
          const csEnabled = customSections.isEnabled(cs.id);
          const csColor = cs.color || getSectionColor("env", `custom:${cs.id}`);
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
          title="Save current panel order and collapsed states as default"
        >
          <Save className="h-3 w-3" />
          Set Active Layout as Default
        </button>
      </div>

      {/* Middle Column - Edit Panel */}
      <div className="w-[320px] h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Environment</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe changes to apply:</p>
            <Textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={14} placeholder="Tell the AI what to change — e.g. Add fog in the valley, change to sunset lighting, make the water more turbulent..." disabled={busy.is("apply")} />
            <Button variant="primary" className="w-full" generating={busy.is("apply")} generatingText="Applying..." onClick={handleApplyEdit} title="Send your edit instructions to the AI — it will modify the current image based on what you wrote above">Apply Changes</Button>
            {modelOptions.length > 0 && (
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Gemini model (edit)</label>
                <select
                  className="w-full px-2 py-1 text-[10px] rounded-[var(--radius-sm)] truncate"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  value={editModel || modelId}
                  onChange={(e) => setEditModel(e.target.value)}
                  disabled={busy.is("apply")}
                  title="Model used for Apply Changes edits."
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
                    title="Build the exact prompt that will be sent to the AI"
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
                      title="Copy the prompt text to your clipboard"
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
        <div className="flex items-end shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex-1 min-w-0 overflow-hidden">
            <GroupedTabBar
              tabs={tabs}
              active={activeTab}
              onSelect={setActiveTab}
              onAddRef={handleAddRef}
              onRemoveTab={handleRemoveRef}
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

        {/* Image viewer */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {activeTab === "artboard" ? (
            <ArtboardCanvas />
          ) : activeTab === "deepSearch" ? (
            <DeepSearchPanel onSendToArtboard={handleSendSearchToArtboard} />
          ) : generationMode === "grid" && activeTab === "main" && gridResults.length > 0 ? (
            <div className="flex-1 min-w-0">
              <GridGallery
                results={gridResults}
                title="Environment Variations"
                toolLabel="environment"
                generating={busy.is("gen")}
                emptyMessage="No grid results yet. Switch to grid mode and generate."
                onDelete={handleGridDelete}
                onCopy={handleGridCopy}
                onEditSubmit={handleGridEdit}
                editBusy={gridEditBusy}
                isFavorited={(b64) => isFavorited(b64)}
                onToggleFavorite={(id, b64, w, h) => { if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "environment", label: `grid-${id}`, prompt: "", source: "grid", width: w, height: h }); }}
              />
            </div>
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
                onToggleFavorite={currentSrc ? () => { const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "environment", label: activeTab || "main", source: "viewer" }); } : undefined}
              />
              <ArtDirectorWidget onOpenConfig={() => setArtDirectorConfigOpen(true)} />
            </div>
          )}
        </div>
      </div>

      {xmlOpen && <XmlModal xml={xmlContent} title="Environment XML" onClose={() => setXmlOpen(false)} />}
      <ArtDirectorConfigModal open={artDirectorConfigOpen} onClose={() => setArtDirectorConfigOpen(false)} />
    </div>
  );
}
