import React, { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import useModoComanda from "@/hooks/useModoComanda";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { Mesa } from "@/types";
import { apiGet } from "@/utils/api";
import { getMesaStatusLabel, getMesaStatusColor, isAdmin } from "@/utils/helpers";
import { Users } from "lucide-react-native";


interface Pedido {
  id: string | number;
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string | null;
  status: string;
}

interface ComandaInfo {
  id: string | number;
  aberta_em: string;
  garcom_nome: string;
  total: number;
  status: string;
  pedidos: Pedido[];
}

// Comanda aberta da mesa, como devolvida por GET /api/mesas/:id/comandas (modo individual)
interface ComandaResumo {
  id: string;
  rotulo: string | null;
  garcom_nome: string;
  total: number;
  item_count: number;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatPrice(value: number | string): string {
  return Number(value).toFixed(2).replace(".", ",");
}

function getPedidoStatusConfig(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "em_preparo":
      return { label: "Em Preparo", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" };
    case "pronto":
      return { label: "Pronto", color: "#22C55E", bg: "rgba(34,197,94,0.12)" };
    case "entregue":
      return { label: "Entregue", color: "#3B82F6", bg: "rgba(59,130,246,0.12)" };
    default:
      return { label: "Pendente", color: "#94A3B8", bg: "rgba(148,163,184,0.12)" };
  }
}

export default function MesaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;
  const canAdmin = isAdmin(role);

  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [comanda, setComanda] = useState<ComandaInfo | null>(null);
  const [comandaLoading, setComandaLoading] = useState(false);

  // Modo individual: várias comandas abertas na mesma mesa, cada uma com nome
  const { modo } = useModoComanda();
  const individual = modo === "individual";
  const [comandas, setComandas] = useState<ComandaResumo[]>([]);
  const [comandasLoading, setComandasLoading] = useState(false);
  const [comandasError, setComandasError] = useState("");

  const fetchComandas = useCallback(async () => {
    if (!id) return;
    console.log("[Mesa] GET /api/mesas/" + id + "/comandas");
    setComandasLoading(true);
    setComandasError("");
    try {
      const data = await apiGet<any>(`/api/mesas/${id}/comandas`);
      const lista: ComandaResumo[] = Array.isArray(data?.comandas) ? data.comandas : [];
      console.log("[Mesa] Comandas abertas:", lista.length);
      setComandas(lista);
    } catch (e: any) {
      console.error("[Mesa] Erro ao buscar comandas da mesa:", e);
      setComandasError("Não foi possível carregar as comandas da mesa.");
    } finally {
      setComandasLoading(false);
    }
  }, [id]);

  // Busca ao abrir a tela e sempre que ela volta ao foco (ex.: depois de criar ou fechar uma comanda)
  useFocusEffect(
    useCallback(() => {
      if (individual) fetchComandas();
    }, [individual, fetchComandas])
  );

  const fetchComanda = useCallback(async (mesaId: string) => {
    console.log("[Mesa] GET /api/mesas/" + mesaId + "/comanda");
    setComandaLoading(true);
    try {
      const data = await apiGet<any>(`/api/mesas/${mesaId}/comanda`);
      const c: ComandaInfo | null = data.comanda ?? data ?? null;
      if (c) {
        c.total = parseFloat(String(c.total)) || 0;
        if (!c.aberta_em) {
          c.aberta_em = (c as any).created_at ?? "";
        }
      }
      console.log("[Mesa] Comanda carregada:", c?.id ?? "nenhuma", "total:", c?.total);
      setComanda(c);
    } catch (e: any) {
      console.error("[Mesa] Erro ao buscar comanda:", e);
      setComanda(null);
    } finally {
      setComandaLoading(false);
    }
  }, []);

  const fetchMesa = useCallback(async () => {
    console.log("[Mesa] GET /api/mesas/" + id);
    try {
      const res = await apiGet<any>(`/api/mesas/${id}`);
      const m: Mesa = res.mesa || res;
      setMesa(m);
      setError("");
      if ((m.status as string) === "ocupada") {
        fetchComanda(String(id));
      } else {
        setComanda(null);
      }
    } catch (e: any) {
      console.error("[Mesa] Erro:", e);
      setError("Não foi possível carregar a mesa.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, fetchComanda]);

  useEffect(() => { fetchMesa(); }, [fetchMesa]);

  const handleRefresh = () => {
    console.log("[Mesa] Refresh manual");
    setRefreshing(true);
    fetchMesa();
    if (individual) fetchComandas();
  };

  const handleOpenComanda = () => {
    if (!mesa) return;
    console.log("[Mesa] Abrir Comanda (cardápio) pressionado para mesa:", mesa.numero, "id:", mesa.id);
    router.push({
      pathname: "/comanda/nova",
      params: { mesa_id: mesa.id, mesa_numero: String(mesa.numero) },
    });
  };

  const statusColor = getMesaStatusColor(mesa?.status ?? "livre");
  const statusLabel = getMesaStatusLabel(mesa?.status ?? "livre");
  const mesaTitle = mesa ? `Mesa ${mesa.numero}` : "Detalhes da Mesa";
  const mesaNumero = mesa?.numero;
  const mesaCapacidade = mesa?.capacidade;
  const mesaStatus = mesa?.status ?? "livre";
  // comanda_id may live on the mesa object directly OR come from the fetched comanda
  // No modo individual a mesa pode ter várias comandas: não existe "a" comanda da mesa
  const comandaId = individual ? null : ((mesa as any)?.comanda_id ?? comanda?.id ?? null);
  const garcomName = (mesa as any)?.garcom?.name;

  const isOcupada = (mesaStatus as string) === "ocupada";
  // Itens cancelados não aparecem nem entram na contagem (não são venda)
  const pedidosCount = comanda?.pedidos?.filter((p) => p.status !== "cancelado").length ?? 0;
  const abertoEm = comanda ? formatDateTime(comanda.aberta_em || (comanda as any).created_at || "") : "";
  const totalFormatted = comanda ? formatPrice(comanda.total) : "0,00";

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
          onPress={() => { console.log("[Mesa] Botão voltar pressionado"); router.back(); }}
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
          {mesaTitle}
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Erro ao carregar mesa</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>{error}</Text>
          <AnimatedPressable
            onPress={fetchMesa}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
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
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, gap: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: statusColor + "18", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 28, color: statusColor }}>{mesaNumero}</Text>
              </View>
              <View style={{ backgroundColor: statusColor + "20", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: statusColor }}>{statusLabel}</Text>
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Users size={16} color={COLORS.textSecondary} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Capacidade:</Text>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{mesaCapacidade} pessoas</Text>
              </View>
              {garcomName ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Garçom:</Text>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{garcomName}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Modo individual: lista de comandas abertas da mesa */}
          {individual ? (
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text, marginBottom: 10 }}>
                Comandas abertas ({comandas.length})
              </Text>
              {comandasLoading && comandas.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
              ) : comandasError ? (
                <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", gap: 10 }}>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    {comandasError}
                  </Text>
                  <AnimatedPressable
                    onPress={fetchComandas}
                    style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: "#fff" }}>Tentar novamente</Text>
                  </AnimatedPressable>
                </View>
              ) : comandas.length === 0 ? (
                <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                    Nenhuma comanda aberta nesta mesa
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {comandas.map((c) => {
                    const nome = c.rotulo && c.rotulo.trim().length > 0 ? c.rotulo.trim() : "Sem nome";
                    const itens = `${c.item_count} ${c.item_count === 1 ? "item" : "itens"}`;
                    return (
                      <AnimatedPressable
                        key={c.id}
                        onPress={() => {
                          console.log("[Mesa] Comanda pressionada:", c.id, "nome:", nome);
                          router.push({ pathname: `/comanda/${c.id}`, params: { mesa_numero: String(mesa?.numero ?? ""), mesa_id: String(mesa?.id ?? "") } });
                        }}
                        style={{
                          backgroundColor: COLORS.surface,
                          borderRadius: 14,
                          padding: 14,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          gap: 4,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text numberOfLines={1} style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text, flex: 1, marginRight: 8 }}>
                            {nome}
                          </Text>
                          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.primary }}>
                            R$ {formatPrice(c.total)}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                          {c.garcom_nome} · {itens}
                        </Text>
                      </AnimatedPressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* Comanda section — only when ocupada (modo mesa) */}
          {isOcupada && !individual ? (
            comandaLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, marginTop: 8 }}>
                  Carregando comanda...
                </Text>
              </View>
            ) : comanda ? (
              <>
                {/* Comanda header card */}
                <View>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text, marginBottom: 10 }}>
                    Comanda Ativa
                  </Text>
                  <View style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    gap: 10,
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.06,
                    shadowRadius: 4,
                    elevation: 2,
                  }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ gap: 8, flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 15 }}>🧾</Text>
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                            Aberta em:
                          </Text>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>
                            {abertoEm}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 15 }}>👤</Text>
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                            Garçom:
                          </Text>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>
                            {comanda.garcom_nome}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 15 }}>💰</Text>
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                            Total:
                          </Text>
                          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.primary }}>
                            R$ {totalFormatted}
                          </Text>
                        </View>
                      </View>
                      <View style={{ backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginLeft: 12 }}>
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: "#22C55E" }}>Aberta</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Pedidos list */}
                <View>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text, marginBottom: 10 }}>
                    Pedidos ({pedidosCount})
                  </Text>
                  {pedidosCount === 0 ? (
                    <View style={{
                      backgroundColor: COLORS.surface,
                      borderRadius: 16,
                      padding: 20,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      alignItems: "center",
                    }}>
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>
                        Nenhum pedido ainda
                      </Text>
                    </View>
                  ) : (
                    <View style={{ gap: 10 }}>
                      {comanda.pedidos.filter((p) => p.status !== "cancelado").map((pedido) => {
                        const statusCfg = getPedidoStatusConfig(pedido.status);
                        const precoFormatted = formatPrice(pedido.preco_unitario);
                        const qtdPreco = `${pedido.quantidade}x R$ ${precoFormatted}`;
                        const hasObs = pedido.observacao && pedido.observacao.trim().length > 0;
                        return (
                          <View
                            key={pedido.id}
                            style={{
                              backgroundColor: COLORS.surface,
                              borderRadius: 14,
                              padding: 14,
                              borderWidth: 1,
                              borderColor: COLORS.border,
                              gap: 6,
                              shadowColor: "#000",
                              shadowOffset: { width: 0, height: 1 },
                              shadowOpacity: 0.05,
                              shadowRadius: 3,
                              elevation: 1,
                            }}
                          >
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.text, flex: 1, marginRight: 8 }}>
                                {pedido.prato_nome}
                              </Text>
                              <View style={{ backgroundColor: statusCfg.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: statusCfg.color }}>
                                  {statusCfg.label}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                              {qtdPreco}
                            </Text>
                            {hasObs ? (
                              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textTertiary, fontStyle: "italic" }}>
                                {pedido.observacao}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            ) : null
          ) : null}

          {/* Action buttons */}
          {comandaId ? (
            <AnimatedPressable
              onPress={() => { console.log("[Mesa] Ver comanda pressionado:", comandaId, "mesa_numero:", mesaNumero, "mesa_id:", mesa?.id); router.push({ pathname: `/comanda/${comandaId}`, params: { mesa_numero: String(mesa?.numero ?? ''), mesa_id: String(mesa?.id ?? '') } }); }}
              style={{ backgroundColor: COLORS.primaryMuted, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary + "30" }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.primary }}>Ver comanda ativa</Text>
            </AnimatedPressable>
          ) : null}

          {((mesaStatus === "livre" || (mesaStatus as string) === "disponivel") || (individual && isOcupada)) && (role === "garcom" || canAdmin) ? (
            <AnimatedPressable
              onPress={() => { console.log("[Mesa] Abrir Comanda pressionado"); handleOpenComanda(); }}
              style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>{individual ? "Nova comanda" : "Abrir Comanda"}</Text>
            </AnimatedPressable>
          ) : null}

          {mesaStatus === "ocupada" && comandaId ? (
            <AnimatedPressable
              onPress={() => { console.log("[Mesa] Fazer pedido pressionado, comanda:", comandaId); router.push({ pathname: "/pedido/novo", params: { comanda_id: comandaId, mesa_id: id } }); }}
              style={{ backgroundColor: COLORS.surface, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>Fazer pedido</Text>
            </AnimatedPressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
