import { useState, useCallback } from "react";

export interface Toast {
  id: number;
  message: string;
  level: "info" | "error" | "success";
  progress?: number;
}

let _nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, level: Toast["level"] = "info") => {
    const id = _nextId++;
    setToasts((prev) => [...prev, { id, message, level }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
    return id;
  }, []);

  const updateToast = useCallback((id: number, updates: Partial<Pick<Toast, "message" | "level" | "progress">>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, updateToast, dismissToast };
}
