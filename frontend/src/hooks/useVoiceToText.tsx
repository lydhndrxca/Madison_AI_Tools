import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/hooks/useApi";
import { useShortcuts } from "@/hooks/useShortcuts";

/* ── Persisted settings ─────────────────────────────────────── */

const SETTINGS_KEY = "madison-voice-settings";
const DEVICE_KEY = "madison-audio-device-id";

export type VoiceEngine = "gemini" | "native";

export interface VoiceSettings {
  engine: VoiceEngine;
  lang: string;
  continuous: boolean;
  sendInterval: number;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  engine: "gemini",
  lang: "en-US",
  continuous: true,
  sendInterval: 7000,
};

const MAX_CONTEXT_CHARS = 300;

function loadSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const merged = { ...DEFAULT_SETTINGS, ...parsed };
        if (merged.engine !== "gemini" && merged.engine !== "native") merged.engine = DEFAULT_SETTINGS.engine;
        if (typeof merged.sendInterval !== "number" || merged.sendInterval < 500) merged.sendInterval = DEFAULT_SETTINGS.sendInterval;
        return merged;
      }
    }
  } catch { /* */ }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(s: VoiceSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* */ }
}

export function getSavedDeviceId(): string {
  try { return localStorage.getItem(DEVICE_KEY) || ""; } catch { return ""; }
}

/* ── Safe base64 encoding for large blobs ───────────────────── */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/* ── Target element tracking ────────────────────────────────── */

const VOICE_TARGET_ATTR = "data-voice-target";

function stampElement(el: HTMLInputElement | HTMLTextAreaElement) {
  if (!el.getAttribute(VOICE_TARGET_ATTR)) {
    el.setAttribute(VOICE_TARGET_ATTR, `vt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  }
  return el.getAttribute(VOICE_TARGET_ATTR)!;
}

function findElementByStamp(stamp: string): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[${VOICE_TARGET_ATTR}="${stamp}"]`);
  return el;
}

/* ── Context ────────────────────────────────────────────────── */

interface VoiceToTextContextValue {
  active: boolean;
  /** True when recording has stopped but transcription requests are still in flight */
  processing: boolean;
  toggle: () => void;
  supported: boolean;
  settings: VoiceSettings;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
}

const VoiceToTextContext = createContext<VoiceToTextContextValue>({
  active: false,
  processing: false,
  toggle: () => {},
  supported: true,
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
});

export const useVoiceToText = () => useContext(VoiceToTextContext);

/* ── Web Speech API types (not in all TS libs) ───────────────── */

interface NativeSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface NativeSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: NativeSpeechRecognitionResult;
}

interface NativeSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: NativeSpeechRecognitionResultList;
}

interface NativeSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface NativeSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: NativeSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: NativeSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type NativeSpeechRecognitionCtor = new () => NativeSpeechRecognition;

/* ── Native Web Speech API check ─────────────────────────────── */

const SpeechRecognitionCtor: NativeSpeechRecognitionCtor | null =
  typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>).SpeechRecognition as NativeSpeechRecognitionCtor ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition as NativeSpeechRecognitionCtor ?? null
    : null;

export const nativeSpeechSupported = !!SpeechRecognitionCtor;

/* ── Provider (Gemini transcription + native Web Speech API) ── */

export function VoiceToTextProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Gemini engine refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const targetStampRef = useRef<string | null>(null);
  const recentTranscriptsRef = useRef<string[]>([]);
  const pendingRequestsRef = useRef(0);

  // Native engine ref
  const recognitionRef = useRef<NativeSpeechRecognition | null>(null);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });
  }, []);

  const resolveTarget = useCallback((): HTMLInputElement | HTMLTextAreaElement | null => {
    if (targetStampRef.current) {
      const el = findElementByStamp(targetStampRef.current);
      if (el) return el;
    }
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      targetStampRef.current = stampElement(active);
      return active;
    }
    return null;
  }, []);

  const insertText = useCallback((text: string) => {
    const el = resolveTarget();
    if (!el) {
      if (process.env.NODE_ENV === "development") console.log("[VoiceToText] No target text field found — transcription:", text);
      return;
    }

    el.focus();

    const spacer = el.value.length > 0 && el.selectionStart === el.value.length && !el.value.endsWith(" ") ? " " : "";
    const inserted = document.execCommand("insertText", false, spacer + text);

    if (!inserted) {
      void 0;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const sp = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newValue = before + sp + text + after;

      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(el, newValue);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const cursorPos = start + sp.length + text.length;
      el.setSelectionRange(cursorPos, cursorPos);
    }

    void 0;
  }, [resolveTarget]);

  /* ── Gemini engine ──────────────────────────────────────────── */

  const sendChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 200) return;
    pendingRequestsRef.current++;
    try {
      const buf = await blob.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      console.log(`[VoiceToText] Sending ${(blob.size / 1024).toFixed(1)}KB audio chunk...`);

      const unique = [...new Set(recentTranscriptsRef.current)];
      const context = unique.slice(-3).join(" ").slice(-MAX_CONTEXT_CHARS);

      const resp = await apiFetch<{ text?: string; error?: string }>("/system/transcribe", {
        method: "POST",
        body: JSON.stringify({
          audio_b64: b64,
          mime_type: blob.type || "audio/webm",
          lang: settingsRef.current.lang,
          context,
        }),
      });
      if (resp.error) {
        console.warn("[VoiceToText] Transcription error:", resp.error);
      }
      const transcript = resp.text?.trim();
      if (transcript) {
        const recent = recentTranscriptsRef.current;
        const isDuplicate =
          recent.length >= 2 &&
          recent[recent.length - 1] === transcript &&
          recent[recent.length - 2] === transcript;
        if (isDuplicate) {
          console.warn("[VoiceToText] Dropping duplicate transcript (likely hallucination loop):", transcript);
          recentTranscriptsRef.current = [];
        } else {
          void 0;
          recent.push(transcript);
          if (recent.length > 10) recent.shift();
          insertText(transcript);
        }
      } else {
        void 0;
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("[VoiceToText] Request failed:", err);
      }
    } finally {
      pendingRequestsRef.current--;
      if (pendingRequestsRef.current <= 0 && !activeRef.current) {
        setProcessing(false);
        if (processingTimeoutRef.current) { clearTimeout(processingTimeoutRef.current); processingTimeoutRef.current = null; }
      }
    }
  }, [insertText]);

  const mimeRef = useRef("audio/webm");

  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !activeRef.current) return;

    const recorder = new MediaRecorder(stream, { mimeType: mimeRef.current });
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        sendChunk(blob);
      }
      if (activeRef.current) beginSegment();
    };

    recorder.start();

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, settingsRef.current.sendInterval);
  }, [sendChunk]);

  const stopGemini = useCallback(() => {
    activeRef.current = false;
    if (sendTimerRef.current) { clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  const startGemini = useCallback(async (preTarget: HTMLInputElement | HTMLTextAreaElement | null) => {
    try {
      const deviceId = getSavedDeviceId();
      const audioConstraints: MediaTrackConstraints = {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;

      mimeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      activeRef.current = true;
      recentTranscriptsRef.current = [];
      setActive(true);
      beginSegment();

      if (preTarget) requestAnimationFrame(() => preTarget.focus());
    } catch (err) {
      console.error("[VoiceToText] Could not start Gemini recording:", err);
      setActive(false);
    }
  }, [beginSegment]);

  /* ── Native Web Speech API engine ───────────────────────────── */

  const stopNative = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const startNative = useCallback((preTarget: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!SpeechRecognitionCtor) {
      console.error("[VoiceToText] Native speech recognition not available in this browser");
      setActive(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = settingsRef.current.lang;
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: NativeSpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) {
            void 0;
            insertText(text);
          }
        }
      }
    };

    recognition.onerror = (event: NativeSpeechRecognitionErrorEvent) => {
      console.warn("[VoiceToText/Native] Error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopNative();
        setActive(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be active
      if (activeRef.current && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch { /* already started */ }
      }
    };

    recognitionRef.current = recognition;
    activeRef.current = true;
    setActive(true);

    try {
      recognition.start();
    } catch (err) {
      console.error("[VoiceToText/Native] Could not start:", err);
      setActive(false);
      return;
    }

    if (preTarget) requestAnimationFrame(() => preTarget.focus());
  }, [insertText, stopNative]);

  /* ── Unified start / stop / toggle ──────────────────────────── */

  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecording = useCallback(() => {
    stopGemini();
    stopNative();
    activeRef.current = false;
    setActive(false);
    if (pendingRequestsRef.current > 0) {
      setProcessing(true);
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = setTimeout(() => setProcessing(false), 15000);
    }
  }, [stopGemini, stopNative]);

  const startRecording = useCallback(async () => {
    const preTarget = resolveTarget();
    if (settingsRef.current.engine === "native") {
      startNative(preTarget);
    } else {
      await startGemini(preTarget);
    }
  }, [resolveTarget, startGemini, startNative]);

  const toggle = useCallback(() => {
    if (active) stopRecording();
    else startRecording();
  }, [active, startRecording, stopRecording]);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const { registerAction, unregisterAction } = useShortcuts();
  useEffect(() => {
    registerAction("toggleVoice", () => toggleRef.current());
    return () => unregisterAction("toggleVoice");
  }, [registerAction, unregisterAction]);

  // Track the last focused text field at all times via a stable data attribute.
  // This survives React re-renders because querySelector finds the current DOM node
  // even if React replaced the old one (as long as the attribute persists via React props or was set).
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        targetStampRef.current = stampElement(el);
      }
    };
    document.addEventListener("focusin", handler, true);
    return () => document.removeEventListener("focusin", handler, true);
  }, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
    };
  }, []);

  return (
    <VoiceToTextContext.Provider value={{ active, processing, toggle, supported: true, settings, updateSettings }}>
      {children}
    </VoiceToTextContext.Provider>
  );
}
