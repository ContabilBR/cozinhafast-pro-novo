import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { exportarRelatorioExcel } from "@/utils/relatorioExport";
import { exportRelatorioPDF } from "@/utils/reportPdf";

interface ReportSummary {
  total_revenue?: number;
  receita_periodo?: number;
  total_orders?: number;
  open_orders?: number;
  avg_ticket?: number;
  top_dishes?: { dish_name: string; quantity_sold: number }[];
  orders_by_status?: { aberta?: number; fechada?: number; cancelada?: number };
  periodo_label?: string;
  vendas_por_canal?: Array<{
    canal: string;
    faturamento: number;
    quantidade: number;
    taxa_entrega_total?: number;
  }>;
}

interface MesaResumo {
  mesa_numero: number;
  ticket_medio: number;
  comandas_fechadas: number;
  top_dishes: { dish_name: string; quantity_sold: number }[];
}

type PeriodoKey = "hoje" | "7dias" | "mes";

const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7dias", label: "7 dias" },
  { key: "mes", label: "Este mês" },
];

export default function RelatoriosScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [periodo, setPeriodo] = useState<PeriodoKey>("hoje");
  const [summary, setSummary] = useState<ReportSummary>({});
  const [mesas, setMesas] = useState<MesaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [exportandoPDF, setExportandoPDF] = useState(false);

  const fetchData = useCallback(async (periodoAtual: PeriodoKey) => {
    console.log("[Relatorios] Fetching reports summary, periodo:", periodoAtual);
    try {
      const [resSummary, resMesas] = await Promise.all([
        apiGet<any>(`/api/relatorios/resumo?periodo=${periodoAtual}`),
        apiGet<any>(`/api/relatorios/mesas?periodo=${periodoAtual}`),
      ]);
      const data: ReportSummary = resSummary || {};
      console.log("[Relatorios] Loaded summary:", JSON.stringify(data).slice(0, 200));
      setSummary(data);
      setMesas((resMesas?.mesas as MesaResumo[]) || []);
      setError("");
    } catch (e: any) {
      console.error("[Relatorios] Error:", e instanceof Error ? e.message : String(e));
      const status = e?.status ? ` (HTTP ${e.status})` : "";
      setError((e?.message || "Não foi possível carregar os relatórios.") + status);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(periodo);
  }, [periodo, fetchData]);

  const handleRefresh = () => {
    console.log("[Relatorios] Manual refresh");
    setRefreshing(true);
    fetchData(periodo);
  };

  const handleExportarExcel = async () => {
    if (loading || exportandoExcel || exportandoPDF) return;
    console.log("[Relatorios] Exportando Excel");
    setExportandoExcel(true);
    try {
      await exportarRelatorioExcel(summary, summary.periodo_label || "Hoje", mesas);
    } catch (e: any) {
      console.error("[Relatorios] Erro ao exportar Excel:", e instanceof Error ? e.message : String(e));
      Alert.alert("Erro ao exportar", e?.message || "Não foi possível gerar o arquivo Excel. Tente novamente.");
    } finally {
      setExportandoExcel(false);
    }
  };

  const ordersByStatus = summary.orders_by_status || {};
  const pedidosNoPeriodo =
    (ordersByStatus.aberta ?? 0) + (ordersByStatus.fechada ?? 0) + (ordersByStatus.cancelada ?? 0);

  const handleExportarPDF = async () => {
    if (loading || exportandoExcel || exportandoPDF) return;
    console.log("[Relatorios] Exportando PDF");
    setExportandoPDF(true);
    try {
      await exportRelatorioPDF({
        periodoLabel: summary.periodo_label || "Hoje",
        receitaPeriodo: summary.receita_periodo ?? 0,
        avgTicket: summary.avg_ticket ?? 0,
        totalPedidos: pedidosNoPeriodo,
        pedidosAbertos: summary.open_orders,
        topDishes: summary.top_dishes || [],
        ordersByStatus,
        mesas,
      });
    } catch (e: any) {
      console.error("[Relatorios] Erro ao exportar PDF:", e instanceof Error ? e.message : String(e));
      Alert.alert("Erro ao exportar", e?.message || "Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setExportandoPDF(false);
    }
  };

  const totalRevenue = formatCurrency(summary.receita_periodo ?? 0);
  const avgTicket = formatCurrency(summary.avg_ticket ?? 0);
  const topDishes = summary.top_dishes || [];
  const maxDish = Math.max(...topDishes.map((d) => d.quantity_sold), 1);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: COLORS.surface }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 56,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}>
          <View style={{ width: 80 }}>
            <TouchableOpacity
              onPress={() => {
                console.log("[Relatorios] Voltar pressed");
                router.replace('/(tabs)/(home)' as any);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
              <Text style={{ fontSize: 16, color: '#007AFF', fontWeight: '500' }}>Voltar</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: COLORS.text }}>Relatórios</Text>
          </View>
          <View style={{ width: 80 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Filtro de período */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PERIODOS.map((p) => {
            const ativo = p.key === periodo;
            return (
              <AnimatedPressable
                key={p.key}
                onPress={() => setPeriodo(p.key)}
                disabled={loading}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: ativo ? COLORS.primary : COLORS.surface,
                  borderWidth: 1,
                  borderColor: ativo ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Outfit_600SemiBold",
                    fontSize: 13,
                    color: ativo ? "#fff" : COLORS.text,
                  }}
                >
                  {p.label}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>

        {error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
              Erro ao carregar relatórios
            </Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
              {error}
            </Text>
            <AnimatedPressable
              onPress={() => fetchData(periodo)}
              style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                Tentar novamente
              </Text>
            </AnimatedPressable>
          </View>
        ) : (
          <>
            {/* Exportar relatório */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={handleExportarExcel}
                disabled={loading || exportandoExcel || exportandoPDF}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: COLORS.surface,
                  borderRadius: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                {exportandoExcel ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <Ionicons name="grid-outline" size={18} color={COLORS.text} />
                )}
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  Excel
                </Text>
              </AnimatedPressable>

              <AnimatedPressable
                onPress={handleExportarPDF}
                disabled={loading || exportandoExcel || exportandoPDF}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: COLORS.surface,
                  borderRadius: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                {exportandoPDF ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <Ionicons name="document-text-outline" size={18} color={COLORS.text} />
                )}
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  PDF
                </Text>
              </AnimatedPressable>
            </View>

            {/* Summary stats */}
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Faturamento no Período", value: totalRevenue, color: COLORS.success },
                { label: "Pedidos no Período", value: String(pedidosNoPeriodo), color: COLORS.primary },
                { label: "Pedidos Abertos", value: String(summary.open_orders ?? 0), color: COLORS.warning },
                { label: "Ticket Médio", value: avgTicket, color: "#3B82F6" },
              ].map((stat) => (
                <View
                  key={stat.label}
                  style={{
                    flex: 1,
                    minWidth: "45%",
                    backgroundColor: COLORS.surface,
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    gap: 6,
                  }}
                >
                  {loading ? (
                    <>
                      <SkeletonLine width="80%" height={18} />
                      <SkeletonLine width="60%" height={12} />
                    </>
                  ) : (
                    <>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: stat.color }}>
                        {stat.value}
                      </Text>
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                        {stat.label}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </View>

            {/* Orders by status */}
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                Pedidos por Status
              </Text>
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  gap: 12,
                }}
              >
                {loading ? (
                  [0, 1, 2].map((i) => <SkeletonLine key={i} width="100%" height={20} />)
                ) : (
                  [
                    { key: "aberta", label: "Abertas", color: "#22C55E" },
                    { key: "fechada", label: "Fechadas", color: "#94A3B8" },
                    { key: "cancelada", label: "Canceladas", color: "#EF4444" },
                  ].map((s) => {
                    const count = (ordersByStatus as any)[s.key] ?? 0;
                    return (
                      <View key={s.key} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                            {s.label}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: s.color }}>
                          {count}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
            </View>

            {/* Top dishes */}
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                Pratos Mais Pedidos
              </Text>
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  gap: 14,
                }}
              >
                {loading ? (
                  [0, 1, 2, 3].map((i) => (
                    <View key={i} style={{ gap: 6 }}>
                      <SkeletonLine width="50%" height={13} />
                      <SkeletonLine width="100%" height={10} borderRadius={5} />
                    </View>
                  ))
                ) : topDishes.length === 0 ? (
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Sem dados disponíveis
                  </Text>
                ) : (
                  topDishes.map((dish, i) => {
                    const barW = Math.max(2, Math.round((dish.quantity_sold / maxDish) * 100));
                    return (
                      <View key={dish.dish_name + i} style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text, flex: 1 }}>
                            {dish.dish_name}
                          </Text>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary, marginLeft: 8 }}>
                            {dish.quantity_sold}x
                          </Text>
                        </View>
                        <View style={{ height: 8, backgroundColor: COLORS.surfaceSecondary, borderRadius: 4 }}>
                          <View
                            style={{
                              height: 8,
                              width: `${barW}%` as `${number}%`,
                              backgroundColor: COLORS.primary,
                              borderRadius: 4,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>

            {/* Vendas por canal */}
            {summary?.vendas_por_canal && summary.vendas_por_canal.length > 0 && (
              <View>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                  Vendas por canal
                </Text>
                <View
                  style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  {summary.vendas_por_canal.map((canal) => {
                    const canalLabel: Record<string, string> = { mesa: "Mesa", balcao: "Balcão", delivery: "Delivery" };
                    const canalNome = canalLabel[canal.canal] || canal.canal;
                    const quantidadeText = canal.quantidade !== 1 ? "s" : "";
                    const mostrarTaxa = canal.canal === "delivery" && canal.taxa_entrega_total !== undefined && canal.taxa_entrega_total > 0;
                    const taxaFormatada = mostrarTaxa ? formatCurrency(canal.taxa_entrega_total!) : "";
                    return (
                      <View key={canal.canal} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}>
                        <View>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>{canalNome}</Text>
                          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{canal.quantidade} pedido{quantidadeText}</Text>
                          {mostrarTaxa && (
                            <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>Taxa de entrega: {taxaFormatada}</Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(canal.faturamento)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Por mesa */}
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                Por Mesa
              </Text>
              {loading ? (
                <View
                  style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    gap: 12,
                  }}
                >
                  {[0, 1].map((i) => (
                    <SkeletonLine key={i} width="100%" height={20} />
                  ))}
                </View>
              ) : mesas.length === 0 ? (
                <View
                  style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Nenhuma mesa com comandas fechadas neste período
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {mesas.map((mesa) => (
                    <View
                      key={mesa.mesa_numero}
                      style={{
                        backgroundColor: COLORS.surface,
                        borderRadius: 16,
                        padding: 16,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        gap: 10,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>
                          Mesa {mesa.mesa_numero}
                        </Text>
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                          {mesa.comandas_fechadas} comanda{mesa.comandas_fechadas === 1 ? "" : "s"} fechada{mesa.comandas_fechadas === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                          Ticket médio
                        </Text>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#3B82F6" }}>
                          {formatCurrency(mesa.ticket_medio)}
                        </Text>
                      </View>
                      {mesa.top_dishes.length > 0 && (
                        <View style={{ gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: COLORS.border }}>
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>
                            Mais pedidos nessa mesa
                          </Text>
                          {mesa.top_dishes.map((dish, i) => (
                            <View key={dish.dish_name + i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                              <Text
                                numberOfLines={1}
                                style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text, flex: 1 }}
                              >
                                {i + 1}. {dish.dish_name}
                              </Text>
                              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary, marginLeft: 8 }}>
                                {dish.quantity_sold}x
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
