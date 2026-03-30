export type ToneMood =
  | "professional"
  | "gritty"
  | "whimsical"
  | "dark"
  | "humorous"
  | "serious"
  | "mysterious"
  | "surreal"
  | "warm"
  | "melancholy"
  | "playful"
  | "bittersweet"
  | "nostalgic"
  | "dreamy"
  | "tense"
  | "epic"
  | "intimate"
  | "satirical";

export const TONE_OPTIONS: { id: ToneMood; label: string }[] = [
  { id: "professional", label: "Professional" },
  { id: "gritty", label: "Gritty" },
  { id: "whimsical", label: "Whimsical" },
  { id: "dark", label: "Dark" },
  { id: "humorous", label: "Humorous" },
  { id: "serious", label: "Serious" },
  { id: "mysterious", label: "Mysterious" },
  { id: "surreal", label: "Surreal" },
  { id: "warm", label: "Warm" },
  { id: "melancholy", label: "Melancholy" },
  { id: "playful", label: "Playful" },
  { id: "bittersweet", label: "Bittersweet" },
  { id: "nostalgic", label: "Nostalgic" },
  { id: "dreamy", label: "Dreamy" },
  { id: "tense", label: "Tense" },
  { id: "epic", label: "Epic" },
  { id: "intimate", label: "Intimate" },
  { id: "satirical", label: "Satirical" },
];

export type WritingType =
  | "game-script"
  | "character-backstory"
  | "world-lore"
  | "story-pitch"
  | "marketing-copy"
  | "dialogue"
  | "art-direction"
  | "other";

export const WRITING_TYPE_OPTIONS: { id: WritingType; label: string }[] = [
  { id: "game-script", label: "Game script" },
  { id: "character-backstory", label: "Character backstory" },
  { id: "world-lore", label: "World lore" },
  { id: "story-pitch", label: "Story pitch" },
  { id: "marketing-copy", label: "Marketing copy" },
  { id: "dialogue", label: "Dialogue" },
  { id: "art-direction", label: "Art direction" },
  { id: "other", label: "Other" },
];

export type ScopeLength = "short" | "medium" | "long" | "open";

export const SCOPE_OPTIONS: { id: ScopeLength; label: string; description: string }[] = [
  {
    id: "short",
    label: "Short",
    description: "Brief output — headlines, blurbs, or a tight beat list.",
  },
  {
    id: "medium",
    label: "Medium",
    description: "Standard length — a scene, section, or focused treatment.",
  },
  {
    id: "long",
    label: "Long",
    description: "Extended draft — multiple sections or fuller narrative.",
  },
  {
    id: "open",
    label: "Open",
    description: "No fixed length — follow the brief and natural pacing.",
  },
];

export interface ChatAttachment {
  type: "image" | "link" | "document";
  mimeType: string;
  base64?: string;
  url?: string;
  fileName?: string;
  caption?: string;
}

export interface PlanningData {
  writingType: WritingType | "";
  writingTypeOther: string;
  projectContext: string;
  targetAudience: string;
  tones: ToneMood[];
  hardRules: string;
  referenceMaterial: string;
  referenceAttachments?: ChatAttachment[];
  scopeLength: ScopeLength;
  additionalNotes: string;
}

export const DEFAULT_PLANNING: PlanningData = {
  writingType: "",
  writingTypeOther: "",
  projectContext: "",
  targetAudience: "",
  tones: [],
  hardRules: "",
  referenceMaterial: "",
  referenceAttachments: [],
  scopeLength: "medium",
  additionalNotes: "",
};

export type AgentRole = "producer" | "writer";
export type ModelTier = "quick" | "standard" | "deep";

export const MODEL_TIER_OPTIONS: {
  id: ModelTier;
  label: string;
  description: string;
  model: string;
}[] = [
  { id: "quick", label: "Quick", description: "Fast responses", model: "gemini-2.0-flash" },
  { id: "standard", label: "Standard", description: "Balanced", model: "gemini-2.5-flash" },
  { id: "deep", label: "Deep", description: "Deepest reasoning", model: "gemini-2.5-pro" },
];

export interface RoomAgent {
  personaId: string;
  approved: boolean;
}

export type MessageSender = "agent" | "user" | "system";

export interface MessageReactions {
  thumbsUp: boolean;
  thumbsDown: boolean;
  star: boolean;
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  sender: MessageSender;
  agentId: string | null;
  agentName: string;
  agentRole: AgentRole | "user" | "system";
  agentAvatar: string;
  content: string;
  attachments?: ChatAttachment[];
  isApproval?: boolean;
  isTldr?: boolean;
  reactions?: MessageReactions;
}

export type RoomPhase =
  | "idle"
  | "briefing"
  | "rounds"
  | "approval"
  | "pitch"
  | "revision"
  | "approved";

export type CreativeRoundId =
  | "premise"
  | "world-context"
  | "characters"
  | "conflict"
  | "structure"
  | "details"
  | "final-review";

export interface CreativeRound {
  id: CreativeRoundId;
  label: string;
  question: string;
  locksField: string;
  agentPool: AgentRole[];
  minTurns: number;
  maxTurns: number;
}

export interface LockedDecision {
  roundId: CreativeRoundId;
  label: string;
  value: string;
  lockedBy: "user" | string;
  lockedAt: number;
}

export interface RoundState {
  currentRoundIndex: number;
  turnsInRound: number;
  lockedDecisions: LockedDecision[];
}

export interface ProducerProjectState {
  creatorBrief: string;
  coreConcept: string;
  worldContext: string;
  keyCharacters: string;
  centralConflict: string;
  structureBeats: string;
  themeOrFeeling: string;
  openQuestions: string[];
  hardRules: string[];
  selectedDirection: string;
  rejectedAlternatives: string[];
  checkpoint: "none" | "concept-lock" | "character-lock" | "structure-lock" | "final-review";
}

export const DEFAULT_PROJECT_STATE: ProducerProjectState = {
  creatorBrief: "",
  coreConcept: "",
  worldContext: "",
  keyCharacters: "",
  centralConflict: "",
  structureBeats: "",
  themeOrFeeling: "",
  openQuestions: [],
  hardRules: [],
  selectedDirection: "",
  rejectedAlternatives: [],
  checkpoint: "none",
};

export interface AgentTurnState {
  personaId: string;
  proposals: string[];
  objections: string[];
  endorsements: string[];
  currentStance: string;
  conviction: number;
  turnsSinceLastSpoke: number;
  totalTurnsSpoken: number;
}

export type ScreenId = "planning" | "writing";

export interface WritingSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  planning: PlanningData;
  producerBrief: string | null;
  roomAgents: RoomAgent[];
  chatHistory: ChatMessage[];
  roomPhase: RoomPhase;
  roundState: RoundState;
  agentStates: Record<string, AgentTurnState>;
  projectState: ProducerProjectState;
  activeScreen: ScreenId;
  userApproved: boolean;
  wrappingUp?: boolean;
}
