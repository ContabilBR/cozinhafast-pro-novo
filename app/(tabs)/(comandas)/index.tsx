import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";
import { Plus, Clock, ShoppingBag } from "lucide-react-native";

interface ApiComanda {
  id: string;
  mesa_id?: string;
  mesa_numero: number;
  mesa_capacidade?: number;
  rotulo?: string | null;
  status: string;
  tipo?: string;
  total: number;
  item_count?: number;
  items_count?: number;
  pedidos_count?: number;
  pedidos?: unknown[];
  opened_at?: string;
  created_at?: string;
}

function ComandaCard({ comanda, onPress, index }: { comanda: ApiComanda; onPress: () => void; index: number }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const mesaNum = comanda.mesa_numero;
  const timeOpen = formatRelativeTime(comanda.opened_at ?? comanda.created_at ?? "");
  const rawTotal = Number(comanda.total);
  const total = `R$ ${(isNaN(rawTotal) ? 0 : rawTotal).toFixed(2).replace(".", ",")}`;
  const itemCount =
    comanda.item_count ??
    comanda.items_count ??
    comanda.pedidos_count ??
    (Array.isArray(comanda.pedidos) ? comanda.pedidos.length : 0);
  const itemCountDisplay = `${itemCount} ${itemCount === 1 ? "item" : "itens"}`;

  const statusColors: Record<string, string> = {
    aberta: "#22C55E",
    fechada: "#94A3B8",
    cancelada: "#EF4444",
  };
  const statusLabels: Record<string, string> = {
    aberta: "Aberta",
    fechada: "Fechada",
    cancelada: "Cancelada",
  };
  const statusColor = statusColors[comanda.status] ?? "#94A3B8";
  const statusLabel = statusLabels[comanda.status] ?? comanda.status;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AnimatedPressable
        onPress={onPress}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: COLORS.border,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: COLORS.primaryMuted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.primary }}>
                {mesaNum}
              </Text>
            </View>
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
                Mesa {mesaNum}
              </Text>
              {typeof comanda.rotulo === "string" && comanda.rotulo.trim().length > 0 ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}
                >
                  {comanda.rotulo.trim()}
                </Text>
              ) : null}
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                {itemCountDisplay}
              </Text>
            </View>
          </View>
          <View style={{ backgroundColor: statusColor + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: statusColor }}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Clock size={13} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {timeOpen}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <ShoppingBag size={13} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {itemCountDisplay}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.divider }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
            {total}
          </Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function ComandasScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;

  const [comandas, setComandas] = useState<ApiComanda[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchOrders = useCallback(async () => {
    console.log("[Comandas] Fetching comandas from /api/comandas");
    try {
      const res = await apiGet<any>("/api/comandas");
      const raw: ApiComanda[] = Array.isArray(res) ? res : (res.comandas || []);
      const list = raw.filter((c) => c.tipo !== "delivery");
      console.log("[Comandas] Loaded", raw.length, "comandas,", list.length, "após filtrar delivery");
      list.forEach((comanda) => console.log('comanda data:', JSON.stringify(comanda)));
      setComandas(list);
      setError("");
    } catch (e: any) {
      console.error("[Comandas] Error:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar as comandas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchOrders();
  }, [fetchOrders]));

  const handleRefresh = () => {
    console.log("[Comandas] Manual refresh");
    setRefreshing(true);
    fetchOrders();
  };

  const abertas = comandas.filter((c) => c.status === "aberta");

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
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            onPress={() => {
              console.log("[Comandas] Botão Mesas pressionado — navegando para /(tabs)/(mesas)");
              router.replace("/(tabs)/(mesas)");
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              opacity: pressed ? 0.6 : 1,
              backgroundColor: COLORS.primaryMuted,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 7,
              marginRight: 14,
            })}
          >
            <Ionicons name="arrow-back" size={16} color={COLORS.primary} />
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}>
              Mesas
            </Text>
          </Pressable>
          <View>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
              Comandas
            </Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
              {abertas.length} abertas
            </Text>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar comandas
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
          data={comandas}
          renderItem={({ item, index }) => (
            <ComandaCard
              comanda={item}
              onPress={() => {
                console.log("[Comandas] Comanda pressed:", item.id, "mesa_numero:", item.mesa_numero, "mesa_id:", item.mesa_id);
                router.push({ pathname: `/comanda/${item.id}`, params: { mesa_numero: String(item.mesa_numero ?? ''), mesa_id: String(item.mesa_id ?? '') } });
              }}
              index={index}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: listPaddingBottom }}
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
                <ShoppingBag size={32} color={COLORS.primary} />
              </View>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Nenhuma comanda
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                Abra uma nova comanda tocando no botão abaixo
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <AnimatedPressable
        onPress={() => {
          console.log("[Comandas] FAB - nova comanda: redirecionando para Mesas para selecionar mesa");
          router.replace("/(tabs)/(mesas)");
        }}
        style={{
          position: "absolute",
          bottom: insets.bottom + 90,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: COLORS.primary,
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(232, 82, 26, 0.4)",
        }}
      >
        <Plus size={24} color="#fff" />
      </AnimatedPressable>
    </View>
  );
}
