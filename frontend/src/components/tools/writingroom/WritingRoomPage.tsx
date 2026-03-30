import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronRight,
  FileText,
  Lock,
  Send,
  Shuffle,
  SkipForward,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { getAllPersonas, getPersona, deletePersona, type Persona } from "@/lib/personaLibrary";
import {
  CREATIVE_ROUNDS,
  buildRoundPrompt,
  getRoundByIndex,
  getTemperatureForRole,
  isLastRound,
} from "@/lib/writingroom/rounds";
import {
  createSession,
  loadSessions,
  saveSession,
  setActiveSessionId,
} from "@/lib/writingroom/store";
import type {
  AgentRole,
  AgentTurnState,
  ChatMessage,
  LockedDecision,
  MessageReactions,
  PlanningData,
  RoomAgent,
  WritingSession,
} from "@/lib/writingroom/types";
import {
  MODEL_TIER_OPTIONS,
  SCOPE_OPTIONS,
  TONE_OPTIONS,
  WRITING_TYPE_OPTIONS,
} from "@/lib/writingroom/types";

function compileBrief(p: PlanningData): string {
  const typeLabel =
    p.writingType === "other" && p.writingTypeOther.trim()
      ? p.writingTypeOther.trim()
      : WRITING_TYPE_OPTIONS.find((o) => o.id === p.writingType)?.label ||
        p.writingType ||
        "(not set)";
  const scope = SCOPE_OPTIONS.find((s) => s.id === p.scopeLength);
  const tones =
    p.tones.length > 0
      ? p.tones.map((t) => TONE_OPTIONS.find((x) => x.id === t)?.label ?? t).join(", ")
      : "(none selected)";
  const lines = [
    "=== CREATIVE BRIEF ===",
    "",
    `Writing type: ${typeLabel}`,
    `Scope: ${scope?.label ?? p.scopeLength} — ${scope?.description ?? ""}`,
    "",
    "— Project context —",
    p.projectContext.trim() || "(none)",
    "",
    "— Target audience —",
    p.targetAudience.trim() || "(none)",
    "",
    "— Tones —",
    tones,
    "",
    "— Hard rules —",
    p.hardRules.trim() || "(none)",
    "",
    "— Reference material —",
    p.referenceMaterial.trim() || "(none)",
    "",
    "— Additional notes —",
    p.additionalNotes.trim() || "(none)",
  ];
  return lines.join("\n");
}

function personaToAgentRole(role: Persona["role"]): AgentRole {
  if (role === "producer") return "producer";
  return "writer";
}

function roleDisplayLabel(role: Persona["role"] | "user" | "system"): string {
  if (role === "producer") return "Producer";
  if (role === "writer") return "Writer";
  if (role === "creative") return "Creative";
  if (role === "user") return "You";
  if (role === "system") return "System";
  return role;
}

function defaultReactions(): MessageReactions {
  return { thumbsUp: false, thumbsDown: false, star: false };
}

function newMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bumpAgentStates(
  prev: Record<string, AgentTurnState>,
  speakerId: string,
  roomAgents: RoomAgent[],
): Record<string, AgentTurnState> {
  const next: Record<string, AgentTurnState> = { ...prev };
  for (const ra of roomAgents) {
    const id = ra.personaId;
    const cur =
      next[id] ?? {
        personaId: id,
        proposals: [],
        objections: [],
        endorsements: [],
        currentStance: "",
        conviction: 0,
        turnsSinceLastSpoke: 0,
        totalTurnsSpoken: 0,
      };
    if (id === speakerId) {
      next[id] = {
        ...cur,
        turnsSinceLastSpoke: 0,
        totalTurnsSpoken: cur.totalTurnsSpoken + 1,
      };
    } else {
      next[id] = { ...cur, turnsSinceLastSpoke: cur.turnsSinceLastSpoke + 1 };
    }
  }
  return next;
}

function pickSpeaker(
  eligible: Persona[],
  agentStates: Record<string, AgentTurnState>,
): Persona {
  if (eligible.length === 1) return eligible[0]!;
  const scored = eligible.map((p) => {
    const st = agentStates[p.id];
    const quiet = st?.turnsSinceLastSpoke ?? 999;
    return { p, quiet, r: Math.random() };
  });
  scored.sort((a, b) => {
    if (b.quiet !== a.quiet) return b.quiet - a.quiet;
    return a.r - b.r;
  });
  return scored[0]!.p;
}

function formatTranscript(msgs: ChatMessage[], max: number): string {
  const slice = msgs.slice(-max);
  return slice
    .map((m) => {
      const who =
        m.sender === "user"
          ? "User"
          : m.sender === "system"
            ? "System"
            : `${m.agentName} (${roleDisplayLabel(m.agentRole as Persona["role"])})`;
      return `${who}: ${m.content}`;
    })
    .join("\n\n");
}

function modelForPersona(p: Persona): string {
  const tier = p.modelTier ?? "standard";
  return MODEL_TIER_OPTIONS.find((o) => o.id === tier)?.model ?? "gemini-2.5-flash";
}

const baseInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-input-bg)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 8px",
  fontSize: "12px",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "10px",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  marginBottom: "4px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export function WritingRoomPage() {
  const { addToast } = useToastContext();
  const [session, setSession] = useState<WritingSession | null>(null);
  const [mainTab, setMainTab] = useState<"planning" | "writing">("planning");
  const [draft, setDraft] = useState("");
  const [autoRun, setAutoRun] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const generatingRef = useRef(false);
  const sessionRef = useRef<WritingSession | null>(null);
  const [personas, setPersonas] = useState<Persona[]>(() => getAllPersonas());

  const handleDeletePersona = useCallback((id: string) => {
    deletePersona(id);
    setPersonas(getAllPersonas());
  }, []);

  useEffect(() => {
    const list = loadSessions();
    let s: WritingSession;
    if (list.length === 0) {
      s = createSession();
      saveSession(s);
    } else {
      s = list[0]!;
    }
    setSession(s);
    sessionRef.current = s;
    setActiveSessionId(s.id);
    setMainTab(s.activeScreen === "writing" ? "writing" : "planning");
  }, []);

  const commit = useCallback((updater: (prev: WritingSession) => WritingSession) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      saveSession(next);
      sessionRef.current = next;
      return next;
    });
  }, []);

  const updatePlanning = useCallback(
    (patch: Partial<PlanningData>) => {
      commit((s) => ({
        ...s,
        planning: { ...s.planning, ...patch },
      }));
    },
    [commit],
  );

  const toggleTone = useCallback(
    (id: (typeof TONE_OPTIONS)[number]["id"]) => {
      commit((s) => {
        const tones = s.planning.tones.includes(id)
          ? s.planning.tones.filter((t) => t !== id)
          : [...s.planning.tones, id];
        return { ...s, planning: { ...s.planning, tones } };
      });
    },
    [commit],
  );

  const toggleRoomAgent = useCallback(
    (personaId: string) => {
      commit((s) => {
        const has = s.roomAgents.some((r) => r.personaId === personaId);
        const roomAgents = has
          ? s.roomAgents.filter((r) => r.personaId !== personaId)
          : [...s.roomAgents, { personaId, approved: true }];
        return { ...s, roomAgents };
      });
    },
    [commit],
  );

  sessionRef.current = session;

  const runAgentTurn = useCallback(
    async (opts?: { producerOnly?: boolean }) => {
      const snap = sessionRef.current;
      if (!snap || generatingRef.current) return;
      const round = getRoundByIndex(snap.roundState.currentRoundIndex);
      if (!round) return;
      if (snap.roundState.turnsInRound >= round.maxTurns) {
        addToast("This round has reached its turn limit. Lock or skip.", "info");
        return;
      }

      const agents = snap.roomAgents
        .map((r) => getPersona(r.personaId))
        .filter((p): p is Persona => !!p);

      const eligible = agents.filter((p) => {
        const ar = personaToAgentRole(p.role);
        if (opts?.producerOnly) return ar === "producer";
        return round.agentPool.includes(ar);
      });

      if (eligible.length === 0) {
        addToast("No agents match this round’s roles. Add a producer or writer.", "error");
        return;
      }

      const speaker = pickSpeaker(eligible, snap.agentStates);
      const agentRole = personaToAgentRole(speaker.role);
      const temperature = getTemperatureForRole(agentRole);
      const model = modelForPersona(speaker);

      const lockedForPrompt = snap.roundState.lockedDecisions.map((d) => ({
        label: d.label,
        value: d.value,
      }));
      const roundBlock = buildRoundPrompt(round, lockedForPrompt);
      const brief = snap.producerBrief ?? compileBrief(snap.planning);
      const profile = [
        `You are ${speaker.name} (${roleDisplayLabel(speaker.role)}).`,
        `Reference: ${speaker.referenceName}`,
        "",
        "=== YOUR CREATIVE PROFILE ===",
        speaker.researchData.trim() || "(No extended profile.)",
      ].join("\n");

      const context = formatTranscript(snap.chatHistory, 24);
      const prompt = [
        profile,
        "",
        "=== BRIEF ===",
        brief,
        "",
        "=== CONVERSATION SO FAR ===",
        context || "(Start of discussion.)",
        "",
        roundBlock,
        "",
        "Respond in character. Be concise but substantive (roughly 2–6 short paragraphs unless the brief demands otherwise). Stay aligned with locked decisions.",
      ].join("\n");

      generatingRef.current = true;
      setIsGenerating(true);
      let chainAuto = false;
      try {
        const res = await apiFetch<{ text: string }>("/writingroom/generate-turn", {
          method: "POST",
          body: JSON.stringify({ prompt, temperature, model }),
        });
        const text = (res?.text ?? "").trim() || "(Empty response.)";
        const chatMessage: ChatMessage = {
          id: newMessageId(),
          timestamp: Date.now(),
          sender: "agent",
          agentId: speaker.id,
          agentName: speaker.name,
          agentRole,
          agentAvatar: speaker.avatar,
          content: text,
          reactions: defaultReactions(),
        };

        commit((s) => {
          const nextS: WritingSession = {
            ...s,
            chatHistory: [...s.chatHistory, chatMessage],
            roundState: {
              ...s.roundState,
              turnsInRound: s.roundState.turnsInRound + 1,
            },
            agentStates: bumpAgentStates(s.agentStates, speaker.id, s.roomAgents),
            roomPhase:
              s.roomPhase === "idle" || s.roomPhase === "briefing" ? "rounds" : s.roomPhase,
          };
          return nextS;
        });

        const nextTurns = snap.roundState.turnsInRound + 1;
        const rAfter = getRoundByIndex(snap.roundState.currentRoundIndex);
        if (autoRun && rAfter && nextTurns < rAfter.maxTurns) {
          chainAuto = true;
          setTimeout(() => {
            generatingRef.current = false;
            setIsGenerating(false);
            void runAgentTurn(opts);
          }, 450);
        }
      } catch (e) {
        addToast(e instanceof Error ? e.message : "Turn generation failed", "error");
      } finally {
        if (!chainAuto) {
          generatingRef.current = false;
          setIsGenerating(false);
        }
      }
    },
    [addToast, commit, autoRun],
  );

  const startWriting = useCallback(() => {
    if (!session) return;
    if (session.roomAgents.length === 0) {
      addToast("Select at least one agent for the room.", "error");
      return;
    }
    if (!session.planning.writingType) {
      addToast("Choose a writing type.", "error");
      return;
    }
    const brief = compileBrief(session.planning);
    const sys: ChatMessage = {
      id: newMessageId(),
      timestamp: Date.now(),
      sender: "system",
      agentId: null,
      agentName: "System",
      agentRole: "system",
      agentAvatar: "",
      content: `Brief locked. ${session.roomAgents.length} collaborators in the room. Current focus: ${getRoundByIndex(0)?.label ?? "Round 1"}.`,
    };
    commit((s) => ({
      ...s,
      producerBrief: brief,
      planning: { ...s.planning },
      activeScreen: "writing",
      roomPhase: "rounds",
      roundState: {
        currentRoundIndex: 0,
        turnsInRound: 0,
        lockedDecisions: s.roundState.lockedDecisions,
      },
      chatHistory: [...s.chatHistory, sys],
    }));
    setMainTab("writing");
    addToast("Writing Room started.", "success");
  }, [session, commit, addToast]);

  const sendUserMessage = useCallback(() => {
    const t = draft.trim();
    if (!t || !session) return;
    const msg: ChatMessage = {
      id: newMessageId(),
      timestamp: Date.now(),
      sender: "user",
      agentId: null,
      agentName: "You",
      agentRole: "user",
      agentAvatar: "",
      content: t,
    };
    setDraft("");
    commit((s) => ({ ...s, chatHistory: [...s.chatHistory, msg] }));
    if (autoRun) {
      setTimeout(() => void runAgentTurn(), 300);
    }
  }, [draft, session, commit, autoRun, runAgentTurn]);

  const lockDecision = useCallback(() => {
    if (!session) return;
    const round = getRoundByIndex(session.roundState.currentRoundIndex);
    if (!round) return;
    const lastAgent = [...session.chatHistory].reverse().find((m) => m.sender === "agent");
    if (!lastAgent?.content.trim()) {
      addToast("No agent message to lock yet.", "info");
      return;
    }
    const label = round.locksField ? round.label : `${round.label} (summary)`;
    const decision: LockedDecision = {
      roundId: round.id,
      label,
      value: lastAgent.content.slice(0, 4000),
      lockedBy: "user",
      lockedAt: Date.now(),
    };
    commit((s) => ({
      ...s,
      roundState: {
        ...s.roundState,
        lockedDecisions: [...s.roundState.lockedDecisions, decision],
      },
    }));
    addToast("Decision recorded for this round.", "success");
  }, [session, commit, addToast]);

  const skipRound = useCallback(() => {
    if (!session) return;
    const idx = session.roundState.currentRoundIndex;
    if (isLastRound(idx)) {
      addToast("Already on the final round.", "info");
      return;
    }
    const sys: ChatMessage = {
      id: newMessageId(),
      timestamp: Date.now(),
      sender: "system",
      agentId: null,
      agentName: "System",
      agentRole: "system",
      agentAvatar: "",
      content: `Round skipped. Moving to: ${getRoundByIndex(idx + 1)?.label ?? "next"}.`,
    };
    commit((s) => ({
      ...s,
      chatHistory: [...s.chatHistory, sys],
      roundState: {
        ...s.roundState,
        currentRoundIndex: idx + 1,
        turnsInRound: 0,
      },
    }));
  }, [session, commit, addToast]);

  const producerNudge = useCallback(() => {
    const sys: ChatMessage = {
      id: newMessageId(),
      timestamp: Date.now(),
      sender: "system",
      agentId: null,
      agentName: "System",
      agentRole: "system",
      agentAvatar: "",
      content: "Producer nudge: steer the room—clarify goals, resolve tension, or propose a decision.",
    };
    commit((s) => ({ ...s, chatHistory: [...s.chatHistory, sys] }));
    void runAgentTurn({ producerOnly: true });
  }, [commit, runAgentTurn]);

  const wrapUp = useCallback(() => {
    const finalIdx = CREATIVE_ROUNDS.length - 1;
    const sys: ChatMessage = {
      id: newMessageId(),
      timestamp: Date.now(),
      sender: "system",
      agentId: null,
      agentName: "System",
      agentRole: "system",
      agentAvatar: "",
      content: "Wrap-up: moving to Final Review. Summarize what’s working and what still needs a pass.",
    };
    commit((s) => ({
      ...s,
      wrappingUp: true,
      roundState: {
        ...s.roundState,
        currentRoundIndex: finalIdx,
        turnsInRound: 0,
      },
      chatHistory: [...s.chatHistory, sys],
    }));
  }, [commit]);

  const [randomizing, setRandomizing] = useState(false);
  const randomizePlanning = useCallback(async () => {
    if (randomizing) return;
    setRandomizing(true);
    try {
      const prompt = [
        "Generate creative, randomized planning parameters for a writing session. Return valid JSON with these keys:",
        '{ "writingType": one of ["screenplay","short_story","narrative_design","world_bible","pitch_doc","ad_copy","dialogue","other"],',
        '  "projectContext": string, "targetAudience": string, "hardRules": string,',
        '  "referenceMaterial": string, "additionalNotes": string,',
        '  "scopeLength": one of ["flash","short","medium","feature","series"] }',
        "Be creative. Return ONLY valid JSON, no markdown fences.",
      ].join("\n");
      const res = await apiFetch<{ result: string }>("/writingroom/randomize-planning", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      const text = (res?.result ?? "").trim();
      const clean = text.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(clean);
      updatePlanning({
        writingType: parsed.writingType ?? "",
        writingTypeOther: parsed.writingTypeOther ?? "",
        projectContext: parsed.projectContext ?? "",
        targetAudience: parsed.targetAudience ?? "",
        hardRules: parsed.hardRules ?? "",
        referenceMaterial: parsed.referenceMaterial ?? "",
        additionalNotes: parsed.additionalNotes ?? "",
        scopeLength: parsed.scopeLength ?? "short",
      });
      addToast("Planning randomized.", "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Randomize failed", "error");
    } finally {
      setRandomizing(false);
    }
  }, [randomizing, updatePlanning, addToast]);

  const [summarizing, setSummarizing] = useState(false);
  const summarizeSession = useCallback(async () => {
    if (summarizing || !session) return;
    setSummarizing(true);
    try {
      const transcript = formatTranscript(session.chatHistory, 50);
      const prompt = [
        "Summarize the following collaborative writing session transcript. Highlight key decisions, themes, and next steps.",
        "",
        transcript || "(No messages yet.)",
      ].join("\n");
      const res = await apiFetch<{ summary: string }>("/writingroom/summarize", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      const text = (res?.summary ?? "").trim() || "(Empty summary.)";
      const sys: ChatMessage = {
        id: newMessageId(),
        timestamp: Date.now(),
        sender: "system",
        agentId: null,
        agentName: "System",
        agentRole: "system",
        agentAvatar: "",
        content: `SESSION SUMMARY:\n${text}`,
      };
      commit((s) => ({ ...s, chatHistory: [...s.chatHistory, sys] }));
      addToast("Session summarized.", "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Summarize failed", "error");
    } finally {
      setSummarizing(false);
    }
  }, [summarizing, session, commit, addToast]);

  const toggleReaction = useCallback(
    (msgId: string, key: keyof MessageReactions) => {
      commit((s) => ({
        ...s,
        chatHistory: s.chatHistory.map((m) => {
          if (m.id !== msgId || m.sender !== "agent") return m;
          const r = m.reactions ?? defaultReactions();
          return {
            ...m,
            reactions: { ...r, [key]: !r[key] },
          };
        }),
      }));
    },
    [commit],
  );

  if (!session) {
    return (
      <div style={{ padding: "1.5rem", color: "var(--color-text-muted)" }}>Loading Writing Room…</div>
    );
  }

  const planning = session.planning;
  const currentRound = getRoundByIndex(session.roundState.currentRoundIndex);

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
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-card)",
        }}
      >
        <Sparkles size={16} style={{ color: "var(--color-accent)" }} />
        <h1 style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>Writing Room</h1>
        <div style={{ flex: 1 }} />
        <TabButton
          active={mainTab === "planning"}
          onClick={() => {
            setMainTab("planning");
            commit((s) => ({ ...s, activeScreen: "planning" }));
          }}
        >
          Planning
        </TabButton>
        <TabButton
          active={mainTab === "writing"}
          onClick={() => {
            setMainTab("writing");
            commit((s) => ({ ...s, activeScreen: "writing" }));
          }}
        >
          Writing Room
        </TabButton>
      </header>

      {mainTab === "planning" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "1rem 1.25rem 2rem",
            maxWidth: "900px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Writing Type</label>
            <select
              value={planning.writingType}
              onChange={(e) =>
                updatePlanning({
                  writingType: e.target.value as PlanningData["writingType"],
                })
              }
              style={{ ...baseInputStyle, cursor: "pointer" }}
            >
              <option value="">Select…</option>
              {WRITING_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </section>

          {planning.writingType === "other" && (
            <section style={{ marginBottom: "1.25rem" }}>
              <label style={labelStyle}>Describe type</label>
              <input
                value={planning.writingTypeOther}
                onChange={(e) => updatePlanning({ writingTypeOther: e.target.value })}
                placeholder="e.g. patch notes, VO script…"
                style={baseInputStyle}
              />
            </section>
          )}

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Scope</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {SCOPE_OPTIONS.map((sc) => {
                const selected = planning.scopeLength === sc.id;
                return (
                  <label
                    key={sc.id}
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "flex-start",
                      cursor: "pointer",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: selected ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                      background: selected ? "var(--color-hover)" : "var(--color-input-bg)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scope"
                      checked={selected}
                      onChange={() => updatePlanning({ scopeLength: sc.id })}
                    />
                    <span>
                      <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-text-primary)" }}>{sc.label}</span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "10px",
                          color: "var(--color-text-muted)",
                          marginTop: "2px",
                        }}
                      >
                        {sc.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Project Context</label>
            <textarea
              rows={4}
              value={planning.projectContext}
              onChange={(e) => updatePlanning({ projectContext: e.target.value })}
              style={{ ...baseInputStyle, resize: "vertical", minHeight: "88px" }}
            />
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Target Audience</label>
            <input
              value={planning.targetAudience}
              onChange={(e) => updatePlanning({ targetAudience: e.target.value })}
              style={baseInputStyle}
            />
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Tones</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {TONE_OPTIONS.map((t) => {
                const on = planning.tones.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTone(t.id)}
                    style={{
                      border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                      background: on ? "rgba(139,92,246,0.15)" : "var(--color-input-bg)",
                      color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderRadius: "var(--radius-sm)",
                      padding: "5px 10px",
                      fontSize: "11px",
                      fontWeight: on ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Hard Rules</label>
            <textarea
              rows={3}
              value={planning.hardRules}
              onChange={(e) => updatePlanning({ hardRules: e.target.value })}
              style={{ ...baseInputStyle, resize: "vertical" }}
            />
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Reference Material</label>
            <textarea
              rows={3}
              value={planning.referenceMaterial}
              onChange={(e) => updatePlanning({ referenceMaterial: e.target.value })}
              style={{ ...baseInputStyle, resize: "vertical" }}
            />
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Additional Notes</label>
            <textarea
              rows={2}
              value={planning.additionalNotes}
              onChange={(e) => updatePlanning({ additionalNotes: e.target.value })}
              style={{ ...baseInputStyle, resize: "vertical" }}
            />
          </section>

          <section style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>Agent Team</label>
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0 0 0.5rem" }}>
              Click cards to include collaborators in the room.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "0.6rem",
              }}
            >
              {personas.map((p) => {
                const selected = session.roomAgents.some((r) => r.personaId === p.id);
                return (
                  <div key={p.id} style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => toggleRoomAgent(p.id)}
                      style={{
                        textAlign: "left",
                        padding: "0.65rem",
                        borderRadius: "var(--radius-sm, 6px)",
                        border: `2px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                        background: "var(--color-card)",
                        color: "var(--color-text-primary)",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", lineHeight: 1 }}>{p.avatar}</div>
                      <div style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
                        {roleDisplayLabel(p.role)}
                      </div>
                    </button>
                    {!p.isPreset && (
                      <button
                        type="button"
                        title="Remove custom persona"
                        onClick={(e) => { e.stopPropagation(); handleDeletePersona(p.id); }}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: "none",
                          background: "rgba(239,68,68,0.15)",
                          color: "#ef4444",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={startWriting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-accent)",
                background: "var(--color-accent)",
                color: "var(--color-foreground, #fff)",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              <ChevronRight size={14} />
              Start Writing
            </button>
            <button
              type="button"
              onClick={randomizePlanning}
              disabled={randomizing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-input-bg)",
                color: "var(--color-text-primary)",
                fontWeight: 600,
                cursor: randomizing ? "not-allowed" : "pointer",
                fontSize: "12px",
                opacity: randomizing ? 0.6 : 1,
              }}
            >
              <Shuffle size={14} />
              {randomizing ? "Randomizing…" : "Randomize"}
            </button>
          </div>
        </div>
      )}

      {mainTab === "writing" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <aside
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: "1px solid var(--color-border)",
              background: "var(--color-card)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "0.65rem 0.75rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              Creative rounds
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "0.5rem" }}>
              {CREATIVE_ROUNDS.map((r, i) => {
                const active = i === session.roundState.currentRoundIndex;
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      padding: "0.45rem 0.5rem",
                      borderRadius: "var(--radius-sm, 6px)",
                      marginBottom: "0.25rem",
                      background: active ? "var(--color-hover)" : "transparent",
                      border: `1px solid ${active ? "var(--color-accent)" : "transparent"}`,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        background: active ? "var(--color-accent)" : "var(--color-input-bg)",
                        color: active ? "var(--color-foreground, #fff)" : "var(--color-text-secondary)",
                      }}
                    >
                      {i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{r.label}</div>
                      {active && currentRound && (
                        <div
                          style={{
                            fontSize: "0.65rem",
                            color: "var(--color-text-muted)",
                            marginTop: "0.2rem",
                          }}
                        >
                          Turns: {session.roundState.turnsInRound} / {currentRound.maxTurns}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                padding: "0.6rem 0.75rem",
                maxHeight: "35%",
                overflow: "auto",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  marginBottom: "0.35rem",
                }}
              >
                Locked decisions
              </div>
              {session.roundState.lockedDecisions.length === 0 ? (
                <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>None yet.</div>
              ) : (
                session.roundState.lockedDecisions.map((d) => (
                  <div
                    key={`${d.roundId}-${d.lockedAt}`}
                    style={{
                      fontSize: "0.68rem",
                      marginBottom: "0.35rem",
                      padding: "0.35rem",
                      background: "var(--color-input-bg)",
                      borderRadius: "4px",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>{d.label}</div>
                    <div style={{ color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
                      {d.value.slice(0, 180)}
                      {d.value.length > 180 ? "…" : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {session.chatHistory.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
                  No messages yet. Run a turn from the controls or enable Auto-Run after you speak.
                </div>
              ) : (
                session.chatHistory.map((m) => (
                  <MessageBubble key={m.id} message={m} onToggleReaction={toggleReaction} />
                ))
              )}
            </div>

            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid var(--color-border)",
                padding: "0.5rem 0.75rem",
                background: "var(--color-card)",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                alignItems: "center",
              }}
            >
              <ControlPill active={autoRun} onClick={() => setAutoRun((v) => !v)} icon={<Zap size={14} />}>
                Auto-Run
              </ControlPill>
              <ControlPill onClick={lockDecision} icon={<Lock size={14} />}>
                Lock Decision
              </ControlPill>
              <ControlPill onClick={skipRound} icon={<SkipForward size={14} />}>
                Skip Round
              </ControlPill>
              <ControlPill onClick={producerNudge} icon={<Sparkles size={14} />}>
                Producer Nudge
              </ControlPill>
              <ControlPill onClick={wrapUp} icon={<Check size={14} />}>
                Wrap Up
              </ControlPill>
              <ControlPill onClick={summarizeSession} icon={<FileText size={14} />}>
                {summarizing ? "Summarizing…" : "Summarize"}
              </ControlPill>
              <div style={{ flex: 1, minWidth: 8 }} />
              <button
                type="button"
                onClick={() => void runAgentTurn()}
                disabled={isGenerating}
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "5px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-accent)",
                  background: "var(--color-accent)",
                  color: "var(--color-foreground, #fff)",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  opacity: isGenerating ? 0.6 : 1,
                }}
              >
                Run Agent Turn
              </button>
            </div>

            <div
              style={{
                flexShrink: 0,
                padding: "0.65rem 0.75rem",
                borderTop: "1px solid var(--color-border)",
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-end",
                background: "var(--color-background)",
              }}
            >
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendUserMessage();
                  }
                }}
                placeholder="Message the room…"
                style={{
                  ...baseInputStyle,
                  flex: 1,
                  resize: "none",
                  minHeight: "48px",
                }}
              />
              <button
                type="button"
                onClick={sendUserMessage}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-sm, 6px)",
                  border: "none",
                  background: "var(--color-accent)",
                  color: "var(--color-foreground, #fff)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Send"
              >
                <Send size={18} />
              </button>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        background: active ? "var(--color-hover)" : "var(--color-input-bg)",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ControlPill({
  children,
  onClick,
  icon,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        fontWeight: 500,
        padding: "5px 10px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        background: active ? "rgba(139,92,246,0.15)" : "var(--color-input-bg)",
        color: active ? "var(--color-accent)" : "var(--color-text-primary)",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function MessageBubble({
  message: m,
  onToggleReaction,
}: {
  message: ChatMessage;
  onToggleReaction: (id: string, key: keyof MessageReactions) => void;
}) {
  if (m.sender === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            maxWidth: "92%",
            padding: "0.45rem 0.75rem",
            borderRadius: "8px",
            background: "var(--color-input-bg)",
            border: "1px dashed var(--color-border)",
            fontSize: "0.78rem",
            color: "var(--color-text-secondary)",
            textAlign: "center",
          }}
        >
          {m.content}
        </div>
      </div>
    );
  }

  if (m.sender === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "78%",
            padding: "0.55rem 0.75rem",
            borderRadius: "12px 12px 4px 12px",
            background: "var(--color-accent)",
            color: "var(--color-foreground, #fff)",
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {m.content}
        </div>
      </div>
    );
  }

  const r = m.reactions ?? defaultReactions();
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          maxWidth: "82%",
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "8px",
            background: "var(--color-input-bg)",
            border: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.15rem",
            flexShrink: 0,
          }}
        >
          {m.agentAvatar || "•"}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.35rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{m.agentName}</span>
            <span style={{ fontSize: "0.68rem", color: "var(--color-text-muted)" }}>
              {roleDisplayLabel(m.agentRole as Persona["role"])}
            </span>
          </div>
          <div
            style={{
              marginTop: "0.25rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "12px 12px 12px 4px",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              fontSize: "0.85rem",
              whiteSpace: "pre-wrap",
              color: "var(--color-text-primary)",
            }}
          >
            {m.content}
          </div>
          <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.35rem" }}>
            <ReactionBtn
              title="Thumbs up"
              active={r.thumbsUp}
              onClick={() => onToggleReaction(m.id, "thumbsUp")}
            >
              <ThumbsUp size={14} />
            </ReactionBtn>
            <ReactionBtn
              title="Thumbs down"
              active={r.thumbsDown}
              onClick={() => onToggleReaction(m.id, "thumbsDown")}
            >
              <ThumbsDown size={14} />
            </ReactionBtn>
            <ReactionBtn title="Star" active={r.star} onClick={() => onToggleReaction(m.id, "star")}>
              <Star size={14} />
            </ReactionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReactionBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: "0.2rem 0.35rem",
        borderRadius: "6px",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        background: active ? "var(--color-hover)" : "transparent",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
      }}
    >
      {children}
    </button>
  );
}
