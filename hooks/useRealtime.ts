import { useEffect, useRef, useCallback, useState } from "react";
import { BACKEND_URL, getBearerToken } from "@/utils/api";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export interface RealtimeEvent {
  type: string;
  entityId: string;
  occurredAt: string;
  payload?: Record<string, any>;
}

interface UseRealtimeOptions {
  onEvent: (event: RealtimeEvent) => void;
  enabled?: boolean; // default true
}

const WS_URL = BACKEND_URL.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"));

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export function useRealtime({ onEvent, enabled = true }: UseRealtimeOptions): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current || !enabled) return;
    if (wsRef.current) return; // already connecting/connected

    const token = await getBearerToken();
    if (!token || !mountedRef.current) return;

    console.log("[useRealtime] Connecting to WebSocket:", `${WS_URL}/api/realtime`);
    setStatus("connecting");

    const ws = new WebSocket(`${WS_URL}/api/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      console.log("[useRealtime] WebSocket opened, sending auth token");
      ws.send(token);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === "connected") {
          retryCountRef.current = 0;
          console.log("[useRealtime] Connected and authenticated");
          setStatus("connected");
          return;
        }
        if (data.error) {
          // Auth failed — do not retry
          console.error("[useRealtime] Auth error from server:", data.error);
          setStatus("disconnected");
          closeWs();
          return;
        }
        // It's a realtime event
        console.log("[useRealtime] Received event:", data.type, data.entityId);
        onEventRef.current(data as RealtimeEvent);
      } catch {}
    };

    ws.onerror = () => {
      // onclose will fire after onerror
      console.warn("[useRealtime] WebSocket error");
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      setStatus("disconnected");

      if (!enabled) return;

      // Exponential backoff
      const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCountRef.current), MAX_BACKOFF_MS);
      retryCountRef.current += 1;
      console.log(`[useRealtime] Disconnected. Retrying in ${delay}ms (attempt ${retryCountRef.current})`);
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current && enabled) connect();
      }, delay);
    };
  }, [enabled, closeWs]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      closeWs();
    };
  }, [enabled, connect, clearRetryTimer, closeWs]);

  return status;
}
