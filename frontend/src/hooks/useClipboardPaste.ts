import { useEffect, useRef } from "react";

/**
 * Resolve a ClipboardResult (from Electron IPC) into a data-URL string.
 * If the result contains a direct dataUrl, return it.
 * If it contains an imageUrl, fetch it and convert to data-URL.
 */
async function resolveClipboardResult(result: ClipboardResult | null): Promise<string | null> {
  if (!result) return null;
  if (result.dataUrl) return result.dataUrl;
  if (result.imageUrl) {
    try {
      const resp = await fetch(result.imageUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob.type.startsWith("image/")) return null;
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Reads an image from the system clipboard on demand (for context-menu Paste).
 * Uses Electron IPC to main process, falls back to web Clipboard API.
 */
export async function readClipboardImage(): Promise<string | null> {
  // 1. Electron IPC (main process has full clipboard access)
  if (window.electronAPI?.readClipboardImage) {
    try {
      const result = await window.electronAPI.readClipboardImage();
      const dataUrl = await resolveClipboardResult(result);
      if (dataUrl) return dataUrl;
    } catch (err) {
      console.warn("[readClipboardImage] IPC failed:", err);
    }
  }

  // 2. Web Clipboard API fallback
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch {
    // permission denied or unsupported
  }

  return null;
}

/**
 * Hook: listens for Ctrl+V image paste via Electron IPC push from the main
 * process.  Calls `onImage(dataUrl)` when an image is pasted.
 * Skips delivery when an INPUT or TEXTAREA is focused.
 */
export function useClipboardPaste(onImage: ((dataUrl: string) => void) | undefined) {
  const callbackRef = useRef(onImage);
  callbackRef.current = onImage;

  useEffect(() => {
    if (!window.electronAPI?.onPasteImage) return;

    const unsub = window.electronAPI.onPasteImage(async (result: ClipboardResult) => {
      if (!callbackRef.current) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const dataUrl = await resolveClipboardResult(result);
      if (dataUrl) {
        callbackRef.current(dataUrl);
      }
    });

    return unsub;
  }, []);
}
