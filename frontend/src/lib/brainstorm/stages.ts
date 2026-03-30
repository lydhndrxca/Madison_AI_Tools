export const STAGE_IDS = ["seed", "normalize", "diverge", "critique", "expand", "converge", "commit", "iterate"] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_META: Record<StageId, { label: string; description: string; color: string }> = {
  seed: { label: "Idea Seed", description: "Enter your raw idea, concept, or inspiration", color: "#f59e0b" },
  normalize: { label: "Normalize", description: "Structure and clarify the seed into assumptions and questions", color: "#3b82f6" },
  diverge: { label: "Diverge", description: "Generate many candidate ideas across different creative lenses", color: "#8b5cf6" },
  critique: { label: "Critique", description: "Score candidates for genericness and mutate weak ones", color: "#ef4444" },
  expand: { label: "Expand", description: "Deep-dive the top candidates with risks, plans, and scope", color: "#10b981" },
  converge: { label: "Converge", description: "Score and rank expanded ideas to find the winner", color: "#06b6d4" },
  commit: { label: "Commit", description: "Generate the final artifact from the winning idea", color: "#f97316" },
  iterate: { label: "Iterate", description: "Suggest follow-up prompts for the next brainstorm cycle", color: "#6366f1" },
};

export function getStageIndex(id: StageId): number {
  return STAGE_IDS.indexOf(id);
}

export function getDownstream(id: StageId): StageId[] {
  return [...STAGE_IDS].slice(getStageIndex(id) + 1);
}
