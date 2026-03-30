import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Search, Send, Bot, ChevronRight, ChevronDown, BookOpen,
  ExternalLink, Loader2, X, MessageCircle,
} from "lucide-react";
import { HELP_DOCS, type DocSection } from "@/lib/helpDocs";
import { apiFetch } from "@/hooks/useApi";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  sections?: string[];
}

const CATEGORIES = [...new Set(HELP_DOCS.map((d) => d.category))];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function renderMarkdownish(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    key++;
    if (!line.trim()) {
      elements.push(<div key={key} className="h-2" />);
      continue;
    }

    let processed = line
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--color-text-primary)">$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer" style="color:var(--color-accent);text-decoration:underline">$1</a>');

    if (line.startsWith("- ")) {
      processed = processed.slice(2);
      elements.push(
        <div key={key} className="flex gap-2 pl-2 py-0.5">
          <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full" style={{ background: "var(--color-text-muted)" }} />
          <span className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }} dangerouslySetInnerHTML={{ __html: processed }} />
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)?.[1] || "";
      processed = processed.replace(/^\d+\.\s/, "");
      elements.push(
        <div key={key} className="flex gap-2 pl-2 py-0.5">
          <span className="shrink-0 text-[11px] font-mono mt-0.5" style={{ color: "var(--color-text-muted)" }}>{num}.</span>
          <span className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }} dangerouslySetInnerHTML={{ __html: processed }} />
        </div>
      );
    } else {
      elements.push(
        <p key={key} className="text-[12px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }} dangerouslySetInnerHTML={{ __html: processed }} />
      );
    }
  }
  return elements;
}

export function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set(CATEGORIES));
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    { id: "welcome", role: "assistant", text: "Hi! I'm the Madison AI Suite help assistant. Ask me anything about the app's tools, features, or workflow — I'll find the answer in the documentation and point you to the right section.", sections: [] },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return HELP_DOCS;
    const q = searchQuery.toLowerCase();
    return HELP_DOCS.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.body.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const groupedDocs = useMemo(() => {
    const map = new Map<string, DocSection[]>();
    for (const doc of filteredDocs) {
      const list = map.get(doc.category) || [];
      list.push(doc);
      map.set(doc.category, list);
    }
    return map;
  }, [filteredDocs]);

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id);
    const el = document.getElementById(`help-section-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Track active section on scroll
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const onScroll = () => {
      const sections = container.querySelectorAll("[data-section-id]");
      let closest: string | null = null;
      let closestDist = Infinity;
      const top = container.scrollTop + 80;
      sections.forEach((el) => {
        const dist = Math.abs((el as HTMLElement).offsetTop - top);
        if (dist < closestDist) {
          closestDist = dist;
          closest = (el as HTMLElement).dataset.sectionId || null;
        }
      });
      if (closest) setActiveSection(closest);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  const handleChatSend = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", text: q };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const conv = chatMessages.filter((m) => m.id !== "welcome").map((m) => ({ role: m.role, text: m.text }));
      const res = await apiFetch<{ answer: string; relevant_sections: string[] }>("/help/ask", {
        method: "POST",
        body: JSON.stringify({ question: q, conversation: conv }),
      });
      const botMsg: ChatMsg = {
        id: `b-${Date.now()}`,
        role: "assistant",
        text: res.answer,
        sections: res.relevant_sections,
      };
      setChatMessages((prev) => [...prev, botMsg]);
    } catch (e) {
      setChatMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", text: "Sorry, I couldn't process that. Make sure your Gemini API key is configured in Settings.", sections: [] },
      ]);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, chatMessages]);

  const handleChatKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  }, [handleChatSend]);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* ── Left: Table of Contents ─────────────────────── */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{ width: 260, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        {/* Search */}
        <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
            <Search size={13} style={{ color: "var(--color-text-muted)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="flex-1 min-w-0 text-[12px] outline-none"
              style={{ background: "transparent", color: "var(--color-text-primary)", border: "none" }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="cursor-pointer" style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* TOC */}
        <div className="flex-1 overflow-y-auto py-1">
          {CATEGORIES.map((cat) => {
            const docs = groupedDocs.get(cat);
            if (!docs || docs.length === 0) return null;
            const isExpanded = expandedCats.has(cat);
            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCat(cat)}
                  className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left cursor-pointer"
                  style={{ background: "none", border: "none", color: "var(--color-text-secondary)" }}
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="text-[10px] font-semibold uppercase tracking-wider">{cat}</span>
                  <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-muted)" }}>{docs.length}</span>
                </button>
                {isExpanded && docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => scrollToSection(doc.id)}
                    className="flex items-center gap-2 w-full px-4 pl-7 py-1.5 text-left cursor-pointer transition-colors"
                    style={{
                      background: activeSection === doc.id ? "var(--color-hover)" : "transparent",
                      border: "none",
                      color: activeSection === doc.id ? "var(--color-foreground)" : "var(--color-text-muted)",
                      borderLeft: activeSection === doc.id ? "2px solid var(--color-accent)" : "2px solid transparent",
                    }}
                  >
                    <span className="text-[11px] truncate">{doc.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {filteredDocs.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>No sections match "{searchQuery}"</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Center: Documentation Content ───────────────── */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto">
        {/* Hero */}
        <div className="px-8 pt-8 pb-6" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)" }}
            >
              <BookOpen size={20} style={{ color: "var(--color-accent)" }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>Madison AI Suite — Help Wiki</h1>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                Comprehensive guide to every tool and feature. Use the AI assistant on the right to ask questions.
              </p>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="px-8 py-6 space-y-8 pb-32">
          {CATEGORIES.map((cat) => {
            const docs = groupedDocs.get(cat);
            if (!docs || docs.length === 0) return null;
            return (
              <div key={cat}>
                <h2
                  className="text-[11px] font-bold uppercase tracking-widest mb-4 pb-2"
                  style={{ color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}
                >
                  {cat}
                </h2>
                <div className="space-y-6">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      id={`help-section-${doc.id}`}
                      data-section-id={doc.id}
                      className="rounded-lg p-5"
                      style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                    >
                      <h3
                        className="text-[14px] font-bold mb-3"
                        style={{ color: "var(--color-foreground)" }}
                      >
                        {doc.title}
                      </h3>
                      <div className="space-y-1">
                        {renderMarkdownish(doc.body)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: AI Chat Bot (always visible) ─────────── */}
      <div
        className="flex flex-col shrink-0 overflow-hidden"
        style={{
          width: chatOpen ? 340 : 48,
          borderLeft: "1px solid var(--color-border)",
          background: "var(--color-card)",
          transition: "width 0.2s ease",
        }}
      >
        {chatOpen ? (
          <>
            {/* Chat header */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 shrink-0"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <Bot size={16} style={{ color: "var(--color-accent)" }} />
              <span className="text-[12px] font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
                Help Assistant
              </span>
              <button
                onClick={() => setChatMessages([chatMessages[0]])}
                className="p-1 rounded cursor-pointer"
                style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
                title="Clear chat"
              >
                <X size={14} />
              </button>
              <button
                onClick={() => setChatOpen(false)}
                className="p-1 rounded cursor-pointer"
                style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
                title="Collapse"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className="max-w-[90%] rounded-lg px-3 py-2"
                    style={{
                      background: msg.role === "user" ? "var(--color-accent)" : "var(--color-input-bg)",
                      color: msg.role === "user" ? "var(--color-foreground)" : "var(--color-text-secondary)",
                      border: msg.role === "user" ? "none" : "1px solid var(--color-border)",
                    }}
                  >
                    <div className="text-[11px] leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                    {msg.sections && msg.sections.length > 0 && (
                      <div className="mt-2 pt-2 flex flex-wrap gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        {msg.sections.map((sId) => {
                          const doc = HELP_DOCS.find((d) => d.id === sId);
                          if (!doc) return null;
                          return (
                            <button
                              key={sId}
                              onClick={() => scrollToSection(sId)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors"
                              style={{
                                background: "rgba(255,255,255,0.06)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-accent)",
                              }}
                            >
                              <ExternalLink size={8} />
                              {doc.title}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
                    <Loader2 size={14} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="shrink-0 px-3 pb-3 pt-1">
              <div
                className="flex items-end gap-2 rounded-lg px-3 py-2"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}
              >
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKey}
                  placeholder="Ask about any feature..."
                  rows={1}
                  className="flex-1 min-w-0 text-[12px] outline-none resize-none"
                  style={{ background: "transparent", color: "var(--color-text-primary)", border: "none", maxHeight: 80 }}
                />
                <button
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatInput.trim()}
                  className="p-1 rounded cursor-pointer shrink-0 disabled:opacity-30"
                  style={{ background: "none", border: "none", color: "var(--color-accent)" }}
                  title="Send"
                >
                  <Send size={14} />
                </button>
              </div>
              <p className="text-[9px] mt-1.5 text-center" style={{ color: "var(--color-text-muted)" }}>
                Powered by Gemini — answers are based on app documentation
              </p>
            </div>
          </>
        ) : (
          /* Collapsed sidebar — just a toggle button */
          <div className="flex flex-col items-center pt-3 gap-2">
            <button
              onClick={() => setChatOpen(true)}
              className="p-2 rounded-lg cursor-pointer"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)", color: "var(--color-accent)" }}
              title="Open Help Assistant"
            >
              <MessageCircle size={18} />
            </button>
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)", writingMode: "vertical-rl" }}>
              AI Help
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
