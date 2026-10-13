import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { Pedido, PedidoStatus } from "@/types";
import { apiGet, apiPatch } from "@/utils/api";
import { formatDate, formatCurrency, getPedidoStatusLabel, getPedidoStatusColor, isAdmin } from "@/utils/helpers";
import { CheckCircle, Clock } from "lucide-react-native";

const STATUS_TIMELINE: PedidoStatus[] = ["pendente", "recebido", "em_preparacao", "pronto", "entregue"];

export default function PedidoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const role = (user as any)?.role;
  const canAdmin = isAdmin(role);

  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchPedido = useCallback(async () => {
    console.log("[PedidoDetail] GET /api/pedidos/" + id);
    try {
      const res = await apiGet<any>(`/api/pedidos/${id}`);
      const p: Pedido = res.pedido || res;
      setPedido(p);
      setError("");
    } catch (e: any) {
      console.error("[PedidoDetail] Erro:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar o pedido.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { fetchPedido(); }, [fetchPedido]);

  const handleRefresh = () => {
    console.log("[PedidoDetail] Refresh manual");
    setRefreshing(true);
    fetchPedido();
  };

  const handleStatusUpdate = async (status: PedidoStatus) => {
    console.log("[PedidoDetail] Atualizar status:", id, "->", status);
    setUpdating(true);
    try {
      console.log("[PedidoDetail] PATCH /api/pedidos/" + id + "/status");
      await apiPatch(`/api/pedidos/${id}/status`, { status });
      console.log("[PedidoDetail] Status atualizado");
      await fetchPedido();
    } catch (e: any) {
      console.error("[PedidoDetail] Erro ao atualizar status:", e);
    } finally {
      setUpdating(false);
    }
  };

  const statusColor = getPedidoStatusColor(pedido?.status ?? "pendente");
  const statusLabel = getPedidoStatusLabel(pedido?.status ?? "pendente");
  const mesaNum = pedido?.mesa_numero ?? pedido?.mesa?.numero ?? "?";
  const garcomName = pedido?.garcom?.name ?? "—";
  const navTitle = `Detalhes do Pedido`;

  const currentStatusIndex = STATUS_TIMELINE.indexOf(pedido?.status as PedidoStatus);

  const ADMIN_STATUSES: { status: PedidoStatus; label: string }[] = [
    { status: "recebido", label: "Recebido" },
    { status: "em_preparacao", label: "Em Preparo" },
    { status: "pronto", label: "Pronto" },
    { status: "entregue", label: "Entregue" },
    { status: "cancelado", label: "Cancelado" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        height: 56,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.surface,
      }}>
        <Pressable
          onPress={() => { console.log("[PedidoDetail] Botão voltar pressionado"); router.back(); }}
          style={{ flexDirection: "row", alignItems: "center", padding: 8, zIndex: 10 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color="#22c55e" />
          <Text style={{ color: "#22c55e", marginLeft: 6, fontSize: 16, fontWeight: "500" }}>Voltar</Text>
        </Pressable>
        <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: "#111" }}>
          {navTitle}
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Erro ao carregar pedido</Text>
          <AnimatedPressable
            onPress={fetchPedido}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        >
          {/* Info card */}
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>Mesa {mesaNum}</Text>
              <View style={{ backgroundColor: statusColor + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: statusColor }}>{statusLabel}</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>Garçom</Text>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>{garcomName}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>Enviado em</Text>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>{formatDate(pedido?.sent_at)}</Text>
              </View>
            </View>
          </View>

          {/* Timeline */}
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>Linha do tempo</Text>
            {STATUS_TIMELINE.map((s, i) => {
              const isDone = i <= currentStatusIndex;
              const isCurrent = i === currentStatusIndex;
              const color = isDone ? getPedidoStatusColor(s) : COLORS.textTertiary;
              const timestamps: Record<string, string | undefined> = {
                pendente: pedido?.sent_at,
                recebido: pedido?.received_at,
                em_preparacao: pedido?.started_at,
                pronto: pedido?.ready_at,
                entregue: pedido?.delivered_at,
              };
              const ts = timestamps[s];
              return (
                <View key={s} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <View style={{ alignItems: "center", gap: 4 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: isDone ? color : COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                      {isDone && <CheckCircle size={12} color="#fff" />}
                    </View>
                    {i < STATUS_TIMELINE.length - 1 && (
                      <View style={{ width: 2, height: 20, backgroundColor: isDone ? color + "40" : COLORS.border }} />
                    )}
                  </View>
                  <View style={{ flex: 1, paddingTop: 1 }}>
                    <Text style={{ fontFamily: isCurrent ? "Outfit_700Bold" : "Outfit_400Regular", fontSize: 13, color: isDone ? COLORS.text : COLORS.textTertiary }}>
                      {getPedidoStatusLabel(s)}
                    </Text>
                    {ts && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Clock size={11} color={COLORS.textSecondary} />
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>{formatDate(ts)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Itens */}
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>Itens ({pedido?.itens?.length ?? 0})</Text>
            {pedido?.itens?.map((item) => (
              <View key={item.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 12, color: COLORS.primary }}>{item.quantidade}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{item.prato?.nome ?? "Prato"}</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>{formatCurrency(item.preco_unitario)} cada</Text>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: COLORS.text }}>{formatCurrency(item.preco_unitario * item.quantidade)}</Text>
                  </View>
                  {item.observacoes ? (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, fontStyle: "italic" }}>{item.observacoes}</Text>
                  ) : null}
                </View>
              </View>
            ))}
            {pedido?.observacoes ? (
              <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.divider }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, fontStyle: "italic" }}>Obs: {pedido.observacoes}</Text>
              </View>
            ) : null}
          </View>

          {/* Actions */}
          {pedido?.status === "pronto" && role === "garcom" && (
            <AnimatedPressable
              onPress={() => { console.log("[PedidoDetail] Marcar como entregue pressionado"); handleStatusUpdate("entregue"); }}
              disabled={updating}
              style={{ backgroundColor: COLORS.success, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {updating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CheckCircle size={20} color="#fff" />
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Marcar como entregue</Text>
                </>
              )}
            </AnimatedPressable>
          )}

          {canAdmin && pedido?.status !== "entregue" && pedido?.status !== "cancelado" && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Atualizar status</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {ADMIN_STATUSES.filter((s) => s.status !== pedido?.status).map((s) => {
                  const sc = getPedidoStatusColor(s.status);
                  return (
                    <AnimatedPressable
                      key={s.status}
                      onPress={() => { console.log("[PedidoDetail] Status selecionado:", s.status); handleStatusUpdate(s.status); }}
                      disabled={updating}
                      style={{ backgroundColor: sc + "20", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: sc + "40" }}
                    >
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: sc }}>{s.label}</Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
