import { useState, useCallback, useRef, useEffect } from "react";
import { Card, Button, Select, Textarea, NumberStepper, PanelSection, TagPicker } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { EditHistory } from "@/components/shared/EditHistory";
import { TabBar } from "@/components/shared/TabBar";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";

const VIEW_TABS = ["Main Stage (3/4)", "Front", "Back", "Side", "Ref A", "Ref B", "Ref C"];

const VIEW_TYPE_MAP: Record<string, string> = {
  "Main Stage (3/4)": "main",
  Front: "front",
  Back: "back",
  Side: "side",
};

const AGE_OPTIONS = [
  "", "teen (18–19)", "young adult (20–29)", "adult (30–45)", "middle-aged (46–65)", "senior (66+)",
].map((v) => ({ value: v, label: v || "\u2014" }));

const RACE_OPTIONS = [
  "", "Black / African descent", "White / European descent", "East Asian", "South Asian",
  "Southeast Asian", "Hispanic / Latine", "Middle Eastern / North African", "Indigenous",
  "Pacific Islander", "Mixed", "Other / not specified",
].map((v) => ({ value: v, label: v || "\u2014" }));

const GENDER_OPTIONS = [
  "", "male", "female", "non-binary", "genderqueer", "trans masc", "trans femme",
  "androgynous", "unspecified",
].map((v) => ({ value: v, label: v || "\u2014" }));

const BUILD_OPTIONS = [
  "", "slim", "average", "athletic", "muscular", "curvy", "heavyset", "soft/doughy", "unfit",
].map((v) => ({ value: v, label: v || "\u2014" }));

const ATTRIBUTE_FIELDS = [
  "Headwear", "Outerwear", "Top", "Legwear", "Footwear",
  "Gloves", "FaceGear", "UtilityRig", "BackCarry", "HandProp",
  "Accessories", "ColorAccents", "Detailing", "Pose",
];

// Character Bible presets
const PRODUCTION_STYLES = [
  "Clive Barker", "A24", "Tim Burton", "Zack Snyder", "Quentin Tarantino",
  "Daniel Warren Johnson", "David Fincher", "Denis Villeneuve", "Ridley Scott",
  "Christopher Nolan", "George Miller", "Jordan Peele", "Wes Anderson", "James Cameron",
];

const TONE_TAGS = [
  "Feminine", "Masculine", "Powerful", "Bold", "Wicked", "Modern",
  "Cutting edge", "High fashion", "Blockbuster movie quality", "Iconic",
  "Timeless", "Grounded in reality", "Cinematic",
];

// Costume Director presets
const COSTUME_STYLES = [
  "Heavy metal", "Punk rock", "Industrial", "Gothic", "Art nouveau", "Techwear",
  "Rockabilly", "Outlaw biker", "Pro wrestling", "Streetwear", "High fashion",
  "Military surplus", "Thrift store DIY", "Cyberpunk", "Noir", "Western",
  "Samurai", "Victorian", "Afrofuturism", "Brutalism", "Anti-establishment",
  "Blood magic", "Racing leathers", "Demolition derby",
];

const COSTUME_MATERIALS = [
  "Matte leather", "Patent leather", "Distressed leather", "Satin",
  "Bronze metal", "Chrome metal", "Blackened metal", "Canvas",
  "Mesh", "Vinyl", "Fur", "Rubber", "Wool", "Chainmail",
];

const HARDWARE_COLORS = [
  { value: "bronze", label: "Bronze" }, { value: "chrome", label: "Chrome" },
  { value: "gold", label: "Gold" }, { value: "blackened", label: "Blackened" },
  { value: "copper", label: "Copper" }, { value: "pewter", label: "Pewter" },
  { value: "gunmetal", label: "Gunmetal" },
];

const HW_DETAILS = [
  "buckles", "snaps", "zippers", "rivets", "grommets",
  "chains", "studs", "clasps", "armor plates", "trim/edging",
];

const COSTUME_ORIGINS = [
  "Custom fabrication", "Hardware/thrift", "Found/assembled",
  "Military surplus", "Haute couture", "Stage/performance", "Ceremonial",
];

function matchOption(options: { value: string }[], raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  const exact = options.find((o) => o.value === raw);
  if (exact) return exact.value;
  const caseMatch = options.find((o) => o.value.toLowerCase() === lower);
  if (caseMatch) return caseMatch.value;
  const startsWith = options.find(
    (o) => o.value && (o.value.toLowerCase().startsWith(lower) || lower.startsWith(o.value.toLowerCase())),
  );
  if (startsWith) return startsWith.value;
  const contains = options.find((o) => o.value && o.value.toLowerCase().includes(lower));
  if (contains) return contains.value;
  return raw;
}

interface EditEntry { timestamp: string; prompt: string; isOriginal?: boolean; }
interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean; }

interface BibleState {
  characterName: string;
  roleArchetype: string;
  backstory: string;
  worldContext: string;
  designIntent: string;
  productionStyle: string[];
  customDirector: string;
  toneTags: string[];
}

interface CostumeState {
  costumeStyles: string[];
  costumeCustomStyles: string;
  costumeMaterials: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  hardwareColor: string;
  hwDetails: string[];
  origin: string[];
  costumeNotes: string;
}

const EMPTY_BIBLE: BibleState = {
  characterName: "", roleArchetype: "", backstory: "", worldContext: "",
  designIntent: "", productionStyle: [], customDirector: "", toneTags: [],
};

const EMPTY_COSTUME: CostumeState = {
  costumeStyles: [], costumeCustomStyles: "", costumeMaterials: [],
  primaryColor: "", secondaryColor: "", accentColor: "", hardwareColor: "",
  hwDetails: [], origin: [], costumeNotes: "",
};

interface FullResponse {
  description?: string | null;
  age?: string;
  race?: string;
  gender?: string;
  build?: string;
  attributes?: Record<string, string> | null;
  bible?: Record<string, unknown> | null;
  costume?: Record<string, unknown> | null;
  error?: string | null;
}

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  return { is, start, end, any: set.size > 0 };
}

function bibleToCostumeContext(bible: BibleState): string {
  const parts: string[] = [];
  if (bible.characterName) parts.push(`Character: ${bible.characterName}`);
  if (bible.roleArchetype) parts.push(`Role: ${bible.roleArchetype}`);
  if (bible.backstory) parts.push(`Backstory: ${bible.backstory}`);
  if (bible.worldContext) parts.push(`World: ${bible.worldContext}`);
  if (bible.designIntent) parts.push(`Design intent: ${bible.designIntent}`);
  if (bible.productionStyle.length) parts.push(`Production style: ${bible.productionStyle.join(", ")}`);
  if (bible.customDirector) parts.push(`Production note: ${bible.customDirector}`);
  if (bible.toneTags.length) parts.push(`Tone: ${bible.toneTags.join(", ")}`);
  return parts.join("\n");
}

function costumeToContext(costume: CostumeState): string {
  const parts: string[] = [];
  if (costume.costumeStyles.length) parts.push(`Styles: ${costume.costumeStyles.join(", ")}`);
  if (costume.costumeCustomStyles) parts.push(`Custom styles: ${costume.costumeCustomStyles}`);
  if (costume.costumeMaterials.length) parts.push(`Materials: ${costume.costumeMaterials.join(", ")}`);
  if (costume.primaryColor) parts.push(`Primary color: ${costume.primaryColor}`);
  if (costume.secondaryColor) parts.push(`Secondary color: ${costume.secondaryColor}`);
  if (costume.accentColor) parts.push(`Accent color: ${costume.accentColor}`);
  if (costume.hardwareColor) parts.push(`Hardware color: ${costume.hardwareColor}`);
  if (costume.hwDetails.length) parts.push(`Hardware details: ${costume.hwDetails.join(", ")}`);
  if (costume.origin.length) parts.push(`Costume origin: ${costume.origin.join(", ")}`);
  if (costume.costumeNotes) parts.push(`Notes: ${costume.costumeNotes}`);
  return parts.join("\n");
}

const inputStyle = { background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" };

export function CharacterPage() {
  const [activeTab, setActiveTab] = useState("Main Stage (3/4)");
  const busy = useBusySet();
  const [genText, setGenText] = useState<Record<string, string>>({});

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});

  const [description, setDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editHistory, setEditHistory] = useState<EditEntry[]>([]);
  const [age, setAge] = useState("");
  const [race, setRace] = useState("");
  const [gender, setGender] = useState("");
  const [build, setBuild] = useState("");
  const [attributes, setAttributes] = useState<Record<string, { dropdown: string; custom: string }>>(
    Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])),
  );

  const [bible, setBible] = useState<BibleState>({ ...EMPTY_BIBLE });
  const [costume, setCostume] = useState<CostumeState>({ ...EMPTY_COSTUME });

  const [sectionsOpen, setSectionsOpen] = useState({ attributes: false, bible: false, costume: false });
  const toggleSection = useCallback((key: "attributes" | "bible" | "costume", val: boolean) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: val }));
  }, []);

  const [genCount, setGenCount] = useState(1);
  const [viewGenCount, setViewGenCount] = useState(1);
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

  const appendToGallery = useCallback((tab: string, src: string) => {
    setGallery((prev) => ({ ...prev, [tab]: [...(prev[tab] || []), src] }));
    setImageIdx((prev) => ({ ...prev, [tab]: (gallery[tab] || []).length }));
  }, [gallery]);

  const getMainImageB64 = useCallback(() => {
    const imgs = gallery["Main Stage (3/4)"] || [];
    const src = imgs[imageIdx["Main Stage (3/4)"] ?? 0];
    return src ? src.replace(/^data:image\/\w+;base64,/, "") : null;
  }, [gallery, imageIdx]);

  const getRefB64 = useCallback((tab: string) => {
    const imgs = gallery[tab] || [];
    const src = imgs[imageIdx[tab] ?? 0];
    return src ? src.replace(/^data:image\/\w+;base64,/, "") : null;
  }, [gallery, imageIdx]);

  // Apply bible/costume from an AI response
  const applyBibleFromResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data) return;
    setBible((prev) => ({
      ...prev,
      characterName: String(data.characterName ?? prev.characterName ?? ""),
      roleArchetype: String(data.roleArchetype ?? prev.roleArchetype ?? ""),
      backstory: String(data.backstory ?? prev.backstory ?? ""),
      worldContext: String(data.worldContext ?? prev.worldContext ?? ""),
      designIntent: String(data.designIntent ?? prev.designIntent ?? ""),
      productionStyle: Array.isArray(data.productionStyle) ? data.productionStyle as string[] : prev.productionStyle,
      customDirector: String(data.customDirector ?? prev.customDirector ?? ""),
      toneTags: Array.isArray(data.toneTags) ? data.toneTags as string[] : prev.toneTags,
    }));
    setSectionsOpen((prev) => ({ ...prev, bible: true }));
  }, []);

  const applyCostumeFromResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data) return;
    setCostume((prev) => ({
      ...prev,
      costumeStyles: Array.isArray(data.costumeStyles) ? data.costumeStyles as string[] : prev.costumeStyles,
      costumeCustomStyles: String(data.costumeCustomStyles ?? prev.costumeCustomStyles ?? ""),
      costumeMaterials: Array.isArray(data.costumeMaterials) ? data.costumeMaterials as string[] : prev.costumeMaterials,
      primaryColor: String(data.primaryColor ?? prev.primaryColor ?? ""),
      secondaryColor: String(data.secondaryColor ?? prev.secondaryColor ?? ""),
      accentColor: String(data.accentColor ?? prev.accentColor ?? ""),
      hardwareColor: String(data.hardwareColor ?? prev.hardwareColor ?? ""),
      hwDetails: Array.isArray(data.hwDetails) ? data.hwDetails as string[] : prev.hwDetails,
      origin: Array.isArray(data.origin) ? data.origin as string[] : prev.origin,
      costumeNotes: String(data.costumeNotes ?? prev.costumeNotes ?? ""),
    }));
    setSectionsOpen((prev) => ({ ...prev, costume: true }));
  }, []);

  const applyAttributesFromResponse = useCallback((attrs: Record<string, string> | null | undefined) => {
    if (!attrs) return;
    setAttributes((prev) => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(attrs)) {
        if (key in next && key !== "Pose") next[key] = { dropdown: String(val), custom: "" };
      }
      return next;
    });
    setSectionsOpen((prev) => ({ ...prev, attributes: true }));
  }, []);

  const applyFullResponse = useCallback((resp: FullResponse, setDesc = false) => {
    if (setDesc && resp.description) setDescription(resp.description);
    if (resp.age) setAge(matchOption(AGE_OPTIONS, resp.age));
    if (resp.race) setRace(matchOption(RACE_OPTIONS, resp.race));
    if (resp.gender) setGender(matchOption(GENDER_OPTIONS, resp.gender));
    if (resp.build) setBuild(matchOption(BUILD_OPTIONS, resp.build));
    applyAttributesFromResponse(resp.attributes);
    applyBibleFromResponse(resp.bible as Record<string, unknown> | null);
    applyCostumeFromResponse(resp.costume as Record<string, unknown> | null);
  }, [applyAttributesFromResponse, applyBibleFromResponse, applyCostumeFromResponse]);

  // --- Generation handlers ---

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    busy.start("generate");
    const total = genCount;
    const bibleCtx = bibleToCostumeContext(bible);
    const costumeCtx = costumeToContext(costume);
    for (let i = 0; i < total; i++) {
      setGenText((p) => ({ ...p, generate: total > 1 ? `Generating ${i + 1} of ${total}...` : "Generating character..." }));
      try {
        const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
          "/character/generate", {
            method: "POST",
            body: JSON.stringify({
              description, age, race, gender, build, view_type: "main", mode: "quality",
              model_id: modelId || undefined,
              bible_context: bibleCtx || undefined,
              costume_context: costumeCtx || undefined,
            }),
          },
        );
        if (resp.image_b64) {
          const src = `data:image/png;base64,${resp.image_b64}`;
          if (i === 0) { setTabImage("Main Stage (3/4)", src); } else { appendToGallery("Main Stage (3/4)", src); }
          if (i === 0) setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: "Initial generation", isOriginal: prev.length === 0 }, ...prev]);
        } else if (resp.error) { addToast(resp.error, "error"); break; }
      } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); break; }
    }
    addToast(total > 1 ? `Generated ${total} images` : "Character generated", "success");
    busy.end("generate");
  }, [description, age, race, gender, build, genCount, modelId, bible, costume, setTabImage, appendToGallery, addToast, busy]);

  const handleApplyEdit = useCallback(async () => {
    if (!editPrompt.trim()) return;
    const mainB64 = getMainImageB64();
    if (!mainB64) return;
    busy.start("apply");
    setGenText((p) => ({ ...p, apply: "Applying edits..." }));
    const bibleCtx = bibleToCostumeContext(bible);
    const costumeCtx = costumeToContext(costume);
    try {
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        "/character/edit", {
          method: "POST",
          body: JSON.stringify({
            description, age, race, gender, build, edit_prompt: editPrompt, reference_image_b64: mainB64,
            ref_a_b64: getRefB64("Ref A"), ref_b_b64: getRefB64("Ref B"), ref_c_b64: getRefB64("Ref C"),
            mode: "quality", model_id: modelId || undefined,
            bible_context: bibleCtx || undefined,
            costume_context: costumeCtx || undefined,
          }),
        },
      );
      if (resp.image_b64) {
        setTabImage("Main Stage (3/4)", `data:image/png;base64,${resp.image_b64}`);
        setEditHistory((prev) => [{ timestamp: new Date().toLocaleTimeString(), prompt: editPrompt.slice(0, 60) }, ...prev]);
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("apply");
  }, [editPrompt, description, age, race, gender, build, bible, costume, getMainImageB64, getRefB64, modelId, setTabImage, addToast, busy]);

  const handleExtractAttributes = useCallback(async () => {
    if (!description.trim()) return;
    busy.start("extract");
    try {
      const resp = await apiFetch<FullResponse>(
        "/character/extract-attributes", { method: "POST", body: JSON.stringify({ description }) },
      );
      if (resp.error) { addToast(resp.error, "error"); busy.end("extract"); return; }
      applyFullResponse(resp);
      addToast("Attributes extracted", "success");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("extract");
  }, [description, addToast, busy, applyFullResponse]);

  const handleEnhance = useCallback(async () => {
    if (!description.trim()) return;
    busy.start("enhance");
    try {
      const resp = await apiFetch<FullResponse>(
        "/character/enhance", { method: "POST", body: JSON.stringify({ text: description, operation: "enhance" }) },
      );
      if (resp.description) {
        applyFullResponse(resp, true);
        addToast("Description enhanced", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("enhance");
  }, [description, addToast, busy, applyFullResponse]);

  const handleRandomize = useCallback(async () => {
    busy.start("randomize");
    try {
      const resp = await apiFetch<FullResponse>("/character/randomize-full", { method: "POST" });
      if (resp.description) {
        applyFullResponse(resp, true);
        addToast("Random character generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("randomize");
  }, [addToast, busy, applyFullResponse]);

  const handleQuickGenerate = useCallback(async () => {
    busy.start("quickgen");
    setGenText((p) => ({ ...p, quickgen: "Randomizing character..." }));
    try {
      const randResp = await apiFetch<FullResponse>("/character/randomize-full", { method: "POST" });
      if (randResp.description) {
        applyFullResponse(randResp, true);
        setGenText((p) => ({ ...p, quickgen: "Generating image..." }));
        const bibleCtx = randResp.bible ? bibleToCostumeContext(randResp.bible as unknown as BibleState) : undefined;
        const costumeCtx = randResp.costume ? costumeToContext(randResp.costume as unknown as CostumeState) : undefined;
        const genResp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
          "/character/generate", {
            method: "POST",
            body: JSON.stringify({
              description: randResp.description, age: randResp.age, race: randResp.race,
              gender: randResp.gender, build: randResp.build, mode: "quality",
              model_id: modelId || undefined,
              bible_context: bibleCtx, costume_context: costumeCtx,
            }),
          },
        );
        if (genResp.image_b64) { setTabImage("Main Stage (3/4)", `data:image/png;base64,${genResp.image_b64}`); addToast("Quick generate complete", "success"); }
        else if (genResp.error) addToast(genResp.error, "error");
      } else if (randResp.error) addToast(randResp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("quickgen");
  }, [addToast, modelId, setTabImage, busy, applyFullResponse]);

  const handleGenerateAllViews = useCallback(async () => {
    const mainB64 = getMainImageB64();
    if (!mainB64 || !description.trim()) return;
    busy.start("allviews");
    const bibleCtx = bibleToCostumeContext(bible);
    const costumeCtx = costumeToContext(costume);
    for (const view of ["front", "back", "side"]) {
      const tabName = Object.entries(VIEW_TYPE_MAP).find(([, v]) => v === view)?.[0] || view;
      setGenText((p) => ({ ...p, allviews: `Generating ${tabName}...` }));
      try {
        const resp = await apiFetch<{ image_b64: string | null; width: number; height: number }>("/character/generate", {
          method: "POST",
          body: JSON.stringify({
            description, age, race, gender, build, view_type: view, reference_image_b64: mainB64,
            mode: "quality", model_id: modelId || undefined,
            bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
          }),
        });
        if (resp.image_b64) setTabImage(tabName, `data:image/png;base64,${resp.image_b64}`);
      } catch { break; }
    }
    busy.end("allviews");
  }, [description, age, race, gender, build, bible, costume, getMainImageB64, modelId, setTabImage, busy]);

  const handleCancel = useCallback(async () => {
    try { await apiFetch("/system/cancel", { method: "POST" }); } catch { /* */ }
  }, []);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string);
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc;
    a.download = `character_${activeTab.replace(/[\s()\/]+/g, "_").toLowerCase()}_${Date.now()}.png`; a.click();
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
    setGallery({}); setImageIdx({}); setEditHistory([]); setDescription(""); setEditPrompt("");
    setAttributes(Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])));
    setBible({ ...EMPTY_BIBLE }); setCostume({ ...EMPTY_COSTUME });
    setSectionsOpen({ attributes: false, bible: false, costume: false });
  }, []);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); }, [activeTab, gallery]);

  const isRefTab = activeTab.startsWith("Ref");
  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.label} — ${m.resolution} (${m.time_estimate})` }));

  return (
    <div className="flex h-full overflow-hidden">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Left Column */}
      <div className="w-[400px] shrink-0 flex flex-col gap-2 overflow-y-auto p-3" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Character Identity</p>
            <div className="grid grid-cols-2 gap-2">
              <Select label="Age" options={AGE_OPTIONS} value={age} onChange={(e) => setAge(e.target.value)} />
              <Select label="Race" options={RACE_OPTIONS} value={race} onChange={(e) => setRace(e.target.value)} />
              <Select label="Gender" options={GENDER_OPTIONS} value={gender} onChange={(e) => setGender(e.target.value)} />
              <Select label="Build" options={BUILD_OPTIONS} value={build} onChange={(e) => setBuild(e.target.value)} />
            </div>
            <Textarea label="Character Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe the character..." />
            <Button className="w-full" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtractAttributes}>Extract Attributes</Button>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" className="w-full" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhance}>Enhance Description</Button>
              <Button size="sm" className="w-full" generating={busy.is("randomize")} generatingText="Randomizing..." onClick={handleRandomize}>Randomize Full Character</Button>
              <Button size="sm" className="w-full" onClick={handleOpenImage}>Open Image</Button>
              <Button size="sm" className="w-full" onClick={handleReset}>Reset Character</Button>
            </div>
            <Button variant="primary" className="w-full" size="lg" generating={busy.is("generate")} generatingText={genText.generate || "Generating..."} onClick={handleGenerate}>
              Generate Character Image
            </Button>
            <div className="flex items-center gap-3">
              <NumberStepper value={genCount} onChange={setGenCount} min={1} max={10} label="Count:" />
              {modelOptions.length > 0 && (
                <select className="flex-1 px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          </div>
        </Card>

        {/* Collapsible: Character Attributes */}
        <PanelSection title="Character Attributes" open={sectionsOpen.attributes} onToggle={(v) => toggleSection("attributes", v)}>
          <div className="space-y-1.5">
            {ATTRIBUTE_FIELDS.map((field) => (
              <div key={field} className="flex items-center gap-2">
                <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>{field}</span>
                <input className="flex-1 px-2 py-1 text-xs" style={inputStyle}
                  value={attributes[field]?.dropdown || ""} onChange={(e) => setAttributes((prev) => ({ ...prev, [field]: { ...prev[field], dropdown: e.target.value } }))} />
                <input className="w-24 px-2 py-1 text-xs" style={inputStyle}
                  placeholder="custom" value={attributes[field]?.custom || ""} onChange={(e) => setAttributes((prev) => ({ ...prev, [field]: { ...prev[field], custom: e.target.value } }))} />
              </div>
            ))}
          </div>
        </PanelSection>

        {/* Collapsible: Character Bible */}
        <PanelSection title="Character Bible" open={sectionsOpen.bible} onToggle={(v) => toggleSection("bible", v)}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Name</span>
              <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} value={bible.characterName}
                onChange={(e) => setBible((p) => ({ ...p, characterName: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Role</span>
              <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} value={bible.roleArchetype}
                onChange={(e) => setBible((p) => ({ ...p, roleArchetype: e.target.value }))} />
            </div>
            <div>
              <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Backstory</span>
              <textarea className="w-full px-2 py-1 text-xs resize-none" rows={3} style={inputStyle} value={bible.backstory}
                onChange={(e) => setBible((p) => ({ ...p, backstory: e.target.value }))} />
            </div>
            <div>
              <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>World / Setting</span>
              <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} value={bible.worldContext}
                onChange={(e) => setBible((p) => ({ ...p, worldContext: e.target.value }))} />
            </div>
            <div>
              <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Design Intent</span>
              <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} value={bible.designIntent}
                onChange={(e) => setBible((p) => ({ ...p, designIntent: e.target.value }))} />
            </div>
            <TagPicker label="Production Style" options={PRODUCTION_STYLES} selected={bible.productionStyle}
              onChange={(v) => setBible((p) => ({ ...p, productionStyle: v }))} />
            <div className="flex items-center gap-2">
              <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Custom Note</span>
              <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} placeholder="Custom production note..."
                value={bible.customDirector} onChange={(e) => setBible((p) => ({ ...p, customDirector: e.target.value }))} />
            </div>
            <TagPicker label="Tone / Quality" options={TONE_TAGS} selected={bible.toneTags}
              onChange={(v) => setBible((p) => ({ ...p, toneTags: v }))} />
          </div>
        </PanelSection>

        {/* Collapsible: Costume Director */}
        <PanelSection title="Costume Director" open={sectionsOpen.costume} onToggle={(v) => toggleSection("costume", v)}>
          <div className="space-y-2">
            <TagPicker label="Style Influences" options={COSTUME_STYLES} selected={costume.costumeStyles}
              onChange={(v) => setCostume((p) => ({ ...p, costumeStyles: v }))} />
            <div className="flex items-center gap-2">
              <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Custom</span>
              <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} placeholder="Additional style notes..."
                value={costume.costumeCustomStyles} onChange={(e) => setCostume((p) => ({ ...p, costumeCustomStyles: e.target.value }))} />
            </div>
            <TagPicker label="Materials" options={COSTUME_MATERIALS} selected={costume.costumeMaterials}
              onChange={(v) => setCostume((p) => ({ ...p, costumeMaterials: v }))} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Primary Color</span>
                <input className="w-full px-2 py-1 text-xs" style={inputStyle} value={costume.primaryColor}
                  onChange={(e) => setCostume((p) => ({ ...p, primaryColor: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Secondary Color</span>
                <input className="w-full px-2 py-1 text-xs" style={inputStyle} value={costume.secondaryColor}
                  onChange={(e) => setCostume((p) => ({ ...p, secondaryColor: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Accent Color</span>
                <input className="w-full px-2 py-1 text-xs" style={inputStyle} value={costume.accentColor}
                  onChange={(e) => setCostume((p) => ({ ...p, accentColor: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Hardware Color</span>
                <select className="w-full px-2 py-1 text-xs" style={inputStyle} value={costume.hardwareColor}
                  onChange={(e) => setCostume((p) => ({ ...p, hardwareColor: e.target.value }))}>
                  <option value="">—</option>
                  {HARDWARE_COLORS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>
            </div>
            <TagPicker label="Hardware Details" options={HW_DETAILS} selected={costume.hwDetails}
              onChange={(v) => setCostume((p) => ({ ...p, hwDetails: v }))} />
            <TagPicker label="Costume Origin" options={COSTUME_ORIGINS} selected={costume.origin}
              onChange={(v) => setCostume((p) => ({ ...p, origin: v }))} />
            <div>
              <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Additional Direction</span>
              <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} value={costume.costumeNotes}
                onChange={(e) => setCostume((p) => ({ ...p, costumeNotes: e.target.value }))} />
            </div>
          </div>
        </PanelSection>

        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Multi-View Generation</p>
            <Button className="w-full" size="sm" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating views..."} onClick={handleGenerateAllViews}>Generate All Views</Button>
            <Button className="w-full" size="sm">Generate Selected View</Button>
            <NumberStepper value={viewGenCount} onChange={setViewGenCount} min={1} max={5} label="Count:" />
          </div>
        </Card>

        <Card>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Save Options</p>
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" className="w-full">Save Current</Button>
              <Button size="sm" className="w-full">Send to PS</Button>
              <Button size="sm" className="w-full">Send ALL</Button>
              <Button size="sm" className="w-full">Show XML</Button>
              <Button size="sm" className="w-full">Clear Cache</Button>
              <Button size="sm" className="w-full">Save Log</Button>
            </div>
            <Button size="sm" className="w-full">Open Generated Images</Button>
          </div>
        </Card>
      </div>

      {/* Middle Column - Edit Panel */}
      <div className="w-[320px] shrink-0 flex flex-col gap-2 overflow-y-auto p-3" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Character</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe changes to apply:</p>
            <Textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={14} placeholder="e.g. Add a red scarf, change boots to brown..." />
            <Button variant="primary" className="w-full" generating={busy.is("apply")} generatingText="Applying..." onClick={handleApplyEdit}>Apply Changes</Button>
            <EditHistory entries={editHistory} defaultOpen={true} />
          </div>
        </Card>
      </div>

      {/* Right Column - Image Viewer */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Character Concept</p>
          <div className="flex items-center gap-2">
            {busy.any && <Button size="sm" variant="danger" onClick={handleCancel}>Cancel</Button>}
            <Button size="sm" generating={busy.is("quickgen")} generatingText={genText.quickgen || "Generating..."} onClick={handleQuickGenerate}>Quick Generate</Button>
          </div>
        </div>
        <TabBar tabs={VIEW_TABS} active={activeTab} onSelect={setActiveTab} />
        <ImageViewer
          src={currentSrc}
          placeholder={`No ${activeTab.toLowerCase()} image loaded`}
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
      </div>
    </div>
  );
}
