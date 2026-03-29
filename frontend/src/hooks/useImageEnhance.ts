import { useCallback, useRef, useState } from "react";
import { apiFetch } from "./useApi";

type EnhanceMode = "upscale" | "restore";

interface EnhanceResult {
  image_b64: string;
  width?: number;
  height?: number;
}

interface UseImageEnhance {
  /** True while any enhance operation is in flight */
  busy: boolean;
  /**
   * Run upscale or restore on a base-64 image (with or without data-url prefix).
   * Returns the result data-url, or null on failure.
   */
  enhance: (
    mode: EnhanceMode,
    imageSrc: string,
    opts?: { scaleFactor?: string; context?: string },
  ) => Promise<string | null>;
  /** Abort any running enhance */
  cancel: () => void;
}

/**
 * Shared hook for one-click AI Upres / AI Restore from any image view.
 * Uses the /character/ endpoints which are model-agnostic.
 */
export function useImageEnhance(): UseImageEnhance {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const enhance = useCallback(
    async (
      mode: EnhanceMode,
      imageSrc: string,
      opts?: { scaleFactor?: string; context?: string },
    ): Promise<string | null> => {
      const raw = imageSrc.replace(/^data:image\/[^;]+;base64,/, "");
      if (!raw) return null;

      setBusy(true);
      abortRef.current = new AbortController();

      const endpoint =
        mode === "upscale" ? "/character/upscale" : "/character/restore";

      const body: Record<string, unknown> = { image_b64: raw };
      if (mode === "upscale") body.scale_factor = opts?.scaleFactor ?? "x2";
      if (opts?.context?.trim()) body.context = opts.context.trim();

      try {
        const resp = await apiFetch<EnhanceResult & { error?: string }>(
          endpoint,
          {
            method: "POST",
            body: JSON.stringify(body),
            signal: abortRef.current.signal,
          },
        );
        if (resp.error) return null;
        if (resp.image_b64) return `data:image/png;base64,${resp.image_b64}`;
        return null;
      } catch {
        return null;
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  return { busy, enhance, cancel };
}
