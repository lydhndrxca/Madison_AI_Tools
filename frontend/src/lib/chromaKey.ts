export interface ChromaKeySettings {
  enabled: boolean;
  tolerance: number;       // 0–100
  edgeFeather: number;     // 0–20
  spillSuppression: number; // 0–100
}

export const DEFAULT_CHROMA: ChromaKeySettings = {
  enabled: false,
  tolerance: 40,
  edgeFeather: 4,
  spillSuppression: 50,
};

/**
 * Apply chroma key (green screen removal) to raw RGBA pixel data.
 * Modifies the passed ImageData in-place and returns it.
 */
export function applyChromaKey(
  imageData: ImageData,
  settings: ChromaKeySettings,
): ImageData {
  if (!settings.enabled) return imageData;
  const { data } = imageData;
  const tol = (settings.tolerance / 100) * 255;
  const feather = (settings.edgeFeather / 20) * 60; // px range for soft edge
  const spill = settings.spillSuppression / 100;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Distance from pure green #00FF00 in RGB space
    const dist = Math.sqrt(r * r + (g - 255) * (g - 255) + b * b);

    if (dist < tol) {
      data[i + 3] = 0; // fully transparent
    } else if (feather > 0 && dist < tol + feather) {
      // Soft edge — interpolate alpha
      const alpha = ((dist - tol) / feather) * 255;
      data[i + 3] = Math.min(data[i + 3], Math.round(alpha));
    }

    // Spill suppression: reduce green bias on semi-transparent edge pixels
    if (spill > 0 && data[i + 3] > 0 && data[i + 3] < 255) {
      const maxRB = Math.max(r, b);
      if (g > maxRB) {
        data[i + 1] = Math.round(g - (g - maxRB) * spill);
      }
    }
  }

  return imageData;
}

const CHECKER_SIZE = 8;
let _checkerPattern: CanvasPattern | null = null;

/** Get a reusable checkerboard pattern for transparent backgrounds. */
export function getCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (_checkerPattern) return _checkerPattern;
  const c = document.createElement("canvas");
  c.width = CHECKER_SIZE * 2;
  c.height = CHECKER_SIZE * 2;
  const cx = c.getContext("2d")!;
  cx.fillStyle = "#2a2a2a";
  cx.fillRect(0, 0, c.width, c.height);
  cx.fillStyle = "#3a3a3a";
  cx.fillRect(0, 0, CHECKER_SIZE, CHECKER_SIZE);
  cx.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);
  _checkerPattern = ctx.createPattern(c, "repeat");
  return _checkerPattern;
}
