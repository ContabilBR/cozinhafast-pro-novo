import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, FlatList, RefreshControl, Animated, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/contexts/AuthContext";

interface Entrega {
  entrega: {
    id: string;
    cliente_nome: string;
    cliente_telefone: string;
    endereco: string;
    bairro?: string;
    status: string;
    etapa: string;
    taxa_entrega: string;
    created_at: string;
  };
  comanda: { id: string; total: string; subtotal: string; status?: string };
  itens: Array<{ id: string; status: string; prato_nome?: string; quantidade: number }>;
  itens_ativos: number;
  itens_prontos: number;
  pronto_para_despachar: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pendente: { label: "Pendente", bg: "#FEE2E2", text: "#991B1B" },
  preparando: { label: "Preparando", bg: "#FEF3C7", text: "#92400E" },
  pronto_para_despachar: { label: "Pronto para despachar", bg: "#D1FAE5", text: "#065F46" },
  saiu_entrega: { label: "Saiu entrega", bg: "#DBEAFE", text: "#1E40AF" },
  entregue: { label: "Entregue", bg: "#D1FAE5", text: "#065F46" },
  cancelada: { label: "Cancelada", bg: "#F3F4F6", text: "#6B7280" },
};

function DeliveryCard({ item, onPress, index }: { item: Entrega; onPress: () => void; index: number }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const e = item.entrega;
  const etapa = e.etapa || e.status;
  const statusCfg = STATUS_CONFIG[etapa] || STATUS_CONFIG[e.status] || STATUS_CONFIG.pendente;
  const total = parseFloat(item.comanda?.total || "0");

  const isProntoParaDespachar = etapa === "pronto_para_despachar";
  const showProgress = !isProntoParaDespachar && item.itens_ativos > 0 && e.status !== "saiu_entrega" && e.status !== "entregue" && e.status !== "cancelada";

  const checkLabel = "✓ Pronto para despachar";

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AnimatedPressable onPress={onPress} style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{e.cliente_nome}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3 }} numberOfLines={1}>
              <Ionicons name="location-outline" size={12} />
              {" "}
              {e.endereco}
              {e.bairro ? " - " + e.bairro : ""}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <View style={{ backgroundColor: statusCfg.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: statusCfg.text }}>
                {isProntoParaDespachar ? checkLabel : statusCfg.label}
              </Text>
            </View>
            {showProgress && (
              <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>
                {item.itens_prontos}
                {" de "}
                {item.itens_ativos}
                {" itens prontos"}
              </Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
            {item.itens?.length || 0}
            {" "}
            {(item.itens?.length || 0) === 1 ? "item" : "itens"}
            {" • "}
            {formatRelativeTime(e.created_at)}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function DeliveryScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPedidos = useCallback(async () => {
    try {
      // "prontos" and "encerrados" are handled specially
      let path: string;
      if (filtro === "prontos") {
        path = "/api/delivery/pedidos";
      } else if (filtro === "encerrados") {
        path = "/api/delivery/pedidos?status=entregue";
      } else if (filtro) {
        path = "/api/delivery/pedidos?status=" + filtro;
      } else {
        path = "/api/delivery/pedidos";
      }
      console.log("[Delivery] Fetching pedidos:", path, "filtro:", filtro);
      const data = await apiGet<{ pedidos: Entrega[] }>(path);
      console.log("[Delivery] Pedidos received:", data.pedidos?.length ?? 0);
      setPedidos(data.pedidos || []);
      setError(null);
    } catch (err: any) {
      const msg = err?.body?.error || err?.message || "Erro ao carregar pedidos";
      console.error("[Delivery] Erro ao buscar pedidos:", msg, err);
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filtro]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchPedidos(); }, [fetchPedidos]));

  const handleRealtimeEvent = useCallback((event: any) => {
    if (event.type?.startsWith("delivery.")) {
      console.log("[Delivery] Realtime event received:", event.type, "— refreshing list");
      fetchPedidos();
    }
  }, [fetchPedidos]);

  useRealtime({ onEvent: handleRealtimeEvent });

  const filtros = [
    { key: null, label: "Todos" },
    { key: "pendente", label: "Pendente" },
    { key: "preparando", label: "Preparando" },
    { key: "saiu_entrega", label: "Saiu" },
    { key: "prontos", label: "Prontos" },
    { key: "encerrados", label: "Encerrados" },
  ];

  // Apply client-side filters and sorting
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const pedidosExibidos = (() => {
    if (filtro === "prontos") {
      const filtered = pedidos.filter((p) => p.entrega.etapa === "pronto_para_despachar");
      // Prontos: mais antigos primeiro
      return [...filtered].sort((a, b) =>
        new Date(a.entrega.created_at).getTime() - new Date(b.entrega.created_at).getTime()
      );
    }
    if (filtro === "encerrados") {
      return pedidos.filter((p) => {
        const createdAt = new Date(p.entrega.created_at);
        return createdAt >= sevenDaysAgo;
      });
    }
    if (filtro === null) {
      // "Todos" excludes fully closed orders (entregue + comanda fechada)
      const filtered = pedidos.filter((p) => !(p.entrega.status === "entregue" && p.comanda?.status === "fechada"));
      // Sort: prontos para despachar first (oldest first among them), then rest (server order)
      return [...filtered].sort((a, b) => {
        const aPronte = a.pronto_para_despachar ? 1 : 0;
        const bPronte = b.pronto_para_despachar ? 1 : 0;
        if (aPronte !== bPronte) return bPronte - aPronte;
        if (a.pronto_para_despachar) {
          return new Date(a.entrega.created_at).getTime() - new Date(b.entrega.created_at).getTime();
        }
        return 0;
      });
    }
    return pedidos;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Delivery</Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
              {pedidosExibidos.length}
              {" pedido"}
              {pedidosExibidos.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => { console.log("[Delivery] Novo pedido button pressed"); router.push("/delivery/novo"); }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={{ color: "white", fontSize: 14, fontWeight: "600" }}>Novo</Text>
          </Pressable>
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={filtros}
          keyExtractor={(item) => item.key || "todos"}
          style={{ marginTop: 12 }}
          renderItem={({ item: f }) => (
            <Pressable
              onPress={() => { console.log("[Delivery] Filter selected:", f.key ?? "todos"); setFiltro(f.key); }}
              style={{ backgroundColor: filtro === f.key ? COLORS.primary : COLORS.primaryMuted, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginRight: 8 }}
            >
              <Text style={{ fontSize: 13, fontWeight: "500", color: filtro === f.key ? "white" : COLORS.primary }}>{f.label}</Text>
            </Pressable>
          )}
        />
      </View>
      {loading ? (
        <View style={{ padding: 16 }}><CardSkeleton /><CardSkeleton /><CardSkeleton /></View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
          <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text, textAlign: "center" }}>Erro ao carregar pedidos</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: "center" }}>{error}</Text>
          <Pressable
            onPress={() => { console.log("[Delivery] Retry button pressed"); setLoading(true); fetchPedidos(); }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={pedidosExibidos}
          keyExtractor={(item) => item.entrega.id}
          contentContainerStyle={{ padding: 16, paddingBottom: listPaddingBottom }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { console.log("[Delivery] Pull-to-refresh triggered"); setRefreshing(true); fetchPedidos(); }}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item, index }) => (
            <DeliveryCard
              item={item}
              index={index}
              onPress={() => { console.log("[Delivery] Card pressed, id:", item.entrega.id); router.push(("/delivery/" + item.entrega.id) as any); }}
            />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Ionicons name="bicycle-outline" size={48} color={COLORS.textTertiary} />
              <Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>Nenhum pedido delivery</Text>
              <Text style={{ fontSize: 13, color: COLORS.textTertiary, marginTop: 4 }}>Toque em "Novo" para criar</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
