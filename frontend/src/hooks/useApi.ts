import { useCallback, useEffect, useRef } from "react";

function getBackendBase(): string {
  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:8420";
  }
  return "";
}

const BACKEND = getBackendBase();

const _activeControllers = new Set<AbortController>();

export function cancelAllRequests(): void {
  for (const c of _activeControllers) c.abort();
  _activeControllers.clear();
}

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  _activeControllers.add(controller);
  try {
    const res = await fetch(`${BACKEND}/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return res.json();
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text as unknown as T; }
  } finally {
    _activeControllers.delete(controller);
  }
}

/**
 * POST with Server-Sent Events streaming.  Calls `onToken` for each text
 * chunk as the model generates, then resolves when the stream ends.
 */
export async function apiFetchSSE(
  path: string,
  body: unknown,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<{ error?: string }> {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}` };
  }
  if (!res.body) return { error: "No response body" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.token) onToken(evt.token);
        if (evt.error) return { error: evt.error };
        if (evt.done) return {};
      } catch { /* skip malformed */ }
    }
  }
  return {};
}

interface ProgressMessage {
  type: "progress" | "status" | "error" | "image" | "console";
  data: Record<string, unknown>;
}

export function useWebSocket(onMessage: (msg: ProgressMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    let retryDelay = 2000;

    function connect() {
      if (unmountedRef.current) return;
      const wsBase = BACKEND
        ? BACKEND.replace(/^http/, "ws")
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      const ws = new WebSocket(`${wsBase}/ws/progress`);
      wsRef.current = ws;

      ws.onopen = () => { retryDelay = 2000; };

      ws.onmessage = (ev) => {
        try {
          const msg: ProgressMessage = JSON.parse(ev.data);
          onMessageRef.current(msg);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        wsRef.current = null;
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 1.5, 15000);
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      wsRef.current?.close();
    };
  }, []);

  return wsRef;
}
