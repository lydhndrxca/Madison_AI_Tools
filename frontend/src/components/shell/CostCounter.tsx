import React, { useState, useRef, useEffect, useCallback } from "react";
import { useCostTracker, getCategoryLabel } from "@/hooks/useCostTracker";

export function CostCounter() {
  const { costs, resetCosts } = useCostTracker();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (confirm("Reset API cost counter to $0.00?")) {
        resetCosts();
        setOpen(false);
      }
    },
    [resetCosts],
  );

  const sortedCategories = Object.entries(costs.categories)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = costs.total;

  return (
    <div ref={ref} className="relative flex items-center" style={{ marginLeft: "auto" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        onContextMenu={handleContextMenu}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer font-medium"
        style={{
          background: "transparent",
          border: "1px solid transparent",
          color: "var(--color-text-secondary)",
        }}
        title="API costs this session — click for details, right-click to reset"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        {total < 0.01 ? "$0.00" : `$${total.toFixed(2)}`}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 rounded-lg shadow-xl"
          style={{
            top: "calc(100% + 4px)",
            minWidth: 260,
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div
            className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
          >
            API Cost Breakdown
          </div>

          <div className="px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[18px] font-bold" style={{ color: "var(--color-foreground)" }}>
                ${total < 0.01 ? "0.00" : total.toFixed(2)}
              </span>
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>estimated total</span>
            </div>

            {sortedCategories.length > 0 && (
              <div className="flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, maxHeight: 320, overflowY: "auto" }}>
                {sortedCategories.map(([cat, cost]) => {
                  const pct = total > 0 ? (cost / total) * 100 : 0;
                  return (
                    <div key={cat} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
                          {getCategoryLabel(cat)}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: "var(--color-foreground)" }}>
                          ${cost < 0.01 ? "<0.01" : cost.toFixed(2)}
                          <span className="ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                            {pct.toFixed(0)}%
                          </span>
                        </span>
                      </div>
                      <div
                        className="rounded-full overflow-hidden"
                        style={{ height: 3, background: "var(--color-border)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(pct, 1)}%`,
                            background: "var(--color-text-muted)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {sortedCategories.length === 0 && (
              <div className="text-[11px] py-2" style={{ color: "var(--color-text-muted)" }}>
                No API costs recorded yet.
              </div>
            )}
          </div>

          <div
            className="px-4 py-2 text-[10px]"
            style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
          >
            Right-click counter to reset
          </div>
        </div>
      )}
    </div>
  );
}
