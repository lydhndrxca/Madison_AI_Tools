/**
 * Global deep-search event bus using CustomEvents.
 * Components fire/listen to coordinate the Art Director → Deep Search flow
 * and button visual states across AppShell & ArtDirectorWidget.
 */

// ── Search source settings (persisted in localStorage) ──────

export interface DeepSearchSources {
  gemini: boolean;
  pexels: boolean;
  pixabay: boolean;
  googleImages: boolean;
}

const DS_SOURCES_KEY = "madison-deep-search-sources";

const DEFAULT_SOURCES: DeepSearchSources = {
  gemini: true,
  pexels: true,
  pixabay: true,
  googleImages: true,
};

export function loadDeepSearchSources(): DeepSearchSources {
  try {
    const raw = localStorage.getItem(DS_SOURCES_KEY);
    if (raw) return { ...DEFAULT_SOURCES, ...JSON.parse(raw) };
  } catch { /* */ }
  return { ...DEFAULT_SOURCES };
}

export function saveDeepSearchSources(sources: DeepSearchSources) {
  try {
    localStorage.setItem(DS_SOURCES_KEY, JSON.stringify(sources));
  } catch { /* */ }
}

// ── Event names ──────────────────────────────────────────────

export const DS_EVT = {
  /** Art Director requests a search. detail: { query: string; imageB64?: string } */
  TRIGGER: "deep-search-trigger",
  /** Search is being prepared (enrichment in progress) */
  PREPARING: "deep-search-preparing",
  /** DeepSearchPanel started searching */
  START: "deep-search-start",
  /** DeepSearchPanel finished (has results). detail: { count: number } */
  COMPLETE: "deep-search-complete",
  /** User acknowledged / viewed results — reset button glow */
  VIEWED: "deep-search-viewed",
} as const;

// ── Typed dispatch helpers ───────────────────────────────────

export function dsDispatch(name: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function triggerDeepSearch(query: string, imageB64?: string, enabledSources?: DeepSearchSources) {
  dsDispatch(DS_EVT.TRIGGER, { query, imageB64, enabledSources: enabledSources ?? loadDeepSearchSources() });
}

// ── Detect "deep search" intent in user text ─────────────────

const DS_PATTERN =
  /\b(?:deep\s*search|do\s+a\s+(?:deep\s+)?search|research|look\s+up|find\s+(?:me\s+)?references?\s+(?:for|of|about))\b/i;

/**
 * Returns the search query if the user message looks like a deep-search request,
 * or null otherwise.
 */
export function extractDeepSearchQuery(text: string): string | null {
  if (!DS_PATTERN.test(text)) return null;

  // Strip the "trigger phrase" to extract the actual query
  let q = text
    .replace(/\b(?:please|can you|could you|hey|do)\b/gi, "")
    .replace(/\b(?:deep\s*search|do\s+a\s+(?:deep\s+)?search)\s*(?:for|on|about|of)?\s*/gi, "")
    .replace(/\b(?:research|look\s+up|find\s+(?:me\s+)?references?\s+(?:for|of|about))\s*/gi, "")
    .trim();

  // Remove leading punctuation
  q = q.replace(/^[,.:;!?\-–—]+/, "").trim();

  // If nothing meaningful is left, use the original text minus the trigger word
  if (q.length < 3) {
    q = text.replace(DS_PATTERN, "").trim();
  }

  return q.length >= 2 ? q : null;
}

// ── Inject CSS animations (idempotent) ───────────────────────

if (typeof document !== "undefined" && !document.getElementById("ds-anim-styles")) {
  const s = document.createElement("style");
  s.id = "ds-anim-styles";
  s.textContent = `
@keyframes dsSearchPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes dsResultsGlow {
  0%, 100% { box-shadow: 0 0 4px rgba(34,197,94,0.25), inset 0 0 2px rgba(34,197,94,0.1); }
  50%      { box-shadow: 0 0 12px rgba(34,197,94,0.5), inset 0 0 4px rgba(34,197,94,0.2); }
}
.ds-searching { animation: dsSearchPulse 1.2s ease-in-out infinite; }
.ds-results-ready { animation: dsResultsGlow 2s ease-in-out infinite; }
`;
  document.head.appendChild(s);
}

// ── Lightweight confetti burst ───────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  opacity: number;
}

/**
 * Burst a small cloud of white particles from `anchor` element.
 * Uses an off-screen canvas overlay, ~25 particles, < 1 s lifetime.
 * Completely self-contained; removes itself when done.
 */
export function confettiBurst(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const COUNT = 24;
  const particles: Particle[] = [];

  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 0.6 + Math.random() * 0.5,
      size: 1.5 + Math.random() * 2,
      opacity: 0.7 + Math.random() * 0.3,
    });
  }

  let last = performance.now();
  let alive = true;

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let anyAlive = false;

    for (const p of particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      anyAlive = true;

      p.vy += 2.5 * dt; // gravity
      p.x += p.vx * 60 * dt;
      p.y += p.vy * 60 * dt;

      const alpha = p.opacity * Math.min(p.life / 0.3, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (anyAlive && alive) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);

  // Safety: guarantee cleanup
  setTimeout(() => {
    alive = false;
    canvas.remove();
  }, 2000);
}
