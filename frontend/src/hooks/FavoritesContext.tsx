import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface FavoriteItem {
  id: string;
  image_b64: string;
  tool: string;
  label: string;
  timestamp: number;
  prompt?: string;
  source: "viewer" | "grid";
  width?: number;
  height?: number;
}

interface FavoritesContextValue {
  favorites: FavoriteItem[];
  addFavorite: (item: Omit<FavoriteItem, "id" | "timestamp">) => void;
  removeFavorite: (id: string) => void;
  isFavorited: (image_b64: string) => boolean;
  getFavoriteId: (image_b64: string) => string | null;
  clearFavorites: () => void;
}

const STORAGE_KEY = "madison-favorites";

function loadFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(items: FavoriteItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* quota exceeded — silently drop */ }
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>(loadFavorites);

  const addFavorite = useCallback((item: Omit<FavoriteItem, "id" | "timestamp">) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.image_b64 === item.image_b64)) return prev;
      const next = [{ ...item, id: crypto.randomUUID(), timestamp: Date.now() }, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => f.id !== id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorited = useCallback((image_b64: string) => {
    return favorites.some((f) => f.image_b64 === image_b64);
  }, [favorites]);

  const getFavoriteId = useCallback((image_b64: string) => {
    return favorites.find((f) => f.image_b64 === image_b64)?.id ?? null;
  }, [favorites]);

  const clearFavorites = useCallback(() => {
    setFavorites([]);
    saveFavorites([]);
  }, []);

  return (
    <FavoritesContext.Provider value={{ favorites, addFavorite, removeFavorite, isFavorited, getFavoriteId, clearFavorites }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used inside FavoritesProvider");
  return ctx;
}
