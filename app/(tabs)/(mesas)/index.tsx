import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Animated,
  FlatList,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { isAdmin } from "@/utils/helpers";
import { setMesaHistoricoId } from "@/utils/mesaHistoricoStore";
import { Users, UtensilsCrossed, LayoutGrid } from "lucide-react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiMesa {
  id: string;
  numero: number;
  capacidade: number;
  status: string;
  comanda_id?: string;
}

type FilterKey = "todas" | "livres" | "ocupadas" | "reservadas";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMesaStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    disponivel: "Livre",
    livre: "Livre",
    free: "Livre",
    ocupada: "Ocupada",
    occupied: "Ocupada",
    reservada: "Reservada",
    reserved: "Reservada",
  };
  return labels[status] || String(status);
}

function getMesaStatusColor(status: string): string {
  const map: Record<string, string> = {
    disponivel: "#22C55E",
    livre: "#22C55E",
    free: "#22C55E",
    ocupada: "#E8521A",
    occupied: "#E8521A",
    reservada: "#F59E0B",
    reserved: "#F59E0B",
  };
  return map[status] || "#94A3B8";
}

function isLivre(status: string): boolean {
  return status === "disponivel" || status === "livre" || status === "free";
}

function isOcupada(status: string): boolean {
  return status === "ocupada" || status === "occupied";
}

function isReservada(status: string): boolean {
  return status === "reservada" || status === "reserved";
}

function canOpenComanda(status: string): boolean {
  return isLivre(status) || isReservada(status);
}

// ─── Skeleton Grid ────────────────────────────────────────────────────────────

function MesaCardSkeleton() {
  const COLORS = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        padding: 16,
        margin: 6,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 10,
        minHeight: 160,
      }}
    >
      <SkeletonLine width={48} height={48} borderRadius={12} />
      <SkeletonLine width="70%" height={16} />
      <SkeletonLine width="50%" height={12} />
      <SkeletonLine width="60%" height={28} borderRadius={8} />
    </View>
  );
}

// ─── Mesa Card ────────────────────────────────────────────────────────────────

function MesaCard({
  mesa,
  onOpenComanda,
  onPress,
  index,
}: {
  mesa: ApiMesa;
  onOpenComanda: () => void;
  onPress: () => void;
  index: number;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay: index * 50,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        delay: index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  const statusColor = getMesaStatusColor(mesa.status);
  const statusLabel = getMesaStatusLabel(mesa.status);
  const canOpen = canOpenComanda(mesa.status);
  const mesaLabel = `Mesa ${mesa.numero}`;
  const capacidadeLabel = `${mesa.capacidade} pessoas`;

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity,
        transform: [{ translateY }],
        margin: 6,
      }}
    >
      <AnimatedPressable
        onPress={() => {
          console.log("[Mesas] Card da mesa pressionado:", mesa.numero, "status:", mesa.status);
          onPress();
        }}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: isOcupada(mesa.status)
            ? statusColor + "30"
            : isReservada(mesa.status)
            ? statusColor + "40"
            : COLORS.border,
          padding: 14,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 2,
          minHeight: 168,
          justifyContent: "space-between",
        }}
      >
        {/* Top: number circle + status badge */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              backgroundColor: statusColor + "18",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 22,
                color: statusColor,
                letterSpacing: -0.5,
              }}
            >
              {mesa.numero}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: statusColor + "20",
              borderRadius: 20,
              paddingHorizontal: 9,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 11,
                color: statusColor,
                letterSpacing: 0.2,
              }}
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Middle: name + capacity */}
        <View style={{ marginTop: 10, gap: 4 }}>
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 16,
              color: COLORS.text,
              letterSpacing: -0.2,
            }}
          >
            {mesaLabel}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Users size={12} color={COLORS.textSecondary} />
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 12,
                color: COLORS.textSecondary,
              }}
            >
              {capacidadeLabel}
            </Text>
          </View>
        </View>

        {/* Bottom: action button */}
        <AnimatedPressable
          onPress={() => {
            console.log("[Mesas] Botão Abrir Comanda pressionado — mesa:", mesa.numero, "id:", mesa.id);
            onOpenComanda();
          }}
          disabled={!canOpen}
          style={{
            marginTop: 12,
            backgroundColor: canOpen ? COLORS.primary : COLORS.surfaceSecondary,
            borderRadius: 10,
            paddingVertical: 9,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 5,
            opacity: canOpen ? 1 : 0.5,
          }}
        >
          <UtensilsCrossed size={13} color={canOpen ? "#fff" : COLORS.textTertiary} />
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 12,
              color: canOpen ? "#fff" : COLORS.textTertiary,
            }}
          >
            {isOcupada(mesa.status) ? "Ocupada" : "Abrir Comanda"}
          </Text>
        </AnimatedPressable>
      </AnimatedPressable>
    </Animated.View>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const COLORS = useColors();
  return (
    <AnimatedPressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: active ? COLORS.primary : COLORS.surface,
        borderWidth: 1.5,
        borderColor: active ? COLORS.primary : COLORS.border,
        marginRight: 8,
      }}
    >
      <Text
        style={{
          fontFamily: active ? "Outfit_700Bold" : "Outfit_500Medium",
          fontSize: 13,
          color: active ? "#fff" : COLORS.textSecondary,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          backgroundColor: active ? "rgba(255,255,255,0.25)" : COLORS.surfaceSecondary,
          borderRadius: 10,
          minWidth: 20,
          height: 20,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 5,
        }}
      >
        <Text
          style={{
            fontFamily: "Outfit_700Bold",
            fontSize: 11,
            color: active ? "#fff" : COLORS.textSecondary,
          }}
        >
          {count}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "livres", label: "Livres" },
  { key: "ocupadas", label: "Ocupadas" },
  { key: "reservadas", label: "Reservadas" },
];

export default function MesasScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user } = useAuth();
  const role = user?.role as string | undefined;

  const [mesas, setMesas] = useState<ApiMesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("todas");
  const [searchText, setSearchText] = useState("");

  const fetchMesas = useCallback(async () => {
    console.log("[Mesas] GET /api/mesas");
    try {
      const res = await apiGet<any>("/api/mesas");
      const list: ApiMesa[] = Array.isArray(res) ? res : (res.mesas || []);
      console.log("[Mesas] Carregadas", list.length, "mesas");
      setMesas(list);
      setError("");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Mesas] Erro ao carregar mesas:", msg);
      setError("Não foi possível carregar as mesas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchMesas();
      const interval = setInterval(() => {
        console.log("[Mesas] Auto-refresh (30s)");
        fetchMesas();
      }, 30000);
      return () => clearInterval(interval);
    }, [fetchMesas])
  );

  const handleRefresh = () => {
    console.log("[Mesas] Pull-to-refresh acionado");
    setRefreshing(true);
    fetchMesas();
  };

  const handleOpenComanda = (mesa: ApiMesa) => {
    console.log("[Mesas] Abrir comanda — mesa:", mesa.numero, "id:", mesa.id, "status:", mesa.status);
    router.push({ pathname: "/comanda/nova", params: { mesa_id: mesa.id, mesa_numero: String(mesa.numero) } });
  };

  const handleMesaPress = (mesa: ApiMesa) => {
    console.log("[Mesas] Mesa pressionada:", mesa.numero, "comanda_id:", mesa.comanda_id, "role:", role);
    if (isAdmin(role)) {
      console.log("[Mesas] Admin/gerente — navegando para histórico:", mesa.id);
      setMesaHistoricoId(mesa.id);
      router.push('/mesa-historico');
      return;
    }
    if (isOcupada(mesa.status) && mesa.comanda_id) {
      router.push({ pathname: `/comanda/${mesa.comanda_id}`, params: { mesa_numero: String(mesa.numero) } });
    } else if (canOpenComanda(mesa.status)) {
      router.push({ pathname: "/comanda/nova", params: { mesa_id: mesa.id, mesa_numero: String(mesa.numero) } });
    } else {
      router.push(`/mesa/${mesa.id}`);
    }
  };

  // Counts
  const livreCount = mesas.filter((m) => isLivre(m.status)).length;
  const ocupadaCount = mesas.filter((m) => isOcupada(m.status)).length;
  const reservadaCount = mesas.filter((m) => isReservada(m.status)).length;

  const filterCounts: Record<FilterKey, number> = {
    todas: mesas.length,
    livres: livreCount,
    ocupadas: ocupadaCount,
    reservadas: reservadaCount,
  };

  // Filtered list
  const trimmedSearch = searchText.trim();
  const filteredMesas = mesas
    .filter((m) => {
      if (activeFilter === "todas") return true;
      if (activeFilter === "livres") return isLivre(m.status);
      if (activeFilter === "ocupadas") return isOcupada(m.status);
      if (activeFilter === "reservadas") return isReservada(m.status);
      return true;
    })
    .filter((m) => trimmedSearch === "" || String(m.numero).includes(trimmedSearch));

  // Pair up for 2-column grid
  const rows: ApiMesa[][] = [];
  for (let i = 0; i < filteredMesas.length; i += 2) {
    rows.push(filteredMesas.slice(i, i + 2));
  }

  const subtitleText = `${ocupadaCount} ocupadas · ${livreCount} disponíveis`;

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
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 26,
              color: COLORS.text,
              letterSpacing: -0.3,
            }}
          >
            Mesas
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 13,
              color: COLORS.textSecondary,
              marginTop: 2,
            }}
          >
            {loading ? "Carregando..." : subtitleText}
          </Text>
        </View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: COLORS.primaryMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LayoutGrid size={20} color={COLORS.primary} />
        </View>
      </View>

      {/* Filter chips */}
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          paddingVertical: 10,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              count={filterCounts[f.key]}
              active={activeFilter === f.key}
              onPress={() => {
                console.log("[Mesas] Filtro selecionado:", f.key);
                setActiveFilter(f.key);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Search bar */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            paddingHorizontal: 12,
            height: 42,
            borderWidth: 1,
            borderColor: COLORS.border,
          }}
        >
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={searchText}
            onChangeText={(text) => {
              console.log("[Mesas] Busca alterada:", text);
              setSearchText(text);
            }}
            placeholder="Buscar mesa por número..."
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="numeric"
            style={{
              flex: 1,
              marginLeft: 8,
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.text,
              paddingVertical: 0,
            }}
          />
          {searchText.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                console.log("[Mesas] Busca limpa");
                setSearchText("");
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: listPaddingBottom }}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={{ flexDirection: "row" }}>
              <MesaCardSkeleton />
              <MesaCardSkeleton />
            </View>
          ))}
        </ScrollView>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 12,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: "rgba(239,68,68,0.10)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LayoutGrid size={32} color={COLORS.danger} />
          </View>
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 17,
              color: COLORS.text,
              textAlign: "center",
            }}
          >
            Erro ao carregar mesas
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.textSecondary,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {error}
          </Text>
          <AnimatedPressable
            onPress={() => {
              console.log("[Mesas] Tentar novamente pressionado");
              setLoading(true);
              fetchMesas();
            }}
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 12,
              paddingHorizontal: 28,
              paddingVertical: 13,
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 15,
                color: "#fff",
              }}
            >
              Tentar novamente
            </Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 6, paddingBottom: listPaddingBottom }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
        >
          {filteredMesas.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: 48,
                gap: 12,
                marginTop: 32,
              }}
            >
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
                <LayoutGrid size={32} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 17,
                  color: COLORS.text,
                }}
              >
                Nenhuma mesa encontrada
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  maxWidth: 260,
                }}
              >
                Não há mesas com o filtro selecionado
              </Text>
            </View>
          ) : (
            rows.map((row, rowIdx) => (
              <View key={rowIdx} style={{ flexDirection: "row" }}>
                {row.map((mesa, colIdx) => (
                  <MesaCard
                    key={mesa.id}
                    mesa={mesa}
                    index={rowIdx * 2 + colIdx}
                    onOpenComanda={() => handleOpenComanda(mesa)}
                    onPress={() => handleMesaPress(mesa)}
                  />
                ))}
                {/* Fill empty slot if odd number */}
                {row.length === 1 && <View style={{ flex: 1, margin: 6 }} />}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
