import { apiFetch } from "@/hooks/useApi";
import type { StageId } from "./stages";
import { STAGE_IDS, getDownstream } from "./stages";
import * as prompts from "./prompts";

export type StageStatus = "idle" | "running" | "complete" | "stale" | "error";

export type StageState = {
  status: StageStatus;
  output: unknown;
  error?: string;
};

export type StageConfig = {
  questionCount?: number;
  lensCounts?: { practical: number; inversion: number; constraint: number };
  expandCount?: number;
  templateType?: string;
  customInstructions?: string;
};

export type BrainstormSession = {
  id: string;
  name: string;
  seedText: string;
  seedContext: string;
  seedImageB64?: string;
  stageStates: Record<StageId, StageState>;
  stageConfigs: Record<StageId, StageConfig>;
  personaId?: string;
  emotionalPrompt?: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "madison_brainstorm_sessions";

function emptyStageState(): StageState {
  return { status: "idle", output: null };
}

function defaultStageConfigs(): Record<StageId, StageConfig> {
  const base: StageConfig = { customInstructions: "" };
  return {
    seed: { ...base },
    normalize: { ...base, questionCount: 5 },
    diverge: { ...base, lensCounts: { practical: 4, inversion: 3, constraint: 3 } },
    critique: { ...base },
    expand: { ...base, expandCount: 3 },
    converge: { ...base },
    commit: { ...base, templateType: "design_doc" },
    iterate: { ...base },
  };
}

function cloneSession(s: BrainstormSession): BrainstormSession {
  const stageStates = {} as Record<StageId, StageState>;
  for (const id of STAGE_IDS) {
    const st = s.stageStates[id];
    stageStates[id] = { ...st };
  }
  const stageConfigs = {} as Record<StageId, StageConfig>;
  for (const id of STAGE_IDS) {
    const c = s.stageConfigs[id];
    stageConfigs[id] = {
      ...c,
      lensCounts: c.lensCounts ? { ...c.lensCounts } : undefined,
    };
  }
  return {
    ...s,
    stageStates,
    stageConfigs,
  };
}

function appendCustomInstructions(prompt: string, custom?: string): string {
  const t = custom?.trim();
  if (!t) return prompt;
  return `${prompt}\n\n--- AUTHOR CUSTOM INSTRUCTIONS ---\n${t}`;
}

function markDownstreamStale(states: Record<StageId, StageState>, from: StageId): void {
  for (const id of getDownstream(from)) {
    const s = states[id];
    if (s.status === "complete" || s.status === "stale") {
      states[id] = { ...s, status: "stale" };
    }
  }
}

function buildInfluence(session: BrainstormSession, persona?: { name: string; researchData: string }): string {
  return prompts.buildInfluenceBlock(persona?.name, persona?.researchData, session.emotionalPrompt);
}

async function postRunStage(prompt: string, schemaHint: string | undefined, model?: string): Promise<unknown> {
  const data = await apiFetch<{ result?: unknown; error?: string }>("/brainstorm/run-stage", {
    method: "POST",
    body: JSON.stringify({ prompt, schemaHint, model }),
  });
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  if (data && typeof data === "object" && "result" in data) {
    return data.result;
  }
  return data;
}

function pickCandidatesForExpand(session: BrainstormSession): unknown[] {
  const critOut = session.stageStates.critique.output as { candidates?: unknown[] } | null;
  const divOut = session.stageStates.diverge.output as { candidates?: unknown[] } | null;
  if (critOut?.candidates && Array.isArray(critOut.candidates)) {
    return critOut.candidates.filter((c) => {
      const o = c as { keep?: boolean };
      return o && o.keep !== false;
    });
  }
  if (divOut?.candidates && Array.isArray(divOut.candidates)) {
    return [...divOut.candidates];
  }
  return [];
}

export function createSession(name?: string): BrainstormSession {
  const now = Date.now();
  const stageStates = {} as Record<StageId, StageState>;
  for (const id of STAGE_IDS) {
    stageStates[id] = emptyStageState();
  }
  return {
    id: crypto.randomUUID(),
    name: name?.trim() || "Untitled brainstorm",
    seedText: "",
    seedContext: "",
    stageStates,
    stageConfigs: defaultStageConfigs(),
    createdAt: now,
    updatedAt: now,
  };
}

export function loadSessions(): BrainstormSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BrainstormSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(session: BrainstormSession): void {
  const list = loadSessions();
  const idx = list.findIndex((s) => s.id === session.id);
  const next = { ...session, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function deleteSession(id: string): void {
  const list = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export async function runStage(
  session: BrainstormSession,
  stageId: StageId,
  persona?: { name: string; researchData: string },
): Promise<BrainstormSession> {
  const next = cloneSession(session);
  const now = Date.now();
  next.updatedAt = now;

  const setRunning = () => {
    next.stageStates[stageId] = { status: "running", output: next.stageStates[stageId].output };
  };
  const setError = (msg: string) => {
    next.stageStates[stageId] = { status: "error", output: next.stageStates[stageId].output, error: msg };
  };

  const influence = buildInfluence(next, persona);
  const cfg = (id: StageId) => ({ ...defaultStageConfigs()[id], ...next.stageConfigs[id] });

  try {
    if (stageId === "seed") {
      setRunning();
      next.stageStates.seed = {
        status: "complete",
        output: {
          seedText: next.seedText,
          seedContext: next.seedContext,
          seedImageB64: next.seedImageB64 ?? null,
        },
      };
      markDownstreamStale(next.stageStates, "seed");
      return next;
    }

    setRunning();

    if (stageId === "normalize") {
      const c = cfg("normalize");
      const q = c.questionCount ?? 5;
      let prompt = prompts.buildNormalizePrompt(next.seedText, next.seedContext, q, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("normalize");
      const result = await postRunStage(prompt, hint);
      next.stageStates.normalize = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "normalize");
      return next;
    }

    if (stageId === "diverge") {
      const norm = next.stageStates.normalize.output;
      if (norm == null) throw new Error("Normalize stage has no output yet.");
      const c = cfg("diverge");
      const lenses = c.lensCounts ?? { practical: 4, inversion: 3, constraint: 3 };
      let prompt = prompts.buildDivergePrompt(norm, lenses, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("diverge");
      const result = await postRunStage(prompt, hint);
      next.stageStates.diverge = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "diverge");
      return next;
    }

    if (stageId === "critique") {
      const div = next.stageStates.diverge.output as { candidates?: unknown[] } | null;
      const candidates = div?.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("Diverge stage has no candidates.");
      }
      const c = cfg("critique");
      let prompt = prompts.buildCritiquePrompt(candidates, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("critique");
      const result = await postRunStage(prompt, hint);
      next.stageStates.critique = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "critique");
      return next;
    }

    if (stageId === "expand") {
      const norm = next.stageStates.normalize.output;
      const list = pickCandidatesForExpand(next);
      if (!norm) throw new Error("Normalize output missing.");
      if (list.length === 0) throw new Error("No candidates to expand.");
      const c = cfg("expand");
      const count = Math.max(0, c.expandCount ?? 3);
      const slice = list.slice(0, count);
      const expansions: unknown[] = [];
      const hint = prompts.schemaHintForStage("expand");
      for (const candidate of slice) {
        let prompt = prompts.buildExpandPrompt(candidate, norm, influence);
        prompt = appendCustomInstructions(prompt, c.customInstructions);
        const result = await postRunStage(prompt, hint);
        expansions.push(result);
      }
      next.stageStates.expand = { status: "complete", output: { expansions } };
      markDownstreamStale(next.stageStates, "expand");
      return next;
    }

    if (stageId === "converge") {
      const exp = next.stageStates.expand.output as { expansions?: unknown[] } | null;
      const expansions = exp?.expansions;
      if (!Array.isArray(expansions) || expansions.length === 0) {
        throw new Error("Expand stage has no expansions.");
      }
      const c = cfg("converge");
      let prompt = prompts.buildConvergePrompt(expansions, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("converge");
      const result = await postRunStage(prompt, hint);
      next.stageStates.converge = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "converge");
      return next;
    }

    if (stageId === "commit") {
      const norm = next.stageStates.normalize.output;
      const conv = next.stageStates.converge.output as {
        winner?: { candidateId?: string; title?: string };
      } | null;
      const exp = next.stageStates.expand.output as { expansions?: unknown[] } | null;
      const expansions = exp?.expansions ?? [];
      if (!norm) throw new Error("Normalize output missing.");
      if (!conv?.winner) throw new Error("Converge stage has no winner.");
      const winner = conv.winner;
      const wid = winner.candidateId;
      const expansion =
        (wid != null
          ? expansions.find((e) => typeof e === "object" && e && (e as { candidateId?: string }).candidateId === wid)
          : null) ?? expansions[0];
      const c = cfg("commit");
      const templateType = c.templateType ?? "design_doc";
      let prompt = prompts.buildCommitPrompt(winner, expansion, norm, templateType, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("commit");
      const result = await postRunStage(prompt, hint);
      next.stageStates.commit = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "commit");
      return next;
    }

    if (stageId === "iterate") {
      const commitOut = next.stageStates.commit.output;
      if (commitOut == null) throw new Error("Commit stage has no output yet.");
      const c = cfg("iterate");
      let prompt = prompts.buildIteratePrompt(commitOut, influence);
      prompt = appendCustomInstructions(prompt, c.customInstructions);
      const hint = prompts.schemaHintForStage("iterate");
      const result = await postRunStage(prompt, hint);
      next.stageStates.iterate = { status: "complete", output: result };
      markDownstreamStale(next.stageStates, "iterate");
      return next;
    }

    throw new Error(`Unhandled brainstorm stage: ${String(stageId)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    return next;
  }
}
