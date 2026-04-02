import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/hooks/useApi";
import { Bug, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Intelligent element identification
// ---------------------------------------------------------------------------

function getVisibleText(el: HTMLElement, maxLen = 50): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("svg, img, canvas, style, script").forEach((n) => n.remove());
  const raw = clone.textContent?.replace(/\s+/g, " ").trim() || "";
  return raw.slice(0, maxLen);
}

function nearestLabel(el: HTMLElement): string {
  const prev = el.previousElementSibling;
  if (prev && prev.tagName === "LABEL") return prev.textContent?.trim().slice(0, 40) || "";
  const parent = el.parentElement;
  if (!parent) return "";
  const lbl = parent.querySelector(":scope > label");
  if (lbl && lbl !== el) return lbl.textContent?.trim().slice(0, 40) || "";
  return "";
}

function identifyElement(el: HTMLElement, activePage: string): string {
  const parts: string[] = [];

  // --- 1. What the user clicked on ---
  const btn = el.closest("button") as HTMLButtonElement | null;
  const link = el.closest("a") as HTMLAnchorElement | null;
  const select = el.closest("select") as HTMLSelectElement | null;
  const input = el.closest("input") as HTMLInputElement | null;
  const textarea = el.closest("textarea") as HTMLTextAreaElement | null;
  const menuItem = el.closest("[role=menuitem], .ctx-menu-item") as HTMLElement | null;
  const tab = el.closest("[role=tab], [data-tab-id]") as HTMLElement | null;

  if (tab) {
    const tabText = getVisibleText(tab);
    parts.push(`Tab: "${tabText}"`);
  } else if (menuItem) {
    parts.push(`Menu item: "${getVisibleText(menuItem)}"`);
  } else if (btn) {
    const text = getVisibleText(btn);
    if (text) parts.push(`Button: "${text}"`);
    else if (btn.title) parts.push(`Button (${btn.title.slice(0, 40)})`);
    else if (btn.getAttribute("aria-label")) parts.push(`Button (${btn.getAttribute("aria-label")!.slice(0, 40)})`);
    else parts.push("Button (unlabeled)");
  } else if (select) {
    const lbl = nearestLabel(select) || select.getAttribute("aria-label") || "";
    const val = select.options[select.selectedIndex]?.text || "";
    parts.push(`Dropdown${lbl ? ` "${lbl}"` : ""}${val ? ` = "${val}"` : ""}`);
  } else if (input) {
    const lbl = nearestLabel(input) || input.placeholder || input.getAttribute("aria-label") || "";
    const kind = input.type === "text" ? "" : ` [${input.type}]`;
    parts.push(`Input${lbl ? ` "${lbl}"` : ""}${kind}`);
  } else if (textarea) {
    const lbl = nearestLabel(textarea) || textarea.placeholder || textarea.getAttribute("aria-label") || "";
    parts.push(`Textarea${lbl ? ` "${lbl}"` : ""}`);
  } else if (link) {
    parts.push(`Link: "${getVisibleText(link)}"`);
  } else if (el.tagName === "CANVAS") {
    parts.push("Canvas viewer");
  } else if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt");
    parts.push(alt ? `Image: "${alt.slice(0, 40)}"` : "Image");
  } else if (el.tagName === "SVG" || el.closest("svg")) {
    const parentBtn = el.closest("button");
    if (parentBtn) {
      const text = getVisibleText(parentBtn);
      parts.push(text ? `Icon button: "${text}"` : "Icon button");
    } else {
      parts.push("SVG icon");
    }
  } else {
    const text = getVisibleText(el, 60);
    if (text.length > 2) parts.push(`"${text}"`);
    else parts.push(`<${el.tagName.toLowerCase()}>`);
  }

  // --- 2. Find the containing sidebar section ---
  let sectionName = "";
  let walker: HTMLElement | null = el;
  for (let i = 0; i < 20 && walker; i++) {
    // Sidebar section cards have a header with the section label text
    if (walker.classList.contains("section-card-hover")) {
      const header = walker.querySelector("button > span, h3, h4");
      if (header) {
        sectionName = header.textContent?.trim().slice(0, 50) || "";
        break;
      }
    }
    // Generic panel/section markers
    const dp = walker.getAttribute("data-panel") || walker.getAttribute("data-section");
    if (dp) { sectionName = dp; break; }

    // Look for a heading element as direct child
    for (const tag of ["h1", "h2", "h3", "h4"]) {
      const h = walker.querySelector(`:scope > ${tag}`);
      if (h && h !== el && !h.contains(el)) {
        sectionName = h.textContent?.trim().slice(0, 50) || "";
        break;
      }
    }
    if (sectionName) break;
    walker = walker.parentElement;
  }
  if (sectionName) parts.push(`in "${sectionName}"`);

  // --- 3. Determine area: sidebar, toolbar, main content, grid, etc. ---
  const area = detectArea(el);
  if (area) parts.push(`[${area}]`);

  // --- 4. Active tab ---
  const activeTabEl = document.querySelector("[aria-selected=true], .tab-active");
  if (activeTabEl) {
    const tabLabel = activeTabEl.textContent?.trim();
    if (tabLabel) parts.push(`(tab: ${tabLabel})`);
  }

  // --- 5. Page ---
  parts.push(`(page: ${activePage})`);

  return parts.join(" ");
}

function detectArea(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  for (let i = 0; i < 30 && node; i++) {
    const cl = node.classList;
    const role = node.getAttribute("role");

    // Menu bar area
    if (node.tagName === "NAV" || cl.contains("menu-bar")) return "Menu bar";
    if (cl.contains("relative") && node.querySelector(":scope > button + .absolute")) {
      if (node.closest("nav, [class*=menu]")) return "Menu bar dropdown";
    }

    // Sidebar navigation
    if (role === "navigation" || cl.contains("sidebar")) return "Sidebar navigation";

    // Status bar
    if (cl.contains("status-bar") || node.getAttribute("data-statusbar") !== null) return "Status bar";

    // Settings panel
    if (node.getAttribute("data-settings") !== null || (cl.contains("fixed") && node.querySelector("[class*=settings]"))) return "Settings panel";

    // Grid gallery
    if (node.querySelector(":scope > [class*=grid]") && node.textContent?.includes("Results")) return "Grid gallery";

    // Image viewer / mainstage
    if (node.querySelector(":scope canvas") && !node.querySelector("button")) return "Image viewer";

    // Check if this is the left sidebar panel (generation options)
    const style = node.style;
    if (style.minWidth === "280px" || style.width === "320px" || cl.contains("shrink-0")) {
      if (node.querySelector(".section-card-hover")) return "Sidebar options";
    }

    // Editor toolbar
    if (cl.contains("editor-toolbar") || node.querySelector("[data-toolbar]")) return "Editor toolbar";

    // Main content area
    if (node.tagName === "MAIN") return "Main content";

    node = node.parentElement;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BugReportOverlayProps {
  enabled: boolean;
  activePage: string;
  onNotify?: (msg: string, level: "success" | "error" | "info") => void;
}

export function BugReportOverlay({ enabled, activePage, onNotify }: BugReportOverlayProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; element: string } | null>(null);
  const [modal, setModal] = useState<{ element: string } | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!enabled) {
      setCtxMenu(null);
      setModal(null);
      return;
    }

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const label = identifyElement(target, activePage);
      setCtxMenu({ x: e.clientX, y: e.clientY, element: label });
    };

    document.addEventListener("contextmenu", handler, true);
    return () => document.removeEventListener("contextmenu", handler, true);
  }, [enabled, activePage]);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [ctxMenu]);

  useEffect(() => {
    if (modal) setTimeout(() => textRef.current?.focus(), 50);
  }, [modal]);

  const handleBugIt = useCallback(() => {
    if (!ctxMenu) return;
    setModal({ element: ctxMenu.element });
    setText("");
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || !modal) return;
    setSubmitting(true);
    try {
      await apiFetch("/system/bug-report", {
        method: "POST",
        body: JSON.stringify({
          description: text.trim(),
          element: modal.element,
          page: activePage,
        }),
      });
      onNotify?.("Bug report saved", "success");
      setModal(null);
      setText("");
    } catch (e) {
      onNotify?.(e instanceof Error ? e.message : "Failed to save bug report", "error");
    } finally {
      setSubmitting(false);
    }
  }, [text, modal, activePage, onNotify]);

  if (!enabled) return null;

  return (
    <>
      {/* BUG IT context menu */}
      {ctxMenu && (
        <div
          style={{
            position: "fixed",
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 99999,
            background: "#2a1a1a",
            border: "1px solid #993333",
            borderRadius: 8,
            padding: 6,
            boxShadow: "0 6px 24px rgba(0,0,0,0.7)",
            minWidth: 180,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleBugIt}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm rounded-md font-bold cursor-pointer"
            style={{
              background: "#cc3333",
              color: "#fff",
              border: "none",
              letterSpacing: "0.5px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#dd4444")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#cc3333")}
          >
            <Bug size={16} /> BUG IT
          </button>
          <div
            style={{
              padding: "4px 10px",
              marginTop: 4,
              fontSize: 10,
              color: "#cc9999",
              lineHeight: "1.4",
              wordBreak: "break-word",
            }}
          >
            {ctxMenu.element}
          </div>
        </div>
      )}

      {/* Bug report modal */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              padding: 20,
              width: 480,
              maxWidth: "90vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bug size={18} style={{ color: "#e05050" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Report Bug
                </span>
              </div>
              <button
                onClick={() => setModal(null)}
                className="p-1 rounded hover:bg-white/10 cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              className="text-[10px] mb-3 px-2.5 py-1.5 rounded"
              style={{
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
                lineHeight: "1.5",
                wordBreak: "break-word",
              }}
            >
              {modal.element}
            </div>

            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe what's wrong..."
              rows={5}
              className="w-full rounded px-3 py-2 text-xs resize-y"
              style={{
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
              }}
            />

            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                Ctrl+Enter to submit
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setModal(null)}
                  className="px-3 py-1.5 rounded text-xs cursor-pointer"
                  style={{
                    background: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!text.trim() || submitting}
                  className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer disabled:opacity-40"
                  style={{
                    background: "#cc3333",
                    color: "#fff",
                    border: "none",
                  }}
                >
                  {submitting ? "Saving..." : "Save Bug Report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
