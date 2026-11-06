import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";
import { useAuth } from "@/contexts/AuthContext";
import { hojeNoAparelho, deslocarDias } from "@/utils/exportacao/periodo";
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

interface ComandaDiaItem {
  id: string;
  mesa_numero: number | null;
  rotulo: string | null;
  garcom_nome: string | null;
  status: string;
  total: number;
  item_count: number;
  itens_cancelados: number;
  created_at: string | null;
  closed_at: string | null;
}
interface ComandasDiaResp {
  data: string;
  limit: number;
  offset: number;
  total: number;
  resumo: { abertas: number; fechadas: number; canceladas: number; total_fechadas: number };
  comandas: ComandaDiaItem[];
}

const PAGE_SIZE = 50;
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
function rotuloDia(iso: string, hoje: string): string {
  if (iso === hoje) return "Hoje";
  if (iso === deslocarDias(hoje, -1)) return "Ontem";
  const [a, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay();
  return `${DIAS_SEMANA[dow]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
function horaSP(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  const p = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("hour")}:${g("minute")}`;
}

const DIA_STATUS_COLORS: Record<string, string> = { aberta: "#22C55E", fechada: "#94A3B8", cancelada: "#EF4444" };
const DIA_STATUS_LABELS: Record<string, string> = { aberta: "Aberta", fechada: "Fechada", cancelada: "Cancelada" };

function ComandasPorDia({ bottomPadding }: { bottomPadding: number }) {
  const COLORS = useColors();
  const router = useRouter();
  const [dia, setDia] = useState(() => hojeNoAparelho());
  const [lista, setLista] = useState<ComandaDiaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [resumo, setResumo] = useState<ComandasDiaResp["resumo"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [erro, setErro] = useState("");
  const [pickerAberto, setPickerAberto] = useState(false);
  const reqRef = useRef(0);

  const hoje = hojeNoAparelho();
  const ehHoje = dia >= hoje;

  const carregar = useCallback(async (alvo: string, offset: number) => {
    const req = ++reqRef.current;
    try {
      const res = await apiGet<ComandasDiaResp>(`/api/comandas-dia?data=${alvo}&limit=${PAGE_SIZE}&offset=${offset}`);
      if (req !== reqRef.current) return;
      const novas = res.comandas ?? [];
      setLista((prev) => {
        if (offset === 0) return novas;
        const ids = new Set(prev.map((c) => c.id));
        return [...prev, ...novas.filter((c) => !ids.has(c.id))];
      });
      setTotal(Number(res.total ?? 0));
      setResumo(res.resumo ?? null);
      setErro("");
    } catch (e: any) {
      if (req !== reqRef.current) return;
      console.error("[Comandas/Dia] Erro:", e instanceof Error ? e.message : String(e));
      setErro(e?.message || "Não foi possível carregar as comandas.");
    } finally {
      if (req === reqRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setLista([]);
      setResumo(null);
      setTotal(0);
      carregar(dia, 0);
    }, [dia, carregar])
  );

  const mudarDia = (novo: string) => {
    const limitado = novo > hojeNoAparelho() ? hojeNoAparelho() : novo;
    if (limitado !== dia) setDia(limitado);
  };

  const onPickerChange = (ev: any, d?: Date) => {
    if (Platform.OS !== "ios" || ev.type === "dismissed") setPickerAberto(false);
    if (ev.type === "dismissed" || !d) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    mudarDia(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    if (Platform.OS === "ios") setPickerAberto(false);
  };

  const navBtn = (disabled: boolean) => ({
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    opacity: disabled ? 0.35 : 1,
  });

  const header = (
    <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={() => mudarDia(deslocarDias(dia, -1))}
          accessibilityRole="button"
          accessibilityLabel="Dia anterior"
          style={navBtn(false)}
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </Pressable>
        <Pressable
          onPress={() => setPickerAberto(true)}
          accessibilityRole="button"
          accessibilityLabel="Escolher data"
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: COLORS.surface,
            borderWidth: 1,
            borderColor: COLORS.border,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>{rotuloDia(dia, hoje)}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>{dataBr(dia)}</Text>
        </Pressable>
        <Pressable
          onPress={() => !ehHoje && mudarDia(deslocarDias(dia, 1))}
          disabled={ehHoje}
          accessibilityRole="button"
          accessibilityLabel="Próximo dia"
          accessibilityState={{ disabled: ehHoje }}
          style={navBtn(ehHoje)}
        >
          <Ionicons name="chevron-forward" size={20} color={COLORS.text} />
        </Pressable>
      </View>

      {resumo && (
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {[
              { k: "Abertas", v: resumo.abertas, c: "#22C55E" },
              { k: "Fechadas", v: resumo.fechadas, c: COLORS.text },
              { k: "Canceladas", v: resumo.canceladas, c: "#EF4444" },
            ].map((x) => (
              <View key={x.k} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: x.c }}>{x.v}</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>{x.k}</Text>
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: COLORS.divider,
            }}
          >
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Recebido nas fechadas</Text>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>{formatCurrency(Number(resumo.total_fechadas) || 0)}</Text>
          </View>
        </View>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: ComandaDiaItem }) => {
    const cor = DIA_STATUS_COLORS[item.status] ?? "#94A3B8";
    const rotulo = typeof item.rotulo === "string" ? item.rotulo.trim() : "";
    const abre = horaSP(item.created_at);
    const fecha = horaSP(item.closed_at);
    const qtd = item.item_count ?? 0;
    return (
      <AnimatedPressable
        onPress={() => router.push({ pathname: "/comanda-dia/[id]", params: { id: item.id } })}
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: COLORS.border,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
              Mesa {item.mesa_numero ?? "—"}
              {rotulo ? <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}>{`  ${rotulo}`}</Text> : null}
            </Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
              {abre || "—"}
              {fecha ? ` → ${fecha}` : ""}
              {item.garcom_nome ? ` · ${item.garcom_nome}` : ""}
            </Text>
          </View>
          <View style={{ backgroundColor: cor + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: cor }}>
              {DIA_STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: COLORS.divider,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
              {qtd} {qtd === 1 ? "item" : "itens"}
            </Text>
            {item.itens_cancelados > 0 && (
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: "#EF4444" }}>
                {item.itens_cancelados} cancelados
              </Text>
            )}
          </View>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>
            {formatCurrency(Number(item.total) || 0)}
          </Text>
        </View>
      </AnimatedPressable>
    );
  };

  const picker = pickerAberto ? (
    Platform.OS === "ios" ? (
      <Modal transparent animationType="fade" onRequestClose={() => setPickerAberto(false)}>
        <Pressable
          onPress={() => setPickerAberto(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}
        >
          <Pressable style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 12 }}>
            <DateTimePicker
              value={new Date(`${dia}T12:00:00`)}
              mode="date"
              display="inline"
              maximumDate={new Date()}
              onChange={onPickerChange}
            />
          </Pressable>
        </Pressable>
      </Modal>
    ) : (
      <DateTimePicker
        value={new Date(`${dia}T12:00:00`)}
        mode="date"
        display="default"
        maximumDate={new Date()}
        onChange={onPickerChange}
      />
    )
  ) : null;

  if (erro && lista.length === 0 && !loading) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ alignItems: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Erro ao carregar comandas</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>{erro}</Text>
          <AnimatedPressable
            onPress={() => {
              setLoading(true);
              carregar(dia, 0);
            }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View>
        {picker}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={lista}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: bottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              carregar(dia, 0);
            }}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 32 }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : (
            <View style={{ alignItems: "center", padding: 48 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Nenhuma comanda neste dia</Text>
            </View>
          )
        }
        ListFooterComponent={
          !loading && lista.length > 0 && lista.length < total ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              {!!erro && (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: "#EF4444", textAlign: "center", marginBottom: 8 }}>{erro}</Text>
              )}
              <AnimatedPressable
                onPress={() => {
                  if (loadingMore) return;
                  setLoadingMore(true);
                  carregar(dia, lista.length);
                }}
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                {loadingMore ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}>
                    {`Carregar mais (${lista.length} de ${total})`}
                  </Text>
                )}
              </AnimatedPressable>
            </View>
          ) : null
        }
      />
      {picker}
    </View>
  );
}

export default function ComandasScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user } = useAuth();
  const papel = String((user as any)?.role ?? "").toLowerCase();
  const podeVerPorDia = ["gerente", "administrador", "admin"].includes(papel);
  const [modo, setModo] = useState<"andamento" | "dia">("andamento");
  const porDia = podeVerPorDia && modo === "dia";

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
        {podeVerPorDia && (
          <View
            style={{
              flexDirection: "row",
              marginTop: 14,
              backgroundColor: COLORS.background,
              borderRadius: 12,
              padding: 3,
            }}
          >
            {([
              { v: "andamento", l: "Em andamento" },
              { v: "dia", l: "Por dia" },
            ] as const).map((o) => {
              const ativo = modo === o.v;
              return (
                <Pressable
                  key={o.v}
                  onPress={() => setModo(o.v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ativo }}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    backgroundColor: ativo ? COLORS.primary : "transparent",
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: ativo ? "#fff" : COLORS.textSecondary }}>
                    {o.l}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {porDia ? (
        <ComandasPorDia bottomPadding={listPaddingBottom} />
      ) : loading ? (
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
                router.push({ pathname: "/comanda/[id]", params: { id: item.id, mesa_numero: String(item.mesa_numero ?? ''), mesa_id: String(item.mesa_id ?? '') } });
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
      {!porDia && (
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
      )}
    </View>
  );
}
