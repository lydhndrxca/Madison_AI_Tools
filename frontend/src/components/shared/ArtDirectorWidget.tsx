import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Bot, X, Settings, Send, Trash2, ChevronDown, ChevronUp,
  Zap, Brain, Power, Save, ImagePlus, Paperclip, Check, Sparkles, Search,
  MessageCircle, Lightbulb, Square, CheckSquare,
} from "lucide-react";
import { useArtDirector, type ChatMessage } from "@/hooks/ArtDirectorContext";
import { extractDeepSearchQuery, triggerDeepSearch, DS_EVT, dsDispatch, confettiBurst, loadDeepSearchSources } from "@/lib/deepSearchEvents";
import { apiFetch } from "@/hooks/useApi";

const bubbleKeyframes = `
@keyframes adBubbleIn {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
`;
if (typeof document !== "undefined" && !document.getElementById("ad-bubble-anim")) {
  const s = document.createElement("style");
  s.id = "ad-bubble-anim";
  s.textContent = bubbleKeyframes;
  document.head.appendChild(s);
}

interface ArtDirectorWidgetProps {
  onOpenConfig: () => void;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5 items-center">
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--color-text-muted)", animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--color-text-muted)", animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "var(--color-text-muted)", animationDelay: "300ms" }} />
    </span>
  );
}

interface FeedbackChunk {
  label: string;
  body: string;
  fullText: string;
}

function parseFeedbackChunks(text: string): FeedbackChunk[] {
  const chunks: FeedbackChunk[] = [];
  const regex = /\*\*([^*]+)\*\*:\s*/g;
  let match: RegExpExecArray | null;
  const positions: { label: string; start: number; bodyStart: number }[] = [];

  while ((match = regex.exec(text)) !== null) {
    positions.push({ label: match[1].trim(), start: match.index, bodyStart: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    const body = text.slice(positions[i].bodyStart, end).trim();
    const fullText = text.slice(positions[i].start, end).trim();
    if (body.length > 0) {
      chunks.push({ label: positions[i].label, body, fullText });
    }
  }
  return chunks;
}

function MessageBubble({ msg, onApply }: { msg: ChatMessage; onApply: ((suggestion: string) => void) | null }) {
  const isUser = msg.role === "user";
  const [appliedChunks, setAppliedChunks] = useState<Set<number>>(new Set());

  const chunks = useMemo(() => {
    if (isUser || !msg.text) return [];
    return parseFeedbackChunks(msg.text);
  }, [isUser, msg.text]);

  const hasChunks = chunks.length > 0;

  const handleApply = useCallback((idx: number, chunk: FeedbackChunk) => {
    if (!onApply) return;
    onApply(`${chunk.label}: ${chunk.body}`);
    setAppliedChunks((prev) => new Set(prev).add(idx));
  }, [onApply]);

  const handleApplyAll = useCallback(() => {
    if (!onApply || chunks.length === 0) return;
    const allText = chunks.map((c) => `${c.label}: ${c.body}`).join("\n");
    onApply(allText);
    setAppliedChunks(new Set(chunks.map((_, i) => i)));
  }, [onApply, chunks]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div className="max-w-[85%]">
        {!isUser && (
          <div className="flex items-center gap-1 mb-0.5">
            <Bot className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[9px] font-medium" style={{ color: "var(--color-text-muted)" }}>Director</span>
          </div>
        )}

        {/* User attached images */}
        {isUser && msg.attachedImages && msg.attachedImages.length > 0 && (
          <div className="flex gap-1 mb-1 justify-end flex-wrap">
            {msg.attachedImages.map((img, i) => (
              <img key={i} src={img} alt="" className="h-12 w-12 rounded object-cover" style={{ border: "1px solid var(--color-border)" }} />
            ))}
          </div>
        )}

        {hasChunks ? (
          <div className="space-y-1.5">
            {chunks.map((chunk, idx) => (
              <div
                key={idx}
                className="px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed"
                style={{
                  background: appliedChunks.has(idx) ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${appliedChunks.has(idx) ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>{chunk.label}: </span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{chunk.body}</span>
                  </div>
                  {onApply && (
                    <button
                      onClick={() => handleApply(idx, chunk)}
                      disabled={appliedChunks.has(idx)}
                      className="shrink-0 p-1 rounded cursor-pointer disabled:cursor-default transition-colors mt-0.5"
                      style={{
                        color: appliedChunks.has(idx) ? "#22c55e" : "var(--color-text-muted)",
                        background: appliedChunks.has(idx) ? "rgba(34,197,94,0.1)" : "transparent",
                      }}
                      title={appliedChunks.has(idx) ? "Applied" : "Apply this suggestion"}
                    >
                      {appliedChunks.has(idx) ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {onApply && chunks.length > 1 && appliedChunks.size < chunks.length && (
              <button
                onClick={handleApplyAll}
                className="w-full px-2 py-1 text-[10px] rounded cursor-pointer font-medium flex items-center justify-center gap-1"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
                title="Apply suggestions to edit prompt"
              >
                <Sparkles className="h-3 w-3" /> Apply All to Edit Prompt
              </button>
            )}
          </div>
        ) : (
          <div
            className="px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap"
            style={{
              background: isUser ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
              color: "var(--color-text-primary)",
              border: `1px solid ${isUser ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {msg.text}
          </div>
        )}

        <div className="text-[8px] mt-0.5 px-1" style={{ color: "var(--color-text-muted)" }}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

export function ArtDirectorWidget({ onOpenConfig }: ArtDirectorWidgetProps) {
  const {
    config, updateConfig,
    messages, sendMessage, clearChat, isTyping, cancelTyping,
    saveTranscript, onApplyFeedback,
    currentImage, attributesContext,
  } = useArtDirector();

  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [quickCtx, setQuickCtx] = useState("");
  const [showQuickCtx, setShowQuickCtx] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const modelMessages = messages.filter((m) => m.role === "model" && m.text);
  const unreadCount = expanded ? 0 : Math.max(0, modelMessages.length - lastSeenCount);

  useEffect(() => {
    if (expanded) {
      setLastSeenCount(modelMessages.length);
    }
  }, [expanded, modelMessages.length]);

  useEffect(() => {
    if (expanded) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, expanded, isTyping]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const handleSend = useCallback(() => {
    const text = quickCtx.trim()
      ? `[Context: ${quickCtx.trim()}]\n\n${input.trim()}`
      : input.trim();
    if (!text && pendingImages.length === 0) return;

    const dsQuery = extractDeepSearchQuery(text);
    if (dsQuery) {
      const imageForSearch = pendingImages.length > 0
        ? pendingImages[0]
        : currentImage || undefined;

      window.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabId: "deepSearch" } }));

      if (imageForSearch) {
        dsDispatch(DS_EVT.PREPARING);
        const imgB64 = imageForSearch.replace(/^data:image\/[^;]+;base64,/, "");
        apiFetch<{ enriched_query: string }>("/refsearch/enrich-query", {
          method: "POST",
          body: JSON.stringify({
            user_request: dsQuery,
            image_b64: imgB64,
            attributes_context: attributesContext || undefined,
          }),
        }).then((res) => {
          triggerDeepSearch(res.enriched_query, imageForSearch);
        }).catch(() => {
          triggerDeepSearch(dsQuery, imageForSearch);
        });
      } else {
        triggerDeepSearch(dsQuery);
      }
    }

    sendMessage(text || "(see attached images)", pendingImages.length > 0 ? pendingImages : undefined);
    setInput("");
    setPendingImages([]);
  }, [input, quickCtx, pendingImages, sendMessage, currentImage, attributesContext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = reader.result as string;
          setPendingImages((prev) => [...prev, b64]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const handleFileAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result as string;
        setPendingImages((prev) => [...prev, b64]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const removePendingImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSaveTranscript = useCallback(async () => {
    const id = await saveTranscript("general");
    if (id) clearChat();
  }, [saveTranscript, clearChat]);

  // Deep search visual state tracking
  const [dsState, setDsState] = useState<"idle" | "preparing" | "searching" | "results">("idle");
  const dsButtonRef = useRef<HTMLButtonElement>(null);
  const dsButtonTopRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onPreparing = () => setDsState("preparing");
    const onStart = () => setDsState("searching");
    const onComplete = (e: Event) => {
      const count = (e as CustomEvent).detail?.count ?? 0;
      if (count > 0) {
        setDsState("results");
        // Fire confetti from whichever button is visible
        const btn = dsButtonRef.current ?? dsButtonTopRef.current;
        if (btn) confettiBurst(btn);
      } else {
        setDsState("idle");
      }
    };
    const onViewed = () => setDsState("idle");
    window.addEventListener(DS_EVT.PREPARING, onPreparing);
    window.addEventListener(DS_EVT.START, onStart);
    window.addEventListener(DS_EVT.COMPLETE, onComplete);
    window.addEventListener(DS_EVT.VIEWED, onViewed);
    return () => {
      window.removeEventListener(DS_EVT.PREPARING, onPreparing);
      window.removeEventListener(DS_EVT.START, onStart);
      window.removeEventListener(DS_EVT.COMPLETE, onComplete);
      window.removeEventListener(DS_EVT.VIEWED, onViewed);
    };
  }, []);

  const lastModelMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "model" && messages[i].text) return messages[i];
    }
    return null;
  }, [messages]);

  const [bubbleDismissedId, setBubbleDismissedId] = useState<string | null>(null);

  const showBubble = !expanded && config.enabled && lastModelMsg && lastModelMsg.id !== bubbleDismissedId;

  const bubbleText = useMemo(() => {
    if (!lastModelMsg?.text) return "";
    const raw = lastModelMsg.text.replace(/\*\*([^*]+)\*\*:\s*/g, "$1: ");
    return raw.length > 180 ? raw.slice(0, 177) + "..." : raw;
  }, [lastModelMsg]);

  if (!expanded) {
    const adBorder = `1px solid ${config.enabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`;
    return (
      <div className="absolute bottom-3 left-3 z-30 flex items-end gap-0">
        {/* Widget column */}
        <div className="flex flex-col w-max">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-t-lg rounded-b-none cursor-pointer select-none transition-all hover:scale-[1.03]"
            style={{
              background: config.enabled ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.6)",
              border: adBorder,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(8px)",
            }}
            onClick={() => setExpanded(true)}
            title="Open Art Director"
          >
            <div className="relative">
              <Bot
                className="h-5 w-5"
                style={{
                  color: config.enabled ? "var(--color-text-primary)" : "var(--color-text-muted)",
                }}
              />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold leading-none px-0.5"
                  style={{ background: "#ef4444", color: "#fff" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold" style={{ color: config.enabled ? "var(--color-foreground)" : "var(--color-text-secondary)" }}>
                Art Director
              </div>
              <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                {config.enabled ? (config.mode === "deep" ? "Deep Thinking" : "Fast Mode") : "Off"}
              </div>
            </div>
            {!config.enabled && (
              <button
                onClick={(e) => { e.stopPropagation(); updateConfig({ enabled: true }); }}
                className="flex items-center gap-1 px-2 py-1 rounded-full cursor-pointer transition-all"
                style={{
                  background: "rgba(34,197,94,0.2)",
                  border: "1px solid rgba(34,197,94,0.5)",
                  color: "#4ade80",
                }}
                title="Turn on Art Director"
              >
                <Power className="h-3 w-3" />
                <span className="text-[9px] font-bold tracking-wide">ON</span>
              </button>
            )}
          </div>
          <button
            ref={dsButtonRef}
            type="button"
            className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-b-lg rounded-t-none text-[10px] font-medium cursor-pointer select-none transition-all hover:scale-[1.02]${dsState === "searching" || dsState === "preparing" ? " ds-searching" : ""}${dsState === "results" ? " ds-results-ready" : ""}`}
            style={{
              background: dsState === "results" ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.05)",
              border: dsState === "results" ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.08)",
              borderTop: "none",
              color: dsState === "results" ? "#22c55e" : "var(--color-text-secondary)",
              backdropFilter: "blur(8px)",
            }}
            onClick={() => {
              if (dsState === "results") {
                setDsState("idle");
                window.dispatchEvent(new CustomEvent(DS_EVT.VIEWED));
              }
              window.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabId: "deepSearch" } }));
            }}
            title={dsState === "results" ? "Results ready — click to view" : dsState === "searching" ? "Searching..." : dsState === "preparing" ? "Analyzing image..." : "Open Deep Search"}
          >
            <Search className="h-3 w-3 shrink-0" style={{ color: dsState === "results" ? "#22c55e" : "var(--color-text-muted)" }} />
            {dsState === "results" ? "RESULTS READY" : dsState === "searching" ? "Searching..." : dsState === "preparing" ? "Preparing..." : "Deep Search"}
          </button>
        </div>

        {/* Speech bubble */}
        {showBubble && (
          <div
            className="relative ml-0 mb-1"
            style={{ maxWidth: 280, minWidth: 120, animation: "adBubbleIn 0.25s ease-out both" }}
            key={lastModelMsg!.id}
          >
            {/* Left-pointing arrow */}
            <div
              className="absolute top-1/2 -left-[6px]"
              style={{
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: "6px solid rgba(255,255,255,0.12)",
                marginTop: -6,
              }}
            />
            <div
              className="absolute top-1/2 -left-[5px]"
              style={{
                width: 0,
                height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: "5px solid rgba(30,30,30,0.97)",
                marginTop: -5,
              }}
            />
            <div
              className="px-3 py-2 rounded-lg text-[11px] leading-relaxed cursor-pointer select-none"
              style={{
                background: "rgba(30,30,30,0.97)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "var(--color-text-secondary)",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
              onClick={() => setBubbleDismissedId(lastModelMsg!.id)}
              title="Click to dismiss"
            >
              {bubbleText}
            </div>
          </div>
        )}

        {/* Typing indicator bubble */}
        {!expanded && config.enabled && isTyping && !showBubble && (
          <div
            className="relative ml-0 mb-1"
            style={{ minWidth: 48, animation: "adBubbleIn 0.25s ease-out both" }}
          >
            <div
              className="absolute top-1/2 -left-[6px]"
              style={{
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: "6px solid rgba(255,255,255,0.12)",
                marginTop: -6,
              }}
            />
            <div
              className="absolute top-1/2 -left-[5px]"
              style={{
                width: 0,
                height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: "5px solid rgba(30,30,30,0.97)",
                marginTop: -5,
              }}
            />
            <div
              className="px-3 py-2 rounded-lg"
              style={{
                background: "rgba(30,30,30,0.97)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              <TypingDots />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-3 left-3 z-30 flex flex-col rounded-lg overflow-hidden"
      style={{
        width: 380,
        height: 480,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Bot className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[12px] font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          {config.persona.name || "Art Director"}
        </span>

        {/* Mode toggle */}
        <button
          onClick={() => updateConfig({ mode: config.mode === "fast" ? "deep" : "fast" })}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}
          title={config.mode === "deep" ? "Deep thinking (Gemini 2.5 Pro)" : "Fast mode (Gemini 2.0 Flash)"}
        >
          {config.mode === "deep" ? <Brain className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
          {config.mode === "deep" ? "Deep" : "Fast"}
        </button>

        {/* On/Off */}
        <button
          onClick={() => updateConfig({ enabled: !config.enabled })}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full cursor-pointer transition-all"
          style={{
            color: config.enabled ? "#fff" : "var(--color-text-muted)",
            background: config.enabled ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.06)",
            border: config.enabled ? "1px solid rgba(34,197,94,0.6)" : "1px solid var(--color-border)",
          }}
          title={config.enabled ? "Director is ON — click to turn OFF" : "Director is OFF — click to turn ON"}
        >
          <Power className="h-3 w-3" />
          <span className="text-[9px] font-bold tracking-wide">{config.enabled ? "ON" : "OFF"}</span>
        </button>

        <button onClick={onOpenConfig} className="p-1 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }} title="Art Director settings">
          <Settings className="h-3.5 w-3.5" />
        </button>

        <button onClick={() => setExpanded(false)} className="p-1 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }} title="Minimize">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1" style={{ background: "var(--color-background)" }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Bot className="h-8 w-8" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {config.enabled
                ? "Send a message or paste an image to start."
                : "Turn on the Art Director to start chatting."}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onApply={msg.role === "model" ? onApplyFeedback : null} />
        ))}
        {isTyping && messages.length > 0 && messages[messages.length - 1].text === "" && (
          <div className="flex justify-start mb-2">
            <div className="px-2.5 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div className="flex gap-1.5 px-3 py-1.5 overflow-x-auto shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          {pendingImages.map((img, i) => (
            <div key={i} className="relative shrink-0 group">
              <img src={img} alt="" className="h-10 w-10 rounded object-cover" style={{ border: "1px solid var(--color-border)" }} />
              <button
                onClick={() => removePendingImage(i)}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                style={{ background: "rgba(0,0,0,0.8)", color: "#f06060", fontSize: 8 }}
              >
                <X className="h-2 w-2" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Quick context */}
      {showQuickCtx && (
        <div className="px-3 py-1.5 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <input
            className="w-full px-2 py-1 text-[10px] rounded"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            placeholder="Quick context: what specifically do you want feedback on?"
            value={quickCtx}
            onChange={(e) => setQuickCtx(e.target.value)}
          />
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-1.5 px-3 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={() => setShowQuickCtx(!showQuickCtx)}
          className="p-1 rounded cursor-pointer shrink-0"
          style={{ color: showQuickCtx ? "var(--color-text-primary)" : "var(--color-text-muted)" }}
          title="Toggle context panel"
        >
          {showQuickCtx ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          className="p-1 rounded cursor-pointer shrink-0"
          style={{ color: "var(--color-text-muted)" }}
          title="Attach image from disk"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileAdd} />

        <input
          ref={inputRef}
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          placeholder={config.enabled ? "Ask the Art Director..." : "Turn on to chat"}
          disabled={!config.enabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        {isTyping ? (
          <button onClick={cancelTyping} className="p-1.5 rounded cursor-pointer shrink-0" style={{ color: "#f06060" }} title="Stop">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!config.enabled || (!input.trim() && pendingImages.length === 0)}
            className="p-1.5 rounded cursor-pointer shrink-0 disabled:opacity-30"
            style={{ color: "var(--color-text-primary)" }}
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}

        {messages.length > 0 && (
          <>
            <button onClick={handleSaveTranscript} className="p-1 rounded cursor-pointer shrink-0" style={{ color: "var(--color-text-muted)" }} title="Save transcript and clear">
              <Save className="h-3 w-3" />
            </button>
            <button onClick={clearChat} className="p-1 rounded cursor-pointer shrink-0" style={{ color: "var(--color-text-muted)" }} title="Clear conversation">
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
