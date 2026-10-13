import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { isAdmin } from "@/utils/helpers";
import { setMesaHistoricoId } from "@/utils/mesaHistoricoStore";
import { Users } from "lucide-react-native";

interface ApiMesa {
  id: string;
  numero: number;
  capacidade: number;
  status: string;
  comanda_id?: string;
}

function getMesaStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    disponivel: "Disponível",
    livre: "Disponível",
    free: "Disponível",
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

function isDisponivel(status: string): boolean {
  return status === "disponivel" || status === "livre" || status === "free";
}

function MesaCard({ mesa, onPress, index }: { mesa: ApiMesa; onPress: () => void; index: number }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 320, delay: index * 50, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 320, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const statusColor = getMesaStatusColor(mesa.status);
  const statusLabel = getMesaStatusLabel(mesa.status);
  const livre = isDisponivel(mesa.status);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }], flex: 1, margin: 6 }}>
      <AnimatedPressable
        onPress={onPress}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          borderWidth: 2,
          borderColor: livre ? COLORS.border : statusColor + "50",
          minHeight: 130,
          justifyContent: "space-between",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 1,
        }}
      >
        {/* Status dot */}
        <View style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: statusColor + "18", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: statusColor }}>
              {mesa.numero}
            </Text>
          </View>
          <View style={{ backgroundColor: statusColor + "20", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: statusColor }}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={{ gap: 4, marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Users size={13} color={COLORS.textSecondary} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {mesa.capacidade} lugares
            </Text>
          </View>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function MesaIndexScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role as string | undefined;

  const [mesas, setMesas] = useState<ApiMesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchMesas = useCallback(async () => {
    console.log("[Mesa/Index] GET /api/mesas");
    try {
      const res = await apiGet<any>("/api/mesas");
      const list: ApiMesa[] = Array.isArray(res) ? res : (res.mesas || []);
      console.log("[Mesa/Index] Mesas carregadas:", list.length);
      setMesas(list);
      setError("");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Mesa/Index] Erro:", msg);
      setError("Não foi possível carregar as mesas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchMesas(); }, [fetchMesas]));

  const handleRefresh = () => {
    console.log("[Mesa/Index] Refresh manual");
    setRefreshing(true);
    fetchMesas();
  };

  const handleMesaPress = (mesa: ApiMesa) => {
    console.log("[Mesa/Index] Mesa pressionada:", mesa.numero, "status:", mesa.status, "role:", role);
    if (isAdmin(role)) {
      console.log("[Mesa/Index] Admin/gerente — navegando para histórico:", mesa.id);
      setMesaHistoricoId(mesa.id);
      router.push('/mesa-historico');
      return;
    }
    if (isDisponivel(mesa.status) && role === "garcom") {
      router.push({
        pathname: "/comanda/nova",
        params: { mesa_id: mesa.id, mesa_numero: String(mesa.numero) },
      });
    } else if (!isDisponivel(mesa.status) && mesa.comanda_id) {
      router.push(`/comanda/${mesa.comanda_id}`);
    } else {
      router.push(`/mesa/${mesa.id}`);
    }
  };

  const livreCount = mesas.filter((m) => isDisponivel(m.status)).length;
  const ocupadaCount = mesas.filter((m) => !isDisponivel(m.status)).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Header */}
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
          onPress={() => { console.log("[Mesa/Index] Botão voltar pressionado"); router.back(); }}
          style={{ flexDirection: "row", alignItems: "center", padding: 8, zIndex: 10 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color="#22c55e" />
          <Text style={{ color: "#22c55e", marginLeft: 6, fontSize: 16, fontWeight: "500" }}>Voltar</Text>
        </Pressable>
        <Text style={{
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "Outfit_700Bold",
          fontSize: 17,
          color: COLORS.text,
          height: 56,
          lineHeight: 56,
        }}>
          Mesas
        </Text>
      </View>

      {/* Stats bar */}
      <View style={{
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        gap: 16,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
            {livreCount} disponíveis
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#E8521A" }} />
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
            {ocupadaCount} ocupadas
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={{ padding: 12, gap: 8 }}>
          {[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: "rgba(239,68,68,0.10)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="alert-circle-outline" size={34} color={COLORS.danger} />
          </View>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text, textAlign: "center" }}>
            Erro ao carregar mesas
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
            {error}
          </Text>
          <AnimatedPressable
            onPress={() => { console.log("[Mesa/Index] Tentar novamente pressionado"); setLoading(true); fetchMesas(); }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <FlatList
          data={mesas}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 6, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item, index }) => (
            <MesaCard mesa={item} onPress={() => handleMesaPress(item)} index={index} />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
              <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
                <Users size={32} color={COLORS.primary} />
              </View>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Nenhuma mesa cadastrada
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                As mesas do restaurante aparecerão aqui
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
