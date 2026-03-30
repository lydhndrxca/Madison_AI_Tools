import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Button, Select, Textarea, NumberStepper } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { GridGallery } from "@/components/shared/GridGallery";
import type { GridGalleryResult } from "@/components/shared/GridGallery";
import { GroupedTabBar } from "@/components/shared/TabBar";
import { ArtboardCanvas } from "@/components/shared/ArtboardCanvas";
import type { TabDef } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useModels, type ModelInfo } from "@/hooks/ModelsContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister } from "@/hooks/SessionContext";
import { useClipboardPaste } from "@/hooks/useClipboardPaste";
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
import { GripVertical, ChevronDown, ChevronRight, Save, FolderPlus, Trash2, Pencil, ImagePlus, X, FolderOpen, ArrowLeft, Eye, EyeOff, Monitor } from "lucide-react";
import { EditHistory } from "@/components/shared/EditHistory";
import { StyleFusionPanel, buildFusionBrief, EMPTY_FUSION } from "@/components/shared/StyleFusionPanel";
import type { StyleFusionState } from "@/components/shared/StyleFusionPanel";
import type { HistoryEntry } from "@/lib/imageHistory";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useCustomSections } from "@/hooks/CustomSectionsContext";
import { useCustomSectionState } from "@/hooks/useCustomSectionState";
import { CustomSectionRenderer } from "@/components/shared/CustomSectionRenderer";

// ---------------------------------------------------------------------------
// Tab model — UI Lab uses "library" group instead of "views"
// ---------------------------------------------------------------------------

const BUILTIN_TABS: TabDef[] = [
  { id: "main", label: "Mainstage", group: "stage" },
  { id: "grid", label: "4×4 Grid", group: "stage" },
  { id: "styleLib", label: "Style Library", group: "library" },
  { id: "userLib", label: "User Library", group: "library" },
  { id: "artboard", label: "Art Table", group: "artboard" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
  { id: "deepSearch", label: "Deep Search", group: "search" },
];

// ---------------------------------------------------------------------------
// Domain data (mirrors backend uilab.py)
// ---------------------------------------------------------------------------

const ELEMENT_TYPE_OPTIONS = [
  { value: "button", label: "Button" },
  { value: "icon", label: "Icon" },
  { value: "scrollbar", label: "Scrollbar" },
  { value: "font", label: "Font Letter" },
  { value: "number", label: "Number" },
];

const BUTTON_SHAPE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "rectangle", label: "Rectangle" },
  { value: "rounded_rectangle", label: "Rounded Rectangle" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle / Oval" },
  { value: "pill", label: "Pill / Capsule" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "triangle", label: "Triangle" },
];

const BORDER_STYLE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "thin", label: "Thin" },
  { value: "medium", label: "Medium" },
  { value: "thick", label: "Thick" },
  { value: "none", label: "None" },
];

const TEXT_SIZE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

// ---------------------------------------------------------------------------
// Style Fusion
// ---------------------------------------------------------------------------

const TAKE_OPTIONS = [
  "overall vibe", "silhouette", "material & texture", "color palette",
  "detail work & hardware", "cultural reference", "attitude & energy",
];

// ---------------------------------------------------------------------------
// Layout system
// ---------------------------------------------------------------------------

type SectionId = "generate" | "refImage" | "buttonLayout" | "scrollbarParts" | "charGen" | "styleFusion" | "saveOptions" | "threeDGen";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "refImage", "buttonLayout", "scrollbarParts", "charGen", "styleFusion", "threeDGen", "saveOptions",
];

const SECTION_LABELS: Record<SectionId, string> = {
  generate: "Generate UI Element",
  refImage: "Reference Image",
  buttonLayout: "Button Layout",
  scrollbarParts: "Scrollbar Components",
  charGen: "Character Generation",
  styleFusion: "Style Fusion",
  threeDGen: "3D Gen AI",
  saveOptions: "Save Options",
};

const SECTION_TIPS: Record<SectionId, string> = {
  generate: "Element type, prompt, output size, color, count, and model.",
  refImage: "Reference image for style transfer or re-envisioning.",
  buttonLayout: "Shape, border, icon, and text layout for buttons.",
  scrollbarParts: "Select which scrollbar pieces to generate.",
  charGen: "Choose characters/digits to generate as styled glyphs.",
  styleFusion: "Blend two style references for a unique look.",
  threeDGen: "Generate 3D models from your views using Meshy and Hitem3D.",
  saveOptions: "Export, clear, and manage generated elements.",
};

const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["buttonLayout", "scrollbarParts", "charGen", "styleFusion", "threeDGen"]);


interface LayoutState { order: SectionId[]; collapsed: Partial<Record<SectionId, boolean>>; hidden?: SectionId[] }

function layoutStorageKeyFor(instanceId: number) {
  return `madison-uilab-layout${instanceId ? `-${instanceId}` : ""}`;
}

function loadDefaultLayout(key?: string): LayoutState {
  try {
    const raw = localStorage.getItem(key || "madison-uilab-layout");
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set<SectionId>(DEFAULT_SECTION_ORDER);
      const order = parsed.order.filter((id) => allIds.has(id));
      for (const id of DEFAULT_SECTION_ORDER) { if (!order.includes(id)) order.push(id); }
      return { order, collapsed: parsed.collapsed ?? {}, hidden: parsed.hidden };
    }
  } catch { /* */ }
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { refImage: true, styleFusion: true, threeDGen: true, saveOptions: true } };
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

// GridGalleryResult is imported from GridGallery component

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface UILabPageProps {
  instanceId?: number;
  active?: boolean;
  projectUid?: string;
}

export function UILabPage({ instanceId = 0, active = true, projectUid }: UILabPageProps) {
  const stableId = projectUid ?? String(instanceId);
  const layoutStorageKey = `madison-uilab-layout-${stableId}`;
  const sessionKey = `uilab-${stableId}`;
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [activeTab, setActiveTab] = useState("main");
  const busy = useBusySet();

  // Ref tab images (for Ref A/B/C tabs)
  const [refImages, setRefImages] = useState<Record<string, string>>({});

  // Gallery for grid tab
  const [galleryResults, setGalleryResults] = useState<GridGalleryResult[]>([]);
  const [gridEditBusy, setGridEditBusy] = useState<Record<string, boolean>>({});

  // Mainstage viewer state
  const [mainstageSrc, setMainstageSrc] = useState<string | null>(null);
  const [mainstageHistory, setMainstageHistory] = useState<HistoryEntry[]>([]);
  const [mainstageHistoryActiveId, setMainstageHistoryActiveId] = useState<string | null>(null);
  const mainstageFileInputRef = useRef<HTMLInputElement>(null);

  // UI Generator state
  const [elementType, setElementType] = useState("icon");
  const [prompt, setPrompt] = useState("");
  const [artDirectorConfigOpen, setArtDirectorConfigOpen] = useState(false);
  const { setCurrentImage, setAttributesContext, setOnApplyFeedback } = useArtDirector();
  const appPage = useActivePage();
  const [genCount, setGenCount] = useState(1);
  const { models, defaultModelId } = useModels();
  const [modelId, setModelId] = useState("");

  // Element configuration
  const [outputSize, setOutputSize] = useState("");
  const [matchRefDims, setMatchRefDims] = useState(false);
  const [reenvision, setReenvision] = useState(false);
  const [addColor, setAddColor] = useState(false);
  const [noColor, setNoColor] = useState(false);
  const [useGrid, setUseGrid] = useState(true);
  const [cellSize, setCellSize] = useState("");

  // Reference image
  const [refImageB64, setRefImageB64] = useState<string | null>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  // Button layout
  const [buttonShape, setButtonShape] = useState("auto");
  const [borderStyle, setBorderStyle] = useState("auto");
  const [addIcon, setAddIcon] = useState(false);
  const [addText, setAddText] = useState(true);
  const [textSize, setTextSize] = useState("auto");

  // Scrollbar
  const [sbTrack, setSbTrack] = useState(true);
  const [sbThumb, setSbThumb] = useState(true);
  const [sbArrows, setSbArrows] = useState(true);
  const [sbOrientation, setSbOrientation] = useState("vertical");

  // Font / number characters
  const [fontChars, setFontChars] = useState("");

  // Style Fusion
  const [styleFusion, setStyleFusion] = useState<StyleFusionState>({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });

  // Style library
  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);

  // Section ON/OFF
  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({
    buttonLayout: true, scrollbarParts: true, charGen: true, threeDGen: true,
  });
  const isSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return true;
    return sectionEnabled[id] === true;
  }, [sectionEnabled]);
  const toggleSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return;
    setSectionEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Layout
  const [layout, setLayout] = useState<LayoutState>(() => loadDefaultLayout(layoutStorageKey));
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);
  const dragItemRef = useRef<SectionId | null>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const artboard = useArtboard();
  const { getSectionColor } = useCustomSections();
  const customSections = useCustomSectionState("uilab");

  const [xmlOpen, setXmlOpen] = useState(false);

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

  const refCounter = useRef(0);

  useEffect(() => {
    if (defaultModelId && !modelId) setModelId(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Is a section relevant to current element type?
  const isSectionRelevant = useCallback((id: SectionId): boolean => {
    if (id === "buttonLayout") return elementType === "button";
    if (id === "scrollbarParts") return elementType === "scrollbar";
    if (id === "charGen") return elementType === "font" || elementType === "number";
    return true;
  }, [elementType]);

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
    setRefImages((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
  }, []);

  const isRefTab = activeTab.startsWith("ref");

  const getViewImagesForThreeD = useCallback((): ViewImage[] => {
    const parseDataUrl = (dataUrl: string): { base64: string; mimeType: string } | null => {
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return null;
      const header = dataUrl.slice(0, comma);
      const base64 = dataUrl.slice(comma + 1);
      const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? "image/png";
      return { base64, mimeType };
    };
    const push = (viewKey: string, label: string, src: string | null | undefined, acc: ViewImage[]) => {
      if (!src) return;
      const p = parseDataUrl(src);
      if (!p) return;
      acc.push({ viewKey, label, base64: p.base64, mimeType: p.mimeType });
    };
    const out: ViewImage[] = [];
    push("front", "Mainstage", mainstageSrc, out);
    push("back", "Ref A", refImages.refA, out);
    push("side", "Ref B", refImages.refB, out);
    for (const tab of tabs) {
      if (tab.group !== "refs" || tab.id === "refA" || tab.id === "refB") continue;
      push(tab.id, tab.label, refImages[tab.id], out);
    }
    return out;
  }, [mainstageSrc, refImages, tabs]);

  // Clipboard paste for ref tabs
  const clipboardPasteCb = useCallback((dataUrl: string) => {
    if (isRefTab) {
      setRefImages((prev) => ({ ...prev, [activeTab]: dataUrl }));
    }
  }, [activeTab, isRefTab]);
  useClipboardPaste(activeTab === "artboard" ? undefined : clipboardPasteCb);

  // --- Ref image helpers ---
  const handleRefOpen = useCallback(() => { refFileInputRef.current?.click(); }, []);
  const handleRefFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      setRefImageB64(b64);
      setMatchRefDims(false);
      setReenvision(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleRefPaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            setRefImageB64(b64);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      addToast("No image on clipboard", "info");
    } catch { addToast("Could not read clipboard", "info"); }
  }, [addToast]);

  const handleRefClear = useCallback(() => {
    setRefImageB64(null);
    setMatchRefDims(false);
    setReenvision(false);
  }, []);

  // Collect all ref tab b64 images for style/ref context
  const collectRefImagesB64 = useCallback((): string[] => {
    const result: string[] = [];
    for (const tab of tabs) {
      if (tab.group === "refs" && refImages[tab.id]) {
        const src = refImages[tab.id];
        const b64 = src.startsWith("data:") ? src.replace(/^data:image\/\w+;base64,/, "") : src;
        result.push(b64);
      }
    }
    return result;
  }, [tabs, refImages]);

  // --- Resolve output dimensions ---
  const resolveOutputDims = useCallback((): [number, number] => {
    if (outputSize.trim()) {
      const m = outputSize.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
      if (m) return [parseInt(m[1]), parseInt(m[2])];
    }
    return [1024, 1024];
  }, [outputSize]);

  const resolveCellDims = useCallback((): [number, number] => {
    if (cellSize.trim()) {
      const m = cellSize.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
      if (m) return [parseInt(m[1]), parseInt(m[2])];
    }
    return [256, 256];
  }, [cellSize]);

  // --- Mainstage callbacks ---
  const _histCounter = useRef(0);
  const addMainstageHistory = useCallback((label: string, src: string) => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${++_histCounter.current}`,
      timestamp: new Date().toISOString(),
      label,
      image_b64: src,
      settings: { description: "", age: "", race: "", gender: "", build: "", editPrompt: "" },
    };
    setMainstageHistory((prev) => [...prev, entry]);
    setMainstageHistoryActiveId(entry.id);
  }, []);

  const setMainstageImage = useCallback((src: string, label = "Generation") => {
    setMainstageSrc(src);
    addMainstageHistory(label, src);
  }, [addMainstageHistory]);

  const handleMainstageImageEdited = useCallback((newSrc: string, label: string) => {
    setMainstageSrc(newSrc);
    addMainstageHistory(label, newSrc);
  }, [addMainstageHistory]);

  const handleMainstageSave = useCallback(() => {
    if (!mainstageSrc) return;
    const a = document.createElement("a");
    a.href = mainstageSrc;
    a.download = `uilab_mainstage_${Date.now()}.png`;
    a.click();
  }, [mainstageSrc]);

  const handleMainstageCopy = useCallback(async () => {
    if (!mainstageSrc) return;
    try {
      const resp = await fetch(mainstageSrc);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      addToast("Image copied", "info");
    } catch { addToast("Failed to copy", "error"); }
  }, [mainstageSrc, addToast]);

  const handleMainstagePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const reader = new FileReader();
          reader.onload = () => { setMainstageImage(reader.result as string, "Pasted image"); };
          reader.readAsDataURL(blob);
          return;
        }
      }
      addToast("No image on clipboard", "info");
    } catch { addToast("Could not read clipboard", "info"); }
  }, [addToast, setMainstageImage]);

  const handleMainstageOpen = useCallback(() => { mainstageFileInputRef.current?.click(); }, []);
  const handleMainstageFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setMainstageImage(reader.result as string, "Opened image"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [setMainstageImage]);

  const handleMainstageClear = useCallback(() => {
    setMainstageSrc(null);
  }, []);

  const handleMainstageHistoryRestore = useCallback((entryId: string) => {
    const entry = mainstageHistory.find((h) => h.id === entryId);
    if (!entry) return;
    setMainstageHistoryActiveId(entryId);
    setMainstageSrc(entry.image_b64);
  }, [mainstageHistory]);

  const handleMainstageHistoryRestoreCurrent = useCallback(() => {
    if (mainstageHistory.length === 0) return;
    const last = mainstageHistory[mainstageHistory.length - 1];
    setMainstageHistoryActiveId(last.id);
    setMainstageSrc(last.image_b64);
  }, [mainstageHistory]);

  const handleMainstageHistoryClear = useCallback(() => {
    setMainstageHistory([]);
    setMainstageHistoryActiveId(null);
  }, []);

  const editorRefImagesB64 = useMemo(() => {
    const result: string[] = [];
    for (const tab of tabs) {
      if (tab.group === "refs" && refImages[tab.id]) {
        const src = refImages[tab.id];
        result.push(src.startsWith("data:") ? src : `data:image/png;base64,${src}`);
      }
    }
    return result;
  }, [tabs, refImages]);

  // --- Section prompt resolution ---
  const getDefaultSectionPrompt = useCallback((sectionId: SectionId): string => {
    switch (sectionId) {
      case "styleFusion": return buildFusionBrief(styleFusion);
      default: return "";
    }
  }, [styleFusion]);

  const resolveSection = useCallback((sectionId: SectionId): string => {
    if (!isSectionEnabled(sectionId)) return "";
    return getDefaultSectionPrompt(sectionId);
  }, [isSectionEnabled, getDefaultSectionPrompt]);

  // --- Enhance handler ---
  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim()) { addToast("Enter a description to enhance first", "info"); return; }
    busy.start("enhance");
    try {
      const resp = await apiFetch<{ prompt?: string; error?: string }>("/uilab/enhance", {
        method: "POST",
        body: JSON.stringify({ prompt, element_type: elementType, button_shape: buttonShape, border_style: borderStyle, text_size: textSize }),
      });
      if (resp.error) { addToast(resp.error, "error"); }
      else if (resp.prompt) { setPrompt(resp.prompt); addToast("Description enhanced", "success"); }
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("enhance");
  }, [prompt, elementType, buttonShape, borderStyle, textSize, addToast, busy]);

  // --- Generation handlers ---
  const handleGenerate = useCallback(async () => {
    if (busy.any) return;

    const fusionContext = resolveSection("styleFusion");
    const [outW, outH] = resolveOutputDims();
    const refImagesB64 = collectRefImagesB64();

    const baseReq = {
      element_type: elementType,
      prompt,
      count: genCount,
      output_width: outW,
      output_height: outH,
      reference_image_b64: refImageB64 || undefined,
      ref_images: refImagesB64.length > 0 ? refImagesB64 : undefined,
      reenvision,
      match_ref_dims: matchRefDims,
      add_color: addColor,
      no_color: noColor,
      button_shape: buttonShape,
      border_style: borderStyle,
      add_icon: addIcon,
      add_text: addText,
      text_size: textSize,
      scrollbar_orientation: sbOrientation,
      font_chars: fontChars,
      style_guidance: styleLibraryFolder ? (styleLibraryFolders.find((f) => f.name === styleLibraryFolder)?.guidance_text || "") : "",
      model_id: modelId || undefined,
      style_context: styleLibraryFolder || undefined,
      fusion_context: fusionContext || undefined,
      fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
      custom_sections_context: customSections.getPromptContributions() || undefined,
      custom_section_images: customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean) || undefined,
    };

    const shouldUseGrid = useGrid && elementType !== "scrollbar" && elementType !== "font" && elementType !== "number";

    if (shouldUseGrid) {
      busy.start("gen");
      setActiveTab("grid");
      try {
        const [cw, ch] = resolveCellDims();
        for (let page = 0; page < genCount; page++) {
          const res = await apiFetch<{
            cells?: string[]; full_grid_b64?: string; error?: string;
          }>("/uilab/generate-grid", {
            method: "POST",
            body: JSON.stringify({ ...baseReq, cell_width: cw, cell_height: ch, use_grid: true }),
          });
          if (res.error) {
            addToast(res.error, "error");
            break;
          }
          if (res.cells) {
            const newResults: GridGalleryResult[] = res.cells.map((b64, i) => ({
              id: `grid_${Date.now()}_${page}_${i}`,
              image_b64: b64,
              width: cw,
              height: ch,
              label: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1}`,
            }));
            if (res.full_grid_b64) {
              newResults.push({
                id: `grid_full_${Date.now()}_${page}`,
                image_b64: res.full_grid_b64,
                width: cw * 4,
                height: ch * 4,
                label: "Full",
              });
            }
            setGalleryResults((prev) => [...prev, ...newResults]);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("abort")) return;
        addToast(e instanceof Error ? e.message : "Generation failed", "error");
      } finally {
        busy.end("gen");
      }
    } else if (elementType === "scrollbar") {
      busy.start("gen");
      setActiveTab("grid");
      const components: string[] = [];
      if (sbTrack) components.push("track");
      if (sbThumb) components.push("thumb");
      if (sbArrows) components.push("arrows");
      if (components.length === 0) { addToast("Select at least one scrollbar component", "info"); busy.end("gen"); return; }
      try {
        for (const comp of components) {
          for (let i = 0; i < genCount; i++) {
            const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
              `/uilab/generate-scrollbar?component=${comp}`,
              { method: "POST", body: JSON.stringify(baseReq) },
            );
            if (res.error) { addToast(res.error, "error"); break; }
            if (res.image_b64) {
              setGalleryResults((prev) => [...prev, {
                id: `sb_${comp}_${Date.now()}_${i}`,
                image_b64: res.image_b64!,
                width: res.width || outW,
                height: res.height || outH,
              }]);
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("abort")) return;
        addToast(e instanceof Error ? e.message : "Generation failed", "error");
      } finally {
        busy.end("gen");
      }
    } else if (elementType === "font" || elementType === "number") {
      busy.start("gen");
      setActiveTab("grid");
      const chars = fontChars.trim() || (elementType === "font" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "0123456789");
      const uniqueChars = [...new Set(chars.toUpperCase().split(""))];
      try {
        for (const char of uniqueChars) {
          for (let i = 0; i < genCount; i++) {
            const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
              `/uilab/generate-char?char=${encodeURIComponent(char)}`,
              { method: "POST", body: JSON.stringify(baseReq) },
            );
            if (res.error) { addToast(res.error, "error"); break; }
            if (res.image_b64) {
              setGalleryResults((prev) => [...prev, {
                id: `char_${char}_${Date.now()}_${i}`,
                image_b64: res.image_b64!,
                width: res.width || outW,
                height: res.height || outH,
              }]);
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("abort")) return;
        addToast(e instanceof Error ? e.message : "Generation failed", "error");
      } finally {
        busy.end("gen");
      }
    } else {
      busy.start("gen");
      setActiveTab("main");
      try {
        for (let i = 0; i < genCount; i++) {
          const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
            "/uilab/generate",
            { method: "POST", body: JSON.stringify({ ...baseReq, use_grid: false }) },
          );
          if (res.error) { addToast(res.error, "error"); break; }
          if (res.image_b64) {
            const src = `data:image/png;base64,${res.image_b64}`;
            setMainstageImage(src, `Generation ${i + 1}`);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("abort")) return;
        addToast(e instanceof Error ? e.message : "Generation failed", "error");
      } finally {
        busy.end("gen");
      }
    }
  }, [busy, elementType, prompt, genCount, modelId, refImageB64, reenvision, matchRefDims, addColor, noColor,
    useGrid, buttonShape, borderStyle, addIcon, addText, textSize, sbTrack, sbThumb, sbArrows, sbOrientation,
    fontChars, styleFusion, styleLibraryFolder, styleLibraryFolders, resolveOutputDims, resolveCellDims, collectRefImagesB64, setMainstageImage, addToast,
    resolveSection, customSections.getPromptContributions, customSections.getImageAttachments]);

  const handleCancel = useCallback(() => {
    cancelAllRequests();
    busy.endAll();
    addToast("Cancelled", "info");
    try { fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/system/cancel`, { method: "POST" }); } catch { /* */ }
  }, [busy, addToast]);

  const handleClearGallery = useCallback(() => {
    setGalleryResults([]);
  }, []);

  const handleDeleteResult = useCallback((id: string) => {
    setGalleryResults((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleReset = useCallback(() => {
    setPrompt("");
    setElementType("icon");
    setGenCount(1);
    setOutputSize("");
    setMatchRefDims(false);
    setReenvision(false);
    setAddColor(false);
    setNoColor(false);
    setUseGrid(true);
    setCellSize("");
    setRefImageB64(null);
    setButtonShape("auto");
    setBorderStyle("auto");
    setAddIcon(false);
    setAddText(true);
    setTextSize("auto");
    setSbTrack(true);
    setSbThumb(true);
    setSbArrows(true);
    setSbOrientation("vertical");
    setFontChars("");
    setStyleFusion({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
    setGalleryResults([]);
    setRefImages({});
    setStyleLibraryFolder("");
    setGalleryResults([]);
    setGridEditBusy({});
    customSections.clearAll();
    addToast("Session cleared", "info");
  }, [addToast, customSections]);

  useEffect(() => {
    const SK = "madison-uilab-projects";
    const clearHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) handleReset();
    };
    const saveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId) {
        const state = { prompt, elementType, sbOrientation, fontChars, styleFusion, modelId, styleLibraryFolder, buttonShape, borderStyle, outputSize };
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = `uilab_project_${instanceId + 1}.json`; a.click(); URL.revokeObjectURL(a.href);
      }
    };
    const loadHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === SK && detail?.instanceId === instanceId && detail?.data) {
        const d = detail.data as Record<string, unknown>;
        if (typeof d.prompt === "string") setPrompt(d.prompt);
        if (typeof d.elementType === "string") setElementType(d.elementType as typeof elementType);
        if (typeof d.buttonShape === "string") setButtonShape(d.buttonShape as string);
        if (typeof d.borderStyle === "string") setBorderStyle(d.borderStyle as string);
        if (typeof d.outputSize === "string") setOutputSize(d.outputSize as string);
        if (typeof d.sbOrientation === "string") setSbOrientation(d.sbOrientation as string);
        if (typeof d.fontChars === "string") setFontChars(d.fontChars as string);
        if (d.styleFusion) setStyleFusion(d.styleFusion as StyleFusionState);
        if (typeof d.modelId === "string") setModelId(d.modelId);
        if (typeof d.styleLibraryFolder === "string") setStyleLibraryFolder(d.styleLibraryFolder as string);
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
  }, [instanceId, handleReset, prompt, elementType, sbOrientation, fontChars, styleFusion, modelId, styleLibraryFolder, buttonShape, borderStyle, outputSize, addToast]);

  // Grid cell handlers
  const handleGridCopy = useCallback(async (id: string) => {
    const result = galleryResults.find((r) => r.id === id);
    if (!result) return;
    try {
      const resp = await fetch(`data:image/png;base64,${result.image_b64}`);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      addToast("Copied to clipboard", "success");
    } catch { addToast("Copy failed", "error"); }
  }, [galleryResults, addToast]);

  const handleGridEdit = useCallback(async (id: string, editText: string) => {
    const result = galleryResults.find((r) => r.id === id);
    if (!result) return;
    setGridEditBusy((prev) => ({ ...prev, [id]: true }));
    try {
      const fusionCtx = resolveSection("styleFusion");
      const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
        "/uilab/generate",
        {
          method: "POST",
          body: JSON.stringify({
            element_type: elementType,
            prompt: editText,
            reference_image_b64: result.image_b64,
            edit_prompt: editText,
            model_id: modelId || undefined,
            add_color: addColor,
            no_color: noColor,
            fusion_context: fusionCtx || undefined,
            fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            custom_sections_context: customSections.getPromptContributions() || undefined,
            custom_section_images: customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean) || undefined,
          }),
        },
      );
      if (res.error) { addToast(res.error, "error"); }
      else if (res.image_b64) {
        setGalleryResults((prev) =>
          prev.map((r) => r.id === id ? { ...r, image_b64: res.image_b64!, width: res.width || r.width, height: res.height || r.height } : r),
        );
        addToast("Cell updated", "success");
      }
    } catch (e) { addToast(e instanceof Error ? e.message : "Edit failed", "error"); }
    setGridEditBusy((prev) => ({ ...prev, [id]: false }));
  }, [galleryResults, elementType, modelId, addColor, noColor, styleFusion, customSections, resolveSection, addToast]);

  const handleGridRegenerate = useCallback(async (id: string) => {
    const result = galleryResults.find((r) => r.id === id);
    if (!result || busy.any) return;
    busy.start("gen");
    setActiveTab("grid");
    try {
      const res = await apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(
        "/uilab/generate",
        {
          method: "POST",
          body: JSON.stringify({
            element_type: elementType,
            prompt,
            reference_image_b64: result.image_b64,
            model_id: modelId || undefined,
            style_context: styleLibraryFolder || undefined,
            style_guidance: styleLibraryFolder ? (styleLibraryFolders.find((f) => f.name === styleLibraryFolder)?.guidance_text || "") : "",
            fusion_context: resolveSection("styleFusion") || undefined,
            fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            add_color: addColor,
            no_color: noColor,
            custom_sections_context: customSections.getPromptContributions() || undefined,
            custom_section_images: customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean) || undefined,
          }),
        },
      );
      if (res.error) { addToast(res.error, "error"); }
      else if (res.image_b64) {
        setGalleryResults((prev) => [...prev, {
          id: `regen_${Date.now()}`,
          image_b64: res.image_b64!,
          width: res.width || result.width,
          height: res.height || result.height,
        }]);
        addToast("Regenerated", "success");
      }
    } catch (e) { addToast(e instanceof Error ? e.message : "Regeneration failed", "error"); }
    busy.end("gen");
  }, [galleryResults, busy, elementType, prompt, modelId, styleLibraryFolder, styleLibraryFolders, styleFusion, addToast]);

  const handleGridUpdateImage = useCallback((id: string, newB64: string, w: number, h: number) => {
    setGalleryResults((prev) =>
      prev.map((r) => r.id === id ? { ...r, image_b64: newB64, width: w, height: h } : r),
    );
  }, []);

  const handleSendToMainstage = useCallback((id: string) => {
    const result = galleryResults.find((r) => r.id === id);
    if (!result) return;
    const src = `data:image/png;base64,${result.image_b64}`;
    setMainstageImage(src, "From grid");
    setActiveTab("main");
    addToast("Sent to Mainstage", "success");
  }, [galleryResults, setMainstageImage, addToast]);

  // XML content
  const xmlContent = useMemo(() => {
    const lines = [
      `<uilab>`,
      `  <elementType>${elementType}</elementType>`,
      `  <prompt>${prompt}</prompt>`,
      `  <outputSize>${outputSize || "1024x1024"}</outputSize>`,
      `  <useGrid>${useGrid}</useGrid>`,
      `  <reenvision>${reenvision}</reenvision>`,
    ];
    if (elementType === "button") {
      lines.push(`  <buttonShape>${buttonShape}</buttonShape>`);
      lines.push(`  <borderStyle>${borderStyle}</borderStyle>`);
      lines.push(`  <addIcon>${addIcon}</addIcon>`);
      lines.push(`  <addText>${addText}</addText>`);
      lines.push(`  <textSize>${textSize}</textSize>`);
    }
    if (elementType === "scrollbar") {
      lines.push(`  <scrollbarTrack>${sbTrack}</scrollbarTrack>`);
      lines.push(`  <scrollbarThumb>${sbThumb}</scrollbarThumb>`);
      lines.push(`  <scrollbarArrows>${sbArrows}</scrollbarArrows>`);
      lines.push(`  <scrollbarOrientation>${sbOrientation}</scrollbarOrientation>`);
    }
    if (elementType === "font" || elementType === "number") {
      lines.push(`  <fontChars>${fontChars || (elementType === "font" ? "A-Z" : "0-9")}</fontChars>`);
    }
    const fusionBrief = buildFusionBrief(styleFusion);
    if (fusionBrief) lines.push(`  <styleFusion>${fusionBrief}</styleFusion>`);
    lines.push(`  <generatedCount>${galleryResults.length}</generatedCount>`);
    lines.push(`</uilab>`);
    return lines.join("\n");
  }, [elementType, prompt, outputSize, useGrid, reenvision, buttonShape, borderStyle, addIcon, addText, textSize,
    sbTrack, sbThumb, sbArrows, sbOrientation, fontChars, styleFusion, galleryResults.length]);

  // Session persistence
  useSessionRegister(
    sessionKey,
    () => ({
      elementType, prompt, genCount, outputSize, matchRefDims, reenvision, addColor, noColor,
      useGrid, cellSize, buttonShape, borderStyle, addIcon, addText, textSize,
      sbTrack, sbThumb, sbArrows, sbOrientation, fontChars, styleFusion,
      styleLibraryFolder, sectionEnabled, layout, tabs, activeTab, modelId,
    }),
    (s: unknown) => {
      if (s === null) { handleReset(); return; }
      const d = s as Record<string, unknown>;
      if (typeof d.elementType === "string") setElementType(d.elementType);
      if (typeof d.prompt === "string") setPrompt(d.prompt);
      if (typeof d.genCount === "number") setGenCount(d.genCount);
      if (typeof d.outputSize === "string") setOutputSize(d.outputSize);
      if (typeof d.matchRefDims === "boolean") setMatchRefDims(d.matchRefDims);
      if (typeof d.reenvision === "boolean") setReenvision(d.reenvision);
      if (typeof d.addColor === "boolean") setAddColor(d.addColor);
      if (typeof d.noColor === "boolean") setNoColor(d.noColor);
      if (typeof d.useGrid === "boolean") setUseGrid(d.useGrid);
      if (typeof d.cellSize === "string") setCellSize(d.cellSize);
      if (typeof d.buttonShape === "string") setButtonShape(d.buttonShape);
      if (typeof d.borderStyle === "string") setBorderStyle(d.borderStyle);
      if (typeof d.addIcon === "boolean") setAddIcon(d.addIcon);
      if (typeof d.addText === "boolean") setAddText(d.addText);
      if (typeof d.textSize === "string") setTextSize(d.textSize);
      if (typeof d.sbTrack === "boolean") setSbTrack(d.sbTrack);
      if (typeof d.sbThumb === "boolean") setSbThumb(d.sbThumb);
      if (typeof d.sbArrows === "boolean") setSbArrows(d.sbArrows);
      if (typeof d.sbOrientation === "string") setSbOrientation(d.sbOrientation);
      if (typeof d.fontChars === "string") setFontChars(d.fontChars);
      if (d.styleFusion) setStyleFusion(d.styleFusion as StyleFusionState);
      if (typeof d.styleLibraryFolder === "string") setStyleLibraryFolder(d.styleLibraryFolder);
      if (d.sectionEnabled) setSectionEnabled(d.sectionEnabled as Partial<Record<SectionId, boolean>>);
      if (d.layout) setLayout(d.layout as LayoutState);
      if (Array.isArray(d.tabs)) setTabs(d.tabs as TabDef[]);
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.modelId === "string") setModelId(d.modelId);
    },
  );

  // Keyboard shortcuts (only when this project tab is active)
  const { registerAction, unregisterAction } = useShortcuts();
  useEffect(() => {
    if (!active) return;
    registerAction("uiGenerate", () => handleGenerate());
    registerAction("uiShowXml", () => setXmlOpen(true));
    return () => {
      for (const id of ["uiGenerate", "uiShowXml"]) unregisterAction(id);
    };
  }, [active, registerAction, unregisterAction, handleGenerate]);

  // --- Voice Director command listener ---
  const voiceCmdRef = useRef({
    generate: handleGenerate,
    clear_gallery: handleClearGallery,
    reset: handleReset,
  });
  voiceCmdRef.current = { generate: handleGenerate, clear_gallery: handleClearGallery, reset: handleReset };

  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const { action } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      const cmds = voiceCmdRef.current as Record<string, unknown>;
      if (action in cmds) {
        const fn = cmds[action];
        if (typeof fn === "function") fn();
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
      if (d._source_tool !== "uilab") return;
      if (typeof d.description === "string") setPrompt(d.description);
      if (typeof d.prompt === "string") setPrompt(d.prompt as string);
      if (typeof d.model === "string") setModelId(d.model as string);
    };
    window.addEventListener("gallery-restore", handler);
    return () => window.removeEventListener("gallery-restore", handler);
  }, [active]);

  useEffect(() => {
    if (active) {
      setCurrentImage(mainstageSrc || null);
    }
  }, [active, mainstageSrc, setCurrentImage]);

  useEffect(() => {
    if (active) {
      setAttributesContext(prompt || "");
    }
  }, [active, prompt, setAttributesContext]);

  useEffect(() => {
    if (active && appPage === "uilab") {
      setOnApplyFeedback(() => (suggestion: string) => {
        setPrompt((prev) => prev ? `${prev}\n${suggestion}` : suggestion);
      });
      return () => setOnApplyFeedback(null);
    }
  }, [active, appPage, setOnApplyFeedback]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderGenerateSection = () => {
    const showGridOptions = elementType !== "scrollbar" && elementType !== "font" && elementType !== "number";
    return (
      <>
        {/* Row 1: Element type + Count */}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Element Type</label>
            <Select
              options={ELEMENT_TYPE_OPTIONS}
              value={elementType}
              onChange={(e) => setElementType(e.target.value)}
              disabled={busy.any}
            />
          </div>
          <div className="shrink-0">
            <NumberStepper value={genCount} min={1} max={20} onChange={setGenCount} label="Count:" />
          </div>
        </div>

        {/* Row 2: Prompt */}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder='Describe the element — use "quotes" for button label text'
          disabled={busy.any}
          data-voice-target="uiPrompt"
        />
        <Button size="sm" className="w-full" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhancePrompt} title="Use AI to enrich and expand your element description">Enhance Description</Button>

        {/* Row 3: Output size + Color */}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>
              Output Size
              {useGrid && showGridOptions && <span className="font-normal ml-1" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>(single only)</span>}
            </label>
            <input
              className="w-full text-[11px] px-2 py-1 rounded"
              style={inputStyle}
              placeholder="1024×1024"
              value={outputSize}
              onChange={(e) => setOutputSize(e.target.value)}
              disabled={busy.any}
              title={useGrid && showGridOptions ? "Only applies to single image generation — 4×4 grid uses Cell Size instead" : "Output size (WxH), blank for 1024x1024"}
            />
          </div>
          <div className="flex items-center gap-3 shrink-0 pb-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={addColor} onChange={(e) => { setAddColor(e.target.checked); if (e.target.checked) setNoColor(false); }} disabled={busy.any} />
              <span className="text-[10px]" style={{ color: "var(--color-text-primary)" }}>Color</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={noColor} onChange={(e) => { setNoColor(e.target.checked); if (e.target.checked) setAddColor(false); }} disabled={busy.any} />
              <span className="text-[10px]" style={{ color: "var(--color-text-primary)" }}>Grayscale</span>
            </label>
          </div>
        </div>

        {/* Row 4: Style Library + Generation View side by side */}
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Style</label>
            <select
              className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] min-w-0 truncate"
              style={{ ...inputStyle, maxWidth: "100%" }}
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
          {showGridOptions && (
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>View</label>
              <select
                className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
                style={inputStyle}
                value={useGrid ? "grid" : "single"}
                onChange={(e) => setUseGrid(e.target.value === "grid")}
                disabled={busy.any}
              >
                <option value="grid">4×4 Grid (16 Variations)</option>
                <option value="single">Single Image</option>
              </select>
            </div>
          )}
        </div>

        {/* Row 5: Model selector */}
        {models.length > 0 && (
          <select
            className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
            style={{ ...inputStyle, maxWidth: "100%" }}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            title="AI model for generation"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label} — {m.resolution}</option>
            ))}
          </select>
        )}

        {/* Row 6: Cell size (grid mode only) */}
        {useGrid && showGridOptions && (
          <div>
            <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>
              Grid Cell Size (WxH)
              <span className="font-normal ml-1" style={{ opacity: 0.7 }}>— each cell in the 4×4 grid</span>
            </label>
            <input
              className="w-full text-[11px] px-2 py-1 rounded"
              style={inputStyle}
              placeholder="e.g. 256x256 (default)"
              value={cellSize}
              onChange={(e) => setCellSize(e.target.value)}
              disabled={busy.any}
              title="Size of each cell in the 4×4 grid (WxH), blank for 256x256"
            />
          </div>
        )}

        {/* Generate button */}
        <div className="pt-0.5">
          <Button
            variant="primary"
            className="w-full"
            size="lg"
            generating={busy.is("gen")}
            generatingText="Generating..."
            onClick={() => handleGenerate()}
            disabled={busy.is("gen")}
            title="Generate from current settings"
          >
            Generate Elements
          </Button>
        </div>
      </>
    );
  };

  const refMode = reenvision ? "reenvision" : matchRefDims ? "match" : "none";
  const handleRefModeChange = useCallback((mode: string) => {
    setMatchRefDims(mode === "match");
    setReenvision(mode === "reenvision");
  }, []);

  const REF_MODE_HINTS: Record<string, string> = {
    none: "Image used as visual context only — AI sees it but makes no dimensional or creative guarantees.",
    match: "AI will match the aspect ratio and dimensions of your reference image in its output.",
    reenvision: "AI reimagines the reference as a new element in your chosen style, preserving subject and composition.",
  };

  const renderRefImageSection = () => (
    <div className="space-y-2.5">
      <input ref={refFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleRefFileSelect} />

      {/* Drop-zone / preview area */}
      <div
        className="relative rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
        style={{
          minHeight: refImageB64 ? 80 : 72,
          background: refImageB64 ? "var(--color-input-bg)" : "transparent",
          border: refImageB64 ? "1px solid var(--color-border)" : "2px dashed var(--color-border)",
        }}
        onClick={refImageB64 ? undefined : handleRefOpen}
        title={refImageB64 ? "Reference loaded" : "Click to open a reference image"}
      >
        {refImageB64 ? (
          <div className="flex items-center gap-3 w-full p-2">
            <div className="shrink-0 rounded overflow-hidden" style={{ width: 64, height: 64 }}>
              <img src={`data:image/png;base64,${refImageB64}`} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium truncate" style={{ color: "var(--color-text-primary)" }}>Reference loaded</p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Used as {refMode === "reenvision" ? "re-envision source" : refMode === "match" ? "dimension reference" : "visual context"}</p>
            </div>
          </div>
        ) : (
          <>
            <ImagePlus className="h-5 w-5" style={{ color: "var(--color-text-muted)", opacity: 0.5 }} />
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Click to open or paste an image</span>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button onClick={handleRefOpen} className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded cursor-pointer transition-colors" style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>Open</button>
        <button onClick={handleRefPaste} className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded cursor-pointer transition-colors" style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>Paste</button>
        <button onClick={handleRefClear} className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }} disabled={!refImageB64}>Clear</button>
      </div>

      {/* Reference mode selector */}
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Use as Reference</label>
        <select
          className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
          style={inputStyle}
          value={refMode}
          onChange={(e) => handleRefModeChange(e.target.value)}
          disabled={!refImageB64 || busy.any}
        >
          <option value="none">Visual Context Only</option>
          <option value="match">Match Dimensions</option>
          <option value="reenvision">Re-envision</option>
        </select>
      </div>

      <p className="text-[9px] leading-snug" style={{ color: "var(--color-text-muted)" }}>
        {REF_MODE_HINTS[refMode]}
      </p>
    </div>
  );

  const renderButtonLayoutSection = () => (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Shape</label>
        <Select options={BUTTON_SHAPE_OPTIONS} value={buttonShape} onChange={(e) => setButtonShape(e.target.value)} disabled={busy.any} />
      </div>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Border</label>
        <Select options={BORDER_STYLE_OPTIONS} value={borderStyle} onChange={(e) => setBorderStyle(e.target.value)} disabled={busy.any} />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={addIcon} onChange={(e) => setAddIcon(e.target.checked)} disabled={busy.any} />
        <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>Add Icon</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={addText} onChange={(e) => setAddText(e.target.checked)} disabled={busy.any} />
        <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>Add Text</span>
      </label>
      {addText && (
        <div>
          <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Text Size Hint</label>
          <Select options={TEXT_SIZE_OPTIONS} value={textSize} onChange={(e) => setTextSize(e.target.value)} disabled={busy.any} />
        </div>
      )}
    </div>
  );

  const renderScrollbarSection = () => (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sbTrack} onChange={(e) => setSbTrack(e.target.checked)} disabled={busy.any} />
        <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>Track (background)</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sbThumb} onChange={(e) => setSbThumb(e.target.checked)} disabled={busy.any} />
        <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>Thumb (draggable handle)</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sbArrows} onChange={(e) => setSbArrows(e.target.checked)} disabled={busy.any} />
        <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>Up/Down arrow buttons</span>
      </label>
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Orientation</label>
        <Select
          options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }]}
          value={sbOrientation}
          onChange={(e) => setSbOrientation(e.target.value)}
          disabled={busy.any}
        />
      </div>
      <p className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Each checked component generates separately so you can mix and match.</p>
    </div>
  );

  const renderCharGenSection = () => (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Characters to generate</label>
        <input
          className="w-full text-[11px] px-2 py-1 rounded"
          style={inputStyle}
          placeholder={elementType === "font" ? "A-Z (default)" : "0-9 (default)"}
          value={fontChars}
          onChange={(e) => setFontChars(e.target.value)}
          disabled={busy.any}
          title="Specific characters, or blank for full set"
        />
      </div>
      <p className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Each character generates as a separate square image.</p>
    </div>
  );

  const renderStyleFusionSection = () => (
    <StyleFusionPanel
      fusion={styleFusion}
      onChange={setStyleFusion}
      takeOptions={TAKE_OPTIONS}
      disabled={busy.any}
    />
  );

  const renderSaveSection = () => (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="sm" className="w-full" onClick={() => setXmlOpen(true)} title="View UI Lab data as XML">Show XML</Button>
        <Button size="sm" className="w-full" onClick={handleClearGallery} title="Clear gallery">Clear Gallery</Button>
        <Button size="sm" className="w-full" onClick={handleReset} title="Clear all fields and images">Clear All</Button>
      </div>
    </div>
  );

  // Gallery is now rendered via the shared GridGallery component

  // ---------------------------------------------------------------------------
  // Style Library tab — full gallery browser
  // ---------------------------------------------------------------------------

  const [slFolders, setSlFolders] = useState<{ name: string; guidance_text: string; image_count: number; thumbnail: string | null; category: string }[]>([]);
  const [slSelectedFolder, setSlSelectedFolder] = useState<string | null>(null);
  const [slSubfolders, setSlSubfolders] = useState<string[]>([]);
  const [slActiveSub, setSlActiveSub] = useState("");
  const [slImages, setSlImages] = useState<{ filename: string; data_url: string; disabled: boolean }[]>([]);
  const [slGuidance, setSlGuidance] = useState("");
  const [slSelectedImage, setSlSelectedImage] = useState<string | null>(null);
  const [slPreview, setSlPreview] = useState<string | null>(null);
  const slGuidanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slFileInput = useRef<HTMLInputElement>(null);

  const loadSlFolders = useCallback(async () => {
    try {
      const res = await apiFetch<typeof slFolders>("/styles/folders?category=ui");
      setSlFolders(res);
      setStyleLibraryFolders(res.map((f) => ({ name: f.name, guidance_text: f.guidance_text })));
    } catch { /* */ }
  }, []);

  useEffect(() => { loadSlFolders(); }, [loadSlFolders]);

  const loadSlImages = useCallback(async (folder: string, sub: string) => {
    try {
      const qs = sub ? `?subfolder=${encodeURIComponent(sub)}` : "";
      const res = await apiFetch<typeof slImages>(`/styles/folders/${encodeURIComponent(folder)}/images${qs}`);
      setSlImages(res);
    } catch { setSlImages([]); }
  }, []);

  const loadSlSubfolders = useCallback(async (folder: string) => {
    try {
      const res = await apiFetch<string[]>(`/styles/folders/${encodeURIComponent(folder)}/subfolders`);
      setSlSubfolders(res);
    } catch { setSlSubfolders([]); }
  }, []);

  const handleSlSelectFolder = useCallback((name: string) => {
    setSlSelectedFolder(name);
    setSlActiveSub("");
    setSlSelectedImage(null);
    const f = slFolders.find((f) => f.name === name);
    setSlGuidance(f?.guidance_text ?? "");
    loadSlImages(name, "");
    loadSlSubfolders(name);
  }, [slFolders, loadSlImages, loadSlSubfolders]);

  const handleSlSelectSub = useCallback((sub: string) => {
    setSlActiveSub(sub);
    setSlSelectedImage(null);
    if (slSelectedFolder) loadSlImages(slSelectedFolder, sub);
  }, [slSelectedFolder, loadSlImages]);

  const handleSlNewFolder = useCallback(async () => {
    const name = window.prompt("New UI style folder name:");
    if (!name?.trim()) return;
    try {
      await apiFetch("/styles/folders", { method: "POST", body: JSON.stringify({ name: name.trim(), category: "ui" }) });
      await loadSlFolders();
      handleSlSelectFolder(name.trim());
    } catch (e) { console.error(e); }
  }, [loadSlFolders, handleSlSelectFolder]);

  const handleSlDeleteFolder = useCallback(async () => {
    if (!slSelectedFolder) return;
    if (!confirm(`Delete style folder "${slSelectedFolder}" and all its images?`)) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}`, { method: "DELETE" });
      setSlSelectedFolder(null);
      setSlImages([]);
      setSlSubfolders([]);
      setSlGuidance("");
      await loadSlFolders();
    } catch (e) { console.error(e); }
  }, [slSelectedFolder, loadSlFolders]);

  const handleSlRenameFolder = useCallback(async () => {
    if (!slSelectedFolder) return;
    const newName = window.prompt("Rename folder:", slSelectedFolder);
    if (!newName?.trim() || newName.trim() === slSelectedFolder) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}`, { method: "PATCH", body: JSON.stringify({ new_name: newName.trim() }) });
      setSlSelectedFolder(newName.trim());
      await loadSlFolders();
    } catch (e) { console.error(e); }
  }, [slSelectedFolder, loadSlFolders]);

  const handleSlGuidanceChange = useCallback((text: string) => {
    setSlGuidance(text);
    if (slGuidanceTimer.current) clearTimeout(slGuidanceTimer.current);
    slGuidanceTimer.current = setTimeout(async () => {
      if (!slSelectedFolder) return;
      try {
        await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}/guidance`, {
          method: "PUT", body: JSON.stringify({ guidance_text: text }),
        });
        await loadSlFolders();
      } catch { /* */ }
    }, 600);
  }, [slSelectedFolder, loadSlFolders]);

  const handleSlAddImages = useCallback(() => {
    if (!slSelectedFolder) { addToast("Select or create a folder first.", "info"); return; }
    slFileInput.current?.click();
  }, [slSelectedFolder, addToast]);

  const handleSlFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!slSelectedFolder || !e.target.files?.length) return;
    const items: { filename: string; data_url: string }[] = [];
    for (const file of Array.from(e.target.files)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file);
      });
      items.push({ filename: file.name, data_url: dataUrl });
    }
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}/images`, { method: "POST", body: JSON.stringify(items) });
      loadSlImages(slSelectedFolder, slActiveSub);
      loadSlFolders();
    } catch (err) { console.error(err); }
    e.target.value = "";
  }, [slSelectedFolder, slActiveSub, loadSlImages, loadSlFolders]);

  const handleSlRemoveImage = useCallback(async () => {
    if (!slSelectedFolder || !slSelectedImage) return;
    const qs = slActiveSub ? `?subfolder=${encodeURIComponent(slActiveSub)}` : "";
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}/images/${encodeURIComponent(slSelectedImage)}${qs}`, { method: "DELETE" });
      setSlSelectedImage(null);
      loadSlImages(slSelectedFolder, slActiveSub);
      loadSlFolders();
    } catch (e) { console.error(e); }
  }, [slSelectedFolder, slSelectedImage, slActiveSub, loadSlImages, loadSlFolders]);

  const handleSlToggleDisabled = useCallback(async (filename: string) => {
    if (!slSelectedFolder) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}/toggle-disabled`, {
        method: "POST", body: JSON.stringify({ filename, subfolder: slActiveSub }),
      });
      loadSlImages(slSelectedFolder, slActiveSub);
    } catch { /* */ }
  }, [slSelectedFolder, slActiveSub, loadSlImages]);

  const handleSlUseFolder = useCallback((folderName: string) => {
    setStyleLibraryFolder(folderName);
    setActiveTab("main");
    addToast(`Style "${folderName}" applied`, "success");
  }, [addToast]);

  // --- Context menu state ---
  interface CtxMenuItem { label: string; action: () => void; danger?: boolean }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    const dismissOnEscape = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [ctxMenu]);

  const handleSlPasteImage = useCallback(async () => {
    if (!slSelectedFolder) { addToast("Select a folder first", "info"); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob);
          });
          await apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder)}/images`, {
            method: "POST", body: JSON.stringify([{ filename: `pasted_${Date.now()}.png`, data_url: dataUrl }]),
          });
          loadSlImages(slSelectedFolder, slActiveSub);
          loadSlFolders();
          addToast("Image pasted", "success");
          return;
        }
      }
      addToast("No image on clipboard", "info");
    } catch { addToast("Could not read clipboard", "info"); }
  }, [slSelectedFolder, slActiveSub, loadSlImages, loadSlFolders, addToast]);

  const renderStyleLibraryTab = () => (
    <div className="flex h-full gap-0 overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Folder list */}
      <div className="flex flex-col shrink-0" style={{ width: 210, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}>
        <div className="flex items-center gap-1.5 px-3 shrink-0" style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-muted)" }}>UI Style Folders</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {slFolders.map((f) => (
            <button
              key={f.name}
              onClick={() => handleSlSelectFolder(f.name)}
              onDoubleClick={() => handleSlUseFolder(f.name)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors cursor-pointer"
              style={{
                background: slSelectedFolder === f.name ? "var(--color-hover)" : "transparent",
                color: slSelectedFolder === f.name ? "var(--color-foreground)" : "var(--color-text-secondary)",
                border: "none", borderBottom: "1px solid var(--color-border)",
              }}
              title={`Click to browse, double-click to use as active style\n${f.guidance_text || ""}`}
            >
              {f.thumbnail ? (
                <img src={f.thumbnail} alt="" className="shrink-0 rounded object-cover" style={{ width: 36, height: 36 }} />
              ) : (
                <div className="shrink-0 rounded flex items-center justify-center" style={{ width: 36, height: 36, background: "var(--color-hover)" }}>
                  <FolderOpen className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-[12px] font-medium truncate">{f.name}</span>
                  {styleLibraryFolder === f.name && (
                    <span className="shrink-0 px-1 rounded text-[7px] font-bold uppercase" style={{ background: "rgba(78,201,160,0.2)", color: "#4ec9a0", border: "1px solid rgba(78,201,160,0.3)" }}>Active</span>
                  )}
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {f.image_count} image{f.image_count !== 1 ? "s" : ""}
                </div>
              </div>
            </button>
          ))}
          {slFolders.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--color-text-muted)" }}>No UI style folders yet</div>
          )}
        </div>
        <div className="flex gap-1 px-2 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button onClick={handleSlNewFolder} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }} title="New Folder">
            <FolderPlus className="h-3.5 w-3.5" /> New
          </button>
          <button onClick={handleSlRenameFolder} disabled={!slSelectedFolder} className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleSlDeleteFolder} disabled={!slSelectedFolder} className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-hover)", color: "var(--color-destructive, #e55)", border: "none" }} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Trained Elements subfolders */}
      <div className="flex flex-col shrink-0" style={{ width: 160, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}>
        <div className="flex items-center px-3 shrink-0" style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Trained Elements</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {slSelectedFolder && (
            <button onClick={() => handleSlSelectSub("")} className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] transition-colors cursor-pointer"
              style={{ background: slActiveSub === "" ? "var(--color-hover)" : "transparent", color: slActiveSub === "" ? "var(--color-foreground)" : "var(--color-text-secondary)", border: "none", borderBottom: "1px solid var(--color-border)" }}>
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" /> Main Folder
            </button>
          )}
          {slSubfolders.map((sub) => {
            const display = sub.replace(/_styles$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return (
              <button key={sub} onClick={() => handleSlSelectSub(sub)} className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] transition-colors cursor-pointer"
                style={{ background: slActiveSub === sub ? "var(--color-hover)" : "transparent", color: slActiveSub === sub ? "var(--color-foreground)" : "var(--color-text-secondary)", border: "none", borderBottom: "1px solid var(--color-border)" }}>
                <FolderOpen className="h-3.5 w-3.5 shrink-0" /> {display}
              </button>
            );
          })}
          {!slSelectedFolder && (
            <div className="px-3 py-6 text-center text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>Select a folder to see trained elements</div>
          )}
          {slSelectedFolder && slSubfolders.length === 0 && (
            <div className="px-3 py-4 text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>Sub-folders created by generation appear here.</div>
          )}
        </div>
      </div>

      {/* Image grid + guidance */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--color-text-muted)" }}>
            {slSelectedFolder ? `Images — ${slSelectedFolder}${slActiveSub ? ` / ${slActiveSub.replace(/_styles$/, "")}` : ""}` : "Select a folder"}
          </span>
          <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-text-muted)" }}>{slSelectedFolder ? `${slImages.length}/16` : ""}</span>
          <button onClick={handleSlAddImages} disabled={!slSelectedFolder} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>
            <ImagePlus className="h-3.5 w-3.5" /> Add
          </button>
          <button onClick={handleSlRemoveImage} disabled={!slSelectedImage} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0" style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}>
            <X className="h-3.5 w-3.5" /> Remove
          </button>
          <div className="flex-1" />
          {slSelectedFolder && (
            <button onClick={() => handleSlUseFolder(slSelectedFolder)} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer shrink-0"
              style={{ background: styleLibraryFolder === slSelectedFolder ? "rgba(78,201,160,0.15)" : "var(--color-accent)", color: styleLibraryFolder === slSelectedFolder ? "#4ec9a0" : "var(--color-foreground)", border: styleLibraryFolder === slSelectedFolder ? "1px solid rgba(78,201,160,0.3)" : "none" }}>
              {styleLibraryFolder === slSelectedFolder ? "Active Style" : "Use This Style"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3" onContextMenu={(e) => {
          if (!slSelectedFolder) return;
          e.preventDefault();
          const menuItems: CtxMenuItem[] = [
            { label: "Add Images…", action: handleSlAddImages },
            { label: "Paste Image", action: handleSlPasteImage },
          ];
          setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
        }}>
          {!slSelectedFolder ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FolderOpen className="mx-auto mb-3 h-12 w-12" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>Select a style folder or create a new one</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>Double-click a folder to set it as the active generation style</p>
              </div>
            </div>
          ) : slImages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <ImagePlus className="mx-auto mb-3 h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px] mb-2" style={{ color: "var(--color-text-muted)" }}>No images in this folder</p>
                <button onClick={handleSlAddImages} className="text-[12px] px-3 py-1.5 rounded cursor-pointer" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>+ Add Images</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slImages.map((img) => (
                <div key={img.filename} className="relative group cursor-pointer rounded transition-all"
                  style={{ width: 104, height: 104, border: slSelectedImage === img.filename ? "2px solid var(--color-accent)" : "2px solid transparent", opacity: img.disabled ? 0.4 : 1 }}
                  onClick={() => setSlSelectedImage(img.filename === slSelectedImage ? null : img.filename)}
                  onDoubleClick={() => setSlPreview(img.data_url)}
                  onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); handleSlToggleDisabled(img.filename); } }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSlSelectedImage(img.filename);
                    const menuItems: CtxMenuItem[] = [
                      { label: "Preview", action: () => setSlPreview(img.data_url) },
                      { label: img.disabled ? "Enable" : "Disable", action: () => handleSlToggleDisabled(img.filename) },
                      { label: "Delete Image", action: () => {
                        setSlSelectedImage(img.filename);
                        const qs = slActiveSub ? `?subfolder=${encodeURIComponent(slActiveSub)}` : "";
                        apiFetch(`/styles/folders/${encodeURIComponent(slSelectedFolder!)}/images/${encodeURIComponent(img.filename)}${qs}`, { method: "DELETE" })
                          .then(() => { setSlSelectedImage(null); loadSlImages(slSelectedFolder!, slActiveSub); loadSlFolders(); });
                      }, danger: true },
                    ];
                    setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
                  }}
                  title={`${img.filename}${img.disabled ? " (disabled)" : ""}\nDouble-click to preview\nMiddle-click to toggle disabled`}>
                  <img src={img.data_url} alt={img.filename} className="w-full h-full object-cover rounded" draggable={false} />
                  {img.disabled && (
                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center py-0.5 rounded-b text-[8px] font-bold uppercase tracking-wider" style={{ background: "rgba(0,0,0,0.7)", color: "#ff3c3c" }}>Disabled</div>
                  )}
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); handleSlToggleDisabled(img.filename); }} className="p-0.5 rounded cursor-pointer" style={{ background: "rgba(0,0,0,0.7)", color: "#ccc", border: "none" }} title={img.disabled ? "Enable" : "Disable"}>
                      {img.disabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 truncate text-center text-[8px] py-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-b" style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-muted)" }}>
                    {img.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {slSelectedFolder && (
          <div className="shrink-0 px-3 py-2 flex items-start gap-2" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <span className="text-[11px] font-semibold shrink-0 pt-1" style={{ color: "var(--color-text-muted)" }}>Style Guidance:</span>
            <textarea value={slGuidance} onChange={(e) => handleSlGuidanceChange(e.target.value)}
              placeholder="Describe the visual style for Gemini… e.g. bold outlines, gritty 90s palette, halftone shading"
              className="flex-1 resize-none text-[12px] px-2 py-1.5 rounded outline-none"
              style={{ height: 52, background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
          </div>
        )}
      </div>

      <input ref={slFileInput} type="file" accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp" multiple className="hidden" onChange={handleSlFileChange} />

      {slPreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }} onClick={() => setSlPreview(null)}>
          <img src={slPreview} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setSlPreview(null)} className="absolute top-4 right-4 p-2 rounded-full cursor-pointer" style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "none" }}>
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // User Library tab — full folder + image browser
  // ---------------------------------------------------------------------------

  const [ulFolders, setUlFolders] = useState<{ name: string; image_count: number; thumbnail: string | null }[]>([]);
  const [ulSelectedFolder, setUlSelectedFolder] = useState<string | null>(null);
  const [ulImages, setUlImages] = useState<{ filename: string; data_url: string }[]>([]);
  const [ulSelectedImage, setUlSelectedImage] = useState<string | null>(null);
  const [ulPreview, setUlPreview] = useState<string | null>(null);
  const ulFileInput = useRef<HTMLInputElement>(null);

  const loadUlFolders = useCallback(async () => {
    try {
      const res = await apiFetch<typeof ulFolders>("/userlib/folders");
      setUlFolders(res);
    } catch { /* */ }
  }, []);

  useEffect(() => { loadUlFolders(); }, [loadUlFolders]);

  const loadUlImages = useCallback(async (folder: string) => {
    try {
      const res = await apiFetch<{ filename: string; data_url: string }[]>(`/userlib/folders/${encodeURIComponent(folder)}/images`);
      setUlImages(res);
    } catch { setUlImages([]); }
  }, []);

  const handleUlSelectFolder = useCallback((name: string) => {
    setUlSelectedFolder(name);
    setUlSelectedImage(null);
    loadUlImages(name);
  }, [loadUlImages]);

  const handleUlNewFolder = useCallback(async () => {
    const name = window.prompt("New user library folder name:");
    if (!name?.trim()) return;
    try {
      await apiFetch("/userlib/folders", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      await loadUlFolders();
      handleUlSelectFolder(name.trim());
    } catch (e) { console.error(e); }
  }, [loadUlFolders, handleUlSelectFolder]);

  const handleUlDeleteFolder = useCallback(async () => {
    if (!ulSelectedFolder) return;
    if (!confirm(`Delete user folder "${ulSelectedFolder}" and all its images?`)) return;
    try {
      await apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder)}`, { method: "DELETE" });
      setUlSelectedFolder(null);
      setUlImages([]);
      await loadUlFolders();
    } catch (e) { console.error(e); }
  }, [ulSelectedFolder, loadUlFolders]);

  const handleUlRenameFolder = useCallback(async () => {
    if (!ulSelectedFolder) return;
    const newName = window.prompt("Rename folder:", ulSelectedFolder);
    if (!newName?.trim() || newName.trim() === ulSelectedFolder) return;
    try {
      await apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder)}`, { method: "PATCH", body: JSON.stringify({ new_name: newName.trim() }) });
      setUlSelectedFolder(newName.trim());
      await loadUlFolders();
    } catch (e) { console.error(e); }
  }, [ulSelectedFolder, loadUlFolders]);

  const handleUlAddImages = useCallback(() => {
    if (!ulSelectedFolder) { addToast("Select or create a folder first.", "info"); return; }
    ulFileInput.current?.click();
  }, [ulSelectedFolder, addToast]);

  const handleUlFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!ulSelectedFolder || !e.target.files?.length) return;
    const items: { filename: string; data_url: string }[] = [];
    for (const file of Array.from(e.target.files)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file);
      });
      items.push({ filename: file.name, data_url: dataUrl });
    }
    try {
      await apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder)}/images`, { method: "POST", body: JSON.stringify(items) });
      loadUlImages(ulSelectedFolder);
      loadUlFolders();
    } catch (err) { console.error(err); }
    e.target.value = "";
  }, [ulSelectedFolder, loadUlImages, loadUlFolders]);

  const handleUlRemoveImage = useCallback(async () => {
    if (!ulSelectedFolder || !ulSelectedImage) return;
    try {
      await apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder)}/images/${encodeURIComponent(ulSelectedImage)}`, { method: "DELETE" });
      setUlSelectedImage(null);
      loadUlImages(ulSelectedFolder);
      loadUlFolders();
    } catch (e) { console.error(e); }
  }, [ulSelectedFolder, ulSelectedImage, loadUlImages, loadUlFolders]);

  const handleUlPasteImage = useCallback(async () => {
    if (!ulSelectedFolder) { addToast("Select a folder first", "info"); return; }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob);
          });
          await apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder)}/images`, {
            method: "POST", body: JSON.stringify([{ filename: `pasted_${Date.now()}.png`, data_url: dataUrl }]),
          });
          loadUlImages(ulSelectedFolder);
          loadUlFolders();
          addToast("Image pasted", "success");
          return;
        }
      }
      addToast("No image on clipboard", "info");
    } catch { addToast("Could not read clipboard", "info"); }
  }, [ulSelectedFolder, loadUlImages, loadUlFolders, addToast]);

  const renderUserLibraryTab = () => (
    <div className="flex h-full gap-0 overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Folder list */}
      <div className="flex flex-col shrink-0" style={{ width: 210, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}>
        <div className="flex items-center gap-1.5 px-3 shrink-0" style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-muted)" }}>User Folders</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {ulFolders.map((f) => (
            <button key={f.name} onClick={() => handleUlSelectFolder(f.name)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors cursor-pointer"
              style={{ background: ulSelectedFolder === f.name ? "var(--color-hover)" : "transparent", color: ulSelectedFolder === f.name ? "var(--color-foreground)" : "var(--color-text-secondary)", border: "none", borderBottom: "1px solid var(--color-border)" }}>
              {f.thumbnail ? (
                <img src={f.thumbnail} alt="" className="shrink-0 rounded object-cover" style={{ width: 36, height: 36 }} />
              ) : (
                <div className="shrink-0 rounded flex items-center justify-center" style={{ width: 36, height: 36, background: "var(--color-hover)" }}>
                  <FolderOpen className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium truncate">{f.name}</div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{f.image_count} image{f.image_count !== 1 ? "s" : ""}</div>
              </div>
            </button>
          ))}
          {ulFolders.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--color-text-muted)" }}>No user library folders yet</div>
          )}
        </div>
        <div className="flex gap-1 px-2 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button onClick={handleUlNewFolder} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }} title="New Folder">
            <FolderPlus className="h-3.5 w-3.5" /> New
          </button>
          <button onClick={handleUlRenameFolder} disabled={!ulSelectedFolder} className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleUlDeleteFolder} disabled={!ulSelectedFolder} className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: "var(--color-hover)", color: "var(--color-destructive, #e55)", border: "none" }} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Image grid */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--color-text-muted)" }}>
            {ulSelectedFolder ? `Images — ${ulSelectedFolder}` : "Select a folder"}
          </span>
          <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-text-muted)" }}>{ulSelectedFolder ? `${ulImages.length}/50` : ""}</span>
          <button onClick={handleUlAddImages} disabled={!ulSelectedFolder} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>
            <ImagePlus className="h-3.5 w-3.5" /> Add
          </button>
          <button onClick={handleUlRemoveImage} disabled={!ulSelectedImage} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0" style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}>
            <X className="h-3.5 w-3.5" /> Remove
          </button>
          <div className="flex-1" />
        </div>

        <div className="flex-1 overflow-y-auto p-3" onContextMenu={(e) => {
          if (!ulSelectedFolder) return;
          e.preventDefault();
          const menuItems: CtxMenuItem[] = [
            { label: "Add Images…", action: handleUlAddImages },
            { label: "Paste Image", action: handleUlPasteImage },
          ];
          setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
        }}>
          {!ulSelectedFolder ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FolderOpen className="mx-auto mb-3 h-12 w-12" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>Select a user folder or create a new one</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>Personal reference library for organizing your UI assets</p>
              </div>
            </div>
          ) : ulImages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <ImagePlus className="mx-auto mb-3 h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px] mb-2" style={{ color: "var(--color-text-muted)" }}>No images in this folder</p>
                <button onClick={handleUlAddImages} className="text-[12px] px-3 py-1.5 rounded cursor-pointer" style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}>+ Add Images</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ulImages.map((img) => (
                <div key={img.filename} className="relative group cursor-pointer rounded transition-all"
                  style={{ width: 104, height: 104, border: ulSelectedImage === img.filename ? "2px solid var(--color-accent)" : "2px solid transparent" }}
                  onClick={() => setUlSelectedImage(img.filename === ulSelectedImage ? null : img.filename)}
                  onDoubleClick={() => setUlPreview(img.data_url)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setUlSelectedImage(img.filename);
                    const menuItems: CtxMenuItem[] = [
                      { label: "Preview", action: () => setUlPreview(img.data_url) },
                      { label: "Delete Image", action: () => {
                        apiFetch(`/userlib/folders/${encodeURIComponent(ulSelectedFolder!)}/images/${encodeURIComponent(img.filename)}`, { method: "DELETE" })
                          .then(() => { setUlSelectedImage(null); loadUlImages(ulSelectedFolder!); loadUlFolders(); });
                      }, danger: true },
                    ];
                    setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems });
                  }}
                  title={`${img.filename}\nDouble-click to preview`}>
                  <img src={img.data_url} alt={img.filename} className="w-full h-full object-cover rounded" draggable={false} />
                  <div className="absolute bottom-0 left-0 right-0 truncate text-center text-[8px] py-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-b" style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-muted)" }}>
                    {img.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <input ref={ulFileInput} type="file" accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp" multiple className="hidden" onChange={handleUlFileChange} />

      {ulPreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }} onClick={() => setUlPreview(null)}>
          <img src={ulPreview} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setUlPreview(null)} className="absolute top-4 right-4 p-2 rounded-full cursor-pointer" style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "none" }}>
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
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
          if (!isSectionRelevant(sectionId)) return null;

          const collapsed = isSectionCollapsed(sectionId);
          const canCollapse = !NON_COLLAPSIBLE.has(sectionId);
          const canToggle = TOGGLEABLE_SECTIONS.has(sectionId);
          const enabled = isSectionEnabled(sectionId);
          const label = SECTION_LABELS[sectionId];
          const sectionColor = getSectionColor("uilab", sectionId);

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
                    title={enabled ? "This panel is ON. Click to turn off." : "This panel is OFF. Click to turn on."}
                  >
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}
              </div>
              {!collapsed && <div className="px-3 pt-1 pb-3 space-y-2 overflow-hidden">{children}</div>}
            </div>
          );

          if (sectionId === "generate") return wrapSection(renderGenerateSection());
          if (sectionId === "refImage") return wrapSection(renderRefImageSection());
          if (sectionId === "buttonLayout") return wrapSection(renderButtonLayoutSection());
          if (sectionId === "scrollbarParts") return wrapSection(renderScrollbarSection());
          if (sectionId === "charGen") return wrapSection(renderCharGenSection());
          if (sectionId === "styleFusion") return wrapSection(renderStyleFusionSection());
          if (sectionId === "saveOptions") return wrapSection(renderSaveSection());
          return null;
        })}

        {customSections.sections.map((cs) => {
          const csCollapsed = customSections.isCollapsed(cs.id);
          const csEnabled = customSections.isEnabled(cs.id);
          const csColor = cs.color || getSectionColor("uilab", `custom:${cs.id}`);
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

        <ThreeDGenSidebar getViewImages={getViewImagesForThreeD} toolLabel="UI" />
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Tab bar + quick actions */}
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

        {/* Content area */}
        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === "main" && (
            <div className="flex h-full overflow-hidden">
              <div className="flex-1 min-w-0 h-full relative">
                <input ref={mainstageFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleMainstageFileSelect} />
                <ImageViewer
                  src={mainstageSrc}
                  placeholder="No image loaded — generate or send an image from the 4×4 Grid"
                  locked={busy.any}
                  onSaveImage={handleMainstageSave}
                  onCopyImage={handleMainstageCopy}
                  onPasteImage={handleMainstagePaste}
                  onOpenImage={handleMainstageOpen}
                  onClearImage={handleMainstageClear}
                  onImageEdited={handleMainstageImageEdited}
                  refImages={editorRefImagesB64}
                  styleContext={styleLibraryFolder || ""}
                  isFavorited={mainstageSrc ? isFavorited(mainstageSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
                  onToggleFavorite={mainstageSrc ? () => { const b64 = mainstageSrc.replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "uilab", label: "main", source: "viewer" }); } : undefined}
                />
                <ArtDirectorWidget onOpenConfig={() => setArtDirectorConfigOpen(true)} />
              </div>
              {mainstageHistory.length > 0 && (
                <div className="w-[220px] shrink-0 overflow-y-auto p-2" style={{ borderLeft: "1px solid var(--color-border)" }}>
                  <EditHistory
                    entries={mainstageHistory}
                    activeEntryId={mainstageHistoryActiveId}
                    onRestore={handleMainstageHistoryRestore}
                    onRestoreCurrent={handleMainstageHistoryRestoreCurrent}
                    onClearHistory={handleMainstageHistoryClear}
                    defaultOpen
                  />
                </div>
              )}
            </div>
          )}
          {activeTab === "grid" && (
            <GridGallery
              results={galleryResults}
              title="UI Generator Results"
              toolLabel="element"
              generating={busy.is("gen")}
              emptyMessage="No results yet. Configure settings and click Generate Elements."
              onDelete={handleDeleteResult}
              onCopy={handleGridCopy}
              onEditSubmit={handleGridEdit}
              onRegenerate={handleGridRegenerate}
              onUpdateImage={handleGridUpdateImage}
              onSendToMainstage={handleSendToMainstage}
              editBusy={gridEditBusy}
              showStyleLibrary
              styleLibraryFolders={slFolders.map((f) => ({ name: f.name }))}
              onRefreshStyleFolders={loadSlFolders}
              isFavorited={(b64) => isFavorited(b64)}
              onToggleFavorite={(id, b64, w, h) => {
                if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); }
                else {
                  const cell = galleryResults.find((r) => r.id === id);
                  const favLabel = cell?.label ? `Grid ${cell.label}` : `grid-${id}`;
                  addFavorite({ image_b64: b64, tool: "uilab", label: favLabel, prompt: "", source: "grid", width: w, height: h });
                }
              }}
            />
          )}
          {activeTab === "artboard" && <ArtboardCanvas />}
          {activeTab === "deepSearch" && <DeepSearchPanel onSendToArtboard={handleSendSearchToArtboard} isActivePage={active} />}
          {activeTab === "styleLib" && renderStyleLibraryTab()}
          {activeTab === "userLib" && renderUserLibraryTab()}
          {isRefTab && (
            <ImageViewer
              src={refImages[activeTab] || null}
              imageCount={refImages[activeTab] ? 1 : 0}
              imageIndex={0}
              onClearImage={() => setRefImages((prev) => { const n = { ...prev }; delete n[activeTab]; return n; })}
              locked={false}
              isFavorited={refImages[activeTab] ? isFavorited(refImages[activeTab].replace(/^data:image\/\w+;base64,/, "")) : false}
              onToggleFavorite={refImages[activeTab] ? () => { const b64 = refImages[activeTab].replace(/^data:image\/\w+;base64,/, ""); if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); } else addFavorite({ image_b64: b64, tool: "uilab", label: "main", source: "viewer" }); } : undefined}
            />
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[9999] py-1 rounded-md shadow-lg min-w-[140px]"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
          }}
          onClick={() => setCtxMenu(null)}
        >
          {ctxMenu.items.map((item, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); item.action(); setCtxMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-[12px] transition-colors cursor-pointer"
              style={{
                background: "transparent",
                border: "none",
                color: item.danger ? "var(--color-destructive, #e55)" : "var(--color-text-primary)",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--color-hover)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* XML Modal */}
      {xmlOpen && <XmlModal xml={xmlContent} title="UI Lab XML" onClose={() => setXmlOpen(false)} />}
      <ArtDirectorConfigModal open={artDirectorConfigOpen} onClose={() => setArtDirectorConfigOpen(false)} />
    </div>
  );
}
