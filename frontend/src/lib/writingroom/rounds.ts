import type { CreativeRound, AgentRole } from "./types";

export const CREATIVE_ROUNDS: CreativeRound[] = [
  {
    id: "premise",
    label: "Core Concept",
    question: "What is this project really about? What's the core idea or premise?",
    locksField: "coreConcept",
    agentPool: ["producer", "writer"],
    minTurns: 3,
    maxTurns: 6,
  },
  {
    id: "world-context",
    label: "World & Context",
    question: "What world does this exist in? What's the setting, tone, and rules?",
    locksField: "worldContext",
    agentPool: ["producer", "writer"],
    minTurns: 3,
    maxTurns: 6,
  },
  {
    id: "characters",
    label: "Key Characters",
    question: "Who are the key characters or voices? What drives them?",
    locksField: "keyCharacters",
    agentPool: ["producer", "writer"],
    minTurns: 3,
    maxTurns: 6,
  },
  {
    id: "conflict",
    label: "Central Conflict",
    question: "What's the central conflict, tension, or problem to solve?",
    locksField: "centralConflict",
    agentPool: ["producer", "writer"],
    minTurns: 3,
    maxTurns: 6,
  },
  {
    id: "structure",
    label: "Structure & Beats",
    question: "How does this unfold? What are the key beats or sections?",
    locksField: "structureBeats",
    agentPool: ["producer", "writer"],
    minTurns: 3,
    maxTurns: 8,
  },
  {
    id: "details",
    label: "Details & Polish",
    question: "What specific details, language, or moments make this come alive?",
    locksField: "themeOrFeeling",
    agentPool: ["producer", "writer"],
    minTurns: 2,
    maxTurns: 5,
  },
  {
    id: "final-review",
    label: "Final Review",
    question: "Is this ready? What's missing, what's working, what needs to change?",
    locksField: "",
    agentPool: ["producer", "writer"],
    minTurns: 2,
    maxTurns: 4,
  },
];

export function getRoundByIndex(idx: number): CreativeRound | undefined {
  return CREATIVE_ROUNDS[idx];
}

export function isLastRound(idx: number): boolean {
  return idx >= CREATIVE_ROUNDS.length - 1;
}

export function buildRoundPrompt(
  round: CreativeRound,
  lockedDecisions: { label: string; value: string }[],
): string {
  const lines = [
    `=== CURRENT ROUND: ${round.label} ===`,
    `FOCUS QUESTION: ${round.question}`,
    "",
    "The room must address this question directly.",
  ];
  if (lockedDecisions.length > 0) {
    lines.push("", "=== LOCKED DECISIONS ===");
    for (const d of lockedDecisions) lines.push(`✅ ${d.label}: ${d.value}`);
    lines.push("Build on these — do not re-debate settled points.");
  }
  return lines.join("\n");
}

export function getTemperatureForRole(role: AgentRole): number {
  return role === "producer" ? 0.6 : 0.9;
}
