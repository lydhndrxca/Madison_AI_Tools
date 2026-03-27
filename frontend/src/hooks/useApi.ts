import { useState, useCallback, useEffect, useRef } from "react";

function getBackendBase(): string {
  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:8420";
  }
  return "";
}

const BACKEND = getBackendBase();

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BACKEND}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function useApiPost<TReq, TRes>(path: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (body: TReq): Promise<TRes | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<TRes>(path, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return res;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  return { execute, loading, error };
}

interface ProgressMessage {
  type: "progress" | "status" | "error" | "image" | "console";
  data: Record<string, unknown>;
}

export function useWebSocket(onMessage: (msg: ProgressMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsBase = BACKEND
      ? BACKEND.replace(/^http/, "ws")
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/progress`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg: ProgressMessage = JSON.parse(ev.data);
        onMessage(msg);
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (wsRef.current === ws) wsRef.current = null;
      }, 1000);
    };

    return () => ws.close();
  }, [onMessage]);

  return wsRef;
}
