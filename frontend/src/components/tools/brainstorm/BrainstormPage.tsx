import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Lightbulb,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { NumberStepper } from "@/components/ui";
import {
  type BrainstormSession,
  type StageConfig,
  type StageState,
  type StageStatus,
  createSession,
  runStage,
  saveSession,
  loadSessions,
} from "@/lib/brainstorm/engine";
import { STAGE_IDS, STAGE_META, type StageId } from "@/lib/brainstorm/stages";
import { getAllPersonas, getPersona, type Persona } from "@/lib/personaLibrary";

const LEFT_PANEL_WIDTH = 280;
const COMMIT_TEMPLATES: { value: string; label: string }[] = [
  { value: "design_doc", label: "Design doc" },
  { value: "one_pager", label: "One-pager" },
  { value: "pitch", label: "Pitch" },
  { value: "creative_brief", label: "Creative brief" },
];

function pickInitialSession(): BrainstormSession {
  const list = loadSessions();
  if (list.length === 0) return createSession();
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function resetPipelineKeepMeta(s: BrainstormSession): BrainstormSession {
  const fresh = createSession(s.name);
  return {
    ...fresh,
    id: s.id,
    name: s.name,
    personaId: s.personaId,
    emotionalPrompt: s.emotionalPrompt,
  };
}

function previousStageId(id: StageId): StageId | null {
  const i = STAGE_IDS.indexOf(id);
  return i <= 0 ? null : STAGE_IDS[i - 1];
}

function isPreviousStageComplete(session: BrainstormSession, stageId: StageId): boolean {
  const prev = previousStageId(stageId);
  if (!prev) return true;
  return session.stageStates[prev].status === "complete";
}

function personaForRun(p: Persona | undefined): { name: string; researchData: string } | undefined {
  if (!p) return undefined;
  return { name: p.name, researchData: p.researchData };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function imageSrc(b64: string | undefined): string | undefined {
  if (!b64) return undefined;
  if (b64.startsWith("data:")) return b64;
  return `data:image/png;base64,${b64}`;
}

function StatusGlyph({
  status,
  isRunning,
}: {
  status: StageStatus;
  isRunning: boolean;
}) {
  const spin: React.CSSProperties = {
    display: "inline-flex",
    animation: "brainstormSpin 0.85s linear infinite",
  };
  const muted = "var(--color-text-muted)";
  if (isRunning) {
    return <Loader2 size={16} style={{ ...spin, color: "var(--color-accent)" }} aria-hidden />;
  }
  switch (status) {
    case "running":
      return <Loader2 size={16} style={{ ...spin, color: "var(--color-accent)" }} aria-hidden />;
    case "complete":
      return <Check size={16} style={{ color: "#22c55e" }} aria-hidden />;
    case "stale":
      return <AlertTriangle size={16} style={{ color: "#eab308" }} aria-hidden />;
    case "error":
      return <X size={16} style={{ color: "#ef4444" }} aria-hidden />;
    default:
      return (
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: muted,
            display: "inline-block",
            flexShrink: 0,
          }}
          aria-hidden
        />
      );
  }
}

function OutputShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        background: "var(--color-input-bg)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SeedOutputView({ out }: { out: unknown }) {
  const o = out as Record<string, unknown> | null;
  if (!o) return <span style={{ color: "var(--color-text-muted)" }}>No output yet.</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
      <div>
        <strong style={{ color: "var(--color-text-primary)" }}>Idea</strong>
        <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{String(o.seedText ?? "")}</div>
      </div>
      <div>
        <strong style={{ color: "var(--color-text-primary)" }}>Context</strong>
        <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{String(o.seedContext ?? "")}</div>
      </div>
      {o.seedImageB64 ? (
        <div>
          <strong style={{ color: "var(--color-text-primary)" }}>Image</strong>
          <div style={{ marginTop: 8 }}>
            <img
              src={imageSrc(String(o.seedImageB64))}
              alt="Seed"
              style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, border: "1px solid var(--color-border)" }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NormalizeOutputView({ out }: { out: unknown }) {
  const o = out as {
    summary?: string;
    assumptions?: string[];
    openQuestions?: string[];
  } | null;
  if (!o) return <span style={{ color: "var(--color-text-muted)" }}>Run normalize to see structured output.</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {o.summary ? (
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Summary</div>
          <div style={{ fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.5 }}>{o.summary}</div>
        </div>
      ) : null}
      {Array.isArray(o.assumptions) && o.assumptions.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>Assumptions</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--color-text-secondary)", fontSize: 13 }}>
            {o.assumptions.map((a, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Array.isArray(o.openQuestions) && o.openQuestions.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>Clarifying questions</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--color-text-secondary)", fontSize: 13 }}>
            {o.openQuestions.map((q, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CandidateCard({ c }: { c: Record<string, unknown> }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)", fontSize: 13 }}>{String(c.title ?? "Untitled")}</span>
        <span style={{ fontSize: 11, color: "var(--color-accent)" }}>{String(c.lens ?? "")}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.45, marginBottom: 8 }}>
        {String(c.pitch ?? "")}
      </div>
      {Array.isArray(c.hooks) && c.hooks.length > 0 ? (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          <span style={{ fontWeight: 600 }}>Hooks: </span>
          {(c.hooks as string[]).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function DivergeOutputView({ out }: { out: unknown }) {
  const o = out as { candidates?: unknown[] } | null;
  const list = o?.candidates;
  if (!Array.isArray(list) || list.length === 0) {
    return <span style={{ color: "var(--color-text-muted)" }}>No candidates yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((raw, i) => (
        <CandidateCard key={i} c={raw as Record<string, unknown>} />
      ))}
    </div>
  );
}

function CritiqueOutputView({ out }: { out: unknown }) {
  const o = out as { candidates?: Record<string, unknown>[]; notes?: string } | null;
  const list = o?.candidates;
  if (!Array.isArray(list) || list.length === 0) {
    return <span style={{ color: "var(--color-text-muted)" }}>No scored candidates yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {list.map((c, i) => (
        <div
          key={i}
          style={{
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)", fontSize: 13 }}>{String(c.title ?? c.id ?? "Idea")}</span>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--color-input-bg)", color: "var(--color-text-secondary)" }}>
              Genericness: {String(c.genericnessScore ?? "—")}
            </span>
            {c.keep === false ? (
              <span style={{ fontSize: 11, color: "#ef4444" }}>Not kept</span>
            ) : (
              <span style={{ fontSize: 11, color: "#22c55e" }}>Kept</span>
            )}
          </div>
          {c.critique ? (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>{String(c.critique)}</div>
          ) : null}
          {c.mutation ? (
            <div style={{ fontSize: 12, color: "var(--color-foreground)", fontStyle: "italic" }}>{String(c.mutation)}</div>
          ) : null}
        </div>
      ))}
      {o?.notes ? (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>{o.notes}</div>
      ) : null}
    </div>
  );
}

function ExpandOutputView({ out }: { out: unknown }) {
  const o = out as { expansions?: unknown[] } | null;
  const ex = o?.expansions;
  if (!Array.isArray(ex) || ex.length === 0) {
    return <span style={{ color: "var(--color-text-muted)" }}>No expansions yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {ex.map((raw, i) => {
        const e = raw as Record<string, unknown>;
        const scope = e.scope as Record<string, unknown> | undefined;
        return (
          <div
            key={i}
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>{String(e.title ?? "Expansion")}</div>
            {e.elevatorPitch ? (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>{String(e.elevatorPitch)}</div>
            ) : null}
            {e.userStory ? (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                <span style={{ color: "var(--color-text-muted)" }}>User story: </span>
                {String(e.userStory)}
              </div>
            ) : null}
            {scope ? (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {scope.mvp ? <div>MVP: {String(scope.mvp)}</div> : null}
                {scope.stretch ? <div>Stretch: {String(scope.stretch)}</div> : null}
                {Array.isArray(scope.nonGoals) ? (
                  <div style={{ marginTop: 4 }}>Non-goals: {(scope.nonGoals as string[]).join("; ")}</div>
                ) : null}
              </div>
            ) : null}
            {Array.isArray(e.milestones) && (e.milestones as string[]).length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
                Milestones: {(e.milestones as string[]).join(" → ")}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ConvergeOutputView({ out }: { out: unknown }) {
  const o = out as {
    rankings?: { rank?: number; title?: string; candidateId?: string; totalScore?: number; rationale?: string }[];
    winner?: { title?: string; candidateId?: string; rationale?: string };
    tradeoffs?: string;
  } | null;
  if (!o?.rankings && !o?.winner) {
    return <span style={{ color: "var(--color-text-muted)" }}>No scorecard yet.</span>;
  }
  const sorted = [...(o.rankings ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const runner = sorted.find((r) => r.rank === 2) ?? sorted[1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {o.winner ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--color-accent)",
            background: "var(--color-input-bg)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--color-accent)", fontWeight: 600, marginBottom: 6 }}>Winner</div>
          <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{String(o.winner.title ?? "")}</div>
          {o.winner.rationale ? (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>{o.winner.rationale}</div>
          ) : null}
        </div>
      ) : null}
      {runner ? (
        <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600, marginBottom: 6 }}>Runner-up</div>
          <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{String(runner.title ?? "")}</div>
          {runner.rationale ? (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>{runner.rationale}</div>
          ) : null}
        </div>
      ) : null}
      {sorted.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>Rank</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>Title</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} style={{ color: "var(--color-text-secondary)" }}>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{r.rank ?? i + 1}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{String(r.title ?? "")}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{r.totalScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {o.tradeoffs ? (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>Tradeoffs: </span>
          {o.tradeoffs}
        </div>
      ) : null}
    </div>
  );
}

function CommitOutputView({ out }: { out: unknown }) {
  const o = out as {
    artifactTitle?: string;
    executiveSummary?: string;
    sections?: { heading?: string; body?: string }[];
    appendix?: string[];
    templateType?: string;
  } | null;
  if (!o) return <span style={{ color: "var(--color-text-muted)" }}>No artifact yet.</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {o.templateType ? (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Template: {o.templateType}</div>
      ) : null}
      {o.artifactTitle ? (
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>{o.artifactTitle}</div>
      ) : null}
      {o.executiveSummary ? (
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{o.executiveSummary}</div>
      ) : null}
      {Array.isArray(o.sections)
        ? o.sections.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>{s.heading}</div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{s.body}</div>
            </div>
          ))
        : null}
      {Array.isArray(o.appendix) && o.appendix.length > 0 ? (
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>Appendix</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-text-secondary)" }}>
            {o.appendix.map((a, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function IterateOutputView({ out }: { out: unknown }) {
  const o = out as {
    followUpPrompts?: { label?: string; intent?: string; prompt?: string }[];
    meta?: string;
  } | null;
  const promptsList = o?.followUpPrompts;
  if (!Array.isArray(promptsList) || promptsList.length === 0) {
    return <span style={{ color: "var(--color-text-muted)" }}>No follow-up suggestions yet.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {o?.meta ? <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{o.meta}</div> : null}
      {promptsList.map((p, i) => (
        <div
          key={i}
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--color-accent)", fontSize: 13, marginBottom: 4 }}>{String(p.label ?? "Follow-up")}</div>
          {p.intent ? <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>{p.intent}</div> : null}
          {p.prompt ? (
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 6,
                background: "var(--color-input-bg)",
                color: "var(--color-text-primary)",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {p.prompt}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StageOutputRenderer({ stageId, state }: { stageId: StageId; state: StageState }) {
  if (state.status === "error" && state.error) {
    return (
      <div style={{ color: "#ef4444", fontSize: 13, lineHeight: 1.5 }}>
        <strong>Error: </strong>
        {state.error}
      </div>
    );
  }
  const out = state.output;
  switch (stageId) {
    case "seed":
      return <SeedOutputView out={out} />;
    case "normalize":
      return <NormalizeOutputView out={out} />;
    case "diverge":
      return <DivergeOutputView out={out} />;
    case "critique":
      return <CritiqueOutputView out={out} />;
    case "expand":
      return <ExpandOutputView out={out} />;
    case "converge":
      return <ConvergeOutputView out={out} />;
    case "commit":
      return <CommitOutputView out={out} />;
    case "iterate":
      return <IterateOutputView out={out} />;
    default:
      return null;
  }
}

export function BrainstormPage() {
  const [session, setSession] = useState<BrainstormSession>(pickInitialSession);
  const [selectedStageId, setSelectedStageId] = useState<StageId>("seed");
  const [runningId, setRunningId] = useState<StageId | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);

  const personas = useMemo(() => getAllPersonas(), []);

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      const exists = loadSessions().some((s) => s.id === session.id);
      if (!exists) saveSession(session);
      return;
    }
    saveSession(session);
  }, [session]);

  const activePersona = session.personaId ? getPersona(session.personaId) : undefined;

  const patchConfig = useCallback((stageId: StageId, patch: Partial<StageConfig>) => {
    setSession((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      stageConfigs: {
        ...prev.stageConfigs,
        [stageId]: { ...prev.stageConfigs[stageId], ...patch },
      },
    }));
  }, []);

  const handleRunStage = useCallback(async () => {
    const id = selectedStageId;
    setRunningId(id);
    try {
      const next = await runStage(session, id, personaForRun(activePersona));
      setSession(next);
      saveSession(next);
    } finally {
      setRunningId(null);
    }
  }, [session, selectedStageId, activePersona]);

  const handleRunAll = useCallback(async () => {
    setRunningId("seed");
    let s = session;
    try {
      for (const id of STAGE_IDS) {
        setRunningId(id);
        s = await runStage(s, id, personaForRun(session.personaId ? getPersona(session.personaId) : undefined));
        setSession(s);
        saveSession(s);
        if (s.stageStates[id].status === "error") break;
      }
    } finally {
      setRunningId(null);
    }
  }, [session]);

  const handleReset = useCallback(() => {
    setSession((prev) => resetPipelineKeepMeta(prev));
    setSelectedStageId("seed");
  }, []);

  const onPickImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (typeof data === "string") {
        setSession((prev) => ({
          ...prev,
          updatedAt: Date.now(),
          seedImageB64: data,
        }));
      }
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  }, []);

  const runDisabled = runningId !== null || !isPreviousStageComplete(session, selectedStageId);

  const inputBase: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-input-bg)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    outline: "none",
  };

  const btnPrimary: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 6,
    border: "1px solid var(--color-accent)",
    background: "var(--color-accent)",
    color: "var(--color-foreground)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };

  const btnGhost: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-primary)",
    fontSize: 13,
    cursor: "pointer",
  };

  const stageState = session.stageStates[selectedStageId];
  const cfg = session.stageConfigs[selectedStageId];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--color-background)",
        color: "var(--color-text-primary)",
      }}
    >
      <style>{`@keyframes brainstormSpin { to { transform: rotate(360deg); } }`}</style>

      {/* Top bar */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Brain size={20} style={{ color: "var(--color-accent)" }} aria-hidden />
          <input
            type="text"
            value={session.name}
            onChange={(e) => setSession((p) => ({ ...p, name: e.target.value, updatedAt: Date.now() }))}
            style={{ ...inputBase, width: 200, padding: "8px 10px" }}
            aria-label="Session name"
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", flexShrink: 0 }}>
          <Bot size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} aria-hidden />
          <select
            value={session.personaId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSession((p) => ({
                ...p,
                personaId: v || undefined,
                updatedAt: Date.now(),
              }));
            }}
            style={{
              ...inputBase,
              width: 220,
              padding: "8px 32px 8px 10px",
              cursor: "pointer",
              appearance: "none",
              WebkitAppearance: "none",
            }}
            aria-label="Persona"
          >
            <option value="">None</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.avatar} {p.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-text-muted)",
              pointerEvents: "none",
            }}
            aria-hidden
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
          <Send size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} aria-hidden />
          <input
            type="text"
            placeholder="Emotional / tonal prompt…"
            value={session.emotionalPrompt ?? ""}
            onChange={(e) => setSession((p) => ({ ...p, emotionalPrompt: e.target.value || undefined, updatedAt: Date.now() }))}
            style={{ ...inputBase, flex: 1, padding: "8px 10px" }}
          />
        </div>

        <button
          type="button"
          style={{
            ...btnPrimary,
            opacity: runningId !== null ? 0.6 : 1,
            cursor: runningId !== null ? "not-allowed" : "pointer",
          }}
          onClick={handleRunAll}
          disabled={runningId !== null}
        >
          <Zap size={16} />
          Run all
        </button>
        <button type="button" style={btnGhost} onClick={handleReset} disabled={runningId !== null}>
          <RotateCcw size={16} />
          Reset
        </button>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left pipeline */}
        <aside
          style={{
            width: LEFT_PANEL_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid var(--color-border)",
            padding: "16px 12px",
            overflowY: "auto",
            background: "var(--color-background)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 12, letterSpacing: "0.06em" }}>
            PIPELINE
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
            {STAGE_IDS.map((id, index) => {
              const meta = STAGE_META[id];
              const st = session.stageStates[id];
              const isSelected = selectedStageId === id;
              const isRunning = runningId === id;
              return (
                <div key={id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setSelectedStageId(id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 10px",
                      borderRadius: 8,
                      border: isSelected ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
                      background: "var(--color-card)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: meta.color,
                        marginTop: 4,
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{meta.label}</div>
                      <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2, lineHeight: 1.3 }}>{meta.description}</div>
                    </div>
                    <div style={{ flexShrink: 0, paddingTop: 2 }}>
                      <StatusGlyph status={st.status} isRunning={isRunning} />
                    </div>
                  </button>
                  {index < STAGE_IDS.length - 1 ? (
                    <div
                      style={{
                        width: 2,
                        height: 14,
                        background: "var(--color-border)",
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right detail */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Lightbulb size={18} style={{ color: STAGE_META[selectedStageId].color }} aria-hidden />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{STAGE_META[selectedStageId].label}</h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{STAGE_META[selectedStageId].description}</p>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
            {selectedStageId === "seed" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Idea</label>
                <textarea
                  value={session.seedText}
                  onChange={(e) => setSession((p) => ({ ...p, seedText: e.target.value, updatedAt: Date.now() }))}
                  rows={8}
                  placeholder="Your raw idea, concept, or inspiration…"
                  style={{ ...inputBase, padding: 12, resize: "vertical", minHeight: 160 }}
                />
                <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Context</label>
                <textarea
                  value={session.seedContext}
                  onChange={(e) => setSession((p) => ({ ...p, seedContext: e.target.value, updatedAt: Date.now() }))}
                  rows={4}
                  placeholder="Constraints, audience, references…"
                  style={{ ...inputBase, padding: 12, resize: "vertical" }}
                />
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
                  <button
                    type="button"
                    style={{ ...btnGhost, marginTop: 4 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={16} />
                    Upload image <span style={{ fontWeight: 400, opacity: 0.6 }}>(visual reference only)</span>
                  </button>
                  {session.seedImageB64 ? (
                    <div style={{ marginTop: 12 }}>
                      <img
                        src={imageSrc(session.seedImageB64)}
                        alt="Seed reference"
                        style={{ maxWidth: 280, maxHeight: 180, borderRadius: 8, border: "1px solid var(--color-border)" }}
                      />
                      <button
                        type="button"
                        style={{ ...btnGhost, marginTop: 8, fontSize: 12 }}
                        onClick={() => setSession((p) => ({ ...p, seedImageB64: undefined, updatedAt: Date.now() }))}
                      >
                        Remove image
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {selectedStageId === "normalize" ? (
              <div style={{ marginBottom: 16 }}>
                <NumberStepper
                  label="Questions"
                  min={1}
                  max={10}
                  value={cfg.questionCount ?? 5}
                  onChange={(n) => patchConfig("normalize", { questionCount: n })}
                />
              </div>
            ) : null}

            {selectedStageId === "diverge" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                <NumberStepper
                  label="Practical"
                  min={1}
                  max={20}
                  value={cfg.lensCounts?.practical ?? 4}
                  onChange={(n) =>
                    patchConfig("diverge", {
                      lensCounts: { practical: n, inversion: cfg.lensCounts?.inversion ?? 3, constraint: cfg.lensCounts?.constraint ?? 3 },
                    })
                  }
                />
                <NumberStepper
                  label="Inversion"
                  min={1}
                  max={20}
                  value={cfg.lensCounts?.inversion ?? 3}
                  onChange={(n) =>
                    patchConfig("diverge", {
                      lensCounts: { practical: cfg.lensCounts?.practical ?? 4, inversion: n, constraint: cfg.lensCounts?.constraint ?? 3 },
                    })
                  }
                />
                <NumberStepper
                  label="Constraint"
                  min={1}
                  max={20}
                  value={cfg.lensCounts?.constraint ?? 3}
                  onChange={(n) =>
                    patchConfig("diverge", {
                      lensCounts: { practical: cfg.lensCounts?.practical ?? 4, inversion: cfg.lensCounts?.inversion ?? 3, constraint: n },
                    })
                  }
                />
              </div>
            ) : null}

            {selectedStageId === "expand" ? (
              <div style={{ marginBottom: 16 }}>
                <NumberStepper
                  label="Expand count"
                  min={1}
                  max={15}
                  value={cfg.expandCount ?? 3}
                  onChange={(n) => patchConfig("expand", { expandCount: n })}
                />
              </div>
            ) : null}

            {selectedStageId === "commit" ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>Template type</label>
                <select
                  value={cfg.templateType ?? "design_doc"}
                  onChange={(e) => patchConfig("commit", { templateType: e.target.value })}
                  style={{ ...inputBase, maxWidth: 280, padding: "8px 10px", cursor: "pointer" }}
                >
                  {COMMIT_TEMPLATES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  opacity: runDisabled ? 0.5 : 1,
                  cursor: runDisabled ? "not-allowed" : "pointer",
                }}
                disabled={runDisabled}
                onClick={handleRunStage}
              >
                <Play size={16} />
                Run stage
              </button>
            </div>

            <OutputShell title="Output">
              <StageOutputRenderer stageId={selectedStageId} state={stageState} />
              {stageState.output != null && stageState.status !== "error" ? (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-text-muted)" }}>Raw JSON</summary>
                  <pre
                    style={{
                      marginTop: 8,
                      padding: 10,
                      borderRadius: 6,
                      overflow: "auto",
                      maxHeight: 240,
                      fontSize: 11,
                      background: "var(--color-background)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {safeJson(stageState.output)}
                  </pre>
                </details>
              ) : null}
            </OutputShell>

            <div style={{ marginTop: 20 }}>
              <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginBottom: 6 }}>Custom instructions</label>
              <textarea
                value={cfg.customInstructions ?? ""}
                onChange={(e) => patchConfig(selectedStageId, { customInstructions: e.target.value })}
                rows={3}
                placeholder="Extra guidance for this stage…"
                style={{ ...inputBase, padding: 10, resize: "vertical", width: "100%" }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
