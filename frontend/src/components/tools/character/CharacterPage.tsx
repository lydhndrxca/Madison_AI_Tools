import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Card, Button, Select, Textarea, NumberStepper, PanelSection, TagPicker, ColorField } from "@/components/ui";
import type { TagItem } from "@/components/ui";
import { ImageViewer } from "@/components/shared/ImageViewer";
import { GridGallery } from "@/components/shared/GridGallery";
import type { GridGalleryResult } from "@/components/shared/GridGallery";
import { EditHistory } from "@/components/shared/EditHistory";
import { GroupedTabBar } from "@/components/shared/TabBar";
import { ArtboardCanvas } from "@/components/shared/ArtboardCanvas";
import { StyleFusionPanel, buildFusionBrief, EMPTY_FUSION } from "@/components/shared/StyleFusionPanel";
import type { StyleFusionState } from "@/components/shared/StyleFusionPanel";
import type { TabDef } from "@/components/shared/TabBar";
import { apiFetch, cancelAllRequests } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { useSessionRegister, useSessionContext } from "@/hooks/SessionContext";
import { useClipboardPaste, readClipboardImage } from "@/hooks/useClipboardPaste";
import { useFavorites } from "@/hooks/FavoritesContext";
import { createHistoryEntry, pushHistory, clearHistory as clearHist, createImageRecord } from "@/lib/imageHistory";
import type { HistoryEntry, ImageRecord, HistorySettings } from "@/lib/imageHistory";
import { XmlModal } from "@/components/shared/XmlModal";
import { GripVertical, ChevronDown, ChevronRight, Save, Lock, Unlock, Pencil } from "lucide-react";
import { useShortcuts } from "@/hooks/useShortcuts";
import { usePromptOverrides } from "@/hooks/PromptOverridesContext";
import { EditPromptModal } from "@/components/shared/EditPromptModal";
import { useCustomSections } from "@/hooks/CustomSectionsContext";
import { useCustomSectionState } from "@/hooks/useCustomSectionState";
import { CustomSectionRenderer } from "@/components/shared/CustomSectionRenderer";

// ---------------------------------------------------------------------------
// Tab model
// ---------------------------------------------------------------------------

const BUILTIN_TABS: TabDef[] = [
  { id: "main", label: "Main Stage", group: "stage", prompt: "Three-quarter hero shot showing the character's full design, head to toe, from a dramatic 3/4 angle." },
  { id: "3/4", label: "3/4", group: "views", prompt: "True 3/4 angle view of the character, full body visible." },
  { id: "front", label: "Front", group: "views", prompt: "Front view" },
  { id: "back", label: "Back", group: "views", prompt: "Back view" },
  { id: "side", label: "Side", group: "views", prompt: "Side view" },
  { id: "artboard", label: "Art Table", group: "artboard" },
  { id: "refA", label: "Ref A", group: "refs" },
  { id: "refB", label: "Ref B", group: "refs" },
  { id: "refC", label: "Ref C", group: "refs" },
];

const VIEW_TYPE_MAP: Record<string, string> = {
  main: "main", "3/4": "three_quarter", front: "front", back: "back", side: "side",
};

const AGE_OPTIONS = [
  "", "teen (18–19)", "young adult (20–29)", "adult (30–45)", "middle-aged (46–65)", "senior (66+)",
].map((v) => ({ value: v, label: v || "—" }));

const RACE_OPTIONS = [
  "", "Black / African descent", "White / European descent", "East Asian", "South Asian",
  "Southeast Asian", "Hispanic / Latine", "Middle Eastern / North African", "Indigenous",
  "Pacific Islander", "Mixed", "Other / not specified",
].map((v) => ({ value: v, label: v || "—" }));

const GENDER_OPTIONS = [
  "", "male", "female", "non-binary", "genderqueer", "trans masc", "trans femme",
  "androgynous", "unspecified",
].map((v) => ({ value: v, label: v || "—" }));

const BUILD_OPTIONS = [
  "", "slim", "average", "athletic", "muscular", "curvy", "heavyset", "soft/doughy", "unfit",
].map((v) => ({ value: v, label: v || "—" }));

const ATTRIBUTE_FIELDS = [
  "Headwear", "Outerwear", "Top", "Legwear", "Footwear",
  "Gloves", "FaceGear", "UtilityRig", "BackCarry", "HandProp",
  "Accessories", "ColorAccents", "Detailing", "Pose",
];

// ---------------------------------------------------------------------------
// TagItem presets
// ---------------------------------------------------------------------------

const PRODUCTION_STYLE_PRESETS: TagItem[] = [
  { label: "Clive Barker", prompt: "Dark grotesque horror with organic textures and body-horror elements" },
  { label: "A24", prompt: "Understated indie aesthetic with naturalistic lighting and muted palettes" },
  { label: "Tim Burton", prompt: "Whimsical gothic with exaggerated proportions and stark contrast" },
  { label: "Zack Snyder", prompt: "Hyper-stylized slow-motion heroism with desaturated tones and lens flares" },
  { label: "Quentin Tarantino", prompt: "Bold retro pop-culture style with saturated colors and gritty realism" },
  { label: "Daniel Warren Johnson", prompt: "Gritty hand-drawn comic energy with heavy inks and kinetic motion" },
  { label: "David Fincher", prompt: "Cold clinical precision with dark shadows and sickly green undertones" },
  { label: "Denis Villeneuve", prompt: "Vast atmospheric scale with muted earth tones and minimal ornamentation" },
  { label: "Ridley Scott", prompt: "Epic historical/sci-fi grandeur with rich textures and practical detail" },
  { label: "Christopher Nolan", prompt: "Grounded realism with IMAX-scale scope and restrained color grading" },
  { label: "George Miller", prompt: "Post-apocalyptic maximalism with weathered metal, rust, and kinetic chaos" },
  { label: "Jordan Peele", prompt: "Unsettling everyday horror with symbolic imagery and sharp contrast" },
  { label: "Wes Anderson", prompt: "Symmetrical pastel compositions with retro nostalgia and flat staging" },
  { label: "James Cameron", prompt: "Blockbuster spectacle with bioluminescent detail and heroic framing" },
];

const TONE_TAG_PRESETS: TagItem[] = [
  { label: "Feminine", prompt: "Soft curves, flowing silhouettes, graceful posture" },
  { label: "Masculine", prompt: "Broad angular build, strong jaw, assertive stance" },
  { label: "Powerful", prompt: "Commanding presence, wide stance, bold proportions" },
  { label: "Bold", prompt: "High-contrast look, striking features, unapologetic style" },
  { label: "Wicked", prompt: "Dark allure, sharp edges, sinister undertones" },
  { label: "Modern", prompt: "Clean lines, contemporary silhouettes, minimal ornamentation" },
  { label: "Cutting edge", prompt: "Experimental avant-garde fashion, unconventional materials" },
  { label: "High fashion", prompt: "Runway-ready couture with editorial proportions" },
  { label: "Blockbuster movie quality", prompt: "AAA cinematic production value, studio lighting" },
  { label: "Iconic", prompt: "Instantly recognizable silhouette, signature design elements" },
  { label: "Timeless", prompt: "Classic design that transcends trends, enduring appeal" },
  { label: "Grounded in reality", prompt: "Practical real-world clothing and believable wear" },
  { label: "Cinematic", prompt: "Dramatic lighting, filmic color grade, hero framing" },
];

const COSTUME_STYLE_PRESETS: TagItem[] = [
  { label: "Heavy metal", prompt: "Spiked leather, band patches, chain accessories, distressed black" },
  { label: "Punk rock", prompt: "Safety pins, torn fabric, DIY patches, mohawk-friendly" },
  { label: "Industrial", prompt: "Utilitarian straps, rubber, matte black, gas-mask motifs" },
  { label: "Gothic", prompt: "Velvet, lace, corsetry, dark romantic flowing fabrics" },
  { label: "Art nouveau", prompt: "Organic flowing curves, floral motifs, ornate metalwork" },
  { label: "Techwear", prompt: "Waterproof shells, modular pockets, taped seams, matte finishes" },
  { label: "Rockabilly", prompt: "Vintage 50s greaser, pompadour-ready, rolled sleeves, leather" },
  { label: "Outlaw biker", prompt: "Cut vest, road-worn leather, club insignia, steel buckles" },
  { label: "Pro wrestling", prompt: "Flashy spandex, bold graphic prints, championship accessories" },
  { label: "Streetwear", prompt: "Oversized hoodies, sneaker culture, logo-heavy, urban edge" },
  { label: "High fashion", prompt: "Runway couture, editorial proportions, luxury fabrics" },
  { label: "Military surplus", prompt: "Camo BDUs, cargo pockets, dog tags, field-worn texture" },
  { label: "Thrift store DIY", prompt: "Mismatched vintage finds, hand-sewn alterations, lo-fi charm" },
  { label: "Cyberpunk", prompt: "Neon-lit tech implants, holographic panels, circuit patterns" },
  { label: "Noir", prompt: "Trench coat, fedora shadow, monochrome palette, cigarette smoke" },
  { label: "Western", prompt: "Dusty duster, cowboy boots, leather hat, gunslinger belt" },
  { label: "Samurai", prompt: "Hakama, layered armor plates, katana sash, feudal Japanese silhouette" },
  { label: "Victorian", prompt: "Top hat, waistcoat, pocket watch, high collar, bustled skirts" },
  { label: "Afrofuturism", prompt: "Tribal geometry meets sci-fi tech, bold patterns, metallic accents" },
  { label: "Brutalism", prompt: "Raw concrete textures, exposed structure, monolithic shapes" },
  { label: "Anti-establishment", prompt: "Protest graphics, anarchist symbols, reclaimed materials" },
  { label: "Blood magic", prompt: "Crimson runes, ritual scarring, arcane sigils on flesh and cloth" },
  { label: "Racing leathers", prompt: "Aerodynamic suit, sponsor patches, armored knees and elbows" },
  { label: "Demolition derby", prompt: "Flame decals, welded roll cage, crash-tested padding" },
];

const COSTUME_MATERIAL_PRESETS: TagItem[] = [
  { label: "Matte leather", prompt: "Non-reflective tanned hide with a smooth worn surface" },
  { label: "Patent leather", prompt: "High-gloss mirror-finish leather" },
  { label: "Distressed leather", prompt: "Cracked, faded, road-worn leather with natural patina" },
  { label: "Satin", prompt: "Glossy smooth woven fabric with soft drape and sheen" },
  { label: "Bronze metal", prompt: "Warm amber-toned metal hardware with slight oxidation" },
  { label: "Chrome metal", prompt: "Mirror-polished silver metal with sharp reflections" },
  { label: "Blackened metal", prompt: "Dark oxidized metal with matte charcoal finish" },
  { label: "Canvas", prompt: "Heavy-duty woven cotton with rugged military-grade texture" },
  { label: "Mesh", prompt: "Breathable open-weave fabric with visible grid pattern" },
  { label: "Vinyl", prompt: "Synthetic glossy material with plastic sheen" },
  { label: "Fur", prompt: "Natural or faux animal pelt with soft dense texture" },
  { label: "Rubber", prompt: "Matte black elastic material with industrial texture" },
  { label: "Wool", prompt: "Thick knit or felted fabric with warm fibrous texture" },
  { label: "Chainmail", prompt: "Interlocking metal rings forming flexible armor mesh" },
];

const HW_DETAIL_PRESETS: TagItem[] = [
  { label: "buckles", prompt: "Metal buckle closures on straps and belts" },
  { label: "snaps", prompt: "Press-snap metal fasteners" },
  { label: "zippers", prompt: "Exposed metal zipper teeth and pulls" },
  { label: "rivets", prompt: "Hammered metal rivets reinforcing stress points" },
  { label: "grommets", prompt: "Metal-rimmed eyelets for lacing and ventilation" },
  { label: "chains", prompt: "Hanging or connecting decorative metal chain links" },
  { label: "studs", prompt: "Protruding dome or cone-shaped metal studs" },
  { label: "clasps", prompt: "Ornamental hook-and-loop metal closures" },
  { label: "armor plates", prompt: "Overlapping protective metal plates" },
  { label: "trim/edging", prompt: "Decorative metal trim along seams and edges" },
];

const COSTUME_ORIGIN_PRESETS: TagItem[] = [
  { label: "Custom fabrication", prompt: "Purpose-built bespoke garments" },
  { label: "Hardware/thrift", prompt: "Assembled from found hardware-store and thrift-shop pieces" },
  { label: "Found/assembled", prompt: "Scavenged and pieced together from available materials" },
  { label: "Military surplus", prompt: "Repurposed authentic military-issue gear" },
  { label: "Haute couture", prompt: "High-end designer craftsmanship" },
  { label: "Stage/performance", prompt: "Theatrical costume designed for stage presence" },
  { label: "Ceremonial", prompt: "Ritual or ceremonial garb with symbolic elements" },
];

const HARDWARE_COLORS = [
  { value: "bronze", label: "Bronze" }, { value: "chrome", label: "Chrome" },
  { value: "gold", label: "Gold" }, { value: "blackened", label: "Blackened" },
  { value: "copper", label: "Copper" }, { value: "pewter", label: "Pewter" },
  { value: "gunmetal", label: "Gunmetal" },
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

interface ModelInfo { id: string; label: string; resolution: string; time_estimate: string; multimodal: boolean; }

interface BibleState {
  characterName: string;
  roleArchetype: string;
  backstory: string;
  worldContext: string;
  designIntent: string;
  productionStyle: TagItem[];
  customDirector: string;
  toneTags: TagItem[];
}

interface CostumeState {
  costumeStyles: TagItem[];
  costumeMaterials: TagItem[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  hardwareColor: string;
  hwDetails: TagItem[];
  origin: TagItem[];
  costumeNotes: string;
}

const EMPTY_BIBLE: BibleState = {
  characterName: "", roleArchetype: "", backstory: "", worldContext: "",
  designIntent: "", productionStyle: [], customDirector: "", toneTags: [],
};

const EMPTY_COSTUME: CostumeState = {
  costumeStyles: [], costumeMaterials: [],
  primaryColor: "", secondaryColor: "", accentColor: "", hardwareColor: "",
  hwDetails: [], origin: [], costumeNotes: "",
};

// ---------------------------------------------------------------------------
// Preservation Lock
// ---------------------------------------------------------------------------

interface PreserveToggle {
  key: string;
  label: string;
  prompt: string;
  enabled: boolean;
}

interface PreservationLockState {
  enabled: boolean;
  preserves: PreserveToggle[];
  negatives: { id: string; text: string; enabled: boolean }[];
}

const DEFAULT_PRESERVES: PreserveToggle[] = [
  { key: "keepFace", label: "Keep face", prompt: "Do NOT change the face", enabled: false },
  { key: "keepHair", label: "Keep hairstyle", prompt: "Do NOT change the hairstyle", enabled: false },
  { key: "keepHairColor", label: "Keep hair color", prompt: "Do NOT change the hair color", enabled: false },
  { key: "keepPose", label: "Keep pose", prompt: "Do NOT change the pose", enabled: false },
  { key: "keepBodyType", label: "Keep body type / build", prompt: "Do NOT change the body type or build", enabled: false },
  { key: "keepCameraAngle", label: "Keep camera angle", prompt: "Do NOT change the camera angle", enabled: false },
  { key: "keepLighting", label: "Keep lighting", prompt: "Do NOT change the lighting", enabled: false },
  { key: "keepBackground", label: "Keep background", prompt: "Do NOT change the background", enabled: false },
];

const DEFAULT_NEGATIVES: PreservationLockState["negatives"] = [
  { id: "neg1", text: "No crown", enabled: false },
  { id: "neg2", text: "No fantasy elements", enabled: false },
  { id: "neg3", text: "No dress", enabled: false },
  { id: "neg4", text: "No cape", enabled: false },
  { id: "neg5", text: "No electronics / future technology", enabled: false },
];

const EMPTY_PRESERVATION: PreservationLockState = {
  enabled: true,
  preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })),
  negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })),
};

let _negIdCounter = 100;

interface FullResponse {
  description?: string | null;
  age?: string;
  race?: string;
  gender?: string;
  build?: string;
  attributes?: Record<string, string> | null;
  bible?: Record<string, unknown> | null;
  costume?: Record<string, unknown> | null;
  environment?: Record<string, unknown> | null;
  error?: string | null;
}

function useBusySet() {
  const [set, setSet] = useState<Set<string>>(new Set());
  const is = useCallback((key: string) => set.has(key), [set]);
  const start = useCallback((key: string) => setSet((prev) => new Set(prev).add(key)), []);
  const end = useCallback((key: string) => setSet((prev) => { const n = new Set(prev); n.delete(key); return n; }), []);
  const endAll = useCallback(() => setSet(new Set()), []);
  return { is, start, end, endAll, any: set.size > 0 };
}

function tagsToPromptList(tags: TagItem[]): string {
  return tags.map((t) => t.prompt || t.label).join("; ");
}

function bibleToCostumeContext(bible: BibleState): string {
  const parts: string[] = [];
  if (bible.characterName) parts.push(`Character: ${bible.characterName}`);
  if (bible.roleArchetype) parts.push(`Role: ${bible.roleArchetype}`);
  if (bible.backstory) parts.push(`Backstory: ${bible.backstory}`);
  if (bible.worldContext) parts.push(`World: ${bible.worldContext}`);
  if (bible.designIntent) parts.push(`Design intent: ${bible.designIntent}`);
  if (bible.productionStyle.length) parts.push(`Production style: ${tagsToPromptList(bible.productionStyle)}`);
  if (bible.customDirector) parts.push(`Production note: ${bible.customDirector}`);
  if (bible.toneTags.length) parts.push(`Tone: ${tagsToPromptList(bible.toneTags)}`);
  return parts.join("\n");
}

function preservationToConstraints(pres: PreservationLockState): string {
  if (!pres.enabled) return "";
  const lines: string[] = [];
  for (const p of pres.preserves) {
    if (p.enabled) lines.push(p.prompt);
  }
  for (const n of pres.negatives) {
    if (n.enabled) lines.push(`MUST AVOID: ${n.text}`);
  }
  return lines.join("\n");
}

function costumeToContext(costume: CostumeState): string {
  const parts: string[] = [];
  if (costume.costumeStyles.length) parts.push(`Styles: ${tagsToPromptList(costume.costumeStyles)}`);
  if (costume.costumeMaterials.length) parts.push(`Materials: ${tagsToPromptList(costume.costumeMaterials)}`);
  if (costume.primaryColor) parts.push(`Primary color: ${costume.primaryColor}`);
  if (costume.secondaryColor) parts.push(`Secondary color: ${costume.secondaryColor}`);
  if (costume.accentColor) parts.push(`Accent color: ${costume.accentColor}`);
  if (costume.hardwareColor) parts.push(`Hardware color: ${costume.hardwareColor}`);
  if (costume.hwDetails.length) parts.push(`Hardware details: ${tagsToPromptList(costume.hwDetails)}`);
  if (costume.origin.length) parts.push(`Costume origin: ${tagsToPromptList(costume.origin)}`);
  if (costume.costumeNotes) parts.push(`Notes: ${costume.costumeNotes}`);
  return parts.join("\n");
}

function stringsToTags(arr: string[], allPresets: TagItem[]): TagItem[] {
  return arr.map((s) => {
    const preset = allPresets.find((p) => p.label.toLowerCase() === s.toLowerCase());
    return preset ?? { label: s, prompt: s, isCustom: true };
  });
}

const inputStyle = { background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)" };

// ---------------------------------------------------------------------------
// Layout system — section ordering + collapse state persistence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Environment Placement
// ---------------------------------------------------------------------------

const ENV_LOCATION_PRESETS = [
  "", "Pacific Northwest rainforest", "Abandoned summer camp", "Urban alley — night",
  "Industrial warehouse", "Gothic cathedral interior", "Desert highway",
  "Rooftop — city skyline", "Underground bunker", "Victorian manor",
  "Neon-lit street market", "Frozen tundra", "Jungle temple ruins",
  "Spaceship interior", "Studio — solid grey backdrop", "__custom",
];

const ENV_TIME_OPTIONS = [
  "", "Dawn — cold blue", "Golden hour — warm amber", "Midday — harsh direct",
  "Overcast — soft diffused", "Dusk — purple-orange", "Night — moonlit",
  "Night — artificial light", "Twilight — blue hour",
];

const ENV_LIGHTING_OPTIONS = [
  "", "Dappled forest light", "Harsh direct sun", "Soft diffused overcast",
  "Rim-lit from behind", "Campfire / torch light", "Neon mixed color",
  "Studio three-point", "Dramatic chiaroscuro", "Volumetric fog",
  "Underwater caustics", "Fluorescent industrial",
];

const ENV_POSE_PRESETS = [
  "", "Standing — relaxed", "Standing — soldier's stance", "Walking toward camera",
  "Seated — throne / chair", "Crouching — ready", "Action — mid-combat",
  "Portrait 3/4 turn", "Full body — arms at sides", "From behind — looking over shoulder",
  "Silhouette — backlit",
];

const ENV_CAMERA_OPTIONS = [
  "", "Full body", "Waist up (cowboy)", "Portrait — head & shoulders",
  "Extreme close-up", "Wide establishing", "Low angle — heroic",
  "High angle — vulnerable", "Dutch angle — tension", "Over-the-shoulder",
];

const ENV_FORMAT_OPTIONS = [
  "3:4 — portrait", "1:1 — square", "4:3 — landscape",
  "9:16 — vertical reel", "16:9 — cinematic wide", "2.39:1 — anamorphic",
];

interface EnvCharacterImage {
  id: string;
  dataUrl: string;
  note: string;
}

interface EnvReferenceImage {
  id: string;
  dataUrl: string;
  note: string;
}

interface EnvironmentPlacementState {
  location: string;
  customLocation: string;
  timeOfDay: string;
  lighting: string;
  pose: string;
  customPose: string;
  props: string;
  camera: string;
  outputFormat: string;
  characters: EnvCharacterImage[];
  references: EnvReferenceImage[];
}

const EMPTY_ENV: EnvironmentPlacementState = {
  location: "", customLocation: "", timeOfDay: "", lighting: "",
  pose: "", customPose: "", props: "", camera: "", outputFormat: "3:4 — portrait",
  characters: [], references: [],
};

function buildEnvBrief(env: EnvironmentPlacementState): string {
  const lines: string[] = [];
  const loc = env.location === "__custom" ? env.customLocation : env.location;
  if (loc) lines.push(`Location: ${loc}`);
  if (env.timeOfDay) lines.push(`Time of day: ${env.timeOfDay}`);
  if (env.lighting) lines.push(`Lighting: ${env.lighting}`);
  const pose = env.customPose.trim() || env.pose;
  if (pose) lines.push(`Pose: ${pose}`);
  if (env.props.trim()) lines.push(`Props: ${env.props.trim()}`);
  if (env.camera) lines.push(`Camera: ${env.camera}`);
  if (env.outputFormat) lines.push(`Output format: ${env.outputFormat}`);
  if (env.characters.length > 0) {
    lines.push(`Characters in scene: ${env.characters.length}`);
    env.characters.forEach((c, i) => { if (c.note.trim()) lines.push(`  Character ${i + 1} note: ${c.note.trim()}`); });
  }
  if (env.references.length > 0) {
    env.references.forEach((r, i) => { if (r.note.trim()) lines.push(`Reference ${i + 1}: ${r.note.trim()}`); });
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Layout system — section ordering + collapse state persistence
// ---------------------------------------------------------------------------

type SectionId = "identity" | "generate" | "attributes" | "bible" | "costume" | "styleFusion" | "envPlacement" | "preservation" | "upscaleRestore" | "multiview" | "saveOptions";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "generate", "identity", "attributes", "bible", "costume", "styleFusion", "envPlacement", "preservation", "upscaleRestore", "multiview", "saveOptions",
];

const SECTION_LABELS: Record<SectionId, string> = {
  identity: "Character Identity",
  generate: "Generate Character Image",
  attributes: "Character Attributes",
  bible: "Character Bible",
  costume: "Costume Director",
  styleFusion: "Style Fusion",
  envPlacement: "Environment Placement",
  preservation: "Preservation Lock",
  upscaleRestore: "AI Upscale & Restore",
  multiview: "Multi-View Generation",
  saveOptions: "Save Options",
};

const SECTION_TIPS: Record<SectionId, string> = {
  identity: "Basic info like age, gender, and a description. This is the starting point for your character.",
  generate: "Generate new images, extract details from images, or randomize a character.",
  attributes: "Visual traits like hair, eyes, skin tone, and pose. Fine-tune how your character looks.",
  bible: "The character's story — name, backstory, world, and production style. Gives the AI deeper context.",
  costume: "Everything about what they're wearing — colors, materials, style, and accessories.",
  styleFusion: "Blend two different style influences together. Great for unique, hybrid looks.",
  envPlacement: "Place your character in a real environment instead of a flat background. Set location, lighting, camera, and more.",
  preservation: "Lock specific traits so the AI keeps them when regenerating. Set things it must never include.",
  upscaleRestore: "Make images bigger and sharper (Upscale) or fix AI artifacts and blur (Restore). Only affects images when you hit Generate here.",
  multiview: "Generate consistent front, back, and side views of your character.",
  saveOptions: "Save images, send to Photoshop, export XML, or clear your session.",
};
const NON_COLLAPSIBLE: Set<SectionId> = new Set(["generate"]);
const TOGGLEABLE_SECTIONS: Set<SectionId> = new Set(["identity", "attributes", "bible", "costume", "styleFusion", "envPlacement", "preservation"]);
const PROMPT_EDITABLE_SECTIONS: Set<SectionId> = new Set(["attributes", "bible", "costume", "styleFusion", "envPlacement", "preservation"]);

const TAKE_OPTIONS = [
  "overall vibe", "silhouette", "material & texture", "color palette",
  "detail work & hardware", "cultural reference", "attitude & energy",
];

interface LayoutState {
  order: SectionId[];
  collapsed: Partial<Record<SectionId, boolean>>;
}

function loadDefaultLayout(storageKey: string): LayoutState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutState;
      const allIds = new Set<SectionId>(DEFAULT_SECTION_ORDER);
      const order = parsed.order.filter((id) => allIds.has(id));
      for (const id of DEFAULT_SECTION_ORDER) {
        if (!order.includes(id)) order.push(id);
      }
      return { order, collapsed: parsed.collapsed ?? {} };
    }
  } catch {}
  return { order: [...DEFAULT_SECTION_ORDER], collapsed: { styleFusion: true, envPlacement: true, preservation: true, upscaleRestore: true, multiview: true, saveOptions: true } };
}

interface CharacterPageProps {
  instanceId?: number;
  active?: boolean;
}

export function CharacterPage({ instanceId = 0, active = true }: CharacterPageProps) {
  const layoutStorageKey = `madison-character-layout${instanceId ? `-${instanceId}` : ""}`;
  const sessionKey = `character${instanceId ? `-${instanceId}` : ""}`;
  const [tabs, setTabs] = useState<TabDef[]>(BUILTIN_TABS);
  const [activeTab, setActiveTab] = useState("main");
  const busy = useBusySet();
  const textBusy = busy.is("extract") || busy.is("enhance") || busy.is("randomize");
  const [genText, setGenText] = useState<Record<string, string>>({});

  const [gallery, setGallery] = useState<Record<string, string[]>>({});
  const [imageIdx, setImageIdx] = useState<Record<string, number>>({});

  // Per-image history (keyed by tab + gallery index)
  const [imageRecords, setImageRecords] = useState<Record<string, ImageRecord>>({});
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [age, setAge] = useState("");
  const [race, setRace] = useState("");
  const [gender, setGender] = useState("");
  const [build, setBuild] = useState("");
  const [attributes, setAttributes] = useState<Record<string, { dropdown: string; custom: string }>>(
    Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])),
  );

  const [bible, setBible] = useState<BibleState>({ ...EMPTY_BIBLE });
  const [costume, setCostume] = useState<CostumeState>({ ...EMPTY_COSTUME });
  const [preservation, setPreservation] = useState<PreservationLockState>({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });
  const [styleFusion, setStyleFusion] = useState<StyleFusionState>({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
  const [envPlacement, setEnvPlacement] = useState<EnvironmentPlacementState>({ ...EMPTY_ENV });
  const envCharFileRef = useRef<HTMLInputElement>(null);
  const envRefFileRef = useRef<HTMLInputElement>(null);
  const [styleLibraryFolder, setStyleLibraryFolder] = useState("");
  const [styleLibraryFolders, setStyleLibraryFolders] = useState<{ name: string; guidance_text: string }[]>([]);

  const [prodStylePresets, setProdStylePresets] = useState<TagItem[]>(PRODUCTION_STYLE_PRESETS);
  const [tonePresets, setTonePresets] = useState<TagItem[]>(TONE_TAG_PRESETS);
  const [costumeStylePresets, setCostumeStylePresets] = useState<TagItem[]>(COSTUME_STYLE_PRESETS);
  const [materialPresets, setMaterialPresets] = useState<TagItem[]>(COSTUME_MATERIAL_PRESETS);
  const [hwDetailPresets, setHwDetailPresets] = useState<TagItem[]>(HW_DETAIL_PRESETS);
  const [originPresets, setOriginPresets] = useState<TagItem[]>(COSTUME_ORIGIN_PRESETS);

  const [sectionsOpen, setSectionsOpen] = useState({ attributes: true, bible: false, costume: false });
  const toggleSection = useCallback((key: "attributes" | "bible" | "costume", val: boolean) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: val }));
  }, []);

  const [lockedSections, setLockedSections] = useState({ identity: false, attributes: false, bible: false, costume: false, styleFusion: false, envPlacement: false, preservation: false });
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastContext();
  const { addFavorite, removeFavorite, isFavorited, getFavoriteId } = useFavorites();
  const promptOverrides = usePromptOverrides();
  const { getSectionColor, setSectionColor } = useCustomSections();
  const customSections = useCustomSectionState("character");

  // Prompt editing — right-click context menu + modal
  const TOOL_ID = "character";
  const [promptEditSection, setPromptEditSection] = useState<SectionId | null>(null);
  const [promptCtxMenu, setPromptCtxMenu] = useState<{ x: number; y: number; section: SectionId } | null>(null);

  // Layout ordering + collapse state
  const [layout, setLayout] = useState<LayoutState>(() => loadDefaultLayout(layoutStorageKey));
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);
  const dragItemRef = useRef<SectionId | null>(null);

  // Extract targets — which sections extraction/enhance/randomize populates
  type ExtractTarget = "identity" | "attributes" | "bible" | "costume" | "environment";
  const [extractTargets, setExtractTargets] = useState<Record<ExtractTarget, boolean>>({ identity: true, attributes: true, bible: false, costume: false, environment: false });

  // Extract mode — controls whether generation uses the source image as visual reference
  const [extractMode, setExtractMode] = useState<"inspiration" | "recreate">("inspiration");

  // AI Upscale & Restore state
  const [urMode, setUrMode] = useState<"upscale" | "restore">("upscale");
  const [urScale, setUrScale] = useState<"x2" | "x3" | "x4">("x2");
  const [urContext, setUrContext] = useState("");
  const [urModelId, setUrModelId] = useState("");
  const [urImages, setUrImages] = useState<string[]>([]);
  const urFileRef = useRef<HTMLInputElement>(null);

  // Section ON/OFF — controls whether section data is included in prompts
  const [sectionEnabled, setSectionEnabled] = useState<Partial<Record<SectionId, boolean>>>({ identity: true, attributes: true });
  const isSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return true;
    return sectionEnabled[id] === true;
  }, [sectionEnabled]);
  const SECTION_TO_EXTRACT: Partial<Record<SectionId, ExtractTarget>> = {
    identity: "identity", attributes: "attributes", bible: "bible", costume: "costume", envPlacement: "environment",
  };
  const toggleSectionEnabled = useCallback((id: SectionId) => {
    if (!TOGGLEABLE_SECTIONS.has(id)) return;
    setSectionEnabled((prev) => {
      const next = !prev[id];
      if (next) {
        const target = SECTION_TO_EXTRACT[id];
        if (target) setExtractTargets((p) => ({ ...p, [target]: true }));
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const isSectionCollapsed = useCallback((id: SectionId) => {
    if (NON_COLLAPSIBLE.has(id)) return false;
    if (id === "attributes") return !sectionsOpen.attributes;
    if (id === "bible") return !sectionsOpen.bible;
    if (id === "costume") return !sectionsOpen.costume;
    return layout.collapsed[id] ?? false;
  }, [layout.collapsed, sectionsOpen]);

  const toggleSectionCollapse = useCallback((id: SectionId) => {
    if (NON_COLLAPSIBLE.has(id)) return;
    if (id === "attributes" || id === "bible" || id === "costume") {
      toggleSection(id, !sectionsOpen[id]);
      return;
    }
    setLayout((prev) => ({
      ...prev,
      collapsed: { ...prev.collapsed, [id]: !prev.collapsed[id] },
    }));
  }, [sectionsOpen, toggleSection]);

  const handleDragStart = useCallback((id: SectionId) => {
    dragItemRef.current = id;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: SectionId) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);

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

  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null;
    setDragOverId(null);
  }, []);

  const handleSetDefaultLayout = useCallback(() => {
    const collapsed: Partial<Record<SectionId, boolean>> = {};
    for (const id of layout.order) {
      if (NON_COLLAPSIBLE.has(id)) continue;
      collapsed[id] = isSectionCollapsed(id);
    }
    const state: LayoutState = { order: layout.order, collapsed };
    localStorage.setItem(layoutStorageKey, JSON.stringify(state));
    addToast("Layout saved as default", "success");
  }, [layout.order, isSectionCollapsed, addToast, layoutStorageKey]);

  const refCounter = useRef(0);

  // Listen for project-clear event from ProjectTabsWrapper
  const clearAllState = useCallback(() => {
    setTabs(BUILTIN_TABS);
    setActiveTab("main");
    setGenText({});
    setGallery({});
    setImageIdx({});
    setImageRecords({});
    setActiveHistoryId(null);
    setDescription("");
    setEditPrompt("");
    setAge("");
    setRace("");
    setGender("");
    setBuild("");
    setAttributes(Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])));
    setBible({ ...EMPTY_BIBLE });
    setCostume({ ...EMPTY_COSTUME });
    setPreservation({ ...EMPTY_PRESERVATION, preserves: DEFAULT_PRESERVES.map((p) => ({ ...p })), negatives: DEFAULT_NEGATIVES.map((n) => ({ ...n })) });
    setStyleFusion({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
    setEnvPlacement({ ...EMPTY_ENV });
    setStyleLibraryFolder("");
    setGenCount(1);
    setGenerationMode("single");
    setGridResults([]);
    setGridEditBusy({});
    setViewGenCount(1);
    setUrMode("upscale");
    setUrScale("x2");
    setUrContext("");
    setUrModelId("");
    setUrImages([]);
    setExtractTargets({ identity: true, attributes: true, bible: false, costume: false, environment: false });
    setExtractMode("inspiration");
    setSectionEnabled({ identity: true, attributes: true });
    setLockedSections({ identity: false, attributes: false, bible: false, costume: false, styleFusion: false, envPlacement: false, preservation: false });
    setSectionsOpen({ attributes: true, bible: false, costume: false });
    addToast("Project cleared", "info");
  }, [addToast]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.storageKey === "madison-charlab-projects" && detail?.instanceId === instanceId) {
        clearAllState();
      }
    };
    window.addEventListener("project-clear", handler);
    return () => window.removeEventListener("project-clear", handler);
  }, [instanceId, clearAllState]);

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
  const activeTabDef = tabs.find((t) => t.id === activeTab);

  // History record key
  const historyKey = `${activeTab}:${currentIdx}`;
  const currentRecord = imageRecords[historyKey];
  const currentHistory = currentRecord?.history ?? [];

  const getSettingsSnapshot = useCallback((): HistorySettings => ({
    description, age, race, gender, build, editPrompt,
  }), [description, age, race, gender, build, editPrompt]);

  const addHistoryEntry = useCallback((tab: string, idx: number, label: string, imageSrc: string) => {
    if (tabs.find((t) => t.id === tab)?.group === "refs") return; // refs don't track history
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
    const letter = String.fromCharCode(68 + refCounter.current - 1); // D, E, F...
    const id = `ref${letter}`;
    setTabs((prev) => [...prev, { id, label: `Ref ${letter}`, group: "refs" }]);
    setActiveTab(id);
  }, []);

  const handleRemoveRef = useCallback((tabId: string) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (filtered.length === prev.length) return prev;
      return filtered;
    });
    setActiveTab((prev) => prev === tabId ? "main" : prev);
    setGallery((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    setImageIdx((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
  }, []);

  const handleEditTabPrompt = useCallback((tabId: string, newPrompt: string) => {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, prompt: newPrompt } : t));
  }, []);

  // --- Apply helpers (respect lock) ---

  const applyBibleFromResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data || lockedSections.bible) return;
    setBible((prev) => ({
      ...prev,
      characterName: String(data.characterName ?? prev.characterName ?? ""),
      roleArchetype: String(data.roleArchetype ?? prev.roleArchetype ?? ""),
      backstory: String(data.backstory ?? prev.backstory ?? ""),
      worldContext: String(data.worldContext ?? prev.worldContext ?? ""),
      designIntent: String(data.designIntent ?? prev.designIntent ?? ""),
      productionStyle: Array.isArray(data.productionStyle) ? stringsToTags(data.productionStyle as string[], prodStylePresets) : prev.productionStyle,
      customDirector: String(data.customDirector ?? prev.customDirector ?? ""),
      toneTags: Array.isArray(data.toneTags) ? stringsToTags(data.toneTags as string[], tonePresets) : prev.toneTags,
    }));
    setSectionsOpen((prev) => ({ ...prev, bible: true }));
  }, [lockedSections.bible, prodStylePresets, tonePresets]);

  const applyCostumeFromResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data || lockedSections.costume) return;
    setCostume((prev) => ({
      ...prev,
      costumeStyles: Array.isArray(data.costumeStyles) ? stringsToTags(data.costumeStyles as string[], costumeStylePresets) : prev.costumeStyles,
      costumeMaterials: Array.isArray(data.costumeMaterials) ? stringsToTags(data.costumeMaterials as string[], materialPresets) : prev.costumeMaterials,
      primaryColor: String(data.primaryColor ?? prev.primaryColor ?? ""),
      secondaryColor: String(data.secondaryColor ?? prev.secondaryColor ?? ""),
      accentColor: String(data.accentColor ?? prev.accentColor ?? ""),
      hardwareColor: String(data.hardwareColor ?? prev.hardwareColor ?? ""),
      hwDetails: Array.isArray(data.hwDetails) ? stringsToTags(data.hwDetails as string[], hwDetailPresets) : prev.hwDetails,
      origin: Array.isArray(data.origin) ? stringsToTags(data.origin as string[], originPresets) : prev.origin,
      costumeNotes: String(data.costumeNotes ?? prev.costumeNotes ?? ""),
    }));
    setSectionsOpen((prev) => ({ ...prev, costume: true }));
  }, [lockedSections.costume, costumeStylePresets, materialPresets, hwDetailPresets, originPresets]);

  const applyEnvFromResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data) return;
    setEnvPlacement((prev) => {
      const loc = String(data.location ?? "");
      const isPresetLoc = ENV_LOCATION_PRESETS.includes(loc);
      const timeOfDay = String(data.timeOfDay ?? "");
      const lighting = String(data.lighting ?? "");
      const pose = String(data.pose ?? "");
      const isPresetPose = ENV_POSE_PRESETS.includes(pose);
      const camera = String(data.camera ?? "");
      const outputFormat = String(data.outputFormat ?? prev.outputFormat);
      return {
        ...prev,
        location: isPresetLoc ? loc : (loc ? "__custom" : prev.location),
        customLocation: isPresetLoc ? prev.customLocation : loc,
        timeOfDay: ENV_TIME_OPTIONS.includes(timeOfDay) ? timeOfDay : (timeOfDay || prev.timeOfDay),
        lighting: ENV_LIGHTING_OPTIONS.includes(lighting) ? lighting : (lighting || prev.lighting),
        pose: isPresetPose ? pose : (pose ? "" : prev.pose),
        customPose: isPresetPose ? prev.customPose : pose,
        props: String(data.props ?? prev.props),
        camera: ENV_CAMERA_OPTIONS.includes(camera) ? camera : (camera || prev.camera),
        outputFormat: ENV_FORMAT_OPTIONS.some((f) => f === outputFormat) ? outputFormat : prev.outputFormat,
      };
    });
    setSectionEnabled((prev) => ({ ...prev, envPlacement: true }));
    setLayout((prev) => ({ ...prev, collapsed: { ...prev.collapsed, envPlacement: false } }));
  }, []);

  const applyAttributesFromResponse = useCallback((attrs: Record<string, string> | null | undefined) => {
    if (!attrs || lockedSections.attributes) return;
    setAttributes((prev) => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(attrs)) {
        if (key in next && key !== "Pose") next[key] = { dropdown: String(val), custom: "" };
      }
      return next;
    });
    setSectionsOpen((prev) => ({ ...prev, attributes: true }));
  }, [lockedSections.attributes]);

  const applyFullResponse = useCallback((resp: FullResponse, setDesc = false) => {
    if (extractTargets.identity && !lockedSections.identity) {
      if (setDesc && resp.description) setDescription(resp.description);
      if (resp.age) setAge(matchOption(AGE_OPTIONS, resp.age));
      if (resp.race) setRace(matchOption(RACE_OPTIONS, resp.race));
      if (resp.gender) setGender(matchOption(GENDER_OPTIONS, resp.gender));
      if (resp.build) setBuild(matchOption(BUILD_OPTIONS, resp.build));
    }
    if (extractTargets.attributes) applyAttributesFromResponse(resp.attributes);
    if (extractTargets.bible) applyBibleFromResponse(resp.bible as Record<string, unknown> | null);
    if (extractTargets.costume) applyCostumeFromResponse(resp.costume as Record<string, unknown> | null);
    if (extractTargets.environment) applyEnvFromResponse(resp.environment as Record<string, unknown> | null);
  }, [extractTargets, lockedSections.identity, applyAttributesFromResponse, applyBibleFromResponse, applyCostumeFromResponse, applyEnvFromResponse]);

  // --- Build attribute brief for generation prompt ---

  const buildAttrBrief = useCallback((): string => {
    if (!isSectionEnabled("attributes")) return "";
    const lines: string[] = [];
    for (const [k, v] of Object.entries(attributes)) {
      const val = v.custom || v.dropdown;
      if (val) lines.push(`${k}: ${val}`);
    }
    return lines.length ? `\n\n--- Character Attributes ---\n${lines.join("\n")}` : "";
  }, [attributes, isSectionEnabled]);

  // --- Prompt override helpers ---

  const getDefaultSectionPrompt = useCallback((sectionId: SectionId): string => {
    switch (sectionId) {
      case "attributes": {
        const lines: string[] = [];
        for (const [k, v] of Object.entries(attributes)) {
          const val = v.custom || v.dropdown;
          if (val) lines.push(`${k}: ${val}`);
        }
        return lines.length ? `--- Character Attributes ---\n${lines.join("\n")}` : "";
      }
      case "bible": return bibleToCostumeContext(bible);
      case "costume": return costumeToContext(costume);
      case "styleFusion": return buildFusionBrief(styleFusion);
      case "envPlacement": return buildEnvBrief(envPlacement);
      case "preservation": return preservationToConstraints(preservation);
      default: return "";
    }
  }, [attributes, bible, costume, styleFusion, envPlacement, preservation]);

  const resolveSection = useCallback((sectionId: SectionId): string => {
    if (!isSectionEnabled(sectionId)) return "";
    const override = promptOverrides.getOverride(TOOL_ID, sectionId);
    if (override !== null) return override;
    return getDefaultSectionPrompt(sectionId);
  }, [isSectionEnabled, promptOverrides, getDefaultSectionPrompt]);

  // --- Generation helpers ---

  const getExtraContext = useCallback(() => {
    const fusionCtx = resolveSection("styleFusion");
    const folder = styleLibraryFolders.find((f) => f.name === styleLibraryFolder);
    const styleGuide = folder?.guidance_text || "";
    const envCtx = resolveSection("envPlacement");
    return { fusionCtx, styleGuide, envCtx };
  }, [resolveSection, styleLibraryFolder, styleLibraryFolders]);

  // --- Prompt preview builder (mirrors backend _build_character_prompt + style_rules) ---

  const buildPromptPreview = useCallback((): string => {
    const identityOn = isSectionEnabled("identity");
    const baseDesc = identityOn ? description : "";
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const desc = (baseDesc + attrBrief).trim();
    if (!desc) return "(No description — enter a character description first)";

    const parts: string[] = [];
    const idParts: string[] = [];
    if (identityOn && age) idParts.push(`Age: ${age}`);
    if (identityOn && race) idParts.push(`Race: ${race}`);
    if (identityOn && gender) idParts.push(`Gender: ${gender}`);
    if (identityOn && build) idParts.push(`Build: ${build}`);
    let charPrompt = idParts.length ? `${idParts.join(", ")}\n\n${desc}` : desc;

    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const extra = getExtraContext();
    const lockCtx = resolveSection("preservation");

    if (bibleCtx) charPrompt += `\n\n--- Character Bible ---\n${bibleCtx}`;

    const hasCostume = !!costumeCtx;
    const hasFusion = !!extra.fusionCtx;
    if (hasCostume && hasFusion) {
      charPrompt += `\n\n--- Costume Direction + Style Fusion (MERGED) ---\nCostume Director:\n${costumeCtx}\n\nStyle Fusion:\n${extra.fusionCtx}\n\n(Blended: Costume details as foundation, Style Fusion mood on top)`;
    } else {
      if (hasCostume) charPrompt += `\n\n--- Costume Direction ---\n${costumeCtx}`;
      if (hasFusion) charPrompt += `\n\n--- Style Fusion ---\n${extra.fusionCtx}`;
    }
    if (extra.styleGuide) charPrompt += `\n\n--- Style Library Guidance ---\n${extra.styleGuide}`;
    if (extra.envCtx) charPrompt += `\n\n--- Environment & Placement ---\n${extra.envCtx}`;
    if (lockCtx) charPrompt += `\n\n--- PRESERVATION CONSTRAINTS (HIGHEST PRIORITY) ---\n${lockCtx}`;

    // Style rules
    if (extra.envCtx) {
      parts.push("[STYLE RULES] Realistic 3D-rendered. Place in described environment. Full body head to toe.");
    } else {
      parts.push("[STYLE RULES] Realistic 3D-rendered. Solid flat single-color studio backdrop. NO environmental elements. Full body head to toe.");
      parts.push("\n[POSE RULE] Neutral A-pose unless prompt specifies otherwise.");
    }

    if (extractMode === "recreate" && getImageB64("main")) {
      parts.push(`\n[RECREATE MODE] Main Stage image will be sent as a visual reference. The AI will try to match the character exactly.`);
      parts.push(`\nRecreate this character as accurately as possible — matching face, body, hairstyle, clothing, accessories, colors, and every visual detail.\n\n${charPrompt}`);
    } else {
      parts.push(`\nGenerate a full-body character.\n\n${charPrompt}`);
    }

    // Reference images summary
    const refImgs: string[] = [];
    if (extractMode === "recreate" && getImageB64("main")) refImgs.push("Main Stage image (RECREATE reference)");
    else if (getImageB64("main")) refImgs.push("Main Stage image (reference)");
    if (getImageB64("refA")) refImgs.push("Ref A image");
    if (getImageB64("refB")) refImgs.push("Ref B image");
    if (getImageB64("refC")) refImgs.push("Ref C image");
    if (refImgs.length) parts.push(`\n--- Attached Images ---\n${refImgs.join("\n")}`);

    parts.push(`\n--- Delivery ---\nSent as: ONE single text prompt${refImgs.length ? ` + ${refImgs.length} image(s) attached` : ""}`);

    return parts.join("\n");
  }, [description, age, race, gender, build, attributes, bible, costume, preservation, styleFusion, envPlacement, styleLibraryFolder, styleLibraryFolders, extractMode, isSectionEnabled, buildAttrBrief, getExtraContext, getImageB64]);

  const [promptPreview, setPromptPreview] = useState("");
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [lastSentPrompt, setLastSentPrompt] = useState("");

  // --- Generation handlers ---

  const handleGenerate = useCallback(async () => {
    const identityOn = isSectionEnabled("identity");
    const baseDesc = identityOn ? description : "";
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const desc = (baseDesc + attrBrief).trim();
    const extra = getExtraContext();
    if (!desc) return;
    setLastSentPrompt(buildPromptPreview());
    busy.start("generate");
    const total = genCount;
    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const lockCtx = resolveSection("preservation");
    const mainRef = extractMode === "recreate" ? getMainImageB64() : null;
    const customCtx = customSections.getPromptContributions() || undefined;
    const customImgs = customSections.getImageAttachments().map((img) => img.replace(/^data:image\/\w+;base64,/, "")).filter(Boolean);
    setGenText((p) => ({ ...p, generate: total > 1 ? `Generating ${total} images...` : "Generating character..." }));
    const promises = Array.from({ length: total }, (_, i) =>
      apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        "/character/generate", {
          method: "POST",
          body: JSON.stringify({
            description: desc,
            age: identityOn ? age : "", race: identityOn ? race : "",
            gender: identityOn ? gender : "", build: identityOn ? build : "",
            view_type: "main", mode: "quality",
            model_id: modelId || undefined,
            bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
            fusion_context: extra.fusionCtx || undefined,
            fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
            lock_constraints: lockCtx || undefined,
            reference_image_b64: mainRef || undefined,
            recreate_mode: extractMode === "recreate",
            custom_sections_context: customCtx,
            custom_section_images: customImgs.length ? customImgs : undefined,
          }),
        },
      ).then((resp) => ({ ok: true as const, resp, idx: i }))
       .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), idx: i })),
    );
    const results = await Promise.all(promises);
    for (const r of results.sort((a, b) => a.idx - b.idx)) {
      if (r.ok && r.resp.image_b64) {
        const src = `data:image/png;base64,${r.resp.image_b64}`;
        if (r.idx === 0) setTabImage("main", src, "Initial generation");
        else appendToGallery("main", src, `Generation ${r.idx + 1}`);
      } else if (r.ok && r.resp.error) { addToast(r.resp.error, "error"); }
      else if (!r.ok) { addToast(r.error, "error"); }
    }
    addToast(total > 1 ? `Generated ${total} images` : "Character generated", "success");
    busy.end("generate");
  }, [description, age, race, gender, build, genCount, modelId, bible, costume, preservation, attributes, extractMode, isSectionEnabled, getExtraContext, buildAttrBrief, buildPromptPreview, getMainImageB64, setTabImage, appendToGallery, addToast, busy, styleFusion]);

  const handleApplyEdit = useCallback(async () => {
    if (!editPrompt.trim()) return;
    const mainB64 = getMainImageB64();
    if (!mainB64) return;
    busy.start("apply");
    setGenText((p) => ({ ...p, apply: "Applying edits..." }));
    const identityOn = isSectionEnabled("identity");
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const lockCtx = resolveSection("preservation");
    const extra = getExtraContext();
    try {
      const resp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        "/character/edit", {
          method: "POST",
          body: JSON.stringify({
            description: ((identityOn ? description : "") + attrBrief).trim(),
            age: identityOn ? age : "", race: identityOn ? race : "",
            gender: identityOn ? gender : "", build: identityOn ? build : "",
            edit_prompt: editPrompt, reference_image_b64: mainB64,
            ref_a_b64: getImageB64("refA"), ref_b_b64: getImageB64("refB"), ref_c_b64: getImageB64("refC"),
            mode: "quality", model_id: modelId || undefined,
            bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
            fusion_context: extra.fusionCtx || undefined,
            fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
            lock_constraints: lockCtx || undefined,
          }),
        },
      );
      if (resp.image_b64) {
        setTabImage("main", `data:image/png;base64,${resp.image_b64}`, `Edit: ${editPrompt.slice(0, 40)}`);
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("apply");
  }, [editPrompt, description, age, race, gender, build, attributes, bible, costume, preservation, isSectionEnabled, getExtraContext, buildAttrBrief, getMainImageB64, getImageB64, modelId, setTabImage, addToast, busy, styleFusion]);

  const handleExtractAttributes = useCallback(async () => {
    const imgB64 = getMainImageB64();
    if (!description.trim() && !imgB64) {
      addToast("Provide a description or paste an image first", "error");
      return;
    }
    busy.start("extract");
    try {
      const payload: Record<string, string> = { description: description.trim() };
      if (imgB64) payload.image_b64 = imgB64;
      const resp = await apiFetch<FullResponse>(
        "/character/extract-attributes", { method: "POST", body: JSON.stringify(payload) },
      );
      if (resp.error) { addToast(resp.error, "error"); busy.end("extract"); return; }
      applyFullResponse(resp, !description.trim());
      addToast("Attributes extracted", "success");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("extract");
  }, [description, getMainImageB64, addToast, busy, applyFullResponse]);

  const buildContextBody = useCallback(() => {
    const identityOn = isSectionEnabled("identity");
    const attrOn = isSectionEnabled("attributes");
    const bibleOn = isSectionEnabled("bible");
    const costumeOn = isSectionEnabled("costume");

    const attrFlat: Record<string, string> = {};
    if (attrOn) {
      for (const [k, v] of Object.entries(attributes)) {
        attrFlat[k] = v.custom || v.dropdown;
      }
    }
    return {
      description: identityOn ? description : "",
      age: identityOn ? age : "", race: identityOn ? race : "",
      gender: identityOn ? gender : "", build: identityOn ? build : "",
      attributes: attrFlat,
      bible: bibleOn ? {
        characterName: bible.characterName,
        roleArchetype: bible.roleArchetype,
        backstory: bible.backstory,
        worldContext: bible.worldContext,
        designIntent: bible.designIntent,
        productionStyle: bible.productionStyle.map((t) => t.prompt || t.label),
        customDirector: bible.customDirector,
        toneTags: bible.toneTags.map((t) => t.prompt || t.label),
      } : { characterName: "", roleArchetype: "", backstory: "", worldContext: "", designIntent: "", productionStyle: [] as string[], customDirector: "", toneTags: [] as string[] },
      costume: costumeOn ? {
        costumeStyles: costume.costumeStyles.map((t) => t.prompt || t.label),
        costumeMaterials: costume.costumeMaterials.map((t) => t.prompt || t.label),
        primaryColor: costume.primaryColor,
        secondaryColor: costume.secondaryColor,
        accentColor: costume.accentColor,
        hardwareColor: costume.hardwareColor,
        hwDetails: costume.hwDetails.map((t) => t.prompt || t.label),
        origin: costume.origin.map((t) => t.prompt || t.label),
        costumeNotes: costume.costumeNotes,
      } : { costumeStyles: [] as string[], costumeMaterials: [] as string[], primaryColor: "", secondaryColor: "", accentColor: "", hardwareColor: "", hwDetails: [] as string[], origin: [] as string[], costumeNotes: "" },
    };
  }, [description, age, race, gender, build, attributes, bible, costume, isSectionEnabled]);

  const handleEnhance = useCallback(async () => {
    const ctx = buildContextBody();
    const hasAnything = ctx.description.trim() || ctx.age || ctx.race || ctx.gender || ctx.build
      || Object.values(ctx.attributes).some((v) => v)
      || Object.values(ctx.bible).some((v) => (Array.isArray(v) ? v.length > 0 : !!v))
      || Object.values(ctx.costume).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
    if (!hasAnything) { addToast("Enter something to enhance first", "info"); return; }
    busy.start("enhance");
    try {
      const resp = await apiFetch<FullResponse>(
        "/character/enhance", { method: "POST", body: JSON.stringify(ctx) },
      );
      if (resp.description) {
        applyFullResponse(resp, true);
        addToast("Character enhanced", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("enhance");
  }, [buildContextBody, addToast, busy, applyFullResponse]);

  const handleRandomize = useCallback(async () => {
    busy.start("randomize");
    try {
      const ctx = buildContextBody();
      const resp = await apiFetch<FullResponse>("/character/randomize-full", { method: "POST", body: JSON.stringify(ctx) });
      if (resp.description) {
        applyFullResponse(resp, true);
        addToast("Random character generated", "success");
      } else if (resp.error) addToast(resp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("randomize");
  }, [buildContextBody, addToast, busy, applyFullResponse]);

  const handleQuickGenerate = useCallback(async () => {
    busy.start("quickgen");
    const extra = getExtraContext();
    setGenText((p) => ({ ...p, quickgen: "Randomizing character..." }));
    try {
      const randResp = await apiFetch<FullResponse>("/character/randomize-full", { method: "POST", body: JSON.stringify(buildContextBody()) });
      if (randResp.description) {
        applyFullResponse(randResp, true);
        setGenText((p) => ({ ...p, quickgen: "Generating image..." }));
        const bibleCtx = isSectionEnabled("bible") && randResp.bible ? bibleToCostumeContext(randResp.bible as unknown as BibleState) : undefined;
        const costumeCtx = isSectionEnabled("costume") && randResp.costume ? costumeToContext(randResp.costume as unknown as CostumeState) : undefined;
        const lockCtx = isSectionEnabled("preservation") ? preservationToConstraints(preservation) : "";
        const randAttrLines: string[] = [];
        if (randResp.attributes) {
          for (const [k, v] of Object.entries(randResp.attributes)) {
            if (v) randAttrLines.push(`${k}: ${v}`);
          }
        }
        const randAttrBrief = randAttrLines.length ? `\n\n--- Character Attributes ---\n${randAttrLines.join("\n")}` : "";
        const genResp = await apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
          "/character/generate", {
            method: "POST",
            body: JSON.stringify({
              description: (randResp.description + randAttrBrief).trim(), age: randResp.age, race: randResp.race,
              gender: randResp.gender, build: randResp.build, mode: "quality",
              model_id: modelId || undefined,
              bible_context: bibleCtx, costume_context: costumeCtx,
              fusion_context: extra.fusionCtx || undefined,
              fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
              fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
              style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
              lock_constraints: lockCtx || undefined,
            }),
          },
        );
        if (genResp.image_b64) { setTabImage("main", `data:image/png;base64,${genResp.image_b64}`, "Quick generate"); addToast("Quick generate complete", "success"); }
        else if (genResp.error) addToast(genResp.error, "error");
      } else if (randResp.error) addToast(randResp.error, "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
    busy.end("quickgen");
  }, [buildContextBody, addToast, modelId, preservation, isSectionEnabled, getExtraContext, setTabImage, busy, applyFullResponse, styleFusion]);

  const handleGenerateAllViews = useCallback(async () => {
    const mainB64 = getMainImageB64();
    const identityOn = isSectionEnabled("identity");
    const baseDesc = identityOn ? description : "";
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const desc = (baseDesc + attrBrief).trim();
    if (!mainB64 || !desc) return;
    busy.start("allviews");
    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const lockCtx = resolveSection("preservation");
    const extra = getExtraContext();
    const views = ["3/4", "front", "back", "side"];
    setGenText((p) => ({ ...p, allviews: "Generating all views..." }));
    const promises = views.map((view) =>
      apiFetch<{ image_b64: string | null; width: number; height: number }>("/character/generate", {
        method: "POST",
        body: JSON.stringify({
          description: desc, age: identityOn ? age : "", race: identityOn ? race : "",
          gender: identityOn ? gender : "", build: identityOn ? build : "",
          view_type: VIEW_TYPE_MAP[view] || view, reference_image_b64: mainB64,
          mode: "quality", model_id: modelId || undefined,
          bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
          fusion_context: extra.fusionCtx || undefined,
          fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
          fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
          style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
          lock_constraints: lockCtx || undefined,
        }),
      }).then((resp) => ({ ok: true as const, resp, view }))
        .catch(() => ({ ok: false as const, resp: null, view })),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.ok && r.resp?.image_b64) setTabImage(r.view, `data:image/png;base64,${r.resp.image_b64}`, `${r.view} view`);
    }
    busy.end("allviews");
  }, [description, age, race, gender, build, attributes, bible, costume, preservation, isSectionEnabled, getExtraContext, buildAttrBrief, getMainImageB64, modelId, setTabImage, busy, styleFusion]);

  const handleGenerateSelectedView = useCallback(async () => {
    const mainB64 = getMainImageB64();
    const identityOn = isSectionEnabled("identity");
    const baseDesc = identityOn ? description : "";
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const desc = (baseDesc + attrBrief).trim();
    if (!mainB64 || !desc || !activeTabDef) return;
    const viewType = VIEW_TYPE_MAP[activeTab] || activeTab;
    busy.start("selview");
    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const lockCtx = resolveSection("preservation");
    const extra = getExtraContext();
    const total = viewGenCount;
    const promptOverride = activeTabDef.prompt ? ` Specifically: ${activeTabDef.prompt}` : "";
    setGenText((p) => ({ ...p, selview: total > 1 ? `Generating ${total} ${activeTabDef.label} views...` : `Generating ${activeTabDef.label}...` }));
    const promises = Array.from({ length: total }, (_, i) =>
      apiFetch<{ image_b64: string | null; width: number; height: number }>("/character/generate", {
        method: "POST",
        body: JSON.stringify({
          description: desc + promptOverride,
          age: identityOn ? age : "", race: identityOn ? race : "",
          gender: identityOn ? gender : "", build: identityOn ? build : "",
          view_type: viewType, reference_image_b64: mainB64,
          mode: "quality", model_id: modelId || undefined,
          bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
          fusion_context: extra.fusionCtx || undefined,
          fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
          fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
          style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
          lock_constraints: lockCtx || undefined,
        }),
      }).then((resp) => ({ ok: true as const, resp, idx: i }))
        .catch(() => ({ ok: false as const, resp: null, idx: i })),
    );
    const results = await Promise.all(promises);
    for (const r of results.sort((a, b) => a.idx - b.idx)) {
      if (r.ok && r.resp?.image_b64) {
        const src = `data:image/png;base64,${r.resp.image_b64}`;
        if (r.idx === 0) setTabImage(activeTab, src, `${activeTabDef.label} view`);
        else appendToGallery(activeTab, src, `${activeTabDef.label} #${r.idx + 1}`);
      }
    }
    busy.end("selview");
  }, [description, age, race, gender, build, attributes, bible, costume, preservation, isSectionEnabled, getExtraContext, buildAttrBrief, getMainImageB64, modelId, activeTab, activeTabDef, viewGenCount, setTabImage, appendToGallery, busy, styleFusion]);

  // --- Editor context for inpainting tools (ref images + style) ---

  const editorRefImages = useMemo(() => {
    const refs: string[] = [];
    for (const tab of ["refA", "refB", "refC"]) {
      const b64 = getImageB64(tab);
      if (b64) refs.push(b64);
    }
    return refs;
  }, [getImageB64]);

  const editorStyleContext = useMemo(() => {
    const parts: string[] = [];
    const costumeCtx = resolveSection("costume");
    const extra = getExtraContext();
    if (costumeCtx) parts.push(`Costume: ${costumeCtx}`);
    if (extra.fusionCtx) parts.push(`Style Fusion: ${extra.fusionCtx}`);
    if (extra.styleGuide) parts.push(`Style Library: ${extra.styleGuide}`);
    const bibleCtx = resolveSection("bible");
    if (bibleCtx) parts.push(`Character Bible: ${bibleCtx}`);
    return parts.join("\n\n");
  }, [resolveSection, getExtraContext]);

  // --- AI Upscale & Restore handler ---
  const handleUpscaleRestoreGenerate = useCallback(async () => {
    const busyKey = urMode === "upscale" ? "upscale" : "restore";
    busy.start(busyKey);
    const endpoint = urMode === "upscale" ? "/character/upscale" : "/character/restore";
    const images = urImages.length > 0 ? [...urImages] : [getMainImageB64()].filter(Boolean) as string[];
    if (images.length === 0) {
      addToast("No images to process — add images or generate one on Main Stage first", "error");
      busy.end(busyKey);
      return;
    }
    const label = urMode === "upscale" ? "Upscaled" : "Restored";
    setGenText((p) => ({ ...p, [busyKey]: images.length > 1 ? `Processing ${images.length} images...` : "Processing..." }));
    const promises = images.map((img, i) => {
      const raw = img.replace(/^data:image\/[^;]+;base64,/, "");
      const body: Record<string, unknown> = { image_b64: raw, model_id: urModelId || undefined };
      if (urMode === "upscale") body.scale_factor = urScale;
      if (urContext.trim()) body.context = urContext.trim();
      return apiFetch<{ image_b64?: string; width?: number; height?: number; error?: string }>(endpoint, { method: "POST", body: JSON.stringify(body) })
        .then((resp) => ({ ok: true as const, resp, idx: i }))
        .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err), idx: i }));
    });
    const results = await Promise.all(promises);
    for (const r of results.sort((a, b) => a.idx - b.idx)) {
      if (r.ok && r.resp.error) { addToast(r.resp.error, "error"); continue; }
      if (r.ok && r.resp.image_b64) {
        const src = `data:image/png;base64,${r.resp.image_b64}`;
        if (r.idx === 0) setTabImage("main", src, `${label} image`);
        else appendToGallery("main", src, `${label} #${r.idx + 1}`);
      } else if (!r.ok) { addToast(`Failed on image ${r.idx + 1}: ${r.error}`, "error"); }
    }
    setGenText((p) => { const next = { ...p }; delete next[busyKey]; return next; });
    busy.end(busyKey);
  }, [urMode, urScale, urContext, urModelId, urImages, getMainImageB64, setTabImage, appendToGallery, addToast, busy]);

  const handleCancel = useCallback(async () => {
    cancelAllRequests();
    busy.endAll();
    try { await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/system/cancel`, { method: "POST" }); } catch { /* */ }
  }, [busy]);

  const handleGridGenerate = useCallback(async () => {
    const identityOn = isSectionEnabled("identity");
    const baseDesc = identityOn ? description : "";
    const attrText = resolveSection("attributes");
    const attrBrief = attrText ? `\n\n${attrText}` : "";
    const desc = (baseDesc + attrBrief).trim();
    const extra = getExtraContext();
    if (!desc) return;
    busy.start("generate");
    const bibleCtx = resolveSection("bible");
    const costumeCtx = resolveSection("costume");
    const lockCtx = resolveSection("preservation");
    const mainRef = extractMode === "recreate" ? getMainImageB64() : null;
    setGenText((p) => ({ ...p, generate: "Generating 16 images..." }));
    const promises = Array.from({ length: 16 }, (_, i) =>
      apiFetch<{ image_b64: string | null; width: number; height: number; error: string | null }>(
        "/character/generate", {
          method: "POST",
          body: JSON.stringify({
            description: desc,
            age: identityOn ? age : "", race: identityOn ? race : "",
            gender: identityOn ? gender : "", build: identityOn ? build : "",
            view_type: "main", mode: "quality",
            model_id: modelId || undefined,
            bible_context: bibleCtx || undefined, costume_context: costumeCtx || undefined,
            fusion_context: extra.fusionCtx || undefined,
            fusion_image_1_b64: styleFusion.slots[0].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            fusion_image_2_b64: styleFusion.slots[1].image?.replace(/^data:image\/\w+;base64,/, "") || undefined,
            style_guidance: extra.styleGuide || undefined, env_context: extra.envCtx || undefined,
            lock_constraints: lockCtx || undefined,
            reference_image_b64: mainRef || undefined,
            recreate_mode: extractMode === "recreate",
          }),
        },
      ).then((resp) => ({ ok: true as const, resp, idx: i }))
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
    busy.end("generate");
  }, [description, age, race, gender, build, modelId, bible, costume, preservation, attributes, extractMode, isSectionEnabled, getExtraContext, buildAttrBrief, getMainImageB64, addToast, busy, styleFusion]);

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
        "/character/generate",
        {
          method: "POST",
          body: JSON.stringify({
            description: editText,
            reference_image_b64: result.image_b64,
            edit_prompt: editText,
            model_id: modelId || undefined,
            view_type: "main",
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
  }, [gridResults, modelId, addToast]);

  const handleOpenImage = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setTabImage(activeTab, reader.result as string, "Opened image");
    reader.readAsDataURL(file); e.target.value = "";
  }, [activeTab, setTabImage]);

  const handleSaveImage = useCallback(() => {
    if (!currentSrc) return;
    const a = document.createElement("a"); a.href = currentSrc;
    a.download = `character_${activeTab}_${Date.now()}.png`; a.click();
  }, [currentSrc, activeTab]);

  const handleCopyImage = useCallback(async () => {
    if (!currentSrc) return;
    try { const resp = await fetch(currentSrc); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); addToast("Image copied", "info"); }
    catch { addToast("Failed to copy", "error"); }
  }, [currentSrc, addToast]);

  const handleSendToPS = useCallback(async () => {
    if (!currentSrc) { addToast("No image to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images: [{ label: activeTab, image_b64: currentSrc }] }) },
      );
      if (resp.ok) addToast(resp.results[0]?.message || "Sent to Photoshop", "success");
      else addToast(resp.results[0]?.message || "Failed to send", "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [currentSrc, activeTab, addToast]);

  const handleSendAllToPS = useCallback(async () => {
    const viewTabs = ["main", "front", "back", "side"];
    const images: { label: string; image_b64: string }[] = [];
    for (const tab of viewTabs) {
      const b64 = getImageB64(tab);
      if (b64) images.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
    }
    if (images.length === 0) { addToast("No Main/Front/Back/Side images to send", "error"); return; }
    try {
      const resp = await apiFetch<{ ok: boolean; results: { label: string; message: string }[] }>(
        "/system/send-to-ps", { method: "POST", body: JSON.stringify({ images }) },
      );
      const sent = resp.results.filter((r) => (r as unknown as { ok?: boolean }).ok).length;
      addToast(`Sent ${sent} image${sent !== 1 ? "s" : ""} to Photoshop`, sent > 0 ? "success" : "error");
    } catch (e) { addToast(e instanceof Error ? e.message : String(e), "error"); }
  }, [getImageB64, addToast]);

  const handlePasteImage = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) {
        setTabImage(activeTab, dataUrl, "Pasted image");
      } else {
        addToast("No image found in clipboard", "error");
      }
    } catch (err) {
      addToast(`Paste failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab, setTabImage, addToast]);

  const handleClearImage = useCallback(() => {
    setGallery((prev) => {
      const imgs = prev[activeTab] || [];
      if (imgs.length <= 1) return { ...prev, [activeTab]: [] };
      const arr = [...imgs];
      arr.splice(currentIdx, 1);
      return { ...prev, [activeTab]: arr };
    });
    setImageIdx((prev) => {
      const newIdx = Math.max(0, currentIdx - 1);
      return { ...prev, [activeTab]: newIdx };
    });
  }, [activeTab, currentIdx]);

  const handleClearAllImages = useCallback(() => {
    setGallery((prev) => ({ ...prev, [activeTab]: [] }));
    setImageIdx((prev) => ({ ...prev, [activeTab]: 0 }));
  }, [activeTab]);

  const handleImageEdited = useCallback((newSrc: string, label: string) => {
    const idx = currentIdx;
    setGallery((prev) => {
      const arr = [...(prev[activeTab] || [])];
      arr[idx] = newSrc;
      return { ...prev, [activeTab]: arr };
    });
    addHistoryEntry(activeTab, idx, label, newSrc);
  }, [activeTab, currentIdx, addHistoryEntry]);

  const handleReset = useCallback(() => {
    setGallery({}); setImageIdx({}); setImageRecords({}); setDescription(""); setEditPrompt("");
    setAttributes(Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])));
    setBible({ ...EMPTY_BIBLE }); setCostume({ ...EMPTY_COSTUME });
    setSectionsOpen({ attributes: false, bible: false, costume: false });
    setTabs(BUILTIN_TABS);
  }, []);

  const { clearAll: clearAllSession } = useSessionContext();
  const handleClearCache = useCallback(() => {
    clearAllSession();
    apiFetch("/system/clear-cache", { method: "POST" }).catch(() => {});
    addToast("All session cache cleared", "success");
  }, [clearAllSession, addToast]);

  const handlePrevImage = useCallback(() => { setImageIdx((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] ?? 0) - 1) })); setActiveHistoryId(null); }, [activeTab]);
  const handleNextImage = useCallback(() => { const max = (gallery[activeTab] || []).length - 1; setImageIdx((prev) => ({ ...prev, [activeTab]: Math.min(max, (prev[activeTab] ?? 0) + 1) })); setActiveHistoryId(null); }, [activeTab, gallery]);

  const [showXml, setShowXml] = useState(false);
  const buildCharacterXml = useCallback(() => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const tag = (name: string, val: string, indent = "  ") => val ? `${indent}<${name}>${esc(val)}</${name}>` : "";
    const tagList = (name: string, items: TagItem[], indent = "    ") =>
      items.length ? items.map((t) => `${indent}<${name}>${esc(t.label)}</${name}>`).join("\n") : "";

    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Character>"];

    lines.push("  <Identity>");
    lines.push(tag("Description", description, "    "));
    lines.push(tag("Age", age, "    "));
    lines.push(tag("Race", race, "    "));
    lines.push(tag("Gender", gender, "    "));
    lines.push(tag("Build", build, "    "));
    lines.push("  </Identity>");

    lines.push("  <Attributes>");
    for (const [key, val] of Object.entries(attributes)) {
      const text = val.custom || val.dropdown;
      if (text) lines.push(`    <${key}>${esc(text)}</${key}>`);
    }
    lines.push("  </Attributes>");

    lines.push("  <Bible>");
    lines.push(tag("CharacterName", bible.characterName, "    "));
    lines.push(tag("RoleArchetype", bible.roleArchetype, "    "));
    lines.push(tag("Backstory", bible.backstory, "    "));
    lines.push(tag("WorldContext", bible.worldContext, "    "));
    lines.push(tag("DesignIntent", bible.designIntent, "    "));
    if (bible.productionStyle.length) { lines.push("    <ProductionStyles>"); lines.push(tagList("Style", bible.productionStyle)); lines.push("    </ProductionStyles>"); }
    lines.push(tag("CustomDirector", bible.customDirector, "    "));
    if (bible.toneTags.length) { lines.push("    <ToneTags>"); lines.push(tagList("Tag", bible.toneTags)); lines.push("    </ToneTags>"); }
    lines.push("  </Bible>");

    lines.push("  <Costume>");
    if (costume.costumeStyles.length) { lines.push("    <Styles>"); lines.push(tagList("Style", costume.costumeStyles)); lines.push("    </Styles>"); }
    if (costume.costumeMaterials.length) { lines.push("    <Materials>"); lines.push(tagList("Material", costume.costumeMaterials)); lines.push("    </Materials>"); }
    lines.push(tag("PrimaryColor", costume.primaryColor, "    "));
    lines.push(tag("SecondaryColor", costume.secondaryColor, "    "));
    lines.push(tag("AccentColor", costume.accentColor, "    "));
    lines.push(tag("HardwareColor", costume.hardwareColor, "    "));
    if (costume.hwDetails.length) { lines.push("    <HardwareDetails>"); lines.push(tagList("Detail", costume.hwDetails)); lines.push("    </HardwareDetails>"); }
    if (costume.origin.length) { lines.push("    <Origin>"); lines.push(tagList("Item", costume.origin)); lines.push("    </Origin>"); }
    lines.push(tag("CostumeNotes", costume.costumeNotes, "    "));
    lines.push("  </Costume>");

    lines.push("</Character>");
    return lines.filter((l) => l).join("\n");
  }, [description, age, race, gender, build, attributes, bible, costume]);

  // History handlers
  const handleHistoryRestore = useCallback((entryId: string) => {
    const entry = currentHistory.find((h) => h.id === entryId);
    if (!entry) return;
    setActiveHistoryId(entryId);
    // Restore image
    setGallery((prev) => {
      const arr = [...(prev[activeTab] || [])];
      arr[currentIdx] = entry.image_b64;
      return { ...prev, [activeTab]: arr };
    });
    // Restore settings
    if (entry.settings) {
      if (entry.settings.description) setDescription(entry.settings.description);
      if (entry.settings.age) setAge(entry.settings.age);
      if (entry.settings.race) setRace(entry.settings.race);
      if (entry.settings.gender) setGender(entry.settings.gender);
      if (entry.settings.build) setBuild(entry.settings.build);
      if (entry.settings.editPrompt) setEditPrompt(entry.settings.editPrompt);
    }
  }, [activeTab, currentIdx, currentHistory]);

  const handleRestoreCurrent = useCallback(() => {
    setActiveHistoryId(null);
    if (currentRecord?.currentImage) {
      setGallery((prev) => {
        const arr = [...(prev[activeTab] || [])];
        arr[currentIdx] = currentRecord.currentImage;
        return { ...prev, [activeTab]: arr };
      });
    }
  }, [activeTab, currentIdx, currentRecord]);

  const handleClearHistory = useCallback(() => {
    setImageRecords((prev) => {
      const key = historyKey;
      if (!prev[key]) return prev;
      return { ...prev, [key]: clearHist(prev[key]) };
    });
    setActiveHistoryId(null);
  }, [historyKey]);

  const modelOptions = models.map((m) => ({ value: m.id, label: `${m.label} — ${m.resolution} (${m.time_estimate})` }));

  // --- Character Lab keyboard shortcuts ---
  const { registerAction: regCharAction, unregisterAction: unregCharAction } = useShortcuts();
  const charHandlersRef = useRef({
    generate: handleGenerate,
    quickGen: handleQuickGenerate,
    allViews: handleGenerateAllViews,
    extract: handleExtractAttributes,
    enhance: handleEnhance,
    randomize: handleRandomize,
    showXml: () => setShowXml(true),
    sendPS: handleSendToPS,
  });
  charHandlersRef.current = {
    generate: handleGenerate,
    quickGen: handleQuickGenerate,
    allViews: handleGenerateAllViews,
    extract: handleExtractAttributes,
    enhance: handleEnhance,
    randomize: handleRandomize,
    showXml: () => setShowXml(true),
    sendPS: handleSendToPS,
  };

  useEffect(() => {
    if (!active) return;
    regCharAction("charGenerate", () => charHandlersRef.current.generate());
    regCharAction("charQuickGen", () => charHandlersRef.current.quickGen());
    regCharAction("charAllViews", () => charHandlersRef.current.allViews());
    regCharAction("charExtract", () => charHandlersRef.current.extract());
    regCharAction("charEnhance", () => charHandlersRef.current.enhance());
    regCharAction("charRandomize", () => charHandlersRef.current.randomize());
    regCharAction("charShowXml", () => charHandlersRef.current.showXml());
    regCharAction("charSendPS", () => charHandlersRef.current.sendPS());
    return () => {
      for (const id of ["charGenerate", "charQuickGen", "charAllViews", "charExtract", "charEnhance", "charRandomize", "charShowXml", "charSendPS"]) {
        unregCharAction(id);
      }
    };
  }, [active, regCharAction, unregCharAction]);

  // --- Session save/load ---
  useSessionRegister(
    sessionKey,
    () => ({
      tabs, activeTab, gallery, imageIdx, description, editPrompt,
      age, race, gender, build, attributes, bible, costume,
      prodStylePresets, tonePresets, costumeStylePresets, materialPresets, hwDetailPresets, originPresets,
      sectionsOpen, lockedSections, sectionEnabled, extractTargets, extractMode, styleFusion, envPlacement, styleLibraryFolder, genCount, viewGenCount, modelId, urMode, urScale, urContext, urModelId,
    }),
    (s: unknown) => {
      if (s === null) {
        setGallery({}); setImageIdx({}); setImageRecords({}); setDescription(""); setEditPrompt("");
        setAge(""); setRace(""); setGender(""); setBuild("");
        setAttributes(Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, { dropdown: f === "Pose" ? "A pose" : "", custom: "" }])));
        setBible({ ...EMPTY_BIBLE }); setCostume({ ...EMPTY_COSTUME });
        setSectionsOpen({ attributes: true, bible: false, costume: false });
        setLockedSections({ identity: false, attributes: false, bible: false, costume: false, styleFusion: false, envPlacement: false, preservation: false });
        setSectionEnabled({ identity: true, attributes: true });
        setExtractTargets({ identity: true, attributes: true, bible: false, costume: false, environment: false });
        setExtractMode("inspiration");
        setStyleFusion({ ...EMPTY_FUSION, slots: [{ ...EMPTY_FUSION.slots[0] }, { ...EMPTY_FUSION.slots[1] }] });
        setEnvPlacement({ ...EMPTY_ENV });
        setStyleLibraryFolder("");
        setTabs(BUILTIN_TABS); setActiveTab("main");
        setGenCount(1); setViewGenCount(1);
        return;
      }
      const d = s as Record<string, unknown>;
      if (d.tabs) setTabs(d.tabs as TabDef[]);
      if (typeof d.activeTab === "string") setActiveTab(d.activeTab);
      if (d.gallery) setGallery(d.gallery as Record<string, string[]>);
      if (d.imageIdx) setImageIdx(d.imageIdx as Record<string, number>);
      if (typeof d.description === "string") setDescription(d.description);
      if (typeof d.editPrompt === "string") setEditPrompt(d.editPrompt);
      if (typeof d.age === "string") setAge(d.age);
      if (typeof d.race === "string") setRace(d.race);
      if (typeof d.gender === "string") setGender(d.gender);
      if (typeof d.build === "string") setBuild(d.build);
      if (d.attributes) setAttributes(d.attributes as typeof attributes);
      if (d.bible) setBible(d.bible as typeof bible);
      if (d.costume) setCostume(d.costume as typeof costume);
      if (d.prodStylePresets) setProdStylePresets(d.prodStylePresets as TagItem[]);
      if (d.tonePresets) setTonePresets(d.tonePresets as TagItem[]);
      if (d.costumeStylePresets) setCostumeStylePresets(d.costumeStylePresets as TagItem[]);
      if (d.materialPresets) setMaterialPresets(d.materialPresets as TagItem[]);
      if (d.hwDetailPresets) setHwDetailPresets(d.hwDetailPresets as TagItem[]);
      if (d.originPresets) setOriginPresets(d.originPresets as TagItem[]);
      if (d.sectionsOpen) setSectionsOpen(d.sectionsOpen as typeof sectionsOpen);
      if (d.lockedSections) setLockedSections(d.lockedSections as typeof lockedSections);
      if (d.sectionEnabled) setSectionEnabled(d.sectionEnabled as typeof sectionEnabled);
      if (d.extractTargets) setExtractTargets(d.extractTargets as typeof extractTargets);
      if (typeof d.extractMode === "string") setExtractMode(d.extractMode as "inspiration" | "recreate");
      if (d.styleFusion) setStyleFusion(d.styleFusion as StyleFusionState);
      if (d.envPlacement) setEnvPlacement(d.envPlacement as EnvironmentPlacementState);
      if (typeof d.styleLibraryFolder === "string") setStyleLibraryFolder(d.styleLibraryFolder);
      if (typeof d.genCount === "number") setGenCount(d.genCount);
      if (typeof d.viewGenCount === "number") setViewGenCount(d.viewGenCount);
      if (typeof d.modelId === "string") setModelId(d.modelId);
      if (typeof d.urMode === "string") setUrMode(d.urMode as "upscale" | "restore");
      if (typeof d.urScale === "string") setUrScale(d.urScale as "x2" | "x3" | "x4");
      if (typeof d.urContext === "string") setUrContext(d.urContext);
      if (typeof d.urModelId === "string") setUrModelId(d.urModelId);
    },
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* Left Column */}
      <div className="w-[400px] h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
        {layout.order.map((sectionId) => {
          const collapsed = isSectionCollapsed(sectionId);
          const canCollapse = !NON_COLLAPSIBLE.has(sectionId);
          const canToggle = TOGGLEABLE_SECTIONS.has(sectionId);
          const enabled = isSectionEnabled(sectionId);
          const label = SECTION_LABELS[sectionId];
          const isPromptEditable = PROMPT_EDITABLE_SECTIONS.has(sectionId);
          const sectionHasOverride = isPromptEditable && promptOverrides.hasOverride(TOOL_ID, sectionId);
          const sectionColor = getSectionColor(TOOL_ID, sectionId);

          const wrapSection = (children: React.ReactNode) => (
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

          /* ── Section content ────────────────────────── */

          if (sectionId === "identity") return wrapSection(
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select label="Age" options={AGE_OPTIONS} value={age} onChange={(e) => setAge(e.target.value)} disabled={textBusy} />
                <Select label="Race" options={RACE_OPTIONS} value={race} onChange={(e) => setRace(e.target.value)} disabled={textBusy} />
                <Select label="Gender" options={GENDER_OPTIONS} value={gender} onChange={(e) => setGender(e.target.value)} disabled={textBusy} />
                <Select label="Build" options={BUILD_OPTIONS} value={build} onChange={(e) => setBuild(e.target.value)} disabled={textBusy} />
              </div>
              <Textarea label="Character Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe your character here — who are they, what do they look like, what are they wearing? e.g. A battle-worn knight in dark plate armor with a crimson cloak..." disabled={textBusy} />
            </>
          );

          if (sectionId === "generate") return wrapSection(
            <>
              <Button className="w-full" generating={busy.is("extract")} generatingText="Extracting..." onClick={handleExtractAttributes} title="Reads the image and/or description and fills in the sections you have checked below">Extract Attributes</Button>
              <div>
                <select
                  className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  value={extractMode}
                  onChange={(e) => setExtractMode(e.target.value as "inspiration" | "recreate")}
                  title="Controls how the source image is used when generating. 'Inspiration' extracts text details only. 'Exact Match' also sends the image so the AI recreates the character's exact look."
                >
                  <option value="inspiration">Generate from description only</option>
                  <option value="recreate">Match source image exactly</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-1 px-0.5">
                {([
                  ["identity", "Identity"],
                  ["attributes", "Attributes"],
                  ["bible", "Bible"],
                  ["costume", "Costume"],
                  ["environment", "Environment"],
                ] as [ExtractTarget, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setExtractTargets((p) => ({ ...p, [key]: !p[key] }))}
                    className="px-2 py-0.5 text-[9px] rounded cursor-pointer select-none transition-colors"
                    style={{
                      background: extractTargets[key] ? "var(--color-accent)" : "var(--color-input-bg)",
                      color: extractTargets[key] ? "var(--color-foreground)" : "var(--color-text-muted)",
                      border: "1px solid var(--color-border)",
                      fontWeight: extractTargets[key] ? 600 : 400,
                    }}
                    title={`When active, Extract / Enhance / Randomize will fill in the ${label} section`}
                  >{label}</button>
                ))}
              </div>
              <div>
                <span className="text-xs font-medium block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Style Library</span>
                <select
                  className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                  value={styleLibraryFolder}
                  onChange={(e) => setStyleLibraryFolder(e.target.value)}
                  title="Pick a style folder to guide the look of your generated images. Use the Style Library page to create and manage folders."
                >
                  <option value="">Default (Gemini)</option>
                  {styleLibraryFolders.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" className="w-full" generating={busy.is("enhance")} generatingText="Enhancing..." onClick={handleEnhance} title="Takes what you've already written and polishes it — adds more detail without starting over">Enhance Attributes</Button>
                <Button size="sm" className="w-full" generating={busy.is("randomize")} generatingText="Randomizing..." onClick={handleRandomize} title="Creates a brand-new random character. If you've already filled in some fields, it'll build on those as a starting point.">Randomize Full Character</Button>
                <Button size="sm" className="w-full" onClick={handleOpenImage} title="Load an image from your computer into the viewer">Open Image</Button>
                <Button size="sm" className="w-full" onClick={handleReset} title="Clear everything and start fresh with a blank character">Reset Character</Button>
              </div>
              <div className="pt-1">
                <Button variant="primary" className="w-full" size="lg" generating={busy.is("generate")} generatingText={genText.generate || "Generating..."} onClick={generationMode === "grid" ? handleGridGenerate : handleGenerate} title="Generate a new character image using all the details you've set up">
                  Generate Character Image
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <NumberStepper value={genCount} onChange={setGenCount} min={1} max={10} label="Count:" />
                {modelOptions.length > 0 && (
                  <select className="min-w-0 flex-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }} value={modelId} onChange={(e) => setModelId(e.target.value)} title="Choose which AI model generates your images. Higher-quality models take longer but produce better results.">
                    {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

          if (sectionId === "attributes") return wrapSection(
            <div className="space-y-1.5">
              {ATTRIBUTE_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>{field}</span>
                  <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} disabled={textBusy}
                    value={attributes[field]?.dropdown || ""} onChange={(e) => setAttributes((prev) => ({ ...prev, [field]: { ...prev[field], dropdown: e.target.value } }))} />
                  <input className="w-24 px-2 py-1 text-xs" style={inputStyle} disabled={textBusy}
                    placeholder="your own" value={attributes[field]?.custom || ""} onChange={(e) => setAttributes((prev) => ({ ...prev, [field]: { ...prev[field], custom: e.target.value } }))} />
                </div>
              ))}
            </div>
          );

          if (sectionId === "bible") return wrapSection(
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Name</span>
                <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} placeholder="Give your character a name, e.g. Kael Duskwalker" value={bible.characterName} disabled={textBusy}
                  onChange={(e) => setBible((p) => ({ ...p, characterName: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Role</span>
                <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} placeholder="What role do they play? e.g. Fallen knight, reluctant anti-hero" value={bible.roleArchetype} disabled={textBusy}
                  onChange={(e) => setBible((p) => ({ ...p, roleArchetype: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Backstory</span>
                <textarea className="w-full px-2 py-1 text-xs resize-none" rows={3} style={inputStyle} placeholder="Their story so far — where did they come from? What shaped them?" value={bible.backstory} disabled={textBusy}
                  onChange={(e) => setBible((p) => ({ ...p, backstory: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>World / Setting</span>
                <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} placeholder="Where does your character live? e.g. Post-apocalyptic frontier, Neo-Tokyo 2087" value={bible.worldContext} disabled={textBusy}
                  onChange={(e) => setBible((p) => ({ ...p, worldContext: e.target.value }))} />
              </div>
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Design Intent</span>
                <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} placeholder="What mood or feeling should this character give off? e.g. Mysterious and dangerous" value={bible.designIntent} disabled={textBusy}
                  onChange={(e) => setBible((p) => ({ ...p, designIntent: e.target.value }))} />
              </div>
              <TagPicker label="Production Style" presets={prodStylePresets} selected={bible.productionStyle} disabled={textBusy}
                onChange={(v) => setBible((p) => ({ ...p, productionStyle: v }))} onPresetsChange={setProdStylePresets} />
              <div className="flex items-center gap-2">
                <span className="text-xs w-20 shrink-0 text-right" style={{ color: "var(--color-text-secondary)" }}>Custom Note</span>
                <input className="flex-1 px-2 py-1 text-xs" style={inputStyle} placeholder="Any extra style notes..." disabled={textBusy}
                  value={bible.customDirector} onChange={(e) => setBible((p) => ({ ...p, customDirector: e.target.value }))} />
              </div>
              <TagPicker label="Tone / Quality" presets={tonePresets} selected={bible.toneTags} disabled={textBusy}
                onChange={(v) => setBible((p) => ({ ...p, toneTags: v }))} onPresetsChange={setTonePresets} />
            </div>
          );

          if (sectionId === "costume") return wrapSection(
            <div className="space-y-2">
              <TagPicker label="Style Influences" presets={costumeStylePresets} selected={costume.costumeStyles} disabled={textBusy}
                onChange={(v) => setCostume((p) => ({ ...p, costumeStyles: v }))} onPresetsChange={setCostumeStylePresets} />
              <TagPicker label="Materials" presets={materialPresets} selected={costume.costumeMaterials} disabled={textBusy}
                onChange={(v) => setCostume((p) => ({ ...p, costumeMaterials: v }))} onPresetsChange={setMaterialPresets} />
              <div className="grid grid-cols-2 gap-2">
                <ColorField label="Primary Color" value={costume.primaryColor} placeholder="e.g. Deep crimson" disabled={textBusy}
                  onChange={(v) => setCostume((p) => ({ ...p, primaryColor: v }))} />
                <ColorField label="Secondary Color" value={costume.secondaryColor} placeholder="e.g. Charcoal gray" disabled={textBusy}
                  onChange={(v) => setCostume((p) => ({ ...p, secondaryColor: v }))} />
                <ColorField label="Accent Color" value={costume.accentColor} placeholder="e.g. Gold" disabled={textBusy}
                  onChange={(v) => setCostume((p) => ({ ...p, accentColor: v }))} />
                <div>
                  <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Hardware Color</span>
                  <select className="w-full px-2 py-1 text-xs" style={inputStyle} value={costume.hardwareColor} disabled={textBusy}
                    onChange={(e) => setCostume((p) => ({ ...p, hardwareColor: e.target.value }))}>
                    <option value="">—</option>
                    {HARDWARE_COLORS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </div>
              </div>
              <TagPicker label="Hardware Details" presets={hwDetailPresets} selected={costume.hwDetails} disabled={textBusy}
                onChange={(v) => setCostume((p) => ({ ...p, hwDetails: v }))} onPresetsChange={setHwDetailPresets} />
              <TagPicker label="Costume Origin" presets={originPresets} selected={costume.origin} disabled={textBusy}
                onChange={(v) => setCostume((p) => ({ ...p, origin: v }))} onPresetsChange={setOriginPresets} />
              <div>
                <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Additional Direction</span>
                <textarea className="w-full px-2 py-1 text-xs resize-none" rows={2} style={inputStyle} placeholder="Any extra outfit details — references, accessories, or things to keep in mind..." value={costume.costumeNotes} disabled={textBusy}
                  onChange={(e) => setCostume((p) => ({ ...p, costumeNotes: e.target.value }))} />
              </div>
            </div>
          );

          if (sectionId === "styleFusion") return wrapSection(
            <StyleFusionPanel
              fusion={styleFusion}
              onChange={setStyleFusion}
              takeOptions={TAKE_OPTIONS}
              disabled={textBusy}
            />
          );

          if (sectionId === "envPlacement") return wrapSection(
            <div className="space-y-2.5">
              {/* Info banner */}
              <div className="rounded p-2 text-[10px] leading-relaxed" style={{ background: "rgba(30,136,229,0.08)", border: "1px solid rgba(30,136,229,0.2)", color: "var(--color-text-secondary)" }}>
                Turning this ON places your character in a real environment instead of a flat background. Set a location, lighting, camera angle, and more to create a scene.
              </div>

              {/* Character images */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}
                    title="Add images of the characters you want placed in the scene. Add a note to each to describe who they are or how to use them.">
                    Character Images {envPlacement.characters.length > 0 && <span className="font-normal normal-case" style={{ color: "var(--color-text-muted)" }}>({envPlacement.characters.length})</span>}
                  </p>
                  <input ref={envCharFileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    Array.from(files).forEach((file) => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        setEnvPlacement((p) => ({ ...p, characters: [...p.characters, { id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, dataUrl, note: "" }] }));
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                  <button onClick={() => envCharFileRef.current?.click()} disabled={textBusy}
                    className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                    title="Add character images — these are the characters to be placed in the environment">+ Add</button>
                </div>
                {envPlacement.characters.length > 0 && (
                  <div className="space-y-1.5">
                    {envPlacement.characters.map((c, i) => (
                      <div key={c.id} className="flex items-start gap-1.5 group rounded p-1" style={{ border: "1px solid var(--color-border)" }}>
                        <img src={c.dataUrl} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                        <div className="flex-1 min-w-0">
                          <input className="w-full px-1.5 py-0.5 text-[10px]" style={inputStyle} disabled={textBusy}
                            placeholder="Describe this character or how they should appear..."
                            value={c.note} onChange={(e) => setEnvPlacement((p) => {
                              const chars = [...p.characters]; chars[i] = { ...chars[i], note: e.target.value }; return { ...p, characters: chars };
                            })} />
                        </div>
                        <button onClick={() => setEnvPlacement((p) => ({ ...p, characters: p.characters.filter((_, j) => j !== i) }))}
                          className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0 mt-0.5"
                          style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                          title="Remove this character image">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reference images */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}
                    title="Add reference images for the environment, mood, or anything you want to call out specifically.">
                    Reference Images {envPlacement.references.length > 0 && <span className="font-normal normal-case" style={{ color: "var(--color-text-muted)" }}>({envPlacement.references.length})</span>}
                  </p>
                  <input ref={envRefFileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    Array.from(files).forEach((file) => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        setEnvPlacement((p) => ({ ...p, references: [...p.references, { id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, dataUrl, note: "" }] }));
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                  <button onClick={() => envRefFileRef.current?.click()} disabled={textBusy}
                    className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer disabled:opacity-40"
                    style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                    title="Add reference images for the environment — mood boards, location photos, etc.">+ Add</button>
                </div>
                {envPlacement.references.length > 0 && (
                  <div className="space-y-1.5">
                    {envPlacement.references.map((r, i) => (
                      <div key={r.id} className="flex items-start gap-1.5 group rounded p-1" style={{ border: "1px solid var(--color-border)" }}>
                        <img src={r.dataUrl} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                        <div className="flex-1 min-w-0">
                          <input className="w-full px-1.5 py-0.5 text-[10px]" style={inputStyle} disabled={textBusy}
                            placeholder="What should the AI notice in this reference?"
                            value={r.note} onChange={(e) => setEnvPlacement((p) => {
                              const refs = [...p.references]; refs[i] = { ...refs[i], note: e.target.value }; return { ...p, references: refs };
                            })} />
                        </div>
                        <button onClick={() => setEnvPlacement((p) => ({ ...p, references: p.references.filter((_, j) => j !== i) }))}
                          className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer shrink-0 mt-0.5"
                          style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                          title="Remove this reference image">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Location */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Location</span>
                <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                  value={envPlacement.location}
                  title="Pick a preset location or choose Custom to type your own"
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, location: e.target.value }))}>
                  {ENV_LOCATION_PRESETS.map((v) => (
                    <option key={v} value={v}>{v === "" ? "— select preset —" : v === "__custom" ? "Custom..." : v}</option>
                  ))}
                </select>
                {envPlacement.location === "__custom" && (
                  <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                    placeholder="Describe the location in your own words..."
                    value={envPlacement.customLocation}
                    onChange={(e) => setEnvPlacement((p) => ({ ...p, customLocation: e.target.value }))} />
                )}
              </div>

              {/* Time of Day */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Time of Day</span>
                <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                  value={envPlacement.timeOfDay}
                  title="What time of day is it? This affects the overall mood and color temperature."
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, timeOfDay: e.target.value }))}>
                  {ENV_TIME_OPTIONS.map((v) => <option key={v} value={v}>{v || "— select —"}</option>)}
                </select>
                <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                  placeholder='Or type your own, e.g. "3 AM, fluorescent gas station lights"'
                  value={envPlacement.timeOfDay && !ENV_TIME_OPTIONS.includes(envPlacement.timeOfDay) ? envPlacement.timeOfDay : ""}
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, timeOfDay: e.target.value }))} />
              </div>

              {/* Lighting */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Lighting</span>
                <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                  value={envPlacement.lighting}
                  title="How is the scene lit? This is one of the biggest factors in the mood of your image."
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, lighting: e.target.value }))}>
                  {ENV_LIGHTING_OPTIONS.map((v) => <option key={v} value={v}>{v || "— select —"}</option>)}
                </select>
                <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                  placeholder='Or type your own, e.g. "Backlit by a setting sun through dusty windows"'
                  value={envPlacement.lighting && !ENV_LIGHTING_OPTIONS.includes(envPlacement.lighting) ? envPlacement.lighting : ""}
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, lighting: e.target.value }))} />
              </div>

              {/* Pose */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Pose</span>
                {envPlacement.characters.length > 1 ? (
                  <>
                    <p className="text-[9px] mb-1" style={{ color: "var(--color-text-muted)" }}>Multiple characters — describe the group pose or interaction below:</p>
                    <input className="w-full px-2 py-1 text-xs" style={inputStyle} disabled={textBusy}
                      placeholder="e.g. Two characters standing back-to-back, weapons drawn..."
                      value={envPlacement.customPose}
                      onChange={(e) => setEnvPlacement((p) => ({ ...p, customPose: e.target.value }))} />
                  </>
                ) : (
                  <>
                    <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                      value={envPlacement.pose}
                      title="How should the character be standing or positioned?"
                      onChange={(e) => setEnvPlacement((p) => ({ ...p, pose: e.target.value }))}>
                      {ENV_POSE_PRESETS.map((v) => <option key={v} value={v}>{v || "— select —"}</option>)}
                    </select>
                    <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                      placeholder='Or type a custom pose, e.g. "Leaning against a wall, arms crossed"'
                      value={envPlacement.customPose}
                      onChange={(e) => setEnvPlacement((p) => ({ ...p, customPose: e.target.value }))} />
                  </>
                )}
              </div>

              {/* Props */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Props</span>
                <input className="w-full px-2 py-1 text-xs" style={inputStyle} disabled={textBusy}
                  placeholder="e.g. AK-47, fanny pack, torch, medieval shield..."
                  title="List any objects, weapons, or items the character should be holding or that should be nearby."
                  value={envPlacement.props}
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, props: e.target.value }))} />
              </div>

              {/* Camera */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Camera</span>
                <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                  value={envPlacement.camera}
                  title="The camera framing — how close or far the shot is, and from what angle."
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, camera: e.target.value }))}>
                  {ENV_CAMERA_OPTIONS.map((v) => <option key={v} value={v}>{v || "— select —"}</option>)}
                </select>
                <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                  placeholder='Or type your own, e.g. "Drone shot from above"'
                  value={envPlacement.camera && !ENV_CAMERA_OPTIONS.includes(envPlacement.camera) ? envPlacement.camera : ""}
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, camera: e.target.value }))} />
              </div>

              {/* Output Format */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>Output Format</span>
                <select className="w-full px-2 py-1 text-xs rounded-[var(--radius-sm)]" style={inputStyle} disabled={textBusy}
                  value={envPlacement.outputFormat}
                  title="The aspect ratio of the generated image. When this section is ON, this format will be used instead of the default."
                  onChange={(e) => setEnvPlacement((p) => ({ ...p, outputFormat: e.target.value }))}>
                  {ENV_FORMAT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <input className="w-full px-2 py-1 text-xs mt-1" style={inputStyle} disabled={textBusy}
                  placeholder='Or type a custom format, e.g. "2:1 panoramic"'
                  value={envPlacement.outputFormat && !ENV_FORMAT_OPTIONS.includes(envPlacement.outputFormat) ? envPlacement.outputFormat : ""}
                  onChange={(e) => { if (e.target.value.trim()) setEnvPlacement((p) => ({ ...p, outputFormat: e.target.value })); }} />
              </div>
            </div>
          );

          if (sectionId === "preservation") return wrapSection(
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreservation((p) => ({ ...p, enabled: !p.enabled }))}
                  className="px-2 py-0.5 text-[10px] rounded cursor-pointer font-medium"
                  style={{ background: preservation.enabled ? "var(--color-accent)" : "var(--color-input-bg)", color: preservation.enabled ? "var(--color-foreground)" : "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
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
                      <span className="text-xs flex-1" style={{ color: n.enabled ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>{n.text}</span>
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
                  onClick={() => {
                    const text = prompt("New negative constraint:", "No ...");
                    if (!text?.trim()) return;
                    _negIdCounter++;
                    setPreservation((prev) => ({
                      ...prev,
                      negatives: [...prev.negatives, { id: `neg_${_negIdCounter}`, text: text.trim(), enabled: true }],
                    }));
                  }}
                  className="mt-1.5 px-2 py-0.5 text-[10px] rounded cursor-pointer"
                  style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                  title="Add something the AI must avoid — e.g. No crown, No fantasy elements"
                >+ Add Negative</button>
              </div>
            </div>
          );

          if (sectionId === "upscaleRestore") return wrapSection(
            <div className="space-y-2.5">
              {/* Mode selector */}
              <div className="flex gap-1.5">
                {(["upscale", "restore"] as const).map((m) => (
                  <button key={m} onClick={() => setUrMode(m)}
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

              {/* Scale factor (upscale only) */}
              {urMode === "upscale" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>Scale:</span>
                  <div className="flex gap-1">
                    {(["x2", "x3", "x4"] as const).map((s) => (
                      <button key={s} onClick={() => setUrScale(s)}
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

              {/* Context input */}
              <input className="w-full px-2 py-1 text-xs" style={inputStyle}
                placeholder="Optional context — e.g. pixel art icons, game UI screenshots"
                value={urContext} onChange={(e) => setUrContext(e.target.value)}
                title="Give the AI a hint about what kind of images these are for better results"
              />

              {/* Model selector */}
              {modelOptions.length > 0 && (
                <select className="w-full min-w-0 px-2 py-1 text-xs rounded-[var(--radius-sm)] truncate"
                  style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", maxWidth: "100%" }}
                  value={urModelId} onChange={(e) => setUrModelId(e.target.value)}
                  title="Choose which AI model to use for upscaling or restoring"
                >
                  <option value="">Auto (best available)</option>
                  {modelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}

              {/* Image input area */}
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
                          onClick={() => setUrImages((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100"
                          style={{ background: "var(--color-error)", color: "#fff" }}
                          title="Remove this image"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5 justify-center">
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
                  <button onClick={() => urFileRef.current?.click()}
                    className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
                    style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
                    title="Add images from your computer"
                  >+ Add Images</button>
                  <button onClick={async () => {
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
                    <button onClick={() => setUrImages([])}
                      className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
                      style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                      title="Remove all images"
                    >Clear All</button>
                  )}
                </div>
              </div>

              {/* Generate button */}
              <Button variant="primary" className="w-full" size="sm"
                generating={busy.is("upscale") || busy.is("restore")}
                generatingText={genText.upscale || genText.restore || "Processing..."}
                onClick={handleUpscaleRestoreGenerate}
                title={urMode === "upscale" ? "Upscale images — makes them bigger and sharper" : "Restore images — fixes AI artifacts and blur"}
              >Generate</Button>
            </div>
          );

          if (sectionId === "multiview") return wrapSection(
            <div className="space-y-1.5">
              <Button className="w-full" size="sm" generating={busy.is("allviews")} generatingText={genText.allviews || "Generating views..."} onClick={handleGenerateAllViews} title="Generate front, back, and side views of your character all at once">Generate All Views</Button>
              <Button className="w-full" size="sm" generating={busy.is("selview")} generatingText={genText.selview || "Generating..."} onClick={handleGenerateSelectedView} title="Generate only the view you currently have selected (front, back, side, etc.)">Generate Selected View</Button>
              <NumberStepper value={viewGenCount} onChange={setViewGenCount} min={1} max={5} label="Count:" />
            </div>
          );

          if (sectionId === "saveOptions") return wrapSection(
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                <Button size="sm" className="w-full" onClick={handleSaveImage} title="Save the current image to your generated images folder">Save Current</Button>
                <Button size="sm" className="w-full" onClick={handleSendToPS} title="Open the current image directly in Photoshop">Send to PS</Button>
                <Button size="sm" className="w-full" onClick={handleSendAllToPS} title="Open all generated view images in Photoshop at once">Send ALL to PS</Button>
                <Button size="sm" className="w-full" onClick={() => setShowXml(true)} title="View the full character data as XML — handy for saving or sharing your setup">Show XML</Button>
                <Button size="sm" className="w-full" onClick={handleClearCache} title="Clear all cached AI data for this session — useful if results feel stale">Clear Cache</Button>
                <Button size="sm" className="w-full" title="Save a log of all actions taken during this session">Save Log</Button>
              </div>
              <Button size="sm" className="w-full" title="Browse all images you've generated so far">Open Generated Images</Button>
              <div className="grid grid-cols-2 gap-1.5 pt-1" style={{ borderTop: "1px solid var(--color-border)" }}>
                <Button size="sm" className="w-full" title="Composite all views into a single reference sheet" onClick={async () => {
                  const imgs: {label: string; image_b64: string}[] = [];
                  for (const tab of ["main","3/4","front","back","side"] as const) {
                    const b64 = getImageB64(tab);
                    if (b64) imgs.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
                  }
                  if (imgs.length === 0) { addToast("No view images to export", "info"); return; }
                  try {
                    const res = await (await import("@/hooks/useApi")).apiFetch<{image_b64: string}>("/export/consistency-sheet", {
                      method: "POST", body: JSON.stringify({ images: imgs, layout: imgs.length <= 2 ? "1x4" : "2x2", title: "", include_labels: true })
                    });
                    const a = document.createElement("a"); a.href = `data:image/png;base64,${res.image_b64}`; a.download = `ref_sheet_${Date.now()}.png`; a.click();
                  } catch (e) { addToast("Failed to generate ref sheet", "error"); }
                }}>Ref Sheet</Button>
                <Button size="sm" className="w-full" title="Export a complete handoff package as ZIP" onClick={async () => {
                  const imgs: {label: string; image_b64: string}[] = [];
                  for (const tab of ["main","3/4","front","back","side"] as const) {
                    const b64 = getImageB64(tab);
                    if (b64) imgs.push({ label: tab, image_b64: `data:image/png;base64,${b64}` });
                  }
                  if (imgs.length === 0) { addToast("No view images to export", "info"); return; }
                  try {
                    const res = await fetch(`${window.location.protocol === "file:" ? "http://127.0.0.1:8420" : ""}/api/export/package`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ images: imgs, xml_data: "", prompt_text: buildPromptPreview?.() || "", settings: {}, palette: [], include_ref_sheet: true, tool_name: "character", character_name: "character" })
                    });
                    if (!res.ok) throw new Error("Export failed");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = `character_export_${Date.now()}.zip`; a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) { addToast("Failed to export package", "error"); }
                }}>Export ZIP</Button>
              </div>
            </div>
          );

          return null;
        })}

        {/* Custom sections from Prompt Builder */}
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
                  onClick={() => customSections.toggleCollapsed(cs.id)}
                  className="flex-1 flex items-center gap-1.5 py-1.5 text-left cursor-pointer"
                  style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
                >
                  {csCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                  <span className="text-xs font-semibold uppercase tracking-wider">{cs.name}</span>
                </button>
                <button
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
          onClick={handleSetDefaultLayout}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-[10px] font-medium cursor-pointer transition-colors"
          style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px dashed var(--color-border)" }}
          title="Remember how you've arranged these panels — next time you open the app, they'll be in the same order and open/closed state"
        >
          <Save className="h-3 w-3" />
          Set Active Layout as Default
        </button>
      </div>

      {/* Middle Column - Edit Panel */}
      <div className="w-[320px] h-full shrink-0 overflow-y-auto p-3 space-y-2" style={{ borderRight: "1px solid var(--color-border)" }}>
        <Card>
          <div className="px-3 py-2 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Edit Character</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Describe changes to apply:</p>
            <Textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={14} placeholder="Tell the AI what to change — e.g. Add a red scarf, change the boots to brown leather, make the cloak longer..." disabled={busy.is("apply")} />
            <Button variant="primary" className="w-full" generating={busy.is("apply")} generatingText="Applying..." onClick={handleApplyEdit} title="Send your edit instructions to the AI — it will modify the current image based on what you wrote above">Apply Changes</Button>
            {!isRefTab && (
              <EditHistory
                entries={currentHistory}
                activeEntryId={activeHistoryId}
                onRestore={handleHistoryRestore}
                onRestoreCurrent={handleRestoreCurrent}
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
                    title="Build the exact prompt that will be sent to the AI — shows everything: style rules, character info, attributes, bible, costume, fusion, environment, constraints"
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

      {/* Right Column - Image Viewer */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-end shrink-0 relative" style={{ background: "var(--color-background)", borderBottom: "1px solid var(--color-border)", paddingTop: 4 }}>
          <div className="flex-1 min-w-0 flex items-end overflow-hidden">
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
          <div className="flex items-center gap-2 px-2 shrink-0" style={{ paddingBottom: 5 }}>
            {busy.any && <Button size="sm" variant="danger" onClick={handleCancel} title="Stop all running generations">Cancel</Button>}
            <Button size="sm" generating={busy.is("quickgen")} generatingText={genText.quickgen || "Generating..."} onClick={handleQuickGenerate} title="Quickly re-generate the current view using your existing settings — great for getting a new variation">Quick Generate</Button>
          </div>
        </div>
        {activeTab === "artboard" ? (
          <ArtboardCanvas />
        ) : generationMode === "grid" && activeTab === "main" && gridResults.length > 0 ? (
          <GridGallery
            results={gridResults}
            title="Character Variations"
            toolLabel="character"
            generating={busy.is("generate")}
            emptyMessage="No grid results yet. Switch to grid mode and generate."
            onDelete={handleGridDelete}
            onCopy={handleGridCopy}
            onEditSubmit={handleGridEdit}
            editBusy={gridEditBusy}
            isFavorited={(b64) => isFavorited(b64)}
            onToggleFavorite={(id, b64, w, h) => {
              if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); }
              else addFavorite({ image_b64: b64, tool: "character", label: `grid-${id}`, prompt: "", source: "grid", width: w, height: h });
            }}
          />
        ) : (
          <ImageViewer
            src={currentSrc}
            placeholder={`No ${activeTabDef?.label.toLowerCase() || "image"} loaded`}
            locked={busy.any}
            onSaveImage={handleSaveImage}
            onCopyImage={handleCopyImage}
            onPasteImage={handlePasteImage}
            onOpenImage={handleOpenImage}
            onClearImage={handleClearImage}
            onClearAllImages={handleClearAllImages}
            onImageEdited={handleImageEdited}
            imageCount={currentImages.length}
            imageIndex={currentIdx}
            onPrevImage={handlePrevImage}
            onNextImage={handleNextImage}
            refImages={editorRefImages}
            styleContext={editorStyleContext}
            isFavorited={currentSrc ? isFavorited(currentSrc.replace(/^data:image\/\w+;base64,/, "")) : false}
            onToggleFavorite={currentSrc ? () => {
              const b64 = currentSrc.replace(/^data:image\/\w+;base64,/, "");
              if (isFavorited(b64)) { const fid = getFavoriteId(b64); if (fid) removeFavorite(fid); }
              else addFavorite({ image_b64: b64, tool: "character", label: activeTab || "main", source: "viewer" });
            } : undefined}
          />
        )}
      </div>
      {showXml && <XmlModal xml={buildCharacterXml()} title="Character XML" onClose={() => setShowXml(false)} />}

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
        <EditPromptModal
          open
          sectionLabel={SECTION_LABELS[promptEditSection]}
          defaultText={getDefaultSectionPrompt(promptEditSection)}
          currentText={promptOverrides.getOverride(TOOL_ID, promptEditSection) ?? getDefaultSectionPrompt(promptEditSection)}
          hasOverride={promptOverrides.hasOverride(TOOL_ID, promptEditSection)}
          onSave={(text) => {
            promptOverrides.setOverride(TOOL_ID, promptEditSection, text);
            setPromptEditSection(null);
            addToast("Prompt saved", "success");
          }}
          onReset={() => {
            promptOverrides.clearOverride(TOOL_ID, promptEditSection);
            addToast("Prompt reset to default", "info");
          }}
          onClose={() => setPromptEditSection(null)}
        />
      )}
    </div>
  );
}
