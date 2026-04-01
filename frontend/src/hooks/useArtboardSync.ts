import { useEffect, useRef, useCallback, useState } from "react";
import { useArtboard, type ArtboardDelta, type RoomUser, type RemoteCursor, type BucketImage } from "./ArtboardContext";

function getWsBase(remoteHost?: string | null): string {
  if (remoteHost) {
    const host = remoteHost.includes(":") ? remoteHost : `${remoteHost}:8420`;
    return `ws://${host}`;
  }
  if (window.location.protocol === "file:") return "ws://127.0.0.1:8420";
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}

const CURSOR_THROTTLE_MS = 66;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

/**
 * Manages the WebSocket connection for real-time artboard collaboration.
 * Automatically connects when mode is "shared" and a roomId is set.
 */
export function useArtboardSync() {
  const {
    mode, roomId, remoteHost, applyRemoteDelta, setDeltaListener, setRoomUsers, setRemoteCursors, leaveRoom,
    addBucketImage, setBuckets, setWsSender,
  } = useArtboard();

  const wsRef = useRef<WebSocket | null>(null);
  const lastCursorSend = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userNameRef = useRef("");
  const passwordRef = useRef("");
  const reconnectAttemptRef = useRef(0);
  const [reconnectTick, setReconnectTick] = useState(0);

  const setCredentials = useCallback((userName: string, password?: string) => {
    userNameRef.current = userName;
    passwordRef.current = password || "";
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const sendCursor = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;
    lastCursorSend.current = now;
    send({ op: "cursor", x, y });
  }, [send]);

  useEffect(() => {
    if (mode !== "shared" || !roomId) {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      return;
    }

    const wsBase = getWsBase(remoteHost);
    const params = new URLSearchParams();
    params.set("user", userNameRef.current || "Guest");
    if (passwordRef.current) params.set("password", passwordRef.current);
    const url = `${wsBase}/api/artboard/ws/${encodeURIComponent(roomId)}?${params}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    let everOpened = false;

    ws.onopen = () => {
      everOpened = true;
      reconnectAttemptRef.current = 0;
      setDeltaListener((delta: ArtboardDelta) => {
        send({ op: "delta", ...delta });
      });
      setWsSender(send);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const op = msg.op;

        if (op === "full_sync") {
          applyRemoteDelta({ type: "full_sync", items: msg.items || [] });
          if (msg.users) {
            setRoomUsers(msg.users as RoomUser[]);
          }
          if (msg.buckets && typeof msg.buckets === "object") {
            setBuckets(msg.buckets as Record<string, BucketImage[]>);
          }
        } else if (op === "bucket_add") {
          const img = msg.image as BucketImage | undefined;
          if (img) addBucketImage(img);
        } else if (op === "delta") {
          const actions = msg.actions as ArtboardDelta[];
          if (actions) {
            for (const action of actions) applyRemoteDelta(action);
          }
        } else if (op === "cursor") {
          setRemoteCursors((prev) => {
            const next = new Map(prev);
            next.set(msg.user, {
              x: msg.x, y: msg.y, color: msg.color, name: msg.user, lastUpdate: Date.now(),
            } satisfies RemoteCursor);
            return next;
          });
        } else if (op === "user_joined") {
          setRoomUsers((prev: RoomUser[]) => {
            if (prev.some((u) => u.name === msg.user)) return prev;
            return [...prev, { name: msg.user, color: msg.color }];
          });
        } else if (op === "user_left") {
          setRoomUsers((prev: RoomUser[]) => prev.filter((u) => u.name !== msg.user));
          setRemoteCursors((prev) => { const n = new Map(prev); n.delete(msg.user); return n; });
        } else if (op === "error") {
          console.error("[ArtboardSync] Server error:", msg.message);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      setDeltaListener(null);
      setWsSender(null);

      if (ev.code === 4003 || ev.code === 4004) {
        leaveRoom();
        return;
      }

      if (mode !== "shared" || !roomId || ev.code === 1000) return;

      if (!everOpened) {
        reconnectAttemptRef.current += 1;
      }

      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("[ArtboardSync] Max reconnect attempts reached — giving up");
        leaveRoom();
        return;
      }

      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttemptRef.current),
        RECONNECT_MAX_MS,
      );
      reconnectTimer.current = setTimeout(() => {
        setReconnectTick((t) => t + 1);
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    return () => {
      setDeltaListener(null);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.close();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomId, remoteHost, reconnectTick]);

  return { send, sendCursor, setCredentials, wsRef };
}
