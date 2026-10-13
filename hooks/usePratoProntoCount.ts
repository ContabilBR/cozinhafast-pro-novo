import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/utils/api";
import { useRealtime, type RealtimeEvent } from "@/hooks/useRealtime";

const POLL_INTERVAL_MS = 30_000;

/**
 * Number of pedidos with status "pronto" waiting to be picked up, scoped the
 * same way GET /api/pedidos already scopes results (own comandas for
 * garcom, everything for gerente/administrador).
 *
 * Deliberately NOT based on "did I receive the live WebSocket event at the
 * exact right moment" — it's a plain count derived from current data,
 * refreshed:
 *   - on mount
 *   - whenever the app returns to the foreground (AppState)
 *   - whenever a relevant realtime event arrives, while connected
 *   - every 30s as a safety net in case the WebSocket silently drops
 * So the badge stays correct even if the app was closed or backgrounded at
 * the exact moment the kitchen marked something ready — it just reflects
 * reality whenever the person looks at it.
 */
export function usePratoProntoCount(enabled: boolean = true): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);

  const active = enabled && !!user;

  const fetchCount = useCallback(async () => {
    if (!active) return;
    try {
      const data = await apiGet<{ pedidos: Array<{ status: string }> }>("/api/pedidos");
      if (!mountedRef.current) return;
      const prontos = (data.pedidos || []).filter((p) => p.status === "pronto").length;
      setCount(prontos);
    } catch {
      // Keep the last known count rather than flashing to 0 on a transient error.
    }
  }, [active]);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (
        event.type === "pedido.status_changed" ||
        event.type === "pedido.created" ||
        event.type === "pedido.deleted"
      ) {
        fetchCount();
      }
    },
    [fetchCount]
  );

  useRealtime({ onEvent: handleRealtimeEvent, enabled: active });

  useEffect(() => {
    mountedRef.current = true;

    if (!active) {
      setCount(0);
      return;
    }

    fetchCount();

    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") fetchCount();
    });

    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, [active, fetchCount]);

  return count;
}

/**
 * Number of delivery pedidos with etapa "pronto_para_despachar".
 * Refreshed on mount, foreground, delivery realtime events, and every 30s.
 */
export function useDeliveryProntoCount(enabled: boolean = true): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);

  const active = enabled && !!user;

  const fetchCount = useCallback(async () => {
    if (!active) return;
    try {
      const data = await apiGet<{ pedidos: Array<{ pronto_para_despachar?: boolean; entrega?: { etapa?: string } }> }>("/api/delivery/pedidos");
      if (!mountedRef.current) return;
      const prontos = (data.pedidos || []).filter(
        (p) => p.pronto_para_despachar === true || p.entrega?.etapa === "pronto_para_despachar"
      ).length;
      setCount(prontos);
    } catch {
      // Keep the last known count rather than flashing to 0 on a transient error.
    }
  }, [active]);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type?.startsWith("delivery.")) {
        fetchCount();
      }
    },
    [fetchCount]
  );

  useRealtime({ onEvent: handleRealtimeEvent, enabled: active });

  useEffect(() => {
    mountedRef.current = true;

    if (!active) {
      setCount(0);
      return;
    }

    fetchCount();

    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") fetchCount();
    });

    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, [active, fetchCount]);

  return count;
}
