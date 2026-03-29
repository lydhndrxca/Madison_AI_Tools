import { useState, useEffect, useCallback } from "react";
import { Clock, Search, Filter, X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

const TOOL_LABELS: Record<string, string> = {
  character: "CharacterLab",
  prop: "PropLab",
  environment: "EnvironmentLab",
  uilab: "UI Lab",
  gemini: "Generate Image",
  weapon: "WeaponLab",
  editor: "Editor",
};

const TOOL_COLORS: Record<string, string> = {
  character: "#5ec9e0",
  prop: "#4ec9a0",
  environment: "#b07ee8",
  uilab: "#5e9eff",
  gemini: "#f5a623",
  weapon: "#f06060",
  editor: "#888",
};

interface HistoryEntry {
  id: string;
  timestamp: string;
  tool: string;
  view: string;
  generation_type: string;
  model: string;
  prompt: string;
  image_path: string;
  thumbnail_b64: string;
  width: number;
  height: number;
}

export function HistoryTimeline() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [toolFilter, setToolFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [expandedEntry, setExpandedEntry] = useState<HistoryEntry | null>(null);
  const pageSize = 50;

  const loadDates = useCallback(async () => {
    try {
      const d = await apiFetch<string[]>("/history/dates");
      setDates(d);
    } catch { /* */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (toolFilter) params.set("tool", toolFilter);
      if (dateFilter) params.set("date", dateFilter);
      if (searchText) params.set("search", searchText);
      const res = await apiFetch<{ total: number; entries: HistoryEntry[] }>(`/history/timeline?${params}`);
      setEntries(res.entries);
      setTotal(res.total);
    } catch { /* */ }
  }, [page, toolFilter, dateFilter, searchText]);

  useEffect(() => { loadDates(); }, [loadDates]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiFetch(`/history/entry/${id}`, { method: "DELETE" });
      load();
      if (expandedEntry?.id === id) setExpandedEntry(null);
    } catch { /* */ }
  }, [load, expandedEntry]);

  const grouped = entries.reduce<Record<string, HistoryEntry[]>>((acc, e) => {
    const date = e.timestamp.split("T")[0];
    (acc[date] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Clock className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
        <h1 className="text-base font-semibold flex-1" style={{ color: "var(--color-foreground)" }}>
          Generation History
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
            {total} total
          </span>
        </h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-2 shrink-0 flex-wrap" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded flex-1 min-w-[200px]" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          <input
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: "var(--color-text-primary)" }}
            placeholder="Search prompts, settings..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
          />
        </div>
        <select
          value={toolFilter}
          onChange={(e) => { setToolFilter(e.target.value); setPage(1); }}
          className="px-2 py-1 text-[11px] rounded"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
        >
          <option value="">All Tools</option>
          {Object.entries(TOOL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          className="px-2 py-1 text-[11px] rounded"
          style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
        >
          <option value="">All Dates</option>
          {dates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Clock className="h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No generation history yet. Images you generate will appear here.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="mb-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 px-1" style={{ color: "var(--color-text-muted)" }}>
                {date}
              </p>
              <div className="space-y-1">
                {items.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-[var(--color-hover)] transition-colors group"
                    style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                    onClick={() => setExpandedEntry(entry)}
                  >
                    {entry.thumbnail_b64 && (
                      <img
                        src={`data:image/png;base64,${entry.thumbnail_b64}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover shrink-0"
                        style={{ border: "1px solid var(--color-border)" }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                          style={{ background: `${TOOL_COLORS[entry.tool] || "#888"}20`, color: TOOL_COLORS[entry.tool] || "#888" }}
                        >
                          {TOOL_LABELS[entry.tool] || entry.tool}
                        </span>
                        <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                          {entry.view} \u00b7 {entry.generation_type}
                        </span>
                      </div>
                      {entry.prompt && (
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--color-text-secondary)" }}>
                          {entry.prompt}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-[9px] font-mono" style={{ color: "var(--color-text-muted)" }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>
                        {entry.width}\u00d7{entry.height}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded cursor-pointer transition-opacity"
                      style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}
                      title="Remove from history"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1 rounded cursor-pointer"
            style={{ color: "var(--color-text-muted)", opacity: page <= 1 ? 0.3 : 1, border: "none", background: "transparent" }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded cursor-pointer"
            style={{ color: "var(--color-text-muted)", opacity: page >= totalPages ? 0.3 : 1, border: "none", background: "transparent" }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Expanded detail overlay */}
      {expandedEntry && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
          onClick={() => setExpandedEntry(null)}
        >
          <div className="relative flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setExpandedEntry(null)}
              className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full cursor-pointer"
              style={{ background: "rgba(0,0,0,0.7)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <X className="h-4 w-4" />
            </button>
            {expandedEntry.thumbnail_b64 && (
              <div className="rounded-lg overflow-hidden" style={{ background: "repeating-conic-gradient(rgba(128,128,128,0.2) 0% 25%, rgba(40,40,40,1) 0% 50%) 50%/20px 20px" }}>
                <img
                  src={`data:image/png;base64,${expandedEntry.thumbnail_b64}`}
                  alt=""
                  style={{ maxWidth: "60vw", maxHeight: "50vh", objectFit: "contain" }}
                />
              </div>
            )}
            <div className="max-w-lg w-full space-y-2 px-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-medium"
                  style={{ background: `${TOOL_COLORS[expandedEntry.tool] || "#888"}20`, color: TOOL_COLORS[expandedEntry.tool] || "#888" }}
                >
                  {TOOL_LABELS[expandedEntry.tool] || expandedEntry.tool}
                </span>
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {expandedEntry.view} \u00b7 {expandedEntry.generation_type}
                </span>
                <span className="text-[10px] ml-auto font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {expandedEntry.width}\u00d7{expandedEntry.height}
                </span>
              </div>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>
                <strong style={{ color: "rgba(255,255,255,0.8)" }}>Model:</strong> {expandedEntry.model}
              </p>
              {expandedEntry.prompt && (
                <div>
                  <p className="text-[10px] font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Prompt</p>
                  <p className="text-[11px] whitespace-pre-wrap rounded p-2" style={{ color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)" }}>
                    {expandedEntry.prompt}
                  </p>
                </div>
              )}
              <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                {new Date(expandedEntry.timestamp).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { handleDelete(expandedEntry.id); setExpandedEntry(null); }}
                className="px-3 py-1.5 text-[11px] rounded cursor-pointer font-medium"
                style={{ background: "rgba(90,42,42,0.5)", color: "#f06060", border: "1px solid rgba(138,74,74,0.6)" }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
