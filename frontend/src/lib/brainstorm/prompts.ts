/**
 * Ideation pipeline prompts — structured like OKDO-style pipelines:
 * role → task → inputs → reasoning rules → output contract (JSON) → constraints.
 */

function safeJson(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return String(value);
  }
}

/** Influence / emotional framing layered into every stage. */
export function buildInfluenceBlock(personaName?: string, personaResearchData?: string, emotionalPrompt?: string): string {
  const parts: string[] = [];
  if (personaName?.trim()) {
    parts.push(`## Perspective\nYou are reasoning from the lens of **${personaName.trim()}**.`);
  }
  if (personaResearchData?.trim()) {
    parts.push(`## Persona research (ground truth for taste and priorities)\n${personaResearchData.trim()}`);
  }
  if (emotionalPrompt?.trim()) {
    parts.push(`## Emotional / tonal directive\n${emotionalPrompt.trim()}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `\n\n--- INFLUENCE ---\n${parts.join("\n\n")}\n`;
}

export const SCHEMA_HINT_NORMALIZE = `{
  "title": "string — short working title for the idea",
  "summary": "string — 2-4 sentences restating the seed crisply",
  "assumptions": ["string — explicit assumptions we are making"],
  "openQuestions": ["string — exactly N sharp questions to resolve ambiguity"],
  "constraints": ["string — hard constraints inferred or stated"],
  "successCriteria": ["string — how we would know this idea succeeded"],
  "risks": ["string — early risks or unknowns"]
}`;

export const SCHEMA_HINT_DIVERGE = `{
  "candidates": [
    {
      "id": "string — stable slug e.g. cand_practical_01",
      "lens": "practical | inversion | constraint",
      "title": "string",
      "pitch": "string — one paragraph",
      "hooks": ["string — what makes this distinct"],
      "dependencies": ["string — what must be true for this to work"]
    }
  ]
}`;

export const SCHEMA_HINT_CRITIQUE = `{
  "candidates": [
    {
      "id": "string — same id as input, or new id if replaced",
      "originalId": "string | null — if mutated from another id",
      "genericnessScore": "number — 0 very generic, 10 highly specific / ownable",
      "noveltyScore": "number — 0 cliché, 10 surprising but coherent",
      "feasibilityScore": "number — 0 unrealistic, 10 practical",
      "critique": "string — concise diagnosis",
      "mutation": "string | null — if weak, rewritten stronger pitch; null if already strong",
      "keep": "boolean — whether to carry forward"
    }
  ],
  "notes": "string — cross-cutting observations"
}`;

export const SCHEMA_HINT_EXPAND = `{
  "candidateId": "string",
  "title": "string",
  "elevatorPitch": "string",
  "userStory": "string",
  "scope": { "mvp": "string", "stretch": "string", "nonGoals": ["string"] },
  "risks": [{ "risk": "string", "mitigation": "string" }],
  "milestones": ["string — ordered checkpoints"],
  "openQuestions": ["string"]
}`;

export const SCHEMA_HINT_CONVERGE = `{
  "rankings": [
    {
      "rank": "number — 1 = best",
      "candidateId": "string",
      "title": "string",
      "totalScore": "number — 0-10 composite",
      "rationale": "string — why this placement"
    }
  ],
  "winner": {
    "candidateId": "string",
    "title": "string",
    "rationale": "string — why this wins now"
  },
  "tradeoffs": "string — what we gave up vs alternatives"
}`;

export const SCHEMA_HINT_COMMIT = `{
  "templateType": "string — echoed from request",
  "artifactTitle": "string",
  "sections": [{ "heading": "string", "body": "string — markdown OK" }],
  "appendix": ["string — optional bullets, links-as-text, references"],
  "executiveSummary": "string"
}`;

export const SCHEMA_HINT_ITERATE = `{
  "followUpPrompts": [
    {
      "label": "string — short name",
      "intent": "string — what this cycle would explore",
      "prompt": "string — paste-ready prompt for the next seed or normalize pass"
    }
  ],
  "meta": "string — how to use these prompts in the pipeline"
}`;

export function buildNormalizePrompt(
  seedText: string,
  seedContext: string,
  questionCount: number,
  influence: string,
): string {
  return `# Stage: NORMALIZE (structure the seed)

You are an ideation systems thinker. Turn a messy seed into a crisp problem frame.

## Inputs
### Seed text
${seedText.trim() || "(empty)"}

### Extra context
${seedContext.trim() || "(none)"}

### Required question count
Produce exactly **${questionCount}** entries in \`openQuestions\`.

## Rules
- Separate facts vs assumptions explicitly.
- Questions must be specific and decision-forcing (no yes/no fluff).
- Do not invent a totally new idea — clarify what the user already gave.
${influence}

## Output contract
Return **only** valid JSON matching this shape:
${SCHEMA_HINT_NORMALIZE}

Replace N in openQuestions with the number ${questionCount}.`;
}

export function buildDivergePrompt(
  normalizeOutput: unknown,
  lensCounts: { practical: number; inversion: number; constraint: number },
  influence: string,
): string {
  return `# Stage: DIVERGE (breadth-first ideation)

Generate distinct candidate ideas using three lenses:
- **practical**: grounded, shippable, obvious paths.
- **inversion**: flip assumptions, contrarian but useful angles.
- **constraint**: pick a brutal constraint and design into it.

## Normalized frame (JSON)
${safeJson(normalizeOutput)}

## Counts (strict)
- practical: **${lensCounts.practical}** candidates
- inversion: **${lensCounts.inversion}** candidates
- constraint: **${lensCounts.constraint}** candidates

Each candidate must cite \`lens\` and use a unique \`id\`.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_DIVERGE}`;
}

export function buildCritiquePrompt(candidates: unknown[], influence: string): string {
  return `# Stage: CRITIQUE (score, diagnose, mutate)

Score each candidate for genericness vs ownability. If genericness is low or novelty is weak, **mutate** the pitch into a sharper variant (still honest to the lens).

## Candidates (JSON array)
${safeJson(candidates)}

## Rules
- Prefer surgical edits over discarding ideas.
- \`mutation\` should be a full replacement pitch when used.
- Set \`keep\` false only for irredeemable or duplicate concepts.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_CRITIQUE}`;
}

export function buildExpandPrompt(candidate: unknown, normalizeOutput: unknown, influence: string): string {
  return `# Stage: EXPAND (depth on one candidate)

Deep-dive a single surviving idea. Tie back to the normalized frame where relevant.

## Normalized frame
${safeJson(normalizeOutput)}

## Candidate to expand
${safeJson(candidate)}

## Rules
- Be concrete: scope, milestones, and risks must be actionable.
- Mark non-goals to prevent scope creep.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_EXPAND}`;
}

export function buildConvergePrompt(expansions: unknown[], influence: string): string {
  return `# Stage: CONVERGE (rank expanded ideas)

Compare expanded proposals and pick a winner for the next commit stage.

## Expansions (JSON array)
${safeJson(expansions)}

## Rules
- \`rankings\` must include every expansion (or every expansion with \`candidateId\`).
- Scores should reflect fit to the normalized problem, feasibility, and distinctiveness.
- \`winner\` must match the rank 1 entry's candidateId and title.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_CONVERGE}`;
}

export function buildCommitPrompt(
  winner: unknown,
  expansion: unknown,
  normalizeOutput: unknown,
  templateType: string,
  influence: string,
): string {
  return `# Stage: COMMIT (final artifact)

Synthesize a polished artifact from the winning line of thought.

## Template type
**${templateType}**

Interpret template types loosely but use them to shape headings, e.g.:
- \`design_doc\` — problem, goals, proposal, alternatives, rollout.
- \`one_pager\` — tight single-page narrative.
- \`pitch\` — hook, market, differentiation, ask.
- \`creative_brief\` — audience, tone, key messages, mandatories.

## Normalized frame
${safeJson(normalizeOutput)}

## Winner (from converge)
${safeJson(winner)}

## Expansion (depth)
${safeJson(expansion)}

## Rules
- The artifact must be internally consistent and production-ready in tone.
- Use \`sections\` for the body; \`executiveSummary\` for a tight top summary.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_COMMIT}`;
}

export function buildIteratePrompt(commitOutput: unknown, influence: string): string {
  return `# Stage: ITERATE (next-cycle prompts)

Propose follow-up prompts that would start a **new** brainstorm cycle (new seed or re-normalize) while preserving momentum.

## Last commit output
${safeJson(commitOutput)}

## Rules
- Each follow-up \`prompt\` should be self-contained (paste-ready).
- Cover different directions: deepen, broaden, stress-test, or pivot.
${influence}

## Output contract
Return **only** valid JSON matching:
${SCHEMA_HINT_ITERATE}`;
}

export function schemaHintForStage(
  stageId: "normalize" | "diverge" | "critique" | "expand" | "converge" | "commit" | "iterate",
): string {
  const map = {
    normalize: SCHEMA_HINT_NORMALIZE,
    diverge: SCHEMA_HINT_DIVERGE,
    critique: SCHEMA_HINT_CRITIQUE,
    expand: SCHEMA_HINT_EXPAND,
    converge: SCHEMA_HINT_CONVERGE,
    commit: SCHEMA_HINT_COMMIT,
    iterate: SCHEMA_HINT_ITERATE,
  } as const;
  return map[stageId];
}
