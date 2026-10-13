import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { StatusBadge } from "@/components/StatusBadge";
import { Order } from "@/types";
import { apiGet } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";
import { History, Clock, Users, ShoppingBag } from "lucide-react-native";

function HistoryCard({ order, index }: { order: Order; index: number }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 50, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const tableNum = order.table?.number ?? "?";
  const waiter = order.waiter?.name ?? "—";
  const total = formatCurrency(order.total_amount);
  const openedAt = formatRelativeTime(order.opened_at);
  const closedAt = order.closed_at ? formatRelativeTime(order.closed_at) : "—";
  const itemCount = order.items?.length ?? 0;

  // Duration
  let duration = "—";
  if (order.opened_at && order.closed_at) {
    const diffMs = new Date(order.closed_at).getTime() - new Date(order.opened_at).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    duration = diffMin < 60 ? `${diffMin} min` : `${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;
  }

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: COLORS.border,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.textSecondary }}>
                {tableNum}
              </Text>
            </View>
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>
                Mesa {tableNum}
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                {waiter}
              </Text>
            </View>
          </View>
          <StatusBadge status={order.status} type="order" size="sm" />
        </View>

        <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Clock size={12} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {openedAt}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <ShoppingBag size={12} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {itemCount} itens
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <History size={12} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {duration}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.divider }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
            {total}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function HistoricoScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchOrders = useCallback(async () => {
    console.log("[Historico] Fetching order history from /api/relatorios/historico");
    try {
      const res = await apiGet<any>("/api/relatorios/historico");
      const list: Order[] = Array.isArray(res) ? res : (res.historico || res.orders || res.comandas || []);
      console.log("[Historico] Loaded", list.length, "records");
      setOrders(list);
      setError("");
    } catch (e: any) {
      console.error("[Historico] Error:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar o histórico.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleRefresh = () => {
    console.log("[Historico] Manual refresh");
    setRefreshing(true);
    fetchOrders();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
          Histórico
        </Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
          {orders.length} comandas fechadas
        </Text>
      </View>

      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar histórico
          </Text>
          <AnimatedPressable
            onPress={fetchOrders}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
              Tentar novamente
            </Text>
          </AnimatedPressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          renderItem={({ item, index }) => <HistoryCard order={item} index={index} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
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
                <History size={32} color={COLORS.primary} />
              </View>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Nenhum histórico
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                Comandas fechadas aparecerão aqui
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
