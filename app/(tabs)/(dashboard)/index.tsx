import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Animated,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { setMesaHistoricoId } from "@/utils/mesaHistoricoStore";
import { formatCurrency, isAdmin } from "@/utils/helpers";
import { TrendingUp, ShoppingBag, Grid3x3, Clock, RefreshCw, ChevronRight, DollarSign, ChefHat } from "lucide-react-native";
import { useRealtime, type RealtimeStatus } from "@/hooks/useRealtime";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { RelatorioResumo } from "@/types";
import { exportRelatorioPDF } from "@/utils/reportPdf";

type Periodo = "hoje" | "7dias" | "mes" | "personalizado";

const PERIODO_OPTIONS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7dias", label: "7 dias" },
  { key: "mes", label: "Este mês" },
  { key: "personalizado", label: "Personalizado" },
];

interface ApiMesa {
  id: string;
  numero: number;
  capacidade: number;
  status: string;
}

interface ApiComanda {
  id: string;
  mesa?: { numero?: number } | number | string;
  mesa_id?: string;
  status: string;
  total: number;
  pedidos_count?: number;
  opened_at?: string;
  created_at?: string;
}

const COMANDA_STATUS_LABELS: Record<string, string> = {
  aberta: "Aberta",
  fechada: "Fechada",
  cancelada: "Cancelada",
};

const COMANDA_STATUS_COLORS: Record<string, string> = {
  aberta: "#22C55E",
  fechada: "#94A3B8",
  cancelada: "#EF4444",
};

function StatCard({
  title,
  value,
  color,
  icon,
  loading,
  onPress,
}: {
  title: string;
  value: string;
  color: string;
  icon: React.ReactNode;
  loading: boolean;
  onPress?: () => void;
}) {
  const COLORS = useColors();
  const cardContent = (
    <>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: color + "18",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </View>
      {loading ? (
        <>
          <SkeletonLine width="70%" height={22} />
          <SkeletonLine width="50%" height={13} />
        </>
      ) : (
        <>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text, letterSpacing: -0.3 }}>
            {value}
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
            {title}
          </Text>
        </>
      )}
      {onPress && (
        <View style={{ position: "absolute", bottom: 10, right: 10 }}>
          <ChevronRight size={14} color={COLORS.textSecondary} />
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        style={{
          flex: 1,
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: COLORS.border,
          gap: 8,
        }}
      >
        {cardContent}
      </AnimatedPressable>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 8,
      }}
    >
      {cardContent}
    </View>
  );
}

const EMPTY_RESUMO: RelatorioResumo = {
  total_mesas: 0,
  mesas_ocupadas: 0,
  comandas_abertas: 0,
  pedidos_pendentes: 0,
  pedidos_em_preparo: 0,
  pedidos_atrasados: 0,
  receita_periodo: 0,
  periodo_label: "Hoje",
  avg_ticket: 0,
  total_pratos: 0,
  top_dishes: [],
  orders_by_status: { aberta: 0, fechada: 0, cancelada: 0 },
};

function formatDateBR(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Data civil do aparelho no formato YYYY-MM-DD (sem horário, sem fuso).
// O servidor interpreta esse dia inteiro (00:00 a 23:59) no horário de Brasília.
function formatYMD(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

export default function DashboardScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userIsAdmin = isAdmin(user?.role);

  const [resumo, setResumo] = useState<RelatorioResumo>(EMPTY_RESUMO);
  const [tables, setTables] = useState<ApiMesa[]>([]);
  const [recentComandas, setRecentComandas] = useState<ApiComanda[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [dataInicio, setDataInicio] = useState<Date | null>(null);
  const [dataFim, setDataFim] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<"inicio" | "fim" | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    if (periodo === "personalizado" && (!dataInicio || !dataFim)) {
      console.log("[Dashboard] Personalizado period selected but dates not set yet, skipping fetch");
      return;
    }

    let resumoUrl = "/api/relatorios/resumo";
    if (periodo === "personalizado" && dataInicio && dataFim) {
      resumoUrl += `?periodo=personalizado&dataInicio=${formatYMD(dataInicio)}&dataFim=${formatYMD(dataFim)}`;
      console.log("[Dashboard] Fetching dashboard data with custom range:", formatYMD(dataInicio), "–", formatYMD(dataFim));
    } else {
      resumoUrl += `?periodo=${periodo}`;
      console.log("[Dashboard] Fetching dashboard data with periodo:", periodo);
    }

    try {
      const [resumoRes, tablesRes, comandasRes] = await Promise.all([
        apiGet<any>(resumoUrl).catch((e) => {
          console.error("[Dashboard] relatorios/resumo error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
        apiGet<any>("/api/mesas").catch((e) => {
          console.error("[Dashboard] mesas error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
        apiGet<any>("/api/comandas").catch((e) => {
          console.error("[Dashboard] comandas error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
      ]);

      // Unwrap resumo — handle both direct object and nested
      if (resumoRes && typeof resumoRes === "object") {
        const r = resumoRes.resumo || resumoRes;
        setResumo({
          total_mesas: Number(r.total_mesas ?? 0),
          mesas_ocupadas: Number(r.mesas_ocupadas ?? 0),
          comandas_abertas: Number(r.comandas_abertas ?? 0),
          pedidos_pendentes: Number(r.pedidos_pendentes ?? 0),
          pedidos_em_preparo: Number(r.pedidos_em_preparo ?? 0),
          pedidos_atrasados: Number(r.pedidos_atrasados ?? 0),
          receita_periodo: Number(r.receita_periodo ?? 0),
          periodo_label: String(r.periodo_label ?? "Hoje"),
          avg_ticket: Number(r.avg_ticket ?? 0),
          total_pratos: Number(r.total_pratos ?? 0),
          top_dishes: Array.isArray(r.top_dishes) ? r.top_dishes : [],
          orders_by_status: r.orders_by_status ?? { aberta: 0, fechada: 0, cancelada: 0 },
        });
        console.log("[Dashboard] Resumo loaded:", r);
      }

      const tableList: ApiMesa[] = tablesRes
        ? (Array.isArray(tablesRes) ? tablesRes : (tablesRes.mesas || []))
        : [];
      console.log("[Dashboard] Tables loaded:", tableList.length);
      setTables(tableList);

      const comandaList: ApiComanda[] = comandasRes
        ? (Array.isArray(comandasRes) ? comandasRes : (comandasRes.comandas || []))
        : [];
      const sorted = [...comandaList].sort((a, b) => {
        const dateA = new Date(a.opened_at ?? a.created_at ?? "").getTime();
        const dateB = new Date(b.opened_at ?? b.created_at ?? "").getTime();
        return dateB - dateA;
      });
      setRecentComandas(sorted.slice(0, 5));
      console.log("[Dashboard] Comandas loaded:", comandaList.length);

      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    } catch (e) {
      console.error("[Dashboard] Unexpected error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fadeAnim, periodo, dataInicio, dataFim]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRealtimeEvent = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    realtimeDebounceRef.current = setTimeout(() => {
      fetchData();
    }, 400);
  }, [fetchData]);

  useRealtime({ onEvent: handleRealtimeEvent });

  const handleRefresh = () => {
    console.log("[Dashboard] Manual refresh");
    setRefreshing(true);
    fetchData();
  };

  const handleExport = async () => {
    console.log('[Dashboard] Export PDF button pressed');
    setExporting(true);
    try {
      await exportRelatorioPDF({
        periodoLabel: resumo.periodo_label || 'Dashboard',
        receitaPeriodo: resumo.receita_periodo,
        avgTicket: resumo.avg_ticket ?? 0,
        topDishes: resumo.top_dishes ?? [],
        ordersByStatus: resumo.orders_by_status ?? {},
      });
    } catch (e: any) {
      Alert.alert('Erro', e?.message || 'Não foi possível gerar o PDF.');
    } finally {
      setExporting(false);
    }
  };

  const handlePeriodoChange = (key: Periodo) => {
    console.log("[Dashboard] Period chip pressed:", key);
    setPeriodo(key);
    if (key !== "personalizado") {
      setDataInicio(null);
      setDataFim(null);
    } else {
      setShowDatePicker("inicio");
    }
  };

  const handleDatePickerChange = (_event: any, selectedDate?: Date) => {
    if (!selectedDate) {
      console.log("[Dashboard] Date picker dismissed");
      setShowDatePicker(null);
      return;
    }
    if (showDatePicker === "inicio") {
      console.log("[Dashboard] Data início selected:", selectedDate.toISOString());
      setDataInicio(selectedDate);
      setDataFim(null);
      setShowDatePicker("fim");
    } else if (showDatePicker === "fim") {
      console.log("[Dashboard] Data fim selected:", selectedDate.toISOString());
      setDataFim(selectedDate);
      setShowDatePicker(null);
    }
  };

  const totalMesasStr = String(resumo.total_mesas || tables.length || 0);
  const mesasOcupadasStr = String(resumo.mesas_ocupadas || tables.filter((t) => t.status !== "disponivel").length || 0);
  const comandasAbertasStr = String(resumo.comandas_abertas);
  const pedidosPendentesStr = String(resumo.pedidos_pendentes);
  const receitaPeriodoStr = formatCurrency(resumo.receita_periodo);
  const avgTicketStr = formatCurrency(resumo.avg_ticket ?? 0);
  const topDishes = resumo.top_dishes ?? [];
  const ordersByStatus = resumo.orders_by_status ?? { aberta: 0, fechada: 0, cancelada: 0 };

  const dateRangeLabel = dataInicio && dataFim
    ? `${formatDateBR(dataInicio)} – ${formatDateBR(dataFim)}`
    : null;

  const periodoCardTitle = resumo.periodo_label || "Receita no Período";

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
            Dashboard
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
            Visão geral do restaurante
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AnimatedPressable
            onPress={handleExport}
            disabled={exporting}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: COLORS.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {exporting
              ? <ActivityIndicator size="small" color={COLORS.textSecondary} />
              : <Ionicons name="share-outline" size={18} color={COLORS.textSecondary} />
            }
          </AnimatedPressable>
          <AnimatedPressable
            onPress={handleRefresh}
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
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
      >
        <Animated.View style={{ opacity: fadeAnim, gap: 12 }}>
          {/* Period chip selector */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          >
            {PERIODO_OPTIONS.map((opt) => {
              const isActive = periodo === opt.key;
              return (
                <AnimatedPressable
                  key={opt.key}
                  onPress={() => handlePeriodoChange(opt.key)}
                  style={{
                    backgroundColor: isActive ? COLORS.primary : COLORS.surface,
                    borderRadius: 20,
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: isActive ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 13,
                      color: isActive ? "#fff" : COLORS.textSecondary,
                    }}
                  >
                    {opt.label}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </ScrollView>

          {/* Date range label for personalizado */}
          {periodo === "personalizado" && dateRangeLabel && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                {dateRangeLabel}
              </Text>
            </View>
          )}

          {/* Row 1: Mesas */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatCard
              title="Total de Mesas"
              value={totalMesasStr}
              color="#3B82F6"
              icon={<Grid3x3 size={20} color="#3B82F6" />}
              loading={loading}
            />
            <StatCard
              title="Mesas Ocupadas"
              value={mesasOcupadasStr}
              color="#E8521A"
              icon={<Grid3x3 size={20} color="#E8521A" />}
              loading={loading}
            />
          </View>

          {/* Row 2: Comandas / Pedidos */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatCard
              title="Comandas Abertas"
              value={comandasAbertasStr}
              color={COLORS.primary}
              icon={<ShoppingBag size={20} color={COLORS.primary} />}
              loading={loading}
              onPress={() => {
                console.log("[Dashboard] Comandas Abertas card pressed");
                router.push("/(tabs)/(comandas)");
              }}
            />
            {/* Card Na Cozinha */}
            <AnimatedPressable
              onPress={() => {
                console.log("[Dashboard] Na Cozinha card pressed");
                router.push("/fila-cozinha");
              }}
              style={{
                flex: 1,
                backgroundColor: COLORS.surface,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: COLORS.border,
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: COLORS.warning + "18",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Clock size={20} color={COLORS.warning} />
              </View>
              {loading ? (
                <>
                  <SkeletonLine width="70%" height={22} />
                  <SkeletonLine width="50%" height={13} />
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text, letterSpacing: -0.3 }}>
                    {String((resumo.pedidos_pendentes ?? 0) + (resumo.pedidos_em_preparo ?? 0))}
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    Na Cozinha
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                    {resumo.pedidos_pendentes ?? 0} aguardando · {resumo.pedidos_em_preparo ?? 0} em preparo
                  </Text>
                  {(resumo.pedidos_atrasados ?? 0) > 0 && (
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#EF4444" }}>
                      {resumo.pedidos_atrasados} atrasado{(resumo.pedidos_atrasados ?? 0) > 1 ? "s" : ""}
                    </Text>
                  )}
                </>
              )}
              <View style={{ position: "absolute", bottom: 10, right: 10 }}>
                <ChevronRight size={14} color={COLORS.textSecondary} />
              </View>
            </AnimatedPressable>
          </View>

          {/* Row 3: Receita no Período */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatCard
              title={periodoCardTitle}
              value={receitaPeriodoStr}
              color={COLORS.success}
              icon={<DollarSign size={20} color={COLORS.success} />}
              loading={loading}
              onPress={() => {
                console.log("[Dashboard] Receita no Período card pressed");
                router.push("/(tabs)/(relatorios)");
              }}
            />
          </View>

          {/* Row 4: Ticket médio */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatCard
              title="Ticket Médio"
              value={avgTicketStr}
              color="#0EA5E9"
              icon={<DollarSign size={20} color="#0EA5E9" />}
              loading={loading}
            />
          </View>
        </Animated.View>

        {/* Pratos mais vendidos */}
        <View>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
            Pratos Mais Vendidos
          </Text>
          {loading ? (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 8 }}>
                  <SkeletonLine width="60%" height={14} />
                </View>
              ))}
            </View>
          ) : topDishes.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                Nenhum prato vendido ainda
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {topDishes.map((dish, index) => (
                <View
                  key={dish.dish_name + index}
                  style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: "#F59E0B18",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {index === 0 ? (
                      <ChefHat size={16} color="#F59E0B" />
                    ) : (
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: "#F59E0B" }}>
                        {index + 1}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text, flex: 1 }} numberOfLines={1}>
                    {dish.dish_name}
                  </Text>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.textSecondary }}>
                    {dish.quantity_sold}x
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Pedidos por status */}
        <View>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
            Comandas por Status
          </Text>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: COLORS.border,
              flexDirection: "row",
              justifyContent: "space-around",
            }}
          >
            {(["aberta", "fechada", "cancelada"] as const).map((status) => (
              <View key={status} style={{ alignItems: "center", gap: 4 }}>
                <Text
                  style={{
                    fontFamily: "Outfit_700Bold",
                    fontSize: 20,
                    color: COMANDA_STATUS_COLORS[status],
                  }}
                >
                  {loading ? "—" : ordersByStatus[status]}
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  {COMANDA_STATUS_LABELS[status]}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Tables mini-grid */}
        <View>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
            Mesas
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {loading
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <View key={i} style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: COLORS.surfaceSecondary }} />
                ))
              : tables.map((table) => {
                  const isOccupied = table.status !== "disponivel";
                  return (
                    <AnimatedPressable
                      key={table.id}
                      onPress={() => {
                        console.log("[Dashboard] Table mini pressed:", table.numero, "id:", table.id, "isAdmin:", userIsAdmin);
                        if (userIsAdmin) {
                          setMesaHistoricoId(table.id);
                          router.push('/mesa-historico');
                        } else {
                          router.push(`/mesa/${table.id}`);
                        }
                      }}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 12,
                        backgroundColor: isOccupied ? "#EF4444" : "#22C55E",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                        {table.numero}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
          </View>
        </View>

        {/* Recent comandas */}
        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text }}>
              Últimas Comandas
            </Text>
            <AnimatedPressable
              onPress={() => {
                console.log("[Dashboard] View all comandas pressed");
                router.push("/(tabs)/(relatorios)");
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>
                Ver relatórios
              </Text>
              <ChevronRight size={14} color={COLORS.primary} />
            </AnimatedPressable>
          </View>
          {loading ? (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 8 }}>
                  <SkeletonLine width="40%" height={14} />
                  <SkeletonLine width="60%" height={12} />
                </View>
              ))}
            </View>
          ) : recentComandas.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                Nenhuma comanda recente
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {recentComandas.map((comanda) => {
                const statusColor = COMANDA_STATUS_COLORS[comanda.status] || "#94A3B8";
                const statusLabel = COMANDA_STATUS_LABELS[comanda.status] || comanda.status;
                const totalStr = formatCurrency(comanda.total);
                const mesaNum = typeof comanda.mesa === "object" && comanda.mesa !== null
                  ? (comanda.mesa as any).numero ?? "—"
                  : comanda.mesa ?? "—";
                return (
                  <AnimatedPressable
                    key={comanda.id}
                    onPress={() => {
                      console.log("[Dashboard] Recent comanda pressed:", comanda.id);
                      router.push(`/comanda/${comanda.id}`);
                    }}
                    style={{
                      backgroundColor: COLORS.surface,
                      borderRadius: 12,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <View style={{ gap: 3 }}>
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                        Mesa {mesaNum}
                      </Text>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.primary }}>
                        {totalStr}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: statusColor + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: statusColor }}>
                        {statusLabel}
                      </Text>
                    </View>
                  </AnimatedPressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Date picker for personalizado */}
      {showDatePicker !== null && (
        <DateTimePicker
          value={showDatePicker === "fim" && dataInicio ? dataInicio : new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={handleDatePickerChange}
          minimumDate={showDatePicker === "fim" && dataInicio ? dataInicio : undefined}
          maximumDate={new Date()}
        />
      )}
    </View>
  );
}
