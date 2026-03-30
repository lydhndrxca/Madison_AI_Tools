import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "./useApi";

const STORAGE_KEY = "madison-api-costs-cache";
const POLL_INTERVAL_MS = 8_000;

export interface CostData {
  total: number;
  categories: Record<string, number>;
}

const CATEGORY_LABELS: Record<string, string> = {
  image_generation: "Image Generation",
  text_generation: "Text / JSON",
  art_director: "Art Director Chat",
  voice_director: "Voice Director",
  voice_transcription: "Voice Transcription",
  deep_search: "Deep Reference Search",
  grounding: "Grounded Search",
  extraction: "Attribute Extraction",
  editing: "Image Editing",
  multiview: "Multi-View Generation",
  upscale: "AI Upscale / Restore",
};

export function getCategoryLabel(key: string): string {
  return CATEGORY_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadCache(): CostData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { total: 0, categories: {} };
}

function saveCache(data: CostData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function useCostTracker() {
  const [costs, setCosts] = useState<CostData>(loadCache);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCosts = useCallback(async () => {
    try {
      const data = await apiFetch<CostData>("/system/api-costs");
      if (data && typeof data.total === "number") {
        const slim = { total: data.total, categories: data.categories || {} };
        setCosts(slim);
        saveCache(slim);
      }
    } catch { /* backend not reachable — keep cache */ }
  }, []);

  const resetCosts = useCallback(async () => {
    const empty: CostData = { total: 0, categories: {} };
    try {
      await apiFetch("/system/api-costs", { method: "DELETE" });
      setCosts(empty);
      saveCache(empty);
    } catch {
      setCosts(empty);
      saveCache(empty);
    }
  }, []);

  useEffect(() => {
    fetchCosts();
    intervalRef.current = setInterval(fetchCosts, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCosts]);

  return { costs, fetchCosts, resetCosts };
}
