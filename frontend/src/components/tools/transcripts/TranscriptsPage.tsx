import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Trash2, X, ChevronLeft, Clock, Bot, User } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

interface TranscriptSummary {
  id: string;
  title: string;
  tool: string;
  created_at: string;
  message_count: number;
  preview: string;
  has_images: boolean;
}

interface TranscriptMessage {
  role: "user" | "model";
  text: string;
  timestamp?: number;
}

interface TranscriptDetail {
  id: string;
  title: string;
  tool: string;
  created_at: string;
  messages: TranscriptMessage[];
  images: string[];
}

export function TranscriptsPage() {
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [selected, setSelected] = useState<TranscriptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ transcripts: TranscriptSummary[] }>("/director/transcripts");
      setTranscripts(res.transcripts);
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openTranscript = useCallback(async (id: string) => {
    try {
      const res = await apiFetch<TranscriptDetail>(`/director/transcripts/${id}`);
      setSelected(res);
    } catch { /* */ }
  }, []);

  const deleteTranscript = useCallback(async (id: string) => {
    try {
      await apiFetch(`/director/transcripts/${id}`, { method: "DELETE" });
      setTranscripts((prev) => prev.filter((t) => t.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch { /* */ }
  }, [selected]);

  if (selected) {
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
        <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <button onClick={() => setSelected(null)} className="p-1 rounded cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate" style={{ color: "var(--color-foreground)" }}>{selected.title}</h1>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {selected.created_at} · {selected.messages.length} messages
            </p>
          </div>
          <button
            onClick={() => deleteTranscript(selected.id)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded cursor-pointer"
            style={{ color: "#f06060", background: "rgba(90,42,42,0.2)", border: "1px solid rgba(138,74,74,0.3)" }}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {selected.messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[75%]">
                  <div className="flex items-center gap-1 mb-0.5">
                    {isUser ? (
                      <User className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
                    ) : (
                      <Bot className="h-3 w-3" style={{ color: "var(--color-accent)" }} />
                    )}
                    <span className="text-[9px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                      {isUser ? "You" : "Director"}
                    </span>
                    {msg.timestamp && (
                      <span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div
                    className="px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap"
                    style={{
                      background: isUser ? "rgba(var(--color-accent-rgb, 59,130,246), 0.1)" : "rgba(255,255,255,0.04)",
                      color: "var(--color-text-primary)",
                      border: `1px solid ${isUser ? "rgba(var(--color-accent-rgb, 59,130,246), 0.2)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <MessageSquare className="h-5 w-5" style={{ color: "var(--color-accent)" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Art Direction Transcripts
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {transcripts.length} session{transcripts.length !== 1 ? "s" : ""}
          </span>
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Loading...</p>
          </div>
        ) : transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <MessageSquare className="h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No transcripts yet. Save a conversation from the Art Director to see it here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {transcripts.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors section-card-hover"
                style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                onClick={() => openTranscript(t.id)}
              >
                <Bot className="h-5 w-5 shrink-0" style={{ color: "var(--color-accent)" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate" style={{ color: "var(--color-foreground)" }}>
                    {t.title}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: "var(--color-text-muted)" }}>
                    {t.preview}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                    <Clock className="h-3 w-3" />
                    {t.created_at}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                    {t.message_count} messages
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteTranscript(t.id); }}
                  className="p-1 rounded cursor-pointer opacity-0 group-hover:opacity-100"
                  style={{ color: "var(--color-text-muted)" }}
                  title="Delete transcript"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
