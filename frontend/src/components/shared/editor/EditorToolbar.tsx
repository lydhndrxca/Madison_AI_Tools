import { useState } from "react";
import {
  MousePointer2, Paintbrush, Eraser, Square, Lasso, ScanSearch, Wand2,
  Expand, ImageMinus, Palette, Trash2,
} from "lucide-react";
import type { ModelInfo } from "@/hooks/ModelsContext";

export type EditorTool =
  | "select"
  | "brush"
  | "eraser"
  | "marquee"
  | "lasso"
  | "smartSelect"
  | "smartErase"
  | "outpaint"
  | "removeBg"
  | "styleTransfer";

export type OutpaintDir = "left" | "right" | "top" | "bottom" | "all";

export const STYLE_PRESETS = [
  { id: "oil", label: "Oil Painting", prompt: "Oil painting style with thick brush strokes and rich colors" },
  { id: "watercolor", label: "Watercolor", prompt: "Delicate watercolor style with soft washes and bleeding edges" },
  { id: "anime", label: "Anime / Cel", prompt: "Anime cel-shaded style with clean outlines and flat colors" },
  { id: "cyberpunk", label: "Cyberpunk", prompt: "Cyberpunk style with neon lighting and futuristic tech elements" },
  { id: "pencil", label: "Pencil Sketch", prompt: "Detailed graphite pencil sketch on white paper" },
  { id: "pixel", label: "Pixel Art", prompt: "Retro pixel art style with limited palette and blocky pixels" },
  { id: "artnouveau", label: "Art Nouveau", prompt: "Art Nouveau style with flowing organic curves and ornate borders" },
  { id: "popart", label: "Pop Art", prompt: "Bold pop art style with halftone dots and primary colors" },
  { id: "ghibli", label: "Studio Ghibli", prompt: "Studio Ghibli style with lush scenery and gentle character design" },
  { id: "custom", label: "Custom...", prompt: "" },
] as const;

interface EditorToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  hasMask: boolean;
  onClearMask: () => void;
  onApplyInpaint: (prompt: string) => void;
  onSmartSelect: (subject: string) => void;
  onSmartErase: () => void;
  onOutpaint: (dir: OutpaintDir, px: number, prompt: string) => void;
  onRemoveBg: (replacement: string) => void;
  onStyleTransfer: (preset: string, custom: string) => void;
  busy: boolean;
  locked?: boolean;
  /** When true, hide the tool-specific options row (annotation is active) */
  annotationActive?: boolean;
  models?: ModelInfo[];
  selectedModelId?: string;
  onModelChange?: (id: string) => void;
  generationCount?: number;
  onGenerationCountChange?: (n: number) => void;
}

const TOOLS: { id: EditorTool; label: string; shortcut: string; Icon: React.ComponentType<{ className?: string }>; tip: string }[] = [
  { id: "select", label: "Select", shortcut: "V", Icon: MousePointer2, tip: "Normal pointer — pan and zoom the image without painting." },
  { id: "brush", label: "Brush", shortcut: "B", Icon: Paintbrush, tip: "Paint over the area you want to change. Use [ ] keys to resize." },
  { id: "eraser", label: "Eraser", shortcut: "E", Icon: Eraser, tip: "Erase parts of your painted selection. Use [ ] keys to resize." },
  { id: "marquee", label: "Marquee", shortcut: "M", Icon: Square, tip: "Draw a rectangle to select an area for editing." },
  { id: "lasso", label: "Lasso", shortcut: "L", Icon: Lasso, tip: "Draw a freehand shape around the area you want to select." },
  { id: "smartSelect", label: "Smart Select", shortcut: "W", Icon: ScanSearch, tip: "Type what you want to select (e.g. \"hat\") and AI will find it for you." },
  { id: "smartErase", label: "Smart Erase", shortcut: "", Icon: Wand2, tip: "AI removes whatever you've painted over, filling it in naturally." },
  { id: "outpaint", label: "Outpaint", shortcut: "", Icon: Expand, tip: "Extend the image beyond its edges — great for adding more background or converting portrait to landscape." },
  { id: "removeBg", label: "Remove BG", shortcut: "", Icon: ImageMinus, tip: "AI removes the background, leaving just your character on a transparent layer." },
  { id: "styleTransfer", label: "Style Transfer", shortcut: "", Icon: Palette, tip: "Transform the look of your image into a different art style (oil painting, anime, etc.)." },
];

function ActionBtn({ busy, disabled, onClick, busyText, children }: {
  busy: boolean; disabled?: boolean; onClick: () => void; busyText: string; children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled || busy}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer shrink-0 font-medium transition-all ${busy ? "btn-generating" : ""}`}
      style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
    >
      {busy && (
        <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {busy ? busyText : children}
    </button>
  );
}

const toolBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "var(--color-accent)" : "var(--color-input-bg)",
  color: active ? "var(--color-foreground)" : "var(--color-text-secondary)",
  border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
});

export function EditorToolbar({
  activeTool, onToolChange, brushSize, onBrushSizeChange,
  hasMask, onClearMask, onApplyInpaint,
  onSmartSelect, onSmartErase, onOutpaint, onRemoveBg, onStyleTransfer,
  busy, locked = false, annotationActive = false,
  models = [], selectedModelId = "", onModelChange, generationCount = 1, onGenerationCountChange,
}: EditorToolbarProps) {
  const [inpaintPrompt, setInpaintPrompt] = useState("");
  const [smartSubject, setSmartSubject] = useState("");
  const [outpaintDir, setOutpaintDir] = useState<OutpaintDir>("right");
  const [outpaintPx, setOutpaintPx] = useState(256);
  const [outpaintPrompt, setOutpaintPrompt] = useState("");
  const [bgReplacement, setBgReplacement] = useState("");
  const [stylePreset, setStylePreset] = useState("oil");
  const [styleCustom, setStyleCustom] = useState("");

  const inputStyle: React.CSSProperties = {
    background: "var(--color-input-bg)", border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)",
  };

  const showToolSpecificOptions = activeTool !== "select" && !annotationActive;
  const showInpaintBar = activeTool === "brush" || activeTool === "marquee" || activeTool === "lasso";

  return (
    <div className="shrink-0" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}>
      {/* Model + generation count row */}
      <div className="flex items-center gap-2 px-2 py-1 flex-wrap" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-[10px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Model</span>
        <select
          className="px-1.5 py-0.5 text-[10px] rounded"
          style={inputStyle}
          disabled={locked || busy}
          value={selectedModelId}
          onChange={(e) => onModelChange?.(e.target.value)}
          title="Gemini model for editor tools"
        >
          {models.length === 0 && <option value="">Loading…</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label} ({m.resolution})</option>
          ))}
        </select>
        <div className="w-px h-4" style={{ background: "var(--color-border)" }} />
        <span className="text-[10px] font-medium" style={{ color: "var(--color-text-secondary)" }}>Generations</span>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              disabled={locked || busy}
              onClick={() => onGenerationCountChange?.(n)}
              className="px-1.5 py-0.5 text-[10px] rounded cursor-pointer transition-colors font-medium disabled:opacity-40"
              style={{
                background: generationCount === n ? "var(--color-accent)" : "var(--color-input-bg)",
                color: generationCount === n ? "var(--color-foreground)" : "var(--color-text-secondary)",
                border: generationCount === n ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
          {generationCount > 1 ? `${generationCount} images in parallel` : "single image"}
        </span>
      </div>
      {/* Tool buttons row */}
      <div className="flex items-center gap-1 px-2 py-1 flex-wrap">
        {TOOLS.map((t) => {
          const Icon = t.Icon;
          return (
            <span key={t.id} className="contents">
              <button
                onClick={() => onToolChange(t.id)}
                disabled={locked}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none"
                style={toolBtnStyle(activeTool === t.id)}
                title={`${t.tip}${t.shortcut ? ` (Shortcut: ${t.shortcut})` : ""}`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {t.label}
              </button>
              {t.id === "select" && <div className="w-px h-4 mx-0.5" style={{ background: "var(--color-border)" }} />}
            </span>
          );
        })}
        <div className="w-px h-4 mx-1" style={{ background: "var(--color-border)" }} />
        <button
          onClick={onClearMask}
          disabled={!hasMask || locked}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors disabled:opacity-40 disabled:pointer-events-none"
          style={{ background: "var(--color-input-bg)", color: hasMask ? "var(--color-text-secondary)" : "var(--color-text-muted)", border: "1px solid var(--color-border)", opacity: (hasMask && !locked) ? 1 : 0.4 }}
          title="Clear all selections"
        ><Trash2 className="h-3 w-3 shrink-0" />Clear Mask</button>
      </div>

      {/* Options row — hidden when in pointer/select mode or annotation is active */}
      {/* Inpaint prompt bar — visible during brush/marquee/lasso AND annotation mode */}
      {showInpaintBar && (
        <div className="flex items-center gap-1 px-2 py-1 flex-1 min-w-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <input className="flex-1 px-2 py-0.5 text-[10px] min-w-0" style={inputStyle} disabled={locked}
            placeholder="Describe what you want in the painted area (e.g. a leather belt, blue sky)..."
            value={inpaintPrompt} onChange={(e) => setInpaintPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onApplyInpaint(inpaintPrompt); }}
          />
          <ActionBtn busy={busy} disabled={locked} onClick={() => onApplyInpaint(inpaintPrompt)} busyText="Applying...">Apply Inpaint</ActionBtn>
        </div>
      )}

      {showToolSpecificOptions && <div className="flex items-center gap-2 px-2 py-1 flex-wrap" style={{ borderTop: "1px solid var(--color-border)" }}>

        {activeTool === "smartSelect" && (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input className="flex-1 px-2 py-0.5 text-[10px] min-w-0" style={inputStyle} disabled={locked}
              placeholder='Type what to select (e.g. "hat", "sky", "shoes")...'
              value={smartSubject} onChange={(e) => setSmartSubject(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSmartSelect(smartSubject); }}
            />
            <ActionBtn busy={busy} disabled={locked} onClick={() => onSmartSelect(smartSubject)} busyText="Selecting...">Select</ActionBtn>
          </div>
        )}

        {activeTool === "smartErase" && (
          <ActionBtn busy={busy} disabled={!hasMask || locked} onClick={onSmartErase} busyText="Erasing...">Erase Masked Object</ActionBtn>
        )}

        {activeTool === "outpaint" && (
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <select className="px-1.5 py-0.5 text-[10px] rounded" style={inputStyle} disabled={locked}
              value={outpaintDir} onChange={(e) => setOutpaintDir(e.target.value as OutpaintDir)}>
              <option value="left">Left</option><option value="right">Right</option>
              <option value="top">Top</option><option value="bottom">Bottom</option>
              <option value="all">All sides</option>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>px</span>
              <input type="range" min={64} max={512} step={64} value={outpaintPx} disabled={locked}
                onChange={(e) => setOutpaintPx(Number(e.target.value))} className="w-20 h-3" />
              <span className="text-[10px] w-6 tabular-nums" style={{ color: "var(--color-text-muted)" }}>{outpaintPx}</span>
            </div>
            <input className="flex-1 px-2 py-0.5 text-[10px] min-w-[100px]" style={inputStyle} disabled={locked}
              placeholder="Describe what fills the new area (leave blank for AI to decide)..." value={outpaintPrompt} onChange={(e) => setOutpaintPrompt(e.target.value)} />
            <ActionBtn busy={busy} disabled={locked} onClick={() => onOutpaint(outpaintDir, outpaintPx, outpaintPrompt)} busyText="Extending...">Extend</ActionBtn>
          </div>
        )}

        {activeTool === "removeBg" && (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input className="flex-1 px-2 py-0.5 text-[10px] min-w-0" style={inputStyle} disabled={locked}
              placeholder="New background (leave blank for transparent)..." value={bgReplacement} onChange={(e) => setBgReplacement(e.target.value)} />
            <ActionBtn busy={busy} disabled={locked} onClick={() => onRemoveBg(bgReplacement)} busyText="Removing...">Remove Background</ActionBtn>
          </div>
        )}

        {activeTool === "styleTransfer" && (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <select className="px-1.5 py-0.5 text-[10px] rounded" style={inputStyle} disabled={locked}
              value={stylePreset} onChange={(e) => setStylePreset(e.target.value)}>
              {STYLE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {stylePreset === "custom" && (
              <input className="flex-1 px-2 py-0.5 text-[10px] min-w-0" style={inputStyle} disabled={locked}
                placeholder="Describe the art style you want..." value={styleCustom} onChange={(e) => setStyleCustom(e.target.value)} />
            )}
            <ActionBtn busy={busy} disabled={locked} onClick={() => onStyleTransfer(stylePreset, styleCustom)} busyText="Applying...">Apply Style</ActionBtn>
          </div>
        )}
      </div>}
    </div>
  );
}
