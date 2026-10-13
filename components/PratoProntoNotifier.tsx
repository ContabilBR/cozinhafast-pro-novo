import React, { useCallback, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, Truck } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime, type RealtimeEvent } from "@/hooks/useRealtime";
import { useColors } from "@/hooks/useColors";

// Roles that should be notified when the kitchen marks a dish ready.
// "cozinheiro" is deliberately excluded — they're the one who just marked it.
const NOTIFY_ROLES = new Set(["garcom", "gerente", "administrador", "admin"]);

const AUTO_DISMISS_MS = 5000;
const AUTO_DISMISS_DELIVERY_MS = 20000;

/**
 * Global "prato pronto" banner. Mounted once at the root layout (not inside
 * any single tab/screen) so it's visible no matter where the garcom is in
 * the app when the kitchen marks a pedido as ready.
 *
 * Also handles "delivery.pronto" events with a separate purple banner.
 */
export function PratoProntoNotifier() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Prato (mesa/balcão) banner
  const [message, setMessage] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delivery banner
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
  const [deliveryEntregaId, setDeliveryEntregaId] = useState<string | null>(null);
  const deliveryTranslateY = useRef(new Animated.Value(-120)).current;
  const deliveryDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    Animated.timing(translateY, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setMessage(null));
  }, [translateY]);

  const dismissDelivery = useCallback(() => {
    if (deliveryDismissTimerRef.current) {
      clearTimeout(deliveryDismissTimerRef.current);
      deliveryDismissTimerRef.current = null;
    }
    Animated.timing(deliveryTranslateY, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setDeliveryMessage(null);
      setDeliveryEntregaId(null);
    });
  }, [deliveryTranslateY]);

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === "pedido.status_changed" && event.payload?.status === "pronto") {
        // Ignore delivery — delivery has its own banner via delivery.pronto
        if (event.payload?.comanda_tipo === "delivery") return;

        const mesa = event.payload?.mesa_numero;
        const prato = event.payload?.prato_nome;

        let text: string;
        if (prato && mesa) {
          text = `Mesa ${mesa} — ${prato} está pronto`;
        } else if (prato) {
          text = `${prato} está pronto`;
        } else if (mesa) {
          text = `Mesa ${mesa} — um pedido está pronto`;
        } else {
          text = "Um pedido está pronto";
        }

        console.log("[PratoProntoNotifier] pedido.status_changed pronto (mesa/balcão):", text);
        setMessage(text);
        translateY.setValue(-120);
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 14,
          bounciness: 6,
        }).start();

        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
        return;
      }

      if (event.type === "delivery.pronto") {
        const nome = event.payload?.cliente_nome ?? "";
        const entregaId = event.payload?.entrega_id ?? null;
        const text = nome
          ? `Delivery de ${nome} pronto para despachar`
          : "Um delivery está pronto para despachar";

        console.log("[PratoProntoNotifier] delivery.pronto:", text, "entrega_id:", entregaId);
        setDeliveryMessage(text);
        setDeliveryEntregaId(entregaId);
        deliveryTranslateY.setValue(-120);
        Animated.spring(deliveryTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 14,
          bounciness: 6,
        }).start();

        if (deliveryDismissTimerRef.current) clearTimeout(deliveryDismissTimerRef.current);
        deliveryDismissTimerRef.current = setTimeout(dismissDelivery, AUTO_DISMISS_DELIVERY_MS);
        return;
      }
    },
    [dismiss, dismissDelivery, translateY, deliveryTranslateY]
  );

  const role = (user?.role || "").toLowerCase();
  const shouldConnect = !!user && NOTIFY_ROLES.has(role);

  useRealtime({ onEvent: handleEvent, enabled: shouldConnect });

  const handleDeliveryPress = useCallback(() => {
    console.log("[PratoProntoNotifier] Delivery banner pressed, entrega_id:", deliveryEntregaId);
    if (deliveryEntregaId) {
      router.push("/delivery/" + deliveryEntregaId as any);
    } else {
      router.push("/(tabs)/(delivery)" as any);
    }
    dismissDelivery();
  }, [deliveryEntregaId, router, dismissDelivery]);

  // Delivery banner sits below prato banner if both are visible
  const deliveryTop = insets.top + 8 + (message ? 72 : 0);

  return (
    <>
      {message && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.container, { top: insets.top + 8, transform: [{ translateY }] }]}
        >
          <Pressable
            onPress={dismiss}
            style={[
              styles.banner,
              { backgroundColor: colors.surface, borderColor: colors.statusPronto },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.statusPronto }]}>
              <CheckCircle size={18} color="#fff" />
            </View>
            <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
              {message}
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {deliveryMessage && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.container, { top: deliveryTop, transform: [{ translateY: deliveryTranslateY }] }]}
        >
          <Pressable
            onPress={handleDeliveryPress}
            style={[
              styles.banner,
              { backgroundColor: colors.surface, borderColor: "#7C3AED" },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: "#7C3AED" }]}>
              <Truck size={18} color="#fff" />
            </View>
            <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
              {deliveryMessage}
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 999,
    alignItems: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 480,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
});
