import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/hooks/useApi";
import { useShortcuts } from "@/hooks/useShortcuts";

/* ── Persisted settings ─────────────────────────────────────── */

const SETTINGS_KEY = "madison-voice-settings";
const DEVICE_KEY = "madison-audio-device-id";

export interface VoiceSettings {
  lang: string;
  continuous: boolean;
  sendInterval: number;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  lang: "en-US",
  continuous: true,
  sendInterval: 7000,
};

const MAX_CONTEXT_CHARS = 300;

function loadSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
  toggle: () => void;
  supported: boolean;
  settings: VoiceSettings;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
}

const VoiceToTextContext = createContext<VoiceToTextContextValue>({
  active: false,
  toggle: () => {},
  supported: true,
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
});

export const useVoiceToText = () => useContext(VoiceToTextContext);

/* ── Provider (MediaRecorder + Gemini transcription) ────────── */

export function VoiceToTextProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const targetStampRef = useRef<string | null>(null);
  const recentTranscriptsRef = useRef<string[]>([]);

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
      console.log("[VoiceToText] No target text field found — transcription:", text);
      return;
    }

    el.focus();

    // execCommand('insertText') is the most reliable way to insert text
    // into a focused input/textarea in Chromium — it properly triggers
    // React's synthetic event system and maintains undo history.
    const spacer = el.value.length > 0 && el.selectionStart === el.value.length && !el.value.endsWith(" ") ? " " : "";
    const inserted = document.execCommand("insertText", false, spacer + text);

    if (!inserted) {
      // Fallback: direct value manipulation
      console.log("[VoiceToText] execCommand failed, using fallback setter");
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

    console.log("[VoiceToText] Inserted text into", el.tagName, el.placeholder || el.name || "");
  }, [resolveTarget]);

  const sendChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 200) return;
    try {
      const buf = await blob.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      console.log(`[VoiceToText] Sending ${(blob.size / 1024).toFixed(1)}KB audio chunk...`);

      const context = recentTranscriptsRef.current.join(" ").slice(-MAX_CONTEXT_CHARS);

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
        console.log("[VoiceToText] Transcript:", transcript);
        recentTranscriptsRef.current.push(transcript);
        if (recentTranscriptsRef.current.length > 10) recentTranscriptsRef.current.shift();
        insertText(transcript);
      } else {
        console.log("[VoiceToText] Empty transcript (silence or unintelligible)");
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("[VoiceToText] Request failed:", err);
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

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    if (sendTimerRef.current) { clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setActive(false);
  }, []);

  const startRecording = useCallback(async () => {
    // Capture the currently focused text field BEFORE getUserMedia (which may steal focus)
    const preTarget = resolveTarget();
    try {
      const deviceId = getSavedDeviceId();
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      mimeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      activeRef.current = true;
      recentTranscriptsRef.current = [];
      setActive(true);
      beginSegment();

      // Restore focus to the text field so the cursor stays visible while user speaks
      if (preTarget) {
        requestAnimationFrame(() => preTarget.focus());
      }
    } catch (err) {
      console.error("[VoiceToText] Could not start recording:", err);
      setActive(false);
    }
  }, [beginSegment, resolveTarget]);

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
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <VoiceToTextContext.Provider value={{ active, toggle, supported: true, settings, updateSettings }}>
      {children}
    </VoiceToTextContext.Provider>
  );
}
