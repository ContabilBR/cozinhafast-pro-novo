import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { getMesaHistoricoId, clearMesaHistoricoId } from "@/utils/mesaHistoricoStore";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { Users } from "lucide-react-native";
import { formatCurrency } from "@/utils/helpers";
import { apiGet } from "@/utils/api";

const BASE_URL = "https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev";

// ─── Date display helper ──────────────────────────────────────────────────────

function formatDateDisplay(date: Date | null): string {
  if (!date) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MesaInfo {
  id: string;
  numero: number;
  status: string;
  capacidade: number;
}

interface TopPrato {
  prato_nome: string;
  total_quantidade: number;
  total_receita: number;
}

interface Resumo {
  total_arrecadado: number;
  total_comandas: number;
  total_pedidos: number;
  top_pratos: TopPrato[];
}

interface PedidoItem {
  id: string;
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
  status: string;
}

interface ComandaItem {
  id: string;
  status: string;
  total: number;
  subtotal: number;
  gorjeta: number;
  garcom_id: string;
  garcom_nome: string;
  created_at: string;
  closed_at: string | null;
  source: "ativa" | "historico";
  pedidos: PedidoItem[];
}

interface HistoricoData {
  mesa: MesaInfo;
  resumo: Resumo;
  comandas: ComandaItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function getComandaStatusConfig(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "aberta":
      return { label: "Aberta", color: "#22C55E", bg: "rgba(34,197,94,0.12)" };
    case "fechada":
      return { label: "Fechada", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
    case "paga":
      return { label: "Paga", color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" };
    case "cancelada":
      return { label: "Cancelada", color: "#EF4444", bg: "rgba(239,68,68,0.12)" };
    default:
      return { label: status, color: "#94A3B8", bg: "rgba(148,163,184,0.12)" };
  }
}

function getPedidoStatusConfig(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "em_preparo":
    case "em_preparacao":
      return { label: "Em Preparo", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" };
    case "pronto":
      return { label: "Pronto", color: "#22C55E", bg: "rgba(34,197,94,0.12)" };
    case "entregue":
      return { label: "Entregue", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
    case "cancelado":
      return { label: "Cancelado", color: "#EF4444", bg: "rgba(239,68,68,0.12)" };
    default:
      return { label: "Pendente", color: "#94A3B8", bg: "rgba(148,163,184,0.12)" };
  }
}

function getMesaCircleColor(status: string): string {
  if (status === "disponivel" || status === "livre" || status === "free") return "#22C55E";
  if (status === "ocupada" || status === "occupied") return "#EF4444";
  return "#F59E0B";
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
    finalizada: "Finalizada",
  };
  return labels[status] || String(status);
}

// ─── InlineCalendar ───────────────────────────────────────────────────────────

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DAY_HEADERS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function buildCalendarGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: (Date | null)[] = [];

  // Fill leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push(new Date(year, month - 1, daysInPrevMonth - i));
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Fill trailing days from next month
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push(new Date(year, month + 1, d));
  }

  // Split into 6 rows of 7
  const rows: (Date | null)[][] = [];
  for (let r = 0; r < 6; r++) {
    rows.push(cells.slice(r * 7, r * 7 + 7));
  }
  return rows;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function InlineCalendar({
  value,
  onSelect,
  colors,
}: {
  value: Date | null;
  onSelect: (date: Date) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const initial = value ?? new Date();
  const [displayYear, setDisplayYear] = useState(initial.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(initial.getMonth());

  const today = new Date();
  const rows = buildCalendarGrid(displayYear, displayMonth);
  const monthLabel = MONTH_NAMES_PT[displayMonth] + " " + displayYear;

  const handlePrevMonth = () => {
    console.log("[InlineCalendar] Navigate to previous month");
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear((y) => y - 1);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    console.log("[InlineCalendar] Navigate to next month");
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear((y) => y + 1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  };

  return (
    <View style={{
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginTop: 4,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    }}>
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Pressable
          onPress={handlePrevMonth}
          style={{ padding: 8, borderRadius: 8, backgroundColor: colors.background }}
        >
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </Pressable>
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: colors.text }}>
          {monthLabel}
        </Text>
        <Pressable
          onPress={handleNextMonth}
          style={{ padding: 8, borderRadius: 8, backgroundColor: colors.background }}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        {DAY_HEADERS.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: colors.textSecondary }}>
              {d}
            </Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      {rows.map((week, wi) => (
        <View key={wi} style={{ flexDirection: "row" }}>
          {week.map((date, di) => {
            if (!date) {
              return <View key={di} style={{ flex: 1, aspectRatio: 1, margin: 1 }} />;
            }
            const isCurrentMonth = date.getMonth() === displayMonth;
            const isSelected = value ? isSameDay(date, value) : false;
            const isToday = isSameDay(date, today);

            const textColor = isSelected
              ? "#fff"
              : !isCurrentMonth
              ? colors.textSecondary
              : isToday
              ? colors.primary
              : colors.text;

            const textOpacity = !isCurrentMonth ? 0.4 : 1;
            const fontFamily = isSelected ? "Outfit_700Bold" : "Outfit_400Regular";

            return (
              <Pressable
                key={di}
                onPress={() => {
                  console.log("[InlineCalendar] Day selected:", date.toISOString().slice(0, 10));
                  onSelect(date);
                }}
                style={{ flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", margin: 1 }}
              >
                <View style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isSelected ? colors.primary : "transparent",
                  borderWidth: isToday && !isSelected ? 1 : 0,
                  borderColor: colors.primary,
                }}>
                  <Text style={{
                    fontFamily,
                    fontSize: 13,
                    color: textColor,
                    opacity: textOpacity,
                  }}>
                    {date.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Comanda Card ─────────────────────────────────────────────────────────────

function ComandaCard({ comanda }: { comanda: ComandaItem }) {
  const COLORS = useColors();
  const [expanded, setExpanded] = useState(false);

  const statusCfg = getComandaStatusConfig(comanda.status);
  const isAtiva = comanda.source === "ativa";
  const openedAt = formatDateTime(comanda.created_at);
  const closedAt = formatDateTime(comanda.closed_at);
  const subtotalStr = formatCurrency(Number(comanda.subtotal) || 0);
  const gorjetaVal = Number(comanda.gorjeta) || 0;
  const gorjetaStr = formatCurrency(gorjetaVal);
  const hasGorjeta = gorjetaVal > 0;
  const hasClosed = !!comanda.closed_at;

  const handleToggle = () => {
    console.log("[MesaHistorico] Comanda card toggled:", comanda.id, "expanded:", !expanded);
    setExpanded((prev) => !prev);
  };

  return (
    <AnimatedPressable
      onPress={handleToggle}
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: isAtiva ? "#22C55E40" : COLORS.border,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      {/* Card header */}
      <View style={{ padding: 14, gap: 8 }}>
        {/* Row 1: date, status badge, total */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>
              {openedAt}
            </Text>
            {isAtiva ? (
              <View style={{ backgroundColor: "rgba(34,197,94,0.15)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: "#22C55E" }}>
                  ATIVA
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: statusCfg.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: statusCfg.color }}>
                {statusCfg.label}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.primary }}>
                {subtotalStr}
              </Text>
              {hasGorjeta ? (
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#F59E0B" }}>
                  +{gorjetaStr}
                  {" gorj"}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Row 2: garçom + closed_at */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 12 }}>👤</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {comanda.garcom_nome}
            </Text>
          </View>
          {hasClosed ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 12 }}>🔒</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                {closedAt}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={COLORS.textSecondary}
            />
          </View>
        </View>
      </View>

      {/* Expanded pedidos */}
      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, padding: 14, gap: 8 }}>
          {comanda.pedidos.length === 0 ? (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, textAlign: "center", paddingVertical: 8 }}>
              Nenhum pedido nesta comanda
            </Text>
          ) : (
            comanda.pedidos.map((pedido) => {
              const pStatusCfg = getPedidoStatusConfig(pedido.status);
              const precoUnit = Number(pedido.preco_unitario) || 0;
              const qtdPreco = `${pedido.quantidade} × R$ ${precoUnit.toFixed(2).replace(".", ",")}`;
              const hasObs = pedido.observacao && pedido.observacao.trim().length > 0;
              return (
                <View
                  key={pedido.id}
                  style={{
                    backgroundColor: COLORS.background,
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.text, flex: 1, marginRight: 8 }}>
                      {pedido.prato_nome}
                    </Text>
                    <View style={{ backgroundColor: pStatusCfg.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: pStatusCfg.color }}>
                        {pStatusCfg.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    {qtdPreco}
                  </Text>
                  {hasObs ? (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textTertiary, fontStyle: "italic" }}>
                      {pedido.observacao}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MesaHistoricoScreen() {
  const id = getMesaHistoricoId() ?? "";
  const COLORS = useColors();

  const [data, setData] = useState<HistoricoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const fetchHistorico = useCallback(async () => {
    console.log("[MesaHistorico] GET /api/mesas/" + id + "/historico");
    try {
      const json: any = await apiGet(`/api/mesas/${id}/historico`);
      console.log("[MesaHistorico] Dados carregados — mesa:", json.mesa?.numero, "comandas:", json.comandas?.length);
      // Normalize numbers
      const normalized: HistoricoData = {
        mesa: json.mesa,
        resumo: {
          total_arrecadado: Number(json.resumo?.total_arrecadado) || 0,
          total_comandas: Number(json.resumo?.total_comandas) || 0,
          total_pedidos: Number(json.resumo?.total_pedidos) || 0,
          top_pratos: Array.isArray(json.resumo?.top_pratos) ? json.resumo.top_pratos : [],
        },
        comandas: (json.comandas || []).map((c: any) => ({
          ...c,
          total: Number(c.total) || 0,
          subtotal: Number(c.subtotal) || Number(c.total) || 0,
          gorjeta: Number(c.gorjeta) || 0,
          pedidos: (c.pedidos || []).map((p: any) => ({
            ...p,
            preco_unitario: Number(p.preco_unitario) || 0,
            quantidade: Number(p.quantidade) || 0,
          })),
        })),
      };
      // Sort most recent first
      normalized.comandas.sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setData(normalized);
      setError("");
    } catch (e: any) {
      console.error("[MesaHistorico] Erro:", e);
      const status = e?.status;
      const msg = e instanceof Error ? e.message : String(e);
      setError(status ? `Erro ${status}: ${msg}` : "Não foi possível carregar o histórico da mesa.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      router.back();
      return;
    }
    fetchHistorico();
    return () => {
      clearMesaHistoricoId();
    };
  }, [fetchHistorico, id]);

  if (!id) return null;

  const handleRefresh = () => {
    console.log("[MesaHistorico] Refresh manual");
    setRefreshing(true);
    fetchHistorico();
  };

  // Derived display values
  const mesaNumero = data?.mesa?.numero ?? "—";
  const mesaStatus = data?.mesa?.status ?? "";
  const mesaCapacidade = data?.mesa?.capacidade ?? 0;
  const circleColor = getMesaCircleColor(mesaStatus);
  const statusLabel = getMesaStatusLabel(mesaStatus);
  const totalArrecadado = formatCurrency(data?.resumo?.total_arrecadado ?? 0);
  const totalComandas = String(data?.resumo?.total_comandas ?? 0);
  const totalPedidos = String(data?.resumo?.total_pedidos ?? 0);
  const navSubtitle = data ? `Mesa ${mesaNumero}` : "";

  // Filtered comandas
  const filteredComandas = (data?.comandas ?? []).filter((c) => {
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const matchGarcom = c.garcom_nome?.toLowerCase().includes(q);
      const matchDate = formatDateTime(c.created_at).toLowerCase().includes(q);
      if (!matchGarcom && !matchDate) return false;
    }
    if (dateFrom) {
      const start = new Date(dateFrom);
      start.setHours(0, 0, 0, 0);
      if (new Date(c.created_at) < start) return false;
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (new Date(c.created_at) > end) return false;
    }
    return true;
  });

  // Compute top pratos from filtered comandas
  const computedTopPratos: TopPrato[] = (() => {
    const map = new Map<string, { total_quantidade: number; total_receita: number }>();
    filteredComandas.forEach((c) => {
      c.pedidos.forEach((p) => {
        const existing = map.get(p.prato_nome) ?? { total_quantidade: 0, total_receita: 0 };
        map.set(p.prato_nome, {
          total_quantidade: existing.total_quantidade + p.quantidade,
          total_receita: existing.total_receita + p.quantidade * p.preco_unitario,
        });
      });
    });
    return Array.from(map.entries())
      .map(([prato_nome, v]) => ({ prato_nome, ...v }))
      .sort((a, b) => b.total_quantidade - a.total_quantidade)
      .slice(0, 10);
  })();

  const hasFilters = !!searchText.trim() || !!dateFrom || !!dateTo;
  const topPratos: TopPrato[] = hasFilters
    ? computedTopPratos
    : (data?.resumo?.top_pratos ?? []);

  // Rank badge colors
  const rankBgColor = (index: number) =>
    index === 0
      ? "rgba(251,191,36,0.15)"
      : index === 1
      ? "rgba(148,163,184,0.15)"
      : index === 2
      ? "rgba(180,120,60,0.12)"
      : COLORS.background;

  const rankBorderColor = (index: number) =>
    index === 0
      ? "rgba(251,191,36,0.3)"
      : index === 1
      ? "rgba(148,163,184,0.3)"
      : index === 2
      ? "rgba(180,120,60,0.2)"
      : COLORS.border;

  const rankTextColor = (index: number) =>
    index === 0
      ? "#FBBF24"
      : index === 1
      ? "#94A3B8"
      : index === 2
      ? "#B4783C"
      : COLORS.textSecondary;

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
          onPress={() => { console.log("[MesaHistorico] Botão voltar pressionado"); router.back(); }}
          style={{ flexDirection: "row", alignItems: "center", padding: 8, zIndex: 10 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color="#22c55e" />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#22c55e", marginLeft: 4 }}>Voltar</Text>
        </Pressable>
        <View style={{ position: "absolute", left: 0, right: 0, alignItems: "center", pointerEvents: "none" }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
            Histórico
          </Text>
          {navSubtitle ? (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 1 }}>
              {navSubtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: "rgba(239,68,68,0.10)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="alert-circle-outline" size={34} color={COLORS.danger} />
          </View>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text, textAlign: "center" }}>
            Erro ao carregar histórico
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
            {error}
          </Text>
          <AnimatedPressable
            onPress={() => { console.log("[MesaHistorico] Tentar novamente pressionado"); setLoading(true); fetchHistorico(); }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        >
          {/* Mesa info card */}
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            padding: 20,
            borderWidth: 1,
            borderColor: COLORS.border,
            gap: 16,
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                backgroundColor: circleColor + "18",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 28, color: circleColor }}>
                  {mesaNumero}
                </Text>
              </View>
              <View style={{ backgroundColor: circleColor + "20", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: circleColor }}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Users size={16} color={COLORS.textSecondary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                Capacidade:
              </Text>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {mesaCapacidade}
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                pessoas
              </Text>
            </View>
          </View>

          {/* Resumo card */}
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
          }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text, marginBottom: 14 }}>
              Resumo
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {/* Total arrecadado */}
              <View style={{
                flex: 2,
                backgroundColor: "rgba(34,197,94,0.08)",
                borderRadius: 14,
                padding: 14,
                alignItems: "center",
                gap: 4,
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.18)",
              }}>
                <Text style={{ fontSize: 20 }}>💰</Text>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#22C55E", textAlign: "center" }}>
                  {totalArrecadado}
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, textAlign: "center" }}>
                  Total Arrecadado (s/ gorjeta)
                </Text>
              </View>
              {/* Comandas */}
              <View style={{
                flex: 1,
                backgroundColor: COLORS.background,
                borderRadius: 14,
                padding: 14,
                alignItems: "center",
                gap: 4,
                borderWidth: 1,
                borderColor: COLORS.border,
              }}>
                <Text style={{ fontSize: 20 }}>🧾</Text>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                  {totalComandas}
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, textAlign: "center" }}>
                  Comandas
                </Text>
              </View>
              {/* Pedidos */}
              <View style={{
                flex: 1,
                backgroundColor: COLORS.background,
                borderRadius: 14,
                padding: 14,
                alignItems: "center",
                gap: 4,
                borderWidth: 1,
                borderColor: COLORS.border,
              }}>
                <Text style={{ fontSize: 20 }}>🍽️</Text>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                  {totalPedidos}
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, textAlign: "center" }}>
                  Pedidos
                </Text>
              </View>
            </View>
          </View>

          {/* Pratos mais pedidos */}
          {topPratos.length > 0 && (
            <View style={{
              backgroundColor: COLORS.surface,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
              gap: 12,
            }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>
                🏆 Pratos Mais Pedidos
              </Text>
              {topPratos.map((item, index) => {
                const isLast = index === topPratos.length - 1;
                const bgColor = rankBgColor(index);
                const borderColor = rankBorderColor(index);
                const textColor = rankTextColor(index);
                const rankLabel = String(index + 1);
                const pedidosLabel = item.total_quantidade !== 1 ? "pedidos" : "pedido";
                const receitaLabel = formatCurrency(item.total_receita);
                return (
                  <View
                    key={item.prato_nome}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 8,
                      borderBottomWidth: isLast ? 0 : 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    {/* Rank badge */}
                    <View style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      backgroundColor: bgColor,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: borderColor,
                    }}>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: textColor }}>
                        {rankLabel}
                      </Text>
                    </View>
                    {/* Name */}
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text, flex: 1 }}>
                      {item.prato_nome}
                    </Text>
                    {/* Stats */}
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.primary }}>
                          {item.total_quantidade}
                        </Text>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.primary }}>
                          ×
                        </Text>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.primary }}>
                          {pedidosLabel}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                        {receitaLabel}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Search bar */}
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            paddingHorizontal: 14,
            paddingVertical: 10,
            gap: 10,
          }}>
            <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
            <TextInput
              value={searchText}
              onChangeText={(text) => {
                console.log("[MesaHistorico] Search text changed:", text);
                setSearchText(text);
              }}
              placeholder="Buscar por garçom ou data..."
              placeholderTextColor={COLORS.textSecondary}
              style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }}
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => { console.log("[MesaHistorico] Search cleared"); setSearchText(""); }}>
                <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Date range filter — inline calendar pickers */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {/* De button */}
              <Pressable
                onPress={() => {
                  const next = !showFromPicker;
                  console.log("[MesaHistorico] Date from picker toggled:", next);
                  setShowFromPicker(next);
                  if (next) setShowToPicker(false);
                }}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: COLORS.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: dateFrom ? COLORS.primary : COLORS.border,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Ionicons name="calendar-outline" size={16} color={dateFrom ? COLORS.primary : COLORS.textSecondary} />
                <Text style={{
                  flex: 1,
                  fontFamily: "Outfit_400Regular",
                  fontSize: 13,
                  color: dateFrom ? COLORS.text : COLORS.textSecondary,
                }}>
                  {dateFrom ? formatDateDisplay(dateFrom) : "De"}
                </Text>
                {dateFrom ? (
                  <Pressable
                    onPress={() => {
                      console.log("[MesaHistorico] Date from cleared");
                      setDateFrom(null);
                      setShowFromPicker(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={15} color={COLORS.textSecondary} />
                  </Pressable>
                ) : null}
              </Pressable>

              {/* Até button */}
              <Pressable
                onPress={() => {
                  const next = !showToPicker;
                  console.log("[MesaHistorico] Date to picker toggled:", next);
                  setShowToPicker(next);
                  if (next) setShowFromPicker(false);
                }}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: COLORS.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: dateTo ? COLORS.primary : COLORS.border,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Ionicons name="calendar-outline" size={16} color={dateTo ? COLORS.primary : COLORS.textSecondary} />
                <Text style={{
                  flex: 1,
                  fontFamily: "Outfit_400Regular",
                  fontSize: 13,
                  color: dateTo ? COLORS.text : COLORS.textSecondary,
                }}>
                  {dateTo ? formatDateDisplay(dateTo) : "Até"}
                </Text>
                {dateTo ? (
                  <Pressable
                    onPress={() => {
                      console.log("[MesaHistorico] Date to cleared");
                      setDateTo(null);
                      setShowToPicker(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={15} color={COLORS.textSecondary} />
                  </Pressable>
                ) : null}
              </Pressable>
            </View>

            {/* From picker */}
            {showFromPicker ? (
              <InlineCalendar
                value={dateFrom}
                onSelect={(d) => {
                  console.log("[MesaHistorico] Date from selected:", d.toISOString().slice(0, 10));
                  setDateFrom(d);
                  setShowFromPicker(false);
                }}
                colors={COLORS}
              />
            ) : null}

            {/* To picker */}
            {showToPicker ? (
              <InlineCalendar
                value={dateTo}
                onSelect={(d) => {
                  console.log("[MesaHistorico] Date to selected:", d.toISOString().slice(0, 10));
                  setDateTo(d);
                  setShowToPicker(false);
                }}
                colors={COLORS}
              />
            ) : null}
          </View>

          {/* Comandas list */}
          <View style={{ gap: 10 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>
              Comandas
            </Text>
            {data && filteredComandas.length === 0 ? (
              <View style={{
                backgroundColor: COLORS.surface,
                borderRadius: 16,
                padding: 32,
                alignItems: "center",
                borderWidth: 1,
                borderColor: COLORS.border,
                gap: 8,
              }}>
                <Text style={{ fontSize: 32 }}>🧾</Text>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text, textAlign: "center" }}>
                  {hasFilters
                    ? "Nenhuma comanda encontrada para os filtros aplicados"
                    : "Nenhuma comanda registrada para esta mesa"}
                </Text>
              </View>
            ) : (
              filteredComandas.map((comanda) => (
                <ComandaCard key={comanda.id} comanda={comanda} />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
