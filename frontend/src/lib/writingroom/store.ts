import type { WritingSession } from "./types";
import { DEFAULT_PLANNING, DEFAULT_PROJECT_STATE } from "./types";

const LS_KEY = "madison-writing-sessions";
const LS_ACTIVE = "madison-writing-active";

export function createSession(name?: string): WritingSession {
  return {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `Session ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    planning: { ...DEFAULT_PLANNING },
    producerBrief: null,
    roomAgents: [],
    chatHistory: [],
    roomPhase: "idle",
    roundState: { currentRoundIndex: 0, turnsInRound: 0, lockedDecisions: [] },
    agentStates: {},
    projectState: { ...DEFAULT_PROJECT_STATE },
    activeScreen: "planning",
    userApproved: false,
  };
}

export function loadSessions(): WritingSession[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSessions(sessions: WritingSession[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sessions));
  } catch {
    /* ignore quota / private mode */
  }
}

export function saveSession(session: WritingSession) {
  const all = loadSessions().filter((s) => s.id !== session.id);
  all.unshift({ ...session, updatedAt: Date.now() });
  saveSessions(all);
}

export function deleteSession(id: string) {
  saveSessions(loadSessions().filter((s) => s.id !== id));
}

export function setActiveSessionId(id: string) {
  localStorage.setItem(LS_ACTIVE, id);
}
