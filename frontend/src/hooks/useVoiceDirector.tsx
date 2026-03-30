import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/hooks/useApi";
import { useToastContext } from "@/hooks/ToastContext";
import { getSavedDeviceId } from "@/hooks/useVoiceToText";

/* ── Safe base64 encoding ─────────────────────────────────── */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/* ── Types ────────────────────────────────────────────────── */

export interface VoiceCommand {
  action: string;
  params: Record<string, unknown>;
  spokenText: string;
}

interface VoiceDirectorContextValue {
  active: boolean;
  toggle: () => void;
  lastCommand: VoiceCommand | null;
}

const VoiceDirectorContext = createContext<VoiceDirectorContextValue>({
  active: false,
  toggle: () => {},
  lastCommand: null,
});

export const useVoiceDirector = () => useContext(VoiceDirectorContext);

/* ── Provider ─────────────────────────────────────────────── */

interface ProviderProps {
  activePage: string;
  children: React.ReactNode;
}

const SEND_INTERVAL = 5000;

export function VoiceDirectorProvider({ activePage, children }: ProviderProps) {
  const [active, setActive] = useState(false);
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const { addToast } = useToastContext();

  const activeRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mimeRef = useRef("audio/webm");
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  const processingRef = useRef(false);

  const getImageState = useCallback((): { hasImage: boolean; activeTab: string } => {
    const viewer = document.querySelector("[data-image-viewer-src]");
    const hasImage = !!viewer?.getAttribute("data-image-viewer-src");

    const activeTabEl = document.querySelector("[data-active-tab]");
    const activeTab = activeTabEl?.getAttribute("data-active-tab") || "main";

    return { hasImage, activeTab };
  }, []);

  const sendChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 200 || processingRef.current) return;
    processingRef.current = true;

    try {
      const buf = await blob.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const { hasImage, activeTab } = getImageState();

      void 0;

      const resp = await apiFetch<{
        action: string;
        params: Record<string, unknown>;
        spoken_text?: string;
        message?: string;
        error?: string;
      }>("/system/voice-command", {
        method: "POST",
        body: JSON.stringify({
          audio_b64: b64,
          mime_type: blob.type || "audio/webm",
          lang: "en-US",
          active_page: activePageRef.current,
          has_image: hasImage,
          active_tab: activeTab,
        }),
      });

      if (resp.error) {
        console.warn("[VoiceDirector] Error:", resp.error);
        addToast(`Voice Commands: ${resp.error}`, "error");
        return;
      }

      const action = resp.action || "none";
      const params = resp.params || {};
      const spokenText = resp.spoken_text || resp.message || "";

      void 0;

      const cmd: VoiceCommand = { action, params, spokenText };
      setLastCommand(cmd);

      if (action === "none") {
        if (spokenText) {
          addToast(`Voice Commands heard: "${spokenText.slice(0, 80)}"`, "info");
        }
        return;
      }

      const labelMap: Record<string, string> = {
        generate: "Generating...",
        edit_image: `Editing: ${(params.edit_prompt as string) || ""}`,
        extract_attributes: "Extracting attributes...",
        enhance_description: "Enhancing description...",
        randomize: "Randomizing...",
        quick_generate: "Quick generating...",
        generate_all_views: "Generating all views...",
        generate_selected_view: "Generating view...",
        set_field: `Setting ${params.field}: ${params.value}`,
        show_xml: "Showing XML...",
        send_to_photoshop: "Sending to Photoshop...",
        save_image: "Saving image...",
        reset: "Resetting session...",
        cancel: "Cancelling...",
        navigate: `Navigating to ${params.page}...`,
        inpaint: `Editing image: ${(params.prompt as string) || ""}`,
        remove_background: "Removing background...",
        style_transfer: `Applying style: ${(params.style as string) || ""}`,
        outpaint: `Extending ${(params.direction as string) || ""} ...`,
        smart_select: `Selecting: ${(params.subject as string) || ""}`,
        reimagine: "Reimagining...",
        clear_gallery: "Clearing gallery...",
      };

      const label = labelMap[action] || action;
      addToast(`Voice Commands: ${label}`, "info");

      window.dispatchEvent(new CustomEvent("voice-command", { detail: { action, params } }));
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("[VoiceDirector] Request failed:", err);
      }
    } finally {
      processingRef.current = false;
    }
  }, [getImageState, addToast]);

  /* ── Audio segment management ───────────────────────────── */

  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !activeRef.current) return;

    chunksRef.current = [];
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    let mime = "audio/webm";
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) { mime = t; break; } }
    mimeRef.current = mime;

    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      sendChunk(blob).then(() => {
        if (activeRef.current) beginSegment();
      });
    };

    recorder.start();

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, SEND_INTERVAL);
  }, [sendChunk]);

  /* ── Start / Stop ───────────────────────────────────────── */

  const startRecording = useCallback(async () => {
    try {
      const deviceId = getSavedDeviceId();
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      activeRef.current = true;
      setActive(true);
      beginSegment();
    } catch (err) {
      console.error("[VoiceDirector] Mic access failed:", err);
      addToast("Voice Commands: Could not access microphone", "error");
    }
  }, [beginSegment, addToast]);

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    setActive(false);

    if (sendTimerRef.current) { clearTimeout(sendTimerRef.current); sendTimerRef.current = null; }
    if (recorderRef.current?.state === "recording") {
      try { recorderRef.current.stop(); } catch { /* */ }
    }
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    return () => { if (activeRef.current) stopRecording(); };
  }, [stopRecording]);

  return (
    <VoiceDirectorContext.Provider value={{ active, toggle, lastCommand }}>
      {children}
    </VoiceDirectorContext.Provider>
  );
}
