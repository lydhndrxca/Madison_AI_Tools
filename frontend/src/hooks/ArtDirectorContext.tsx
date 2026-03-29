import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { apiFetchSSE, apiFetch } from "./useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonaConfig {
  name: string;
  description: string;
  philosophy: string;
  likes: string;
  dislikes: string;
}

export interface ContextImage {
  id: string;
  b64: string;
  label: string;
}

export interface ArtDirectorConfig {
  enabled: boolean;
  persona: PersonaConfig;
  verbosity: "brief" | "medium" | "detailed";
  mode: "fast" | "deep";
  systemPrompt: string;
  contextImages: ContextImage[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  imageSnapshot?: string;
  timestamp: number;
}

interface ArtDirectorContextValue {
  config: ArtDirectorConfig;
  setConfig: (c: ArtDirectorConfig) => void;
  updateConfig: (partial: Partial<ArtDirectorConfig>) => void;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  isTyping: boolean;
  cancelTyping: () => void;
  currentImage: string | null;
  setCurrentImage: (src: string | null) => void;
  attributesContext: string;
  setAttributesContext: (ctx: string) => void;
  saveTranscript: (tool: string) => Promise<string | null>;
}

const DEFAULT_PERSONA: PersonaConfig = {
  name: "Art Director",
  description: "",
  philosophy: "",
  likes: "",
  dislikes: "",
};

const DEFAULT_SYSTEM_PROMPT =
  "You are an AI Art Director embedded in a concept art tool. " +
  "You observe the artist's work and provide insightful, constructive, " +
  "and actionable art direction. You speak with authority and taste, " +
  "referencing composition, color theory, silhouette, mood, and storytelling.";

const DEFAULT_CONFIG: ArtDirectorConfig = {
  enabled: false,
  persona: DEFAULT_PERSONA,
  verbosity: "medium",
  mode: "fast",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  contextImages: [],
};

const STORAGE_KEY = "madison-art-director-config";

function loadConfig(): ArtDirectorConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* */ }
  return { ...DEFAULT_CONFIG };
}

function persistConfig(c: ArtDirectorConfig) {
  try {
    const toSave = { ...c, contextImages: c.contextImages.map(({ id, label }) => ({ id, label, b64: "" })) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* */ }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const Ctx = createContext<ArtDirectorContextValue>({
  config: DEFAULT_CONFIG,
  setConfig: () => {},
  updateConfig: () => {},
  messages: [],
  sendMessage: async () => {},
  clearChat: () => {},
  isTyping: false,
  cancelTyping: () => {},
  currentImage: null,
  setCurrentImage: () => {},
  attributesContext: "",
  setAttributesContext: () => {},
  saveTranscript: async () => null,
});

export const useArtDirector = () => useContext(Ctx);

export function ArtDirectorProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigRaw] = useState<ArtDirectorConfig>(loadConfig);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [attributesContext, setAttributesContext] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const currentImageRef = useRef(currentImage);
  currentImageRef.current = currentImage;

  const setConfig = useCallback((c: ArtDirectorConfig) => {
    setConfigRaw(c);
    persistConfig(c);
  }, []);

  const updateConfig = useCallback((partial: Partial<ArtDirectorConfig>) => {
    setConfigRaw((prev) => {
      const next = { ...prev, ...partial };
      persistConfig(next);
      return next;
    });
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsTyping(false);
  }, []);

  const cancelTyping = useCallback(() => {
    abortRef.current?.abort();
    setIsTyping(false);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      imageSnapshot: currentImageRef.current || undefined,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const botMsgId = crypto.randomUUID();
    const botMsg: ChatMessage = {
      id: botMsgId,
      role: "model",
      text: "",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, botMsg]);
    setIsTyping(true);

    const abort = new AbortController();
    abortRef.current = abort;

    const imgB64 = currentImageRef.current?.replace(/^data:image\/[^;]+;base64,/, "") || undefined;

    const history = messages.map((m) => ({
      role: m.role,
      text: m.text,
      image_b64: m.imageSnapshot?.replace(/^data:image\/[^;]+;base64,/, "") || undefined,
    }));

    try {
      const result = await apiFetchSSE(
        "/director/chat",
        {
          message: text.trim(),
          image_b64: imgB64,
          conversation_history: history,
          persona: config.persona,
          context_images: config.contextImages.filter((ci) => ci.b64).map((ci) => ({ b64: ci.b64.replace(/^data:image\/[^;]+;base64,/, ""), label: ci.label })),
          attributes_context: attributesContext,
          system_prompt: config.systemPrompt,
          verbosity: config.verbosity,
          mode: config.mode,
        },
        (token) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === botMsgId ? { ...m, text: m.text + token } : m)),
          );
        },
        abort.signal,
      );
      if (result.error) {
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, text: m.text || `Error: ${result.error}` } : m)),
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, text: m.text || "Connection error" } : m)),
        );
      }
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  }, [messages, config, attributesContext]);

  const saveTranscript = useCallback(async (tool: string): Promise<string | null> => {
    if (messages.length === 0) return null;
    const imageSnapshots = messages
      .filter((m) => m.imageSnapshot)
      .map((m) => m.imageSnapshot!)
      .slice(0, 5);
    try {
      const res = await apiFetch<{ id: string }>("/director/transcripts", {
        method: "POST",
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, text: m.text, timestamp: m.timestamp })),
          images: imageSnapshots.map((img) => img.slice(0, 200)),
          title: `${config.persona.name} — ${new Date().toLocaleString()}`,
          tool,
        }),
      });
      return res.id;
    } catch {
      return null;
    }
  }, [messages, config.persona.name]);

  useEffect(() => {
    persistConfig(config);
  }, [config]);

  return (
    <Ctx.Provider
      value={{
        config, setConfig, updateConfig,
        messages, sendMessage, clearChat, isTyping, cancelTyping,
        currentImage, setCurrentImage,
        attributesContext, setAttributesContext,
        saveTranscript,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
