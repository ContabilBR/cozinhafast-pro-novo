import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  ActivityIndicator,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  TouchableOpacity,
  Pressable,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet, apiPut } from "@/utils/api";
import { formatElapsed } from "@/utils/helpers";
import {
  Flame,
  Clock,
  RefreshCw,
  ChefHat,
  Package,
  UtensilsCrossed,
  User,
  ChevronDown,
  ChevronUp,
  Check,
  Play,
  Bike,
  ShoppingBag,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useRealtime, type RealtimeStatus, type RealtimeEvent } from "@/hooks/useRealtime";
import { useKeepAwake } from "expo-keep-awake";
import { isDelivery, isBalcao, tituloCartao, calcPrazoDelivery, textoAvisoCancelamento } from "@/utils/cozinhaDelivery";
import { useAuth } from "@/contexts/AuthContext";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ComandaPedido {
  id: string;
  prato_nome: string;
  tempo_preparo_min: number | null;
  quantidade: number;
  status: string;
  observacao: string | null;
  created_at: string;
  iniciado_em: string | null;
  pronto_em: string | null;
}

interface Comanda {
  id: string;
  numero_comanda: string;
  mesa_numero: number;
  created_at: string;
  garcom_nome: string;
  total_itens: number;
  status: string;
  tipo: string;
  entrega_cliente_nome: string | null;
  entrega_bairro: string | null;
  entrega_observacao: string | null;
  entrega_tempo_estimado: number | null;
  entrega_horario_limite: string | null;
  pedidos: ComandaPedido[];
}

const STATUS_COLORS: Record<string, string> = {
  pendente: "#94A3B8",
  em_preparo: "#F59E0B",
  pronto: "#22C55E",
  entregue: "#0D9488",
  cancelado: "#EF4444",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_preparo: "Em Preparo",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

const COMANDA_STATUS_COLORS: Record<string, string> = {
  aberta: "#6366F1",
  fechada: "#22C55E",
  cancelada: "#EF4444",
};

const COMANDA_STATUS_LABELS: Record<string, string> = {
  aberta: "Aberta",
  fechada: "Fechada",
  cancelada: "Cancelada",
};

type ComandaFilter = "todas" | "abertas" | "fechadas" | "canceladas";

const COMANDA_FILTERS: { key: ComandaFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "abertas", label: "Abertas" },
  { key: "fechadas", label: "Fechadas" },
  { key: "canceladas", label: "Canceladas" },
];

const COMANDA_FILTER_STATUS: Record<ComandaFilter, string | null> = {
  todas: null,
  abertas: "aberta",
  fechadas: "fechada",
  canceladas: "cancelada",
};

const ACTIVE_STATUSES = ["pendente", "em_preparo", "pronto"];

const DEFAULT_TEMPO_PREPARO_MIN = 15;

function getPedidoUrgencia(pedido: { status: string; iniciado_em: string | null; created_at: string; tempo_preparo_min: number | null }) {
  const targetMin = pedido.tempo_preparo_min ?? DEFAULT_TEMPO_PREPARO_MIN;
  if (pedido.status === "pendente") {
    return { diffMin: 0, targetMin, isUrgent: false, isWarning: false, isPendente: true };
  }
  const ref = pedido.iniciado_em ?? pedido.created_at;
  const diffMin = Math.floor((Date.now() - new Date(ref).getTime()) / 60000);
  const isEmPreparo = pedido.status === "em_preparo";
  const isUrgent = isEmPreparo && diffMin > targetMin;
  const isWarning = isEmPreparo && !isUrgent && diffMin >= targetMin * 0.7;
  return { diffMin, targetMin, isUrgent, isWarning, isPendente: false };
}

function KitchenTicketCard({
  item,
  index,
  onAction,
}: {
  item: Comanda;
  index: number;
  onAction: (id: string, status: string) => Promise<void>;
}) {
  const COLORS = useColors();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ pedidoId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const activePedidos = (Array.isArray(item.pedidos) ? item.pedidos : []).filter(
    (p) => ACTIVE_STATUSES.includes(p.status)
  );

  const itemUrgencias = activePedidos.map((p) => ({ pedido: p, urgencia: getPedidoUrgencia(p) }));
  const emPreparoUrgencias = itemUrgencias.filter((u) => u.pedido.status === "em_preparo");
  const isUrgent = emPreparoUrgencias.some((u) => u.urgencia.isUrgent);
  const isWarning = !isUrgent && emPreparoUrgencias.some((u) => u.urgencia.isWarning);
  const borderColor = isUrgent ? "#EF444460" : isWarning ? "#F59E0B60" : COLORS.border;

  const maxEmPreparoDiffMin = emPreparoUrgencias.reduce<number | null>((max, u) => {
    if (max === null) return u.urgencia.diffMin;
    return u.urgencia.diffMin > max ? u.urgencia.diffMin : max;
  }, null);
  const emPreparoRef = emPreparoUrgencias.reduce<string | null>((oldest, u) => {
    const ref = u.pedido.iniciado_em ?? u.pedido.created_at;
    if (!oldest) return ref;
    return new Date(ref).getTime() < new Date(oldest).getTime() ? ref : oldest;
  }, null);
  const elapsed = emPreparoRef ? formatElapsed(emPreparoRef) : null;

  const urgentItems = emPreparoUrgencias.filter((u) => u.urgencia.isUrgent);
  const urgentBannerParts = urgentItems.map(
    (u) => `${u.pedido.quantidade}x ${u.pedido.prato_nome} (${u.urgencia.diffMin}/${u.urgencia.targetMin} min)`
  );
  const urgentBannerText = urgentBannerParts.length > 0 ? "Atrasado: " + urgentBannerParts.join(", ") : "";

  const comandaCode = item.id.slice(-6).toUpperCase();
  const comandaLabel = "#" + comandaCode;

  const pendentesCount = activePedidos.filter((p) => p.status === "pendente").length;
  const emPreparoCount = activePedidos.filter((p) => p.status === "em_preparo").length;
  const prontoCount = activePedidos.filter((p) => p.status === "pronto").length;

  const cardTitle = tituloCartao(item);

  const prazo = calcPrazoDelivery(item.entrega_horario_limite);

  const temAtivo = activePedidos.some(p => p.status === "pendente" || p.status === "em_preparo");

  const handlePedidoAction = async (pedidoId: string, newStatus: string, isFinalize: boolean) => {
    console.log("[Cozinha] KitchenTicketCard action:", pedidoId, "->", newStatus, "isFinalize:", isFinalize);
    setUpdatingId(pedidoId);
    try {
      await onAction(pedidoId, newStatus);
      if (isFinalize) {
        if (undoToast) clearTimeout(undoToast.timer);
        const timer = setTimeout(() => setUndoToast(null), 5000);
        setUndoToast({ pedidoId, timer });
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUndo = async () => {
    if (!undoToast) return;
    console.log("[Cozinha] Undo pressed for pedido:", undoToast.pedidoId);
    clearTimeout(undoToast.timer);
    setUndoToast(null);
    setUpdatingId(undoToast.pedidoId);
    try {
      await onAction(undoToast.pedidoId, "em_preparo");
    } finally {
      setUpdatingId(null);
    }
  };

  const deliveryItem = isDelivery(item);
  const balcaoItem = isBalcao(item);

  const prazoAtrasadoText = prazo ? "Delivery atrasado há " + Math.abs(prazo.minutosRestantes) + " min — URGENTE" : "";
  const prazoTexto = prazo ? prazo.texto : "";

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1.5,
          borderColor,
          overflow: "hidden",
        }}
      >
        {/* Delivery / Balcão top stripe */}
        {deliveryItem && (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#EDE9FE", borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Bike size={14} color="#7C3AED" />
            <Text style={{ color: "#7C3AED", fontWeight: "700", fontSize: 12, marginLeft: 4 }}>DELIVERY</Text>
            {prazo && (
              <Text style={{ color: prazo.atrasado ? "#EF4444" : prazo.minutosRestantes <= 5 ? "#F59E0B" : "#7C3AED", fontSize: 11, marginLeft: "auto" }}>
                {prazoTexto}
              </Text>
            )}
          </View>
        )}
        {balcaoItem && (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#DBEAFE", borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }}>
            <ShoppingBag size={14} color="#2563EB" />
            <Text style={{ color: "#2563EB", fontWeight: "700", fontSize: 12, marginLeft: 4 }}>BALCÃO</Text>
          </View>
        )}

        {/* Urgency banner */}
        {isUrgent && urgentBannerText !== "" && (
          <View style={{ backgroundColor: "#EF444415", paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#EF4444" }}>
              {urgentBannerText}
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
          {/* Icon / Mesa circle */}
          {deliveryItem ? (
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Bike size={22} color="#7C3AED" />
            </View>
          ) : balcaoItem ? (
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShoppingBag size={22} color="#2563EB" />
            </View>
          ) : (
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: COLORS.primaryMuted,
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.primary }}>
                {String(item.mesa_numero)}
              </Text>
            </View>
          )}

          {/* Center info */}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>
              {cardTitle}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                {comandaLabel}
              </Text>
              {deliveryItem && item.entrega_bairro ? (
                <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}> · {item.entrega_bairro}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <User size={12} color={COLORS.textSecondary} />
              {deliveryItem ? (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  {item.entrega_cliente_nome}{item.entrega_bairro ? ` · ${item.entrega_bairro}` : ""}
                </Text>
              ) : (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  {item.garcom_nome}
                </Text>
              )}
            </View>
          </View>

          {/* Right: elapsed + urgency dot */}
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {elapsed !== null && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Clock size={12} color={isUrgent ? "#EF4444" : isWarning ? "#F59E0B" : COLORS.textSecondary} />
                <Text
                  style={{
                    fontFamily: "Outfit_600SemiBold",
                    fontSize: 12,
                    color: isUrgent ? "#EF4444" : isWarning ? "#F59E0B" : COLORS.textSecondary,
                  }}
                >
                  {elapsed}
                </Text>
              </View>
            )}
            {(isUrgent || isWarning) && (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isUrgent ? "#EF4444" : "#F59E0B",
                }}
              />
            )}
          </View>
        </View>

        {/* Delivery observation box */}
        {deliveryItem && item.entrega_observacao ? (
          <View style={{ backgroundColor: "#F3E8FF", borderRadius: 8, padding: 10, marginHorizontal: 14, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: "#8B5CF6" }}>
            <Text style={{ color: "#6D28D9", fontSize: 12, fontWeight: "700", marginBottom: 2 }}>Observação do pedido</Text>
            <Text style={{ color: "#6D28D9", fontSize: 13 }}>{item.entrega_observacao}</Text>
          </View>
        ) : null}

        {/* Delivery urgency by deadline */}
        {deliveryItem && temAtivo && prazo ? (
          prazo.atrasado ? (
            <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, padding: 8, marginHorizontal: 14, marginBottom: 8, flexDirection: "row", alignItems: "center" }}>
              <Bike size={14} color="#EF4444" />
              <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 12, marginLeft: 6 }}>
                {prazoAtrasadoText}
              </Text>
            </View>
          ) : prazo.minutosRestantes <= 5 ? (
            <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, padding: 8, marginHorizontal: 14, marginBottom: 8, flexDirection: "row", alignItems: "center" }}>
              <Bike size={14} color="#F59E0B" />
              <Text style={{ color: "#F59E0B", fontWeight: "700", fontSize: 12, marginLeft: 6 }}>
                {prazoTexto}
              </Text>
            </View>
          ) : null
        ) : null}

        {/* Pedidos list */}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: COLORS.divider,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 4,
            gap: 6,
          }}
        >
          {activePedidos.map((pedido) => {
            const isPendente = pedido.status === "pendente";
            const isEmPreparo = pedido.status === "em_preparo";
            const isPronto = pedido.status === "pronto";
            const isUpdating = updatingId === pedido.id;
            const pedidoUrgencia = getPedidoUrgencia(pedido);

            const badgeColor = isPronto
              ? "#22C55E"
              : isEmPreparo && pedidoUrgencia.isUrgent
              ? "#EF4444"
              : isEmPreparo
              ? "#F59E0B"
              : "#94A3B8";
            const badgeLabel = isPronto
              ? "Pronto"
              : isEmPreparo && pedidoUrgencia.isUrgent
              ? `Atrasado · ${pedidoUrgencia.diffMin}/${pedidoUrgencia.targetMin} min`
              : isEmPreparo
              ? `Em preparo · ${pedidoUrgencia.diffMin}/${pedidoUrgencia.targetMin} min`
              : "Pendente";

            return (
              <View
                key={pedido.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 7,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.divider,
                  opacity: isPronto ? 0.45 : 1,
                }}
              >
                {/* Qty badge */}
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    backgroundColor: COLORS.primaryMuted,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: COLORS.primary }}>
                    {pedido.quantidade}
                  </Text>
                </View>

                {/* Name + obs */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>
                    {pedido.prato_nome}
                  </Text>
                  {pedido.observacao ? (
                    <Text
                      style={{
                        fontFamily: "Outfit_400Regular",
                        fontSize: 11,
                        color: COLORS.textSecondary,
                        fontStyle: "italic",
                      }}
                    >
                      {pedido.observacao}
                    </Text>
                  ) : null}
                </View>

                {/* Status badge */}
                <View
                  style={{
                    backgroundColor: badgeColor + "20",
                    borderRadius: 6,
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    flexShrink: 1,
                    maxWidth: 160,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 10,
                      color: badgeColor,
                    }}
                    numberOfLines={1}
                  >
                    {badgeLabel}
                  </Text>
                </View>

                {/* Action button — only for pendente and em_preparo */}
                {isPendente && (
                  <AnimatedPressable
                    onPress={() => {
                      console.log("[Cozinha] Iniciar pressed:", pedido.id);
                      handlePedidoAction(pedido.id, "em_preparo", false);
                    }}
                    disabled={isUpdating}
                    style={{
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      minWidth: 72,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 4,
                      borderWidth: 1.5,
                      borderColor: "#F59E0B",
                      backgroundColor: "transparent",
                    }}
                  >
                    {isUpdating ? (
                      <ActivityIndicator color="#F59E0B" size="small" />
                    ) : (
                      <>
                        <Play size={11} color="#F59E0B" fill="#F59E0B" />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#F59E0B" }}>
                          Iniciar
                        </Text>
                      </>
                    )}
                  </AnimatedPressable>
                )}

                {isEmPreparo && (
                  <AnimatedPressable
                    onPress={() => {
                      console.log("[Cozinha] Finalizar pressed:", pedido.id);
                      handlePedidoAction(pedido.id, "pronto", true);
                    }}
                    disabled={isUpdating}
                    style={{
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      minWidth: 80,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 4,
                      backgroundColor: "#F59E0B",
                    }}
                  >
                    {isUpdating ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Check size={11} color="#fff" />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#fff" }}>
                          Finalizar
                        </Text>
                      </>
                    )}
                  </AnimatedPressable>
                )}
              </View>
            );
          })}
        </View>

        {/* Footer summary */}
        <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
            {pendentesCount} pendentes · {emPreparoCount} em preparo · {prontoCount} prontos
          </Text>
        </View>

        {/* Undo toast */}
        {undoToast && (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: "#1E293B",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomLeftRadius: 16,
              borderBottomRightRadius: 16,
            }}
          >
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: "#CBD5E1" }}>
              Item marcado como pronto
            </Text>
            <AnimatedPressable
              onPress={handleUndo}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: "#F59E0B20",
                borderWidth: 1,
                borderColor: "#F59E0B",
              }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: "#F59E0B" }}>
                Desfazer
              </Text>
            </AnimatedPressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function ComandaCard({ item, index }: { item: Comanda; index: number }) {
  const COLORS = useColors();
  const [expanded, setExpanded] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const handleToggle = () => {
    console.log("[Cozinha] ComandaCard toggled:", item.id, "expanded:", !expanded);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  const comandaCode = item.id.slice(-6).toUpperCase();
  const comandaLabel = "#" + comandaCode;

  const createdDate = new Date(item.created_at);
  const hours = String(createdDate.getHours()).padStart(2, "0");
  const minutes = String(createdDate.getMinutes()).padStart(2, "0");
  const timeLabel = hours + ":" + minutes;

  const totalItens = String(item.total_itens);

  const comandaStatusColor = COMANDA_STATUS_COLORS[item.status] || "#94A3B8";
  const comandaStatusLabel = COMANDA_STATUS_LABELS[item.status] || item.status;

  const pedidos: ComandaPedido[] = Array.isArray(item.pedidos) ? item.pedidos : [];

  const deliveryItem = isDelivery(item);
  const balcaoItem = isBalcao(item);

  const garcomOrCliente = deliveryItem
    ? (item.entrega_cliente_nome ?? "") + (item.entrega_bairro ? ` · ${item.entrega_bairro}` : "")
    : item.garcom_nome;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: COLORS.border,
          overflow: "hidden",
        }}
      >
        <TouchableOpacity activeOpacity={0.7} onPress={handleToggle}>
          <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
            {/* Icon / Mesa circle */}
            {deliveryItem ? (
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Bike size={22} color="#7C3AED" />
              </View>
            ) : balcaoItem ? (
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ShoppingBag size={22} color="#2563EB" />
              </View>
            ) : (
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.primary }}>
                  {String(item.mesa_numero)}
                </Text>
              </View>
            )}

            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>
                    {comandaLabel}
                  </Text>
                  {deliveryItem && (
                    <View style={{ backgroundColor: "#EDE9FE", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                      <Text style={{ color: "#7C3AED", fontSize: 10, fontWeight: "700" }}>DELIVERY</Text>
                    </View>
                  )}
                  {balcaoItem && (
                    <View style={{ backgroundColor: "#DBEAFE", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                      <Text style={{ color: "#2563EB", fontSize: 10, fontWeight: "700" }}>BALCÃO</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      backgroundColor: comandaStatusColor + "20",
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: comandaStatusColor }}>
                      {comandaStatusLabel}
                    </Text>
                  </View>
                  {expanded ? (
                    <ChevronUp size={16} color={COLORS.textSecondary} />
                  ) : (
                    <ChevronDown size={16} color={COLORS.textSecondary} />
                  )}
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <User size={12} color={COLORS.textSecondary} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  {garcomOrCliente}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  marginTop: 6,
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.divider,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Clock size={12} color={COLORS.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    {timeLabel}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Package size={12} color={COLORS.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    {totalItens}
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    itens
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {expanded && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.divider,
              paddingHorizontal: 14,
              paddingVertical: 10,
              gap: 8,
            }}
          >
            {pedidos.length === 0 ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, textAlign: "center", paddingVertical: 8 }}>
                Sem pedidos
              </Text>
            ) : (
              pedidos.map((pedido) => {
                const pedidoStatusColor = STATUS_COLORS[pedido.status] || "#94A3B8";
                const pedidoStatusLabel = STATUS_LABELS[pedido.status] || pedido.status;
                return (
                  <View
                    key={pedido.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.divider,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        backgroundColor: COLORS.primaryMuted,
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: COLORS.primary }}>
                        {pedido.quantidade}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 13, color: COLORS.text, flex: 1 }}>
                      {pedido.prato_nome}
                    </Text>
                    <View
                      style={{
                        backgroundColor: pedidoStatusColor + "20",
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: pedidoStatusColor }}>
                        {pedidoStatusLabel}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export default function CozinhaScreen() {
  useKeepAwake();

  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user: authUser } = useAuth();

  const [activeTab, setActiveTab] = useState<"fila" | "comandas">("fila");

  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [comandasLoading, setComandasLoading] = useState(true);
  const [comandasRefreshing, setComandasRefreshing] = useState(false);
  const [comandasError, setComandasError] = useState("");
  const [comandaFilter, setComandaFilter] = useState<ComandaFilter>("todas");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "mesas" | "delivery">("todos");

  const fetchComandas = useCallback(async () => {
    console.log("[Cozinha] Fetching comandas from /api/cozinha/comandas");
    try {
      const res = await apiGet<{ comandas: Comanda[] }>("/api/cozinha/comandas");
      const list: Comanda[] = Array.isArray(res) ? res : (res.comandas || []);
      console.log("[Cozinha] Loaded", list.length, "comandas");
      setComandas(list);
      setComandasError("");
    } catch (e: any) {
      console.error("[Cozinha] Comandas error:", e instanceof Error ? e.message : String(e));
      setComandasError("Não foi possível carregar as comandas.");
    } finally {
      setComandasLoading(false);
      setComandasRefreshing(false);
    }
  }, []);

  // Aviso de item cancelado
  const [avisoCancelamento, setAvisoCancelamento] = useState<{ texto: string; aposInicio: boolean } | null>(null);
  const avisoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Aviso de delivery completo (apenas para cozinheiro)
  const [avisoDeliveryCompleto, setAvisoDeliveryCompleto] = useState<string | null>(null);
  const avisoDeliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRealtimeEvent = useCallback((event?: RealtimeEvent) => {
    if (event?.type === "pedido.status_changed" && event.payload?.status === "cancelado") {
      const msg = textoAvisoCancelamento(
        event.payload?.comanda_tipo,
        event.payload?.entrega_cliente_nome,
        event.payload?.mesa_numero,
        event.payload?.prato_nome
      );
      const aposInicio = event.payload.cancelado_apos_inicio === true;
      setAvisoCancelamento({
        texto: msg + (aposInicio ? " Pare o preparo." : ""),
        aposInicio,
      });
      if (avisoTimerRef.current) clearTimeout(avisoTimerRef.current);
      avisoTimerRef.current = setTimeout(() => setAvisoCancelamento(null), 15000);
    }

    if (event?.type === "delivery.cancelado") {
      const nome = event.payload?.cliente_nome ?? "";
      const houveItemIniciado = event.payload?.houve_item_iniciado === true;
      console.log("[Cozinha] delivery.cancelado event — cliente:", nome, "houveItemIniciado:", houveItemIniciado);
      if (houveItemIniciado) {
        // Alerta vermelho — pare o preparo
        setAvisoCancelamento({ texto: `Delivery (${nome}) foi cancelado. Pare o preparo.`, aposInicio: true });
        if (avisoTimerRef.current) clearTimeout(avisoTimerRef.current);
        avisoTimerRef.current = setTimeout(() => setAvisoCancelamento(null), 15000);
      } else {
        // Alerta âmbar — sem ordem de parar
        setAvisoCancelamento({ texto: `Delivery (${nome}) foi cancelado.`, aposInicio: false });
        if (avisoTimerRef.current) clearTimeout(avisoTimerRef.current);
        avisoTimerRef.current = setTimeout(() => setAvisoCancelamento(null), 10000);
      }
      setTimeout(() => fetchComandas(), 300);
      return;
    }

    if (event?.type === "delivery.pronto") {
      setTimeout(() => fetchComandas(), 300);
      return;
    }

    if (event?.type === "delivery.criado" || event?.type === "delivery.status_changed") {
      setTimeout(() => fetchComandas(), 300);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      console.log("[Cozinha] Realtime event — refreshing comandas");
      fetchComandas();
    }, 300);
  }, [fetchComandas, authUser?.role, router]);

  const realtimeStatus = useRealtime({
    onEvent: handleRealtimeEvent,
  });

  useEffect(() => {
    fetchComandas();
  }, [fetchComandas]);

  useEffect(() => {
    if (realtimeStatus === "connected") return;
    const interval = setInterval(() => {
      console.log("[Cozinha] Fallback poll (30s) — realtime disconnected");
      fetchComandas();
    }, 30000);
    return () => clearInterval(interval);
  }, [realtimeStatus, fetchComandas]);

  const prevStatusRef = useRef<RealtimeStatus>(realtimeStatus);
  useEffect(() => {
    if (prevStatusRef.current !== "connected" && realtimeStatus === "connected") {
      console.log("[Cozinha] Realtime reconnected — refetching");
      fetchComandas();
    }
    prevStatusRef.current = realtimeStatus;
  }, [realtimeStatus, fetchComandas]);

  const handleRefresh = () => {
    console.log("[Cozinha] Manual refresh - tab:", activeTab);
    setComandasRefreshing(true);
    fetchComandas();
  };

  const handleAction = async (id: string, status: string) => {
    console.log("[Cozinha] PUT /api/pedidos/" + id + "/status ->", status);
    try {
      await apiPut(`/api/pedidos/${id}/status`, { status });
      console.log("[Cozinha] Status updated, refreshing comandas");
      await fetchComandas();

      // Se marcou como pronto, verificar se todos os itens ativos da comanda estão prontos
      if (status === "pronto") {
        const role = (authUser?.role || "").toLowerCase();
        const isCozinheiro = role === "cozinheiro" || role === "kitchen";
        if (isCozinheiro) {
          // Encontrar a comanda que contém este pedido
          const comanda = comandas.find((c) =>
            (Array.isArray(c.pedidos) ? c.pedidos : []).some((p) => p.id === id)
          );
          if (comanda && isDelivery(comanda)) {
            const pedidosAtivos = (Array.isArray(comanda.pedidos) ? comanda.pedidos : []).filter(
              (p) => p.status === "pendente" || p.status === "em_preparo"
            );
            // Após o fetch, o pedido marcado como pronto não deve mais estar em pendente/em_preparo
            // Se não há mais ativos, todos estão prontos
            if (pedidosAtivos.length === 0) {
              const nomeCliente = comanda.entrega_cliente_nome ?? "";
              const avisoText = nomeCliente
                ? `Delivery de ${nomeCliente} completo. Atendente avisado.`
                : "Delivery completo. Atendente avisado.";
              console.log("[Cozinha] Delivery completo:", avisoText);
              setAvisoDeliveryCompleto(avisoText);
              if (avisoDeliveryTimerRef.current) clearTimeout(avisoDeliveryTimerRef.current);
              avisoDeliveryTimerRef.current = setTimeout(() => setAvisoDeliveryCompleto(null), 5000);
            }
          }
        }
      }
    } catch (e: any) {
      console.error("[Cozinha] Status update error:", e);
      const msg = e?.body?.error || e?.message || "Erro ao atualizar status";
      Alert.alert("Erro", msg);
    }
  };

  const handleTabPress = (tab: "fila" | "comandas") => {
    console.log("[Cozinha] Tab switched to:", tab);
    setActiveTab(tab);
  };

  const handleFilterPress = (filter: ComandaFilter) => {
    console.log("[Cozinha] Comanda filter changed to:", filter);
    setComandaFilter(filter);
  };

  const getOldestActivePedidoTime = (c: Comanda): number => {
    const active = (Array.isArray(c.pedidos) ? c.pedidos : []).filter(
      (p) => p.status === "pendente" || p.status === "em_preparo"
    );
    if (active.length === 0) return new Date(c.created_at).getTime();
    return active.reduce(
      (oldest, p) => Math.min(oldest, new Date(p.created_at).getTime()),
      Infinity
    );
  };

  // Comandas ativas (não canceladas) para contagens e fila
  const comandasAtivas = comandas.filter(c => c.status !== "cancelada" && c.status !== "cancelado");

  const deliveryCount = comandasAtivas.filter(c => isDelivery(c)).length;

  const filaComandas = comandasAtivas
    .filter((c) =>
      (Array.isArray(c.pedidos) ? c.pedidos : []).some(
        (p) => p.status === "pendente" || p.status === "em_preparo"
      )
    )
    .filter(c => {
      if (filtroTipo === "mesas") return !isDelivery(c) && !isBalcao(c);
      if (filtroTipo === "delivery") return isDelivery(c);
      return true;
    })
    .sort((a, b) => {
      const aHasUrgent = (Array.isArray(a.pedidos) ? a.pedidos : []).some(
        (p) => getPedidoUrgencia(p).isUrgent
      );
      const bHasUrgent = (Array.isArray(b.pedidos) ? b.pedidos : []).some(
        (p) => getPedidoUrgencia(p).isUrgent
      );
      if (aHasUrgent && !bHasUrgent) return -1;
      if (!aHasUrgent && bHasUrgent) return 1;
      return getOldestActivePedidoTime(a) - getOldestActivePedidoTime(b);
    });

  const filteredComandas = comandas
    .filter((c) => {
      const targetStatus = COMANDA_FILTER_STATUS[comandaFilter];
      if (targetStatus === null) return true;
      return c.status === targetStatus;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Header subtitle counts across all active (non-cancelled) comandas
  const allActivePedidos = comandasAtivas.flatMap((c) =>
    (Array.isArray(c.pedidos) ? c.pedidos : []).filter((p) =>
      p.status === "pendente" || p.status === "em_preparo"
    )
  );
  const pendingCount = allActivePedidos.filter((p) => p.status === "pendente").length;
  const inProgressCount = allActivePedidos.filter((p) => p.status === "em_preparo").length;

  const pendingCountStr = String(pendingCount);
  const inProgressCountStr = String(inProgressCount);

  const deliveryLabel = deliveryCount > 0 ? ` · ${deliveryCount} delivery` : "";

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 14,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flame size={22} color={COLORS.primary} />
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
                Cozinha
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                  {pendingCountStr} pendentes · {inProgressCountStr} em preparo
                </Text>
                {deliveryCount > 0 && (
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: "#8B5CF6", fontWeight: "600" }}>
                    {deliveryLabel}
                  </Text>
                )}
              </View>
              {realtimeStatus === "connected" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: "#22C55E" }}>Tempo real</Text>
                </View>
              ) : realtimeStatus === "connecting" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: "#F59E0B" }}>Reconectando…</Text>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.textSecondary }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>Reconectando…</Text>
                </View>
              )}
            </View>
          </View>
          <AnimatedPressable
            onPress={handleRefresh}
            accessibilityLabel="Atualizar"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: COLORS.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RefreshCw size={18} color={COLORS.textSecondary} />
          </AnimatedPressable>
        </View>

        {/* Toggle */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            padding: 3,
          }}
        >
          <AnimatedPressable
            onPress={() => handleTabPress("fila")}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: activeTab === "fila" ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 14,
                color: activeTab === "fila" ? "#fff" : COLORS.textSecondary,
              }}
            >
              Fila
            </Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => handleTabPress("comandas")}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: activeTab === "comandas" ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 14,
                color: activeTab === "comandas" ? "#fff" : COLORS.textSecondary,
              }}
            >
              Comandas
            </Text>
          </AnimatedPressable>
        </View>

        {/* Fila: tipo filter pills */}
        {activeTab === "fila" && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {(["todos", "mesas", "delivery"] as const).map(key => {
              const isActive = filtroTipo === key;
              const label = key === "todos" ? "Todos" : key === "mesas" ? "Mesas" : `Delivery${deliveryCount > 0 ? ` (${deliveryCount})` : ""}`;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    console.log("[Cozinha] Filtro tipo changed to:", key);
                    setFiltroTipo(key);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    backgroundColor: isActive ? COLORS.primary : COLORS.surfaceSecondary,
                    borderWidth: 1,
                    borderColor: isActive ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Text style={{ color: isActive ? "#fff" : COLORS.text, fontSize: 13, fontWeight: "600" }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Comanda status filter pills */}
        {activeTab === "comandas" && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 0 }}
          >
            {COMANDA_FILTERS.map((f) => {
              const isActive = comandaFilter === f.key;
              return (
                <AnimatedPressable
                  key={f.key}
                  onPress={() => handleFilterPress(f.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 20,
                    backgroundColor: isActive ? COLORS.primary : COLORS.surfaceSecondary,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 13,
                      color: isActive ? "#fff" : COLORS.textSecondary,
                    }}
                  >
                    {f.label}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Fila view */}
      {activeTab === "fila" && (
        <>
          {comandasLoading ? (
            <View style={{ paddingTop: 16 }}>
              {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
            </View>
          ) : comandasError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Erro ao carregar fila
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                {comandasError}
              </Text>
              <AnimatedPressable
                onPress={fetchComandas}
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                  Tentar novamente
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <FlatList
              data={filaComandas}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
              contentInsetAdjustmentBehavior="automatic"
              refreshControl={
                <RefreshControl refreshing={comandasRefreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
              }
              renderItem={({ item, index }) => (
                <KitchenTicketCard item={item} index={index} onAction={handleAction} />
              )}
              ListEmptyComponent={
                <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChefHat size={32} color={COLORS.primary} />
                  </View>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                    Fila vazia
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Nenhum item aguardando preparo
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Comandas view */}
      {activeTab === "comandas" && (
        <>
          {comandasLoading ? (
            <View style={{ paddingTop: 16 }}>
              {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
            </View>
          ) : comandasError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Erro ao carregar comandas
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                {comandasError}
              </Text>
              <AnimatedPressable
                onPress={fetchComandas}
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                  Tentar novamente
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <FlatList
              data={filteredComandas}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
              contentInsetAdjustmentBehavior="automatic"
              refreshControl={
                <RefreshControl refreshing={comandasRefreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
              }
              renderItem={({ item, index }) => (
                <ComandaCard item={item} index={index} />
              )}
              ListEmptyComponent={
                <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChefHat size={32} color={COLORS.primary} />
                  </View>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                    Nenhuma comanda
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Não há comandas abertas no momento
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Aviso de item cancelado */}
      {avisoCancelamento ? (
        <Pressable
          onPress={() => setAvisoCancelamento(null)}
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 12,
            right: 12,
            zIndex: 50,
            elevation: 8,
            backgroundColor: avisoCancelamento.aposInicio ? "#DC2626" : "#F59E0B",
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "#fff" }}>Item cancelado</Text>
          <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 14, color: "#fff", marginTop: 2 }}>
            {avisoCancelamento.texto}
          </Text>
        </Pressable>
      ) : null}

      {/* Aviso de delivery completo (cozinheiro) */}
      {avisoDeliveryCompleto ? (
        <Pressable
          onPress={() => setAvisoDeliveryCompleto(null)}
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 12,
            right: 12,
            zIndex: 200,
            elevation: 10,
            backgroundColor: "#22C55E",
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "#fff" }}>Delivery pronto</Text>
          <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 14, color: "#fff", marginTop: 2 }}>
            {avisoDeliveryCompleto}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
