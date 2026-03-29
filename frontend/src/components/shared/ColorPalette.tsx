import { useState, useCallback } from "react";
import { Pipette, Copy, Loader2 } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

export interface PaletteSwatch {
  hex: string;
  rgb: number[];
  percentage: number;
}

interface ColorPaletteProps {
  swatches: PaletteSwatch[];
  onSwatchesChange?: (swatches: PaletteSwatch[]) => void;
  /** If provided, shows an "Extract" button that uses this image */
  imageSrc?: string | null;
  compact?: boolean;
}

export function ColorPalette({ swatches, onSwatchesChange, imageSrc, compact = false }: ColorPaletteProps) {
  const [busy, setBusy] = useState(false);

  const handleExtract = useCallback(async () => {
    if (!imageSrc || !onSwatchesChange) return;
    setBusy(true);
    try {
      const b64 = imageSrc.startsWith("data:") ? imageSrc : `data:image/png;base64,${imageSrc}`;
      const result = await apiFetch<PaletteSwatch[]>("/palette/extract", {
        method: "POST",
        body: JSON.stringify({ image_b64: b64, num_colors: 6 }),
      });
      onSwatchesChange(result);
    } catch { /* */ }
    setBusy(false);
  }, [imageSrc, onSwatchesChange]);

  const handleCopy = useCallback(() => {
    const text = swatches.map((s) => s.hex).join(", ");
    navigator.clipboard?.writeText(text).catch(() => {});
  }, [swatches]);

  const paletteString = swatches.map((s) => s.hex).join(", ");

  if (compact && swatches.length === 0 && imageSrc && onSwatchesChange) {
    return (
      <button
        onClick={handleExtract}
        disabled={busy}
        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded cursor-pointer font-medium"
        style={{ background: "rgba(42,74,90,0.25)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.4)" }}
        title="Extract dominant color palette from the current image"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pipette className="h-3 w-3" />}
        Extract Palette
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {/* Swatch row */}
      {swatches.length > 0 && (
        <div className="flex items-center gap-1">
          {swatches.map((s, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-0.5"
              title={`${s.hex} (${s.percentage}%)`}
            >
              <div
                className="rounded"
                style={{
                  width: compact ? 16 : 24,
                  height: compact ? 16 : 24,
                  background: s.hex,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              {!compact && (
                <span className="text-[8px] font-mono" style={{ color: "var(--color-text-muted)" }}>
                  {s.hex}
                </span>
              )}
            </div>
          ))}
          <button
            onClick={handleCopy}
            className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)] ml-1"
            style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
            title={`Copy palette: ${paletteString}`}
          >
            <Copy className="h-3 w-3" />
          </button>
          {imageSrc && onSwatchesChange && (
            <button
              onClick={handleExtract}
              disabled={busy}
              className="p-1 rounded cursor-pointer hover:bg-[var(--color-hover)]"
              style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
              title="Re-extract palette"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pipette className="h-3 w-3" />}
            </button>
          )}
        </div>
      )}

      {/* Extract button when no swatches yet */}
      {swatches.length === 0 && imageSrc && onSwatchesChange && (
        <button
          onClick={handleExtract}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded cursor-pointer font-medium w-full justify-center"
          style={{ background: "rgba(42,74,90,0.25)", color: "#5ec9e0", border: "1px solid rgba(74,110,138,0.4)" }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pipette className="h-3.5 w-3.5" />}
          Extract Color Palette
        </button>
      )}
    </div>
  );
}

/** Formats a palette array into a prompt-ready string. */
export function paletteToPromptText(swatches: PaletteSwatch[]): string {
  if (swatches.length === 0) return "";
  return `Use color palette: ${swatches.map((s) => s.hex).join(", ")}`;
}
