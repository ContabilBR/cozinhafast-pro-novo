import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Animated,
  Platform,
  useWindowDimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useTabBarInset } from "@/hooks/useTabBarInset";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { setMesaHistoricoId } from "@/utils/mesaHistoricoStore";
import { formatCurrency, isAdmin } from "@/utils/helpers";
import { hojeNoAparelho, formatDateBR, formatYMD } from "@/utils/exportacao/periodo";
import { contarReservas } from "@/utils/reservasGrupo";
import { TrendingUp, ShoppingBag, Grid3x3, Clock, RefreshCw, ChevronRight, DollarSign, ChefHat, CalendarDays, MessageCircle } from "lucide-react-native";
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
  mesa_numero?: number | null;
  rotulo?: string | null;
  status: string;
  total: number;
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

const CARD_GAP = 12;
const TABLET_MIN_WIDTH = 768;

function StatCard({
  width,
  title,
  value,
  detail,
  alertDetail,
  icon: Icon,
  loading,
  onPress,
}: {
  width: number;
  title: string;
  value: string;
  detail?: string;
  /** trecho final do detalhe, em vermelho (ex.: pedidos atrasados) */
  alertDetail?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
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
          backgroundColor: COLORS.primaryMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={20} color={COLORS.primary} />
      </View>
      {loading ? (
        <>
          <SkeletonLine width="70%" height={22} />
          <SkeletonLine width="50%" height={13} />
          <View style={{ minHeight: 28 }} />
        </>
      ) : (
        <>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text, letterSpacing: -0.3 }}
          >
            {value}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
            {title}
          </Text>
          <View style={{ minHeight: 28, paddingRight: onPress ? 20 : 0 }}>
            <Text numberOfLines={2} style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
              {detail ?? ""}
              {alertDetail ? (
                <Text style={{ fontFamily: "Outfit_600SemiBold", color: COLORS.danger }}>{alertDetail}</Text>
              ) : null}
            </Text>
          </View>
        </>
      )}
      {onPress && (
        <View style={{ position: "absolute", bottom: 12, right: 12 }}>
          <ChevronRight size={14} color={COLORS.textSecondary} />
        </View>
      )}
    </>
  );

  const style = {
    width,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  } as const;

  if (onPress) {
    return (
      <AnimatedPressable onPress={onPress} style={style}>
        {cardContent}
      </AnimatedPressable>
    );
  }

  return <View style={style}>{cardContent}</View>;
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

export default function DashboardScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width: windowWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const gridColumns = windowWidth >= TABLET_MIN_WIDTH ? 3 : 2;
  const cardWidth = Math.floor((gridWidth - CARD_GAP * (gridColumns - 1)) / gridColumns);
  const router = useRouter();
  const { user } = useAuth();
  const userIsAdmin = isAdmin(user?.role);

  const [resumo, setResumo] = useState<RelatorioResumo>(EMPTY_RESUMO);
  const [tables, setTables] = useState<ApiMesa[]>([]);
  const [reservasHoje, setReservasHoje] = useState<{ total: number; aguardando: number } | null>(null);
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
      const [resumoRes, tablesRes, comandasRes, reservasRes] = await Promise.all([
        apiGet<any>(resumoUrl).catch((e) => {
          console.error("[Dashboard] relatorios/resumo error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
        apiGet<any>("/api/mesas").catch((e) => {
          console.error("[Dashboard] mesas error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
        apiGet<any>(`/api/comandas-dia?data=${hojeNoAparelho()}&limit=5`).catch((e) => {
          console.error("[Dashboard] comandas error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
        apiGet<any>(`/api/reservas?data=${hojeNoAparelho()}`).catch((e) => {
          console.error("[Dashboard] reservas error:", e instanceof Error ? e.message : String(e));
          return null;
        }),
      ]);

      // Reservas de hoje (independe do filtro de período); null esconde o cartão
      if (reservasRes) {
        const lista: { status: string }[] = Array.isArray(reservasRes) ? reservasRes : reservasRes.reservas || [];
        setReservasHoje(contarReservas(lista));
      } else {
        setReservasHoje(null);
      }

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
      setRecentComandas(comandaList.slice(0, 5));
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

  const handleDatePickerChange = (event: any, selectedDate?: Date) => {
    if (event?.type === "dismissed" || !selectedDate) {
      console.log("[Dashboard] Date picker dismissed");
      setShowDatePicker(null);
      return;
    }
    const hoje = new Date();
    const escolhida = formatYMD(selectedDate) > formatYMD(hoje) ? hoje : selectedDate;
    if (showDatePicker === "inicio") {
      console.log("[Dashboard] Data início selected:", escolhida.toISOString());
      setDataInicio(escolhida);
      if (dataFim && formatYMD(escolhida) <= formatYMD(dataFim)) {
        setShowDatePicker(null);
      } else {
        setDataFim(null);
        setShowDatePicker("fim");
      }
    } else if (showDatePicker === "fim") {
      console.log("[Dashboard] Data fim selected:", escolhida.toISOString());
      setDataFim(dataInicio && formatYMD(escolhida) < formatYMD(dataInicio) ? dataInicio : escolhida);
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
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarInset + 16, gap: 20 }}
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

          {/* Campos De / Até do período personalizado */}
          {periodo === "personalizado" && (
            <View style={{ gap: 8 }}>
              {showDatePicker !== null && (
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>
                  {showDatePicker === "inicio" ? "Escolha a data de início" : "Escolha a data final"}
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: 12 }}>
                {([
                  { k: "inicio", label: "De", valor: dataInicio },
                  { k: "fim", label: "Até", valor: dataFim },
                ] as const).map((c) => {
                  const ativo = showDatePicker === c.k;
                  return (
                    <AnimatedPressable
                      key={c.k}
                      onPress={() => setShowDatePicker(c.k)}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.label}: ${c.valor ? formatDateBR(c.valor) : "Selecionar"}`}
                      style={{
                        flex: 1,
                        minHeight: 56,
                        borderRadius: 12,
                        borderWidth: ativo ? 2 : 1,
                        borderColor: ativo ? COLORS.primary : COLORS.border,
                        backgroundColor: ativo ? COLORS.primaryMuted : COLORS.surface,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <View>
                        <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 12, color: ativo ? COLORS.primary : COLORS.textSecondary }}>
                          {c.label}
                        </Text>
                        <Text
                          style={{
                            fontFamily: "Outfit_600SemiBold",
                            fontSize: 15,
                            color: c.valor ? COLORS.text : COLORS.textTertiary,
                          }}
                        >
                          {c.valor ? formatDateBR(c.valor) : "Selecionar"}
                        </Text>
                      </View>
                      <Ionicons name="calendar-outline" size={20} color={ativo ? COLORS.primary : COLORS.textSecondary} />
                    </AnimatedPressable>
                  );
                })}
              </View>
              {(!dataInicio || !dataFim) && (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  Escolha as duas datas para ver o período
                </Text>
              )}
            </View>
          )}

          {/* Atalho para os relatórios (mesmo destino do cartão Faturamento) */}
          <AnimatedPressable
            onPress={() => {
              console.log("[Dashboard] Relatórios shortcut pressed");
              router.push((Platform.OS === "ios" ? "/relatorio-detalhe" : "/(tabs)/(relatorios)") as any);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              backgroundColor: COLORS.surface,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="bar-chart-outline" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>Relatórios</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>Vendas, fechamento do dia, CMV e mais</Text>
            </View>
            <ChevronRight size={18} color={COLORS.textTertiary} />
          </AnimatedPressable>

          {/* Cards de resumo: grade uniforme (2 colunas no celular, 3 no tablet) */}
          <View
            onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP }}
          >
            {gridWidth > 0 && (
              <>
                <StatCard
                  width={cardWidth}
                  title="Mesas ocupadas"
                  value={`${mesasOcupadasStr} de ${totalMesasStr}`}
                  icon={Grid3x3}
                  loading={loading}
                />
                <StatCard
                  width={cardWidth}
                  title="Comandas abertas"
                  value={comandasAbertasStr}
                  icon={ShoppingBag}
                  loading={loading}
                  onPress={() => {
                    console.log("[Dashboard] Comandas Abertas card pressed");
                    router.push("/(tabs)/(comandas)");
                  }}
                />
                <StatCard
                  width={cardWidth}
                  title="Na cozinha"
                  value={String((resumo.pedidos_pendentes ?? 0) + (resumo.pedidos_em_preparo ?? 0))}
                  detail={`${resumo.pedidos_pendentes ?? 0} aguardando · ${resumo.pedidos_em_preparo ?? 0} em preparo`}
                  alertDetail={
                    (resumo.pedidos_atrasados ?? 0) > 0
                      ? ` · ${resumo.pedidos_atrasados} atrasado${(resumo.pedidos_atrasados ?? 0) > 1 ? "s" : ""}`
                      : undefined
                  }
                  icon={Clock}
                  loading={loading}
                  onPress={() => {
                    console.log("[Dashboard] Na Cozinha card pressed");
                    router.push("/fila-cozinha");
                  }}
                />
                <StatCard
                  width={cardWidth}
                  title={periodo === "hoje" ? "Faturamento de hoje" : `Faturamento · ${periodoCardTitle}`}
                  value={receitaPeriodoStr}
                  icon={DollarSign}
                  loading={loading}
                  onPress={() => {
                    console.log("[Dashboard] Receita no Período card pressed");
                    router.push((Platform.OS === "ios" ? "/relatorio-detalhe" : "/(tabs)/(relatorios)") as any);
                  }}
                />
                <StatCard
                  width={cardWidth}
                  title="Ticket médio"
                  value={avgTicketStr}
                  icon={DollarSign}
                  loading={loading}
                />
                {(loading || reservasHoje) && (
                  <StatCard
                    width={cardWidth}
                    title="Reservas hoje"
                    value={String(reservasHoje?.total ?? 0)}
                    detail={`${reservasHoje?.aguardando ?? 0} aguardando`}
                    icon={CalendarDays}
                    loading={loading}
                    onPress={() => {
                      console.log("[Dashboard] Reservas hoje card pressed");
                      router.push("/reservas");
                    }}
                  />
                )}
              </>
            )}
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
                    color: status === "cancelada" ? COLORS.danger : status === "aberta" ? COLORS.primary : COLORS.text,
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
                router.push("/(tabs)/(comandas)");
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>
                Ver todas
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
                Nenhuma comanda hoje
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {recentComandas.map((comanda) => {
                const statusColor = COMANDA_STATUS_COLORS[comanda.status] || "#94A3B8";
                const statusLabel = COMANDA_STATUS_LABELS[comanda.status] || comanda.status;
                const totalStr = formatCurrency(comanda.total);
                const mesaNum = comanda.mesa_numero ?? "—";
                const rotulo = typeof comanda.rotulo === "string" ? comanda.rotulo.trim() : "";
                return (
                  <AnimatedPressable
                    key={comanda.id}
                    onPress={() => {
                      console.log("[Dashboard] Recent comanda pressed:", comanda.id);
                      router.push({ pathname: "/comanda-dia/[id]", params: { id: comanda.id } });
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
                        Mesa {mesaNum}{rotulo ? ` · ${rotulo}` : ""}
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

        {userIsAdmin && (
          <AnimatedPressable
            onPress={() => router.push("/fale-conosco" as any)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 14,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
              backgroundColor: COLORS.surface,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
              <MessageCircle size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Ajuda e sugestões</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>Relate um problema ou envie uma sugestão</Text>
            </View>
            <ChevronRight size={16} color={COLORS.textSecondary} />
          </AnimatedPressable>
        )}
      </ScrollView>

      {/* Date picker for personalizado */}
      {showDatePicker !== null && (
        <DateTimePicker
          key={showDatePicker}
          value={showDatePicker === "fim" ? dataFim ?? dataInicio ?? new Date() : dataInicio ?? new Date()}
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
