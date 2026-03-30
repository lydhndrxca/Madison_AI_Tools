import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Card, Button, Textarea, Select, NumberStepper } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { GroupedTabBar } from "@/components/shared/TabBar";
import type { TabDef } from "@/components/shared/TabBar";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useModels, type ModelInfo } from "@/hooks/ModelsContext";
import { useFavorites } from "@/hooks/FavoritesContext";
import { useSessionRegister, useSessionContext } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { XmlModal } from "@/components/shared/XmlModal";
import { ArtDirectorWidget } from "@/components/shared/ArtDirectorWidget";
import { ArtDirectorConfigModal } from "@/components/shared/ArtDirectorConfigModal";
import { useArtDirector } from "@/hooks/ArtDirectorContext";
import { useActivePage } from "@/hooks/ActivePageContext";
import { DeepSearchPanel } from "@/components/shared/DeepSearchPanel";
import type { SearchResult } from "@/components/shared/DeepSearchPanel";
import { ThreeDGenSidebar } from "@/components/shared/ThreeDGenSidebar";
import type { ViewImage } from "@/components/shared/ThreeDGenSidebar";
import {
  GripVertical, ChevronRight, ChevronDown, Save, X, Plus, Pencil, Trash2,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────── */

interface EditEntry { timestamp: string; prompt: string; isOriginal?: boolean; }

/* ── Weapon Library ─────────────────────────────────────────── */

interface WeaponDef {
  id: string;
  name: string;
  category: string;
}

const DEFAULT_LIBRARY: WeaponDef[] = [
  { id: "ar15", name: "AR-15", category: "Rifle" },
  { id: "ak47", name: "AK-47", category: "Rifle" },
  { id: "m4a1", name: "M4A1 Carbine", category: "Rifle" },
  { id: "scar_h", name: "SCAR-H", category: "Rifle" },
  { id: "m16a4", name: "M16A4", category: "Rifle" },
  { id: "g36c", name: "G36C", category: "Rifle" },
  { id: "famas", name: "FAMAS", category: "Rifle" },
  { id: "aug_a3", name: "AUG A3", category: "Rifle" },
  { id: "mp5", name: "MP5", category: "SMG" },
  { id: "ump45", name: "UMP-45", category: "SMG" },
  { id: "p90", name: "P90", category: "SMG" },
  { id: "vector", name: "KRISS Vector", category: "SMG" },
  { id: "m870", name: "Remington 870", category: "Shotgun" },
  { id: "spas12", name: "SPAS-12", category: "Shotgun" },
  { id: "m1014", name: "M1014", category: "Shotgun" },
  { id: "m1911", name: "M1911", category: "Pistol" },
  { id: "glock17", name: "Glock 17", category: "Pistol" },
  { id: "deagle", name: "Desert Eagle", category: "Pistol" },
  { id: "p226", name: "SIG P226", category: "Pistol" },
  { id: "m24", name: "M24 SWS", category: "Sniper" },
  { id: "awm", name: "AWM", category: "Sniper" },
  { id: "barrett", name: "Barrett M82", category: "Sniper" },
  { id: "rpg7", name: "RPG-7", category: "Launcher" },
  { id: "m249", name: "M249 SAW", category: "LMG" },
  { id: "katana", name: "Katana", category: "Melee" },
  { id: "combat_knife", name: "Combat Knife", category: "Melee" },
  { id: "bat", name: "Baseball Bat", category: "Melee" },
];

const LIBRARY_KEY = "madison-weapon-library";

function loadLibrary(): WeaponDef[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return JSON.parse(raw) as WeaponDef[];
  } catch { /* */ }
  return [...DEFAULT_LIBRARY];
}

function saveLibrary(lib: WeaponDef[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

/* ── Weapon Library Editor Modal ───────────────────────────── */

function WeaponLibraryModal({
  library,
  onSave,
  onClose,
}: {
  library: WeaponDef[];
  onSave: (lib: WeaponDef[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<WeaponDef[]>(() => [...library]);
  const [bulkText, setBulkText] = useState("");
  const [bulkCategory, setBulkCategory] = useState("Rifle");

  const addItem = () => {
    const id = `custom_${Date.now()}`;
    setItems((prev) => [...prev, { id, name: "", category: "Rifle" }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((w) => w.id !== id));
  };

  const updateItem = (id: string, field: keyof WeaponDef, value: string) => {
    setItems((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: value } : w)));
  };

  const handleBulkAdd = () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const newItems = lines.map((name) => ({
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      category: bulkCategory,
    }));
    setItems((prev) => [...prev, ...newItems]);
    setBulkText("");
  };

  const handleSave = () => {
    onSave(items.filter((w) => w.name.trim()));
    onClose();
  };

  const handleRestoreDefaults = () => {
    setItems([...DEFAULT_LIBRARY]);
  };

  const categories = [...new Set(items.map((w) => w.category).filter(Boolean))].sort();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-[560px] max-h-[80vh] flex flex-col rounded-lg" style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Edit Weapon Library</h3>
          <button onClick={onClose} className="p-1 rounded cursor-pointer" style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {categories.map((cat) => {
            const catItems = items.filter((w) => w.category === cat);
            if (catItems.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>{cat}</p>
                <div className="space-y-1">
                  {catItems.map((w) => (
                    <div key={w.id} className="flex items-center gap-2">
                      <input
                        className="flex-1 px-2 py-1 text-xs rounded"
                        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                        value={w.name}
                        onChange={(e) => updateItem(w.id, "name", e.target.value)}
                        placeholder="Weapon name..."
                      />
                      <select
                        className="px-2 py-1 text-xs rounded"
                        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                        value={w.category}
                        onChange={(e) => updateItem(w.id, "category", e.target.value)}
                      >
                        {["Rifle", "SMG", "Shotgun", "Pistol", "Sniper", "Launcher", "LMG", "Melee", "Fantasy", "Sci-Fi", "Other"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeItem(w.id)}
                        className="p-1 rounded cursor-pointer"
                        style={{ background: "transparent", border: "none", color: "#ef4444" }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>Bulk Add (one per line)</p>
            <div className="flex gap-2 mb-1">
              <select
                className="px-2 py-1 text-xs rounded"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
              >
                {["Rifle", "SMG", "Shotgun", "Pistol", "Sniper", "Launcher", "LMG", "Melee", "Fantasy", "Sci-Fi", "Other"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <textarea
              className="w-full px-2 py-1.5 text-xs rounded"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", resize: "vertical" }}
              rows={4}
              placeholder={"Paste weapon names here, one per line:\nM4A1\nAK-47\nMP5"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <Button size="sm" className="w-full mt-1" onClick={handleBulkAdd} disabled={!bulkText.trim()}>
              <Plus className="h-3 w-3 mr-1" /> Add All
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={handleRestoreDefaults}
            className="text-[10px] px-2 py-1 rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
          >
            Restore Defaults
          </button>
          <button
            onClick={addItem}
            className="text-[10px] px-2 py-1 rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            <Plus className="h-3 w-3 inline mr-0.5" /> Add Single
          </button>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save Library</Button>
        </div>
      </div>
    </div>
  );
}

/* ── Tab model ─────────────────────────────────────────────── */

const BUILTIN_TABS: TabDef[] = [
  { id: "main", label: "Main Stage", group: "stage" },
  { id: "threequarter", label: "3/4", group: "views" },
  { id: "front", label: "Front", group: "views" },
  { id: "back", label: "Back", group: "views" },
  { id: "side", label: "Side", group: "views" },
  { id: "top", label: "Top", group: "views" },
  { id: "bottom", label: "Bottom", group: "views" },
  { id: "deepSearch", label: "Deep Search", group: "search" },
];

const VIEW_TYPE_MAP: Record<string, string> = {
  main: "main", threequarter: "threequarter", front: "front", back: "back", side: "side", top: "top", bottom: "bottom",
};

/* ── Constants ─────────────────────────────────────────────── */

const COMPONENTS = ["Receiver", "Barrel", "Stock", "Grip", "Magazine", "Optic", "Muzzle", "Markings"];
const FINISHES = ["Blued Steel", "Parkerized", "Nickel Plated", "Stainless", "Cerakote", "Anodized", "Painted"].map((v) => ({ value: v, label: v }));
const CONDITIONS = ["1 - Factory New", "2 - Light Wear", "3 - Service Used", "4 - Heavily Worn", "5 - Damaged"].map((v) => ({ value: v, label: v }));

/* ── Layout system ─────────────────────────────────────────── */

type SectionId = "generate" | "weaponLibrary" | "identity" | "components" | "threeDGen" | "multiview" | "saveOptions";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "weaponLibrary", "identity", "components", "threeDGen", "multiview", "saveOptions",
];

const SECTION_LABELS: Record<SectionId, string> = {
  generate: "Generate Weapon Image",
  weaponLibrary: "Weapon Library",
  identity: "Weapon Identity",
  components: "Weapon Components",
  threeDGen: "3D Gen AI",
  multiview: "Multi-View Generation",
  saveOptions: "Save Options",
};

const SECTION_TIPS: Record<SectionId, string> = {
  generate: "Generate new images, extract details from images, or enhance descriptions.",
  weaponLibrary: "Quick-select weapons from your library or edit the library.",
  identity: "Name, material finish, and condition of the weapon.",
  components: "Detailed component breakdown — receiver, barrel, stock, etc.",
  threeDGen: "Generate 3D models from your views using Meshy and Hitem3D.",
  multiview: "Generate consistent views from the main stage image.",
  saveOptions: "Save images, send to Photoshop, export XML, or clear your session.",
};

const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["identity", "components", "threeDGen"]);

interface LayoutState { order: SectionId[]; collapsed: Partial<Record<SectionId, boolean>>; hidden?: SectionId[] }

function loadDefaultLayout(storageKey: string): LayoutState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set<SectionId>(DEFAULT_SECTION_ORDER);
      const order = parsed.order.filter((id) => allIds.has(id)) as SectionId[];
      for (const id of DEFAULT_SECTION_ORDER) { if (!order.includes(id)) order.push(id); }
      return { order, collapsed: parsed.collapsed ?? {}, hidden: parsed.hidden };
    }
  } catch { /* */ }
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { components: true, threeDGen: true, saveOptions: true } };
}

/* ── Busy helper ───────────────────────────────────────────── */

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

/* ── Main component ────────────────────────────────────────── */

interface WeaponPageProps { instanceId?: number; active?: boolean; projectUid?: string }

export function WeaponPage({ instanceId = 0, active = true, projectUid }: WeaponPageProps) {
  const stableId = projectUid ?? String(instanceId);
  const layoutStorageKey = `madison-weapon-layout-${stableId}`;
  const sessionKey = `weapon-${stableId}`;

  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [activeTab, setActiveTab] = useState("main");
  const busy = useBusySet();
  const [genText, setGenText] = useState<Record<string, string>>({});
  const textBusy = busy.is("extract") || busy.is("enhance");

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});

  const [editText, setEditText] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);
  const [weaponName, setWeaponName] = useState("");
  const [finish, setFinish] = useState("Blued Steel");
  const [condition, setCondition] = useState("1 - Factory New");
  const [components, setComponents] = useState<Record<string, string>>(
    Object.fromEntries(COMPONENTS.map((c) => [c, ""])),
  );
  const { models, defaultModelId } = useModels();
  const [modelId, setModelId] = useState("");
  const [multiviewModel, setMultiviewModel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const [artDirectorConfigOpen, setArtDirectorConfigOpen] = useState(false);
  const { setCurrentImage, setAttributesContext, setOnApplyFeedback } = useArtDirector();
  const appPage = useActivePage();

  // Style library
  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);

  // Weapon library
  const [library, setLibrary] = useState<WeaponDef[]>(() => loadLibrary());
  const [libraryOpen, setLibraryOpen] = useState(false);

  const handleSaveLibrary = useCallback((lib: WeaponDef[]) => {
    setLibrary(lib);
    saveLibrary(lib);
    addToast("Weapon library saved", "success");
  }, [addToast]);

  const handleSelectWeapon = useCallback((w: WeaponDef) => {
    setWeaponName(w.name);
  }, []);

  // Layout
  const [layout, setLayout] = useState<LayoutState>(() => loadDefaultLayout(layoutStorageKey));
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);
  const dragItemRef = useRef<SectionId | null>(null);

  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({ identity: true, components: true, threeDGen: true });
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
        const newOrder = [...prev.order];
        const fi = newOrder.indexOf(from);
        const ti = newOrder.indexOf(targetId);
        if (fi >= 0 && ti >= 0) { newOrder.splice(fi, 1); newOrder.splice(ti, 0, from); }
        return { ...prev, order: newOrder };
      });
    }
    setDragOverId(null);
    dragItemRef.current = null;
  }, []);
  const handleDragEnd = useCallback(() => { setDragOverId(null); dragItemRef.current = null; }, []);

  const handleSetDefaultLayout = useCallback(() => {
    const collapsed: Partial<Record<SectionId, boolean>> = {};
    for (const id of layout.order) { if (NON_COLLAPSIBLE.has(id)) continue; collapsed[id] = isSectionCollapsed(id); }
    localStorage.setItem(layoutStorageKey, JSON.stringify({ order: layout.order, collapsed, hidden: layout.hidden }));
    addToast("Layout saved as default", "success");
  }, [layout.order, layout.hidden, isSectionCollapsed, addToast, layoutStorageKey]);

  useEffect(() => {
    if (defaultModelId && !modelId) setModelId(defaultModelId);
  }, [defaultModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiFetch<{ name: string; guidance_text: string }[]>("/styles/folders?category=general").then((folders) => {
      setStyleLibraryFolders(folders);
    }).catch(() => {});
  }, []);

  // Image helpers
  const currentImages = gallery[activeTab] || [];
  const currentIdx = imageIdx[activeTab] ?? 0;
  const currentSrc = currentImages[currentIdx] ?? null;
  const activeTabDef = tabs.find((t) => t.id === activeTab);

  const setTabImage = useCallback((tab: string, src: string) => {
    setGallery((prev) => ({ ...prev, [tab]: [src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: 0 }));
  }, []);

  const getMainB64 = useCallback(() => {
    const imgs = gallery["main"] || [];
    const src = imgs[imageIdx["main"] ?? 0];
    return src ? src.replace(/^data:image\/\w+;base64,/, "") : null;
  }, [gallery, imageIdx]);

  // View images for 3D
  const getViewImagesForThreeD = useCallback((): ViewImage[] => {
    const out: ViewImage[] = [];
    for (const tab of BUILTIN_TABS) {
      const imgs = gallery[tab.id] || [];
      const src = imgs[imageIdx[tab.id] ?? 0];
      if (!src) continue;
      const m = /^data:([^;]+);base64,(.+)$/.exec(src);
      if (!m) continue;
      out.push({ viewKey: tab.id, label: tab.label, base64: m[2], mimeType: m[1] });
    }
    return out;
  }, [gallery, imageIdx]);

  // Actions
  const handleGenerate = useCallback(async () => {
    if (!editPrompt.trim() && !weaponName.trim()) return;
    busy.start("generate");
    setGenText((p) => ({ ...p, generate: "Generating weapon..." }));
    try {
      const mainB64 = getMainB64();
      const isEdit = mainB64 && editPrompt.trim();
      const styleFolder = styleLibraryFolders.find((f) => f.name === styleLibraryFolder);
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        isEdit ? "/weapon/edit" : "/weapon/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: editPrompt || `Generate a detailed ${weaponName} concept art`,
            weapon_name: weaponName, components, material_finish: finish, condition,
            view_type: "main", reference_image_b64: mainB64,
            edit_prompt: isEdit ? editPrompt : undefined,
            mode: "quality", model_id: modelId || undefined,
            style_guidance: styleFolder?.guidance_text || undefined,
          }),
        },
      );
      if (resp.image_b64) {
        setTabImage("main", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: (editPrompt || "Initial generation").slice(0, 60), isOriginal: prev.length === 0 }, ...prev]);
        addToast("Weapon generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("generate");
  }, [editPrompt, weaponName, components, finish, condition, modelId, styleLibraryFolder, styleLibraryFolders, getMainB64, setTabImage, addToast, busy]);

  const handleExtract = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!mainB64) return;
    busy.start("extract");
    try {
      const resp = await apiFetch<{ text: string | null; error: string | null }>("/weapon/extract-attributes", { method: "POST", body: JSON.stringify({ prompt: "", image_b64: mainB64 }) });
      if (resp.text) {
        const lines = resp.text.split("\n");
        const newComps = { ...components };
        const descLines: string[] = [];
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
    const mvModel = multiviewModel || modelId;
    const promises = views.map((view) =>
      apiFetch<{ image_b64: string | null; width: number; height: number }>("/weapon/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: editText || `Detailed ${weaponName} weapon concept`,
          weapon_name: weaponName, components, material_finish: finish, condition,
          view_type: view, reference_image_b64: mainB64,
          mode: "quality", model_id: mvModel || undefined,
        }),
      }).then((resp) => ({ ok: true as const, resp, view }))
        .catch(() => ({ ok: false as const, resp: null, view })),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.ok && r.resp?.image_b64) setTabImage(r.view, `data:image/png;base64,${r.resp.image_b64}`);
    }
    busy.end("allviews");
  }, [editText, weaponName, components, finish, condition, modelId, multiviewModel, getMainB64, setTabImage, busy]);

  const handleGenerateSelectedView = useCallback(async () => {
    const mainB64 = getMainB64();
    if (!mainB64 || activeTab === "main" || activeTab.startsWith("ref")) return;
    const viewType = VIEW_TYPE_MAP[activeTab] || activeTab;
    busy.start("selview");
    const mvModel = multiviewModel || modelId;
    setGenText((p) => ({ ...p, selview: `Generating ${activeTabDef?.label || activeTab}...` }));
    try {
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number }>("/weapon/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: editText || `Detailed ${weaponName} weapon concept`,
          weapon_name: weaponName, components, material_finish: finish, condition,
          view_type: viewType, reference_image_b64: mainB64,
          mode: "quality", model_id: mvModel || undefined,
        }),
      });
      if (resp.image_b64) setTabImage(activeTab, `data:image/png;base64,${resp.image_b64}`);
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("selview");
  }, [editText, weaponName, components, finish, condition, modelId, multiviewModel, activeTab, activeTabDef, getMainB64, setTabImage, addToast, busy]);

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

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc; a.download = `weapon_${activeTab}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  useClipboardPaste(useCallback((dataUrl: string) => setTabImage(activeTab, dataUrl), [activeTab, setTabImage]));

  const handlePasteImage = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) setTabImage(activeTab, dataUrl);
      else addToast("No image found in clipboard", "error");
    } catch (err) { addToast(`Paste failed: ${err instanceof Error ? err.message : String(err)}`, "error"); }
  }, [activeTab, setTabImage, addToast]);

  const handleClearRef = useCallback(() => {
    if (activeTab.startsWith("ref")) { setGallery((prev) => ({ ...prev, [activeTab]: [] })); setImageIdx((prev) => ({ ...prev, [activeTab]: 0 })); }
  }, [activeTab]);

  const handleReset = useCallback(() => {
    setGallery({}); setImageIdx({}); setEditHistory([]); setEditText(""); setEditPrompt(""); setWeaponName("");
    setComponents(Object.fromEntries(COMPONENTS.map((c) => [c, ""])));
    setTabs(BUILTIN_TABS); setActiveTab("main");
  }, []);

  const handleSendToPS = useCallback(async () => {
    if (!currentSrc) { addToast("No image to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images: [{ label: `weapon_${activeTab}`, image_b64: currentSrc }] }) },
      );
      if (resp.ok) addToast(resp.results[0]?.message || "Sent to Photoshop", "success");
      else addToast(resp.results[0]?.message || "Failed to send", "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [currentSrc, activeTab, addToast]);

  const handleSendAllToPS = useCallback(async () => {
    const images: { label: string; image_b64: string }[] = [];
    for (const tab of BUILTIN_TABS) {
      const imgs = gallery[tab.id] || [];
      const src = imgs[imageIdx[tab.id] ?? 0];
      if (src) images.push({ label: `weapon_${tab.id}`, image_b64: src });
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

  const isRefTab = activeTab.startsWith("ref");
  const handleAddRef = useCallback(() => {
    const existing = tabs.filter((t) => t.group === "refs");
    const nextLetter = String.fromCharCode(65 + existing.length);
    const id = `ref${nextLetter.toLowerCase()}`;
    setTabs((prev) => [...prev, { id, label: `Ref ${nextLetter}`, group: "refs" }]);
    setActiveTab(id);
  }, [tabs]);
  const handleRemoveRef = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setGallery((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    setImageIdx((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    if (activeTab === tabId) setActiveTab("main");
  }, [activeTab]);

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
    for (const [key, val] of Object.entries(components)) { if (val) lines.push(`    <${key}>${esc(val)}</${key}>`); }
    lines.push("  </Components>");
    lines.push("</Weapon>");
    return lines.filter((l) => l).join("\n");
  }, [weaponName, editText, finish, condition, components]);

  // Session register
  useSessionRegister(
    sessionKey,
    () => ({ activeTab, tabs, editText, editPrompt, weaponName, finish, condition, components, gallery, imageIdx, editHistory, modelId, styleLibraryFolder }),
    (s: unknown) => {
      if (s === null) { handleReset(); return; }
      const d = s as Record<string, unknown>;
      if (d.tabs) setTabs(d.tabs as TabDef[]);
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (typeof d.editText === "string") setEditText(d.editText);
      if (typeof d.editPrompt === "string") setEditPrompt(d.editPrompt);
      if (typeof d.weaponName === "string") setWeaponName(d.weaponName);
      if (typeof d.finish === "string") setFinish(d.finish);
      if (typeof d.condition === "string") setCondition(d.condition);
      if (d.components) setComponents(d.components as Record<string, string>);
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (d.editHistory) setEditHistory(d.editHistory as EditEntry[]);
      if (typeof d.modelId === "string") setModelId(d.modelId);
      if (typeof d.styleLibraryFolder === "string") setStyleLibraryFolder(d.styleLibraryFolder);
    },
  );

  // Art Director integration
  useEffect(() => { if (active) setCurrentImage(currentSrc || null); }, [active, currentSrc, setCurrentImage]);
  useEffect(() => { if (active) setAttributesContext(editText || ""); }, [active, editText, setAttributesContext]);
  useEffect(() => {
    if (active && appPage === "weapon") {
      setOnApplyFeedback(() => (suggestion: string) => { setEditPrompt((prev) => prev ? `${prev}\n${suggestion}` : suggestion); });
      return () => setOnApplyFeedback(null);
    }
  }, [active, appPage, setOnApplyFeedback]);

  // Voice command listener
  const voiceCmdRef = useRef({ generate: handleGenerate, extract_attributes: handleExtract, enhance_description: handleEnhance, generate_all_views: handleGenerateAllViews, send_to_photoshop: handleSendToPS, save_image: handleSaveImage });
  voiceCmdRef.current = { generate: handleGenerate, extract_attributes: handleExtract, enhance_description: handleEnhance, generate_all_views: handleGenerateAllViews, send_to_photoshop: handleSendToPS, save_image: handleSaveImage };
  useEffect(() => {
    const handler = (e: Event) => {
      const { action, params } = (e as CustomEvent).detail as { action: string; params: Record<string, unknown> };
      if (action === "generate" && params.description) setEditPrompt(String(params.description));
      const cmds = voiceCmdRef.current as Record<string, unknown>;
      if (action in cmds) { const fn = cmds[action]; if (typeof fn === "function") fn(); }
    };
    window.addEventListener("voice-command", handler);
    return () => window.removeEventListener("voice-command", handler);
  }, []);

  // Tab switch listener
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string };
      if (detail?.tabId && tabs.some((t) => t.id === detail.tabId)) setActiveTab(detail.tabId);
    };
    window.addEventListener("switch-tab", handler);
    return () => window.removeEventListener("switch-tab", handler);
  }, [tabs]);

  // Gallery restore listener
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
        setGallery((prev) => ({ ...prev, main: [src] }));
        setImageIdx((prev) => ({ ...prev, main: 0 }));
        setActiveTab("main");
      }
    };
    window.addEventListener("gallery-restore", handler);
    return () => window.removeEventListener("gallery-restore", handler);
  }, []);

  // Library: group by category for display
  const libraryByCategory = useMemo(() => {
    const map = new Map<string, WeaponDef[]>();
    for (const w of library) {
      if (!map.has(w.category)) map.set(w.category, []);
      map.get(w.category)!.push(w);
    }
    return map;
  }, [library]);

  /* ── RENDER ──────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      <PanelGroup direction="horizontal" className="flex-1">
        {/* Left Column — Sections */}
        <Panel defaultSize={30} minSize={22} maxSize={45}>
          <div className="w-full h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
            {layout.order.map((sectionId) => {
              if (layout.hidden?.includes(sectionId)) return null;
              const collapsed = isSectionCollapsed(sectionId);
              const canCollapse = !NON_COLLAPSIBLE.has(sectionId);
              const canToggle = TOGGLEABLE_SECTIONS.has(sectionId);
              const enabled = isSectionEnabled(sectionId);
              const label = SECTION_LABELS[sectionId];

              const wrapSection = (children: React.ReactNode) => (
                <div
                  key={sectionId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, sectionId)}
                  onDragOver={(e) => handleDragOver(e, sectionId)}
                  onDrop={() => handleDrop(sectionId)}
                  onDragEnd={handleDragEnd}
                  onDragLeave={() => { if (dragOverId === sectionId) setDragOverId(null); }}
                  onMouseDown={(e) => { if (e.button === 1 && canToggle) { e.preventDefault(); toggleSectionEnabled(sectionId); } }}
                  style={{
                    border: dragOverId === sectionId && dragItemRef.current !== sectionId
                      ? "1px solid var(--color-accent, #6a6aff)" : "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--color-card)",
                    opacity: enabled ? 1 : 0.4,
                    transition: "opacity 0.15s ease",
                  }}
                >
                  <div className="flex items-center px-1 shrink-0" style={{ borderBottom: collapsed ? "none" : "1px solid var(--color-border)" }}>
                    <span className="cursor-grab active:cursor-grabbing px-1 py-1.5" style={{ color: "var(--color-text-muted)" }}>
                      <GripVertical className="h-3 w-3" />
                    </span>
                    {canCollapse ? (
                      <button
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
                        onClick={() => toggleSectionEnabled(sectionId)}
                        className="px-1.5 py-0.5 text-[9px] rounded font-semibold cursor-pointer shrink-0 select-none"
                        style={{
                          background: enabled ? "var(--color-accent)" : "var(--color-input-bg)",
                          color: enabled ? "var(--color-foreground)" : "var(--color-text-muted)",
                          border: "1px solid var(--color-border)",
                        }}
                        title={enabled ? "Panel is ON" : "Panel is OFF"}
                      >
                        {enabled ? "ON" : "OFF"}
                      </button>
                    )}
                  </div>
                  {!collapsed && <div className="px-3 pt-1 pb-3 space-y-2 overflow-hidden">{children}</div>}
                </div>
              );

              if (sectionId === "generate") return wrapSection(
                <>
                  <Button className="w-full" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtract} title="Auto-fill fields from current image">Extract Attributes</Button>
                  <Textarea label="Weapon Description" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} placeholder="Describe the weapon in detail..." disabled={textBusy} />
                  <Button className="w-full" size="sm" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhance} title="Use AI to enrich and expand your weapon description and all attributes">Enhance Description</Button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" className="w-full" onClick={handleOpenImage} title="Open image from disk">Open Image</Button>
                    <Button size="sm" className="w-full" onClick={handleReset} title="Clear all fields and images">Reset Weapon</Button>
                  </div>
                  <Button variant="primary" className="w-full" size="lg" generating={busy.is("generate")} generatingText={genText.generate || "Generating..."} onClick={handleGenerate} title="Generate image from current settings">
                    Generate Weapon
                  </Button>
                  {busy.any && <Button variant="danger" size="sm" className="w-full" onClick={handleCancel} title="Cancel all generations">Cancel</Button>}
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
                      {styleLibraryFolders.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>
                  {models.length > 0 && (
                    <select className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }} value={modelId} onChange={(e) => setModelId(e.target.value)} title="AI model for generation">
                      {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.resolution} ({m.time_estimate})</option>)}
                    </select>
                  )}
                </>
              );

              if (sectionId === "weaponLibrary") return wrapSection(
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                      {library.length} weapons
                    </span>
                    <button
                      onClick={() => setLibraryOpen(true)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded cursor-pointer"
                      style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                    >
                      <Pencil className="h-3 w-3" /> Edit Weapon Library
                    </button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                    {[...libraryByCategory.entries()].map(([cat, weapons]) => (
                      <div key={cat}>
                        <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--color-text-muted)" }}>{cat}</p>
                        <div className="flex flex-wrap gap-1">
                          {weapons.map((w) => (
                            <button
                              key={w.id}
                              onClick={() => handleSelectWeapon(w)}
                              className="px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
                              style={{
                                background: weaponName === w.name ? "var(--color-accent)" : "var(--color-input-bg)",
                                color: weaponName === w.name ? "var(--color-foreground)" : "var(--color-text-secondary)",
                                border: "1px solid var(--color-border)",
                                fontWeight: weaponName === w.name ? 600 : 400,
                              }}
                            >
                              {w.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );

              if (sectionId === "identity") return wrapSection(
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>Weapon Name</label>
                    <input
                      className="w-full px-3 py-1.5 text-sm rounded-[var(--radius-md)]"
                      style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                      value={weaponName} onChange={(e) => setWeaponName(e.target.value)}
                      placeholder="e.g. Stormbreaker Axe, Plasma Rifle MK-II..."
                      disabled={textBusy}
                    />
                  </div>
                  <Select label="Material Finish" options={FINISHES} value={finish} onChange={(e) => setFinish(e.target.value)} disabled={textBusy} />
                  <Select label="Condition" options={CONDITIONS} value={condition} onChange={(e) => setCondition(e.target.value)} disabled={textBusy} />
                </>
              );

              if (sectionId === "components") return wrapSection(
                <div className="space-y-1.5">
                  {COMPONENTS.map((comp) => (
                    <div key={comp} className="flex items-center gap-2">
                      <span className="text-xs w-16 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>{comp}</span>
                      <input
                        className="flex-1 px-2 py-1 text-xs rounded-[var(--radius-sm)]"
                        style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                        value={components[comp]} onChange={(e) => setComponents((c) => ({ ...c, [comp]: e.target.value }))}
                        disabled={textBusy}
                      />
                    </div>
                  ))}
                </div>
              );

              if (sectionId === "threeDGen") return wrapSection(
                <ThreeDGenSidebar embedded getViewImages={getViewImagesForThreeD} toolLabel="Weapon" />
              );

              if (sectionId === "multiview") return wrapSection(
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" className="w-full" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating..."} onClick={handleGenerateAllViews} title="Generate all weapon views">Generate All Views</Button>
                    <Button size="sm" className="w-full" generating={busy.is("selview")} generatingText={genText.selview || "Generating..."} onClick={handleGenerateSelectedView} title="Generate current view only">Generate Selected View</Button>
                  </div>
                  {models.length > 0 && (
                    <select className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }} value={multiviewModel || modelId} onChange={(e) => setMultiviewModel(e.target.value)} title="AI model for view generation">
                      {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.resolution} ({m.time_estimate})</option>)}
                    </select>
                  )}
                </>
              );

              if (sectionId === "saveOptions") return wrapSection(
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" className="w-full" onClick={handleSendToPS} title="Send to Photoshop">Send to PS</Button>
                    <Button size="sm" className="w-full" onClick={handleSendAllToPS} title="Send all views to Photoshop">Send ALL to PS</Button>
                    <Button size="sm" className="w-full" onClick={() => setShowXml(true)} title="View weapon data as XML">Show XML</Button>
                    <Button size="sm" className="w-full" onClick={handleClearCache} title="Clear AI cache">Clear Cache</Button>
                  </div>
                </div>
              );

              return null;
            })}

            <button
              onClick={handleSetDefaultLayout}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-[10px] font-medium cursor-pointer transition-colors"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px dashed var(--color-border)" }}
              title="Save panel layout as default"
            >
              <Save className="h-3 w-3" />
              Set Active Layout as Default
            </button>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 transition-colors hover:bg-[var(--color-border-hover)]" style={{ background: "var(--color-border)" }} />

        {/* Middle Column — Edit Panel */}
        <Panel defaultSize={22} minSize={16} maxSize={35}>
          <div className="w-full h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
            <Card>
              <div className="px-3 py-2 flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Weapon</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe changes to apply:</p>
                <Textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={10} placeholder="Tell the AI what to change — e.g. Add a tactical flashlight, change the finish to worn cerakote, extend the barrel..." disabled={busy.is("generate")} />
                <Button variant="primary" className="w-full" generating={busy.is("generate")} generatingText="Applying..." onClick={handleGenerate} title="Apply edit to current image">Apply Changes</Button>
              </div>
            </Card>
            <EditHistory entries={editHistory} />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 transition-colors hover:bg-[var(--color-border-hover)]" style={{ background: "var(--color-border)" }} />

        {/* Right Column — Viewer */}
        <Panel>
          <div className="flex-1 flex flex-col min-w-0 relative h-full">
            <div className="flex items-end shrink-0 relative" style={{ background: "var(--color-background)", borderBottom: "1px solid var(--color-border)", paddingTop: 4 }}>
              <div className="flex-1 min-w-0 flex items-end overflow-hidden">
                <GroupedTabBar
                  tabs={tabs}
                  active={activeTab}
                  onSelect={setActiveTab}
                  onAddRef={handleAddRef}
                  onRemoveTab={handleRemoveRef}
                  onReorder={setTabs}
                  noBorder
                />
              </div>
            </div>

            {activeTab === "deepSearch" ? (
              <DeepSearchPanel isActivePage={active} />
            ) : (
              <div className="relative flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                <ImageViewer
                  src={currentSrc}
                  placeholder={`No ${activeTabDef?.label.toLowerCase() || "image"} loaded`}
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
          </div>
        </Panel>
      </PanelGroup>

      {showXml && <XmlModal xml={buildWeaponXml()} title="Weapon XML" onClose={() => setShowXml(false)} />}
      <ArtDirectorConfigModal open={artDirectorConfigOpen} onClose={() => setArtDirectorConfigOpen(false)} />
      {libraryOpen && <WeaponLibraryModal library={library} onSave={handleSaveLibrary} onClose={() => setLibraryOpen(false)} />}
    </div>
  );
}
