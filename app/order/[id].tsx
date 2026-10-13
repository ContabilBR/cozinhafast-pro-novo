import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { StatusBadge } from "@/components/StatusBadge";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { Order, OrderItem, Dish, ItemStatus } from "@/types";
import { apiGet, apiPost, apiPut } from "@/utils/api";
import { formatCurrency, formatRelativeTime, getItemStatusLabel } from "@/utils/helpers";
import { Plus, Users, Clock, FileText, Trash2, X, UtensilsCrossed } from "lucide-react-native";
import { COLORS as C } from "@/constants/Colors";
import type { ImageSourcePropType } from "react-native";

const ITEM_STATUS_COLORS: Record<ItemStatus, string> = {
  pendente: C.statusPendente,
  recebido: C.statusRecebido,
  em_preparo: C.statusEmPreparo,
  pronto: C.statusPronto,
  entregue: C.statusEntregue,
  cancelado: C.statusCancelado,
};

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

export default function OrderDetailScreen() {
  const COLORS = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showDishPicker, setShowDishPicker] = useState(false);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [dishesLoading, setDishesLoading] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    console.log("[OrderDetail] GET /api/orders/" + id);
    try {
      const res = await apiGet<any>(`/api/orders/${id}`);
      const orderData: Order = res?.order || res;
      setOrder(orderData);
      setError("");
    } catch (e: any) {
      console.error("[OrderDetail] Erro:", e);
      setError("Não foi possível carregar a comanda.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const handleRefresh = () => {
    console.log("[OrderDetail] Refresh manual");
    setRefreshing(true);
    fetchOrder();
  };

  const handleCloseOrder = async () => {
    if (!order) return;
    const newStatus = order.status === "aberta" ? "fechando" : "fechada";
    console.log("[OrderDetail] Fechar comanda pressionado, novo status:", newStatus);
    setActionLoading(true);
    try {
      console.log("[OrderDetail] PUT /api/orders/" + order.id);
      await apiPut(`/api/orders/${order.id}`, { status: newStatus });
      console.log("[OrderDetail] Status atualizado para:", newStatus);
      await fetchOrder();
    } catch (e) {
      console.error("[OrderDetail] Erro ao fechar comanda:", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddItem = async (dish: Dish) => {
    if (!order) return;
    console.log("[OrderDetail] Adicionar item:", dish.name, "à comanda:", order.id);
    setShowDishPicker(false);
    try {
      console.log("[OrderDetail] POST /api/orders/" + order.id + "/items");
      await apiPost(`/api/orders/${order.id}/items`, { dish_id: dish.id, quantity: 1, unit_price: dish.price });
      console.log("[OrderDetail] Item adicionado com sucesso");
      await fetchOrder();
    } catch (e) {
      console.error("[OrderDetail] Erro ao adicionar item:", e);
    }
  };

  const handleCancelItem = (item: OrderItem) => {
    console.log("[OrderDetail] Cancelar item pressionado:", item.id);
    Alert.alert(
      "Cancelar item?",
      `Deseja cancelar "${item.dish?.name ?? "item"}"?`,
      [
        { text: "Não", style: "cancel" },
        {
          text: "Cancelar item",
          style: "destructive",
          onPress: async () => {
            console.log("[OrderDetail] Confirmar cancelamento item:", item.id);
            try {
              await apiPut(`/api/orders/${order!.id}/items/${item.id}`, { status: "cancelado" });
              await fetchOrder();
            } catch (e) {
              console.error("[OrderDetail] Erro ao cancelar item:", e);
            }
          },
        },
      ]
    );
  };

  const openDishPicker = async () => {
    console.log("[OrderDetail] Abrir seletor de pratos");
    setShowDishPicker(true);
    setDishesLoading(true);
    try {
      const res = await apiGet<any>("/api/dishes?active=true");
      const list: Dish[] = Array.isArray(res) ? res : (res.dishes || []);
      setDishes(list.filter((d) => d.active));
    } catch (e) {
      console.error("[OrderDetail] Erro ao carregar pratos:", e);
    } finally {
      setDishesLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <TouchableOpacity onPress={() => { console.log("[OrderDetail] Botão voltar pressionado (loading)"); router.back(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
          </TouchableOpacity>
          <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text }}>Detalhes da Comanda</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: COLORS.background, padding: 20, gap: 16 }}>
          <SkeletonLine width="60%" height={24} />
          <SkeletonLine width="40%" height={16} />
          <SkeletonLine width="100%" height={80} borderRadius={12} />
          <SkeletonLine width="100%" height={80} borderRadius={12} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <TouchableOpacity onPress={() => { console.log("[OrderDetail] Botão voltar pressionado (erro)"); router.back(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
          </TouchableOpacity>
          <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text }}>Detalhes da Comanda</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12, backgroundColor: COLORS.background }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Erro ao carregar comanda</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>{error}</Text>
          <AnimatedPressable onPress={fetchOrder} style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  const tableNum = order.table?.number ?? "?";
  const waiter = order.waiter?.name ?? "—";
  const timeOpen = formatRelativeTime(order.opened_at);
  const total = formatCurrency(order.total_amount);
  const activeItems = order.items?.filter((i) => i.status !== "cancelado") ?? [];
  const canAddItems = order.status === "aberta";
  const canClose = order.status === "aberta" || order.status === "fechando";
  const closeLabel = order.status === "aberta" ? "Fechar Comanda" : "Confirmar Fechamento";
  const navTitle = `Order Details`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
        <TouchableOpacity
          onPress={() => { console.log("[OrderDetail] Botão voltar pressionado"); router.back(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}
        >
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
          <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
        </TouchableOpacity>
        <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text }}>
          {navTitle}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
      >
        {/* Order header card */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text }}>Mesa {tableNum}</Text>
            <StatusBadge status={order.status} type="order" />
          </View>

          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Clock size={14} color={COLORS.textSecondary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>{timeOpen}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Users size={14} color={COLORS.textSecondary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>{order.customer_count} pessoas</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <FileText size={14} color={COLORS.textSecondary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>{waiter}</Text>
            </View>
          </View>

          {order.notes && (
            <View style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 10, padding: 10 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, fontStyle: "italic" }}>Obs: {order.notes}</Text>
            </View>
          )}
        </View>

        {/* Items section */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text }}>Itens ({activeItems.length})</Text>
            {canAddItems && (
              <AnimatedPressable
                onPress={() => { console.log("[OrderDetail] Adicionar item pressionado"); openDishPicker(); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.primaryMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
              >
                <Plus size={16} color={COLORS.primary} />
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>Adicionar</Text>
              </AnimatedPressable>
            )}
          </View>

          {activeItems.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Nenhum item na comanda</Text>
            </View>
          ) : (
            activeItems.map((item) => {
              const statusColor = ITEM_STATUS_COLORS[item.status] || COLORS.textSecondary;
              const dishName = item.dish?.name ?? "Prato";
              const unitPrice = formatCurrency(item.unit_price);
              const subtotal = formatCurrency(Number(item.unit_price) * item.quantity);
              const statusLabel = getItemStatusLabel(item.status);
              const isCancelled = item.status === "cancelado";

              return (
                <View key={item.id} style={{ backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: 12, opacity: isCancelled ? 0.5 : 1 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>{item.quantity}x</Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{dishName}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ backgroundColor: statusColor + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: statusColor }}>{statusLabel}</Text>
                      </View>
                      {item.notes && (
                        <Text numberOfLines={1} style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, fontStyle: "italic", flex: 1 }}>{item.notes}</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.text }}>{subtotal}</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>{unitPrice} un.</Text>
                    {canAddItems && !isCancelled && (
                      <AnimatedPressable onPress={() => { console.log("[OrderDetail] Cancelar item pressionado:", item.id); handleCancelItem(item); }} style={{ padding: 4 }}>
                        <Trash2 size={14} color={COLORS.danger} />
                      </AnimatedPressable>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Total */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.textSecondary }}>Total</Text>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 24, color: COLORS.text, letterSpacing: -0.3 }}>{total}</Text>
        </View>

        {canClose && (
          <AnimatedPressable
            onPress={() => { console.log("[OrderDetail] Fechar/confirmar comanda pressionado"); handleCloseOrder(); }}
            disabled={actionLoading}
            style={{ backgroundColor: order.status === "aberta" ? COLORS.warning : COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
          >
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>{closeLabel}</Text>}
          </AnimatedPressable>
        )}
      </ScrollView>

      {/* Dish picker modal */}
      {showDishPicker && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "75%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text }}>Adicionar Item</Text>
              <AnimatedPressable
                onPress={() => { console.log("[OrderDetail] Seletor de pratos fechado"); setShowDishPicker(false); }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}
              >
                <X size={16} color={COLORS.textSecondary} />
              </AnimatedPressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
              {dishesLoading ? (
                <View style={{ gap: 10, paddingTop: 8 }}>
                  {[0, 1, 2].map((i) => <View key={i} style={{ height: 72, backgroundColor: COLORS.surfaceSecondary, borderRadius: 12 }} />)}
                </View>
              ) : dishes.length === 0 ? (
                <View style={{ alignItems: "center", padding: 32, gap: 12 }}>
                  <UtensilsCrossed size={32} color={COLORS.textTertiary} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Nenhum prato disponível</Text>
                </View>
              ) : (
                dishes.map((dish) => {
                  const price = formatCurrency(dish.price);
                  const imageSource = resolveImageSource(dish.image_url);
                  return (
                    <AnimatedPressable
                      key={dish.id}
                      onPress={() => { console.log("[OrderDetail] Prato selecionado:", dish.name); handleAddItem(dish); }}
                      style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}
                    >
                      <View style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: COLORS.border, overflow: "hidden" }}>
                        {dish.image_url ? (
                          <Image source={imageSource} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={200} />
                        ) : (
                          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                            <UtensilsCrossed size={20} color={COLORS.textTertiary} />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{dish.name}</Text>
                        {dish.category && <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>{dish.category.name}</Text>}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Clock size={11} color={COLORS.textSecondary} />
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>{dish.prep_time_minutes}min</Text>
                        </View>
                      </View>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.primary }}>{price}</Text>
                    </AnimatedPressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
