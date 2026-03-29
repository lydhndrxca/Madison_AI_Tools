import { useState, useCallback, useRef, useEffect } from "react";
import {
  Bot, X, Settings, Send, Trash2, ChevronDown, ChevronUp,
  Zap, Brain, Power, Save, Mic,
} from "lucide-react";
import { useArtDirector, type ChatMessage } from "@/hooks/ArtDirectorContext";

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

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div className="max-w-[85%]">
        {!isUser && (
          <div className="flex items-center gap-1 mb-0.5">
            <Bot className="h-3 w-3" style={{ color: "var(--color-accent)" }} />
            <span className="text-[9px] font-medium" style={{ color: "var(--color-text-muted)" }}>Director</span>
          </div>
        )}
        <div
          className="px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap"
          style={{
            background: isUser ? "rgba(var(--color-accent-rgb, 59,130,246), 0.15)" : "rgba(255,255,255,0.05)",
            color: "var(--color-text-primary)",
            border: `1px solid ${isUser ? "rgba(var(--color-accent-rgb, 59,130,246), 0.25)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {msg.text}
        </div>
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
    saveTranscript,
  } = useArtDirector();

  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [quickCtx, setQuickCtx] = useState("");
  const [showQuickCtx, setShowQuickCtx] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!text) return;
    sendMessage(text);
    setInput("");
  }, [input, quickCtx, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleSaveTranscript = useCallback(async () => {
    const id = await saveTranscript("general");
    if (id) clearChat();
  }, [saveTranscript, clearChat]);

  if (!expanded) {
    return (
      <div
        className="absolute bottom-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer select-none transition-all hover:scale-[1.03]"
        style={{
          background: config.enabled ? "rgba(var(--color-accent-rgb, 59,130,246), 0.15)" : "rgba(0,0,0,0.6)",
          border: `1px solid ${config.enabled ? "rgba(var(--color-accent-rgb, 59,130,246), 0.3)" : "rgba(255,255,255,0.1)"}`,
          backdropFilter: "blur(8px)",
        }}
        onClick={() => setExpanded(true)}
        title="Open AI Art Director"
      >
        <Bot
          className="h-5 w-5"
          style={{
            color: config.enabled ? "var(--color-accent)" : "var(--color-text-muted)",
            filter: config.enabled ? "drop-shadow(0 0 4px rgba(59,130,246,0.5))" : "none",
          }}
        />
        <div>
          <div className="text-[11px] font-semibold" style={{ color: config.enabled ? "var(--color-foreground)" : "var(--color-text-secondary)" }}>
            Art Director
          </div>
          <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
            {config.enabled ? (config.mode === "deep" ? "Deep Thinking" : "Fast Mode") : "Off"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-3 left-3 z-30 flex flex-col rounded-lg overflow-hidden"
      style={{
        width: 360,
        height: 440,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Bot className="h-4 w-4" style={{ color: "var(--color-accent)" }} />
        <span className="text-[12px] font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          {config.persona.name || "Art Director"}
        </span>

        {/* Mode toggle */}
        <button
          onClick={() => updateConfig({ mode: config.mode === "fast" ? "deep" : "fast" })}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] cursor-pointer"
          style={{
            background: config.mode === "deep" ? "rgba(168,85,247,0.15)" : "rgba(250,204,21,0.15)",
            color: config.mode === "deep" ? "#a855f7" : "#facc15",
            border: `1px solid ${config.mode === "deep" ? "rgba(168,85,247,0.3)" : "rgba(250,204,21,0.3)"}`,
          }}
          title={config.mode === "deep" ? "Deep thinking (Gemini 2.5 Pro)" : "Fast mode (Gemini 2.0 Flash)"}
        >
          {config.mode === "deep" ? <Brain className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
          {config.mode === "deep" ? "Deep" : "Fast"}
        </button>

        {/* On/Off */}
        <button
          onClick={() => updateConfig({ enabled: !config.enabled })}
          className="p-1 rounded cursor-pointer"
          style={{
            color: config.enabled ? "#22c55e" : "var(--color-text-muted)",
            background: config.enabled ? "rgba(34,197,94,0.1)" : "transparent",
          }}
          title={config.enabled ? "Director is ON" : "Director is OFF"}
        >
          <Power className="h-3.5 w-3.5" />
        </button>

        <button onClick={onOpenConfig} className="p-1 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }} title="Configure Art Director">
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
                ? "Send a message to start getting art direction."
                : "Turn on the Art Director to start chatting."}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
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
          style={{ color: showQuickCtx ? "var(--color-accent)" : "var(--color-text-muted)" }}
          title="Toggle quick context"
        >
          {showQuickCtx ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        <input
          ref={inputRef}
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          placeholder={config.enabled ? "Ask the Art Director..." : "Turn on to chat"}
          disabled={!config.enabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {isTyping ? (
          <button onClick={cancelTyping} className="p-1.5 rounded cursor-pointer shrink-0" style={{ color: "#f06060" }} title="Stop">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!config.enabled || !input.trim()}
            className="p-1.5 rounded cursor-pointer shrink-0 disabled:opacity-30"
            style={{ color: "var(--color-accent)" }}
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}

        {messages.length > 0 && (
          <>
            <button onClick={handleSaveTranscript} className="p-1 rounded cursor-pointer shrink-0" style={{ color: "var(--color-text-muted)" }} title="Save transcript & clear">
              <Save className="h-3 w-3" />
            </button>
            <button onClick={clearChat} className="p-1 rounded cursor-pointer shrink-0" style={{ color: "var(--color-text-muted)" }} title="Clear chat">
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
