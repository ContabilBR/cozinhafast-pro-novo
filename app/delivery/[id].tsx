import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput, Modal } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPut } from "@/utils/api";
import { formatCurrency, formatRelativeTime, parseBRL } from "@/utils/helpers";
import { formatViaEntrega, formatEtiquetaLacre, imprimirViaDelivery } from "@/utils/deliveryPrinter";
import { useAuth } from "@/contexts/AuthContext";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { CampoMoeda } from "@/components/CampoMoeda";

const ETAPA_FLOW = ["pendente", "preparando", "pronto_para_despachar", "saiu_entrega", "entregue"] as const;
type Etapa = typeof ETAPA_FLOW[number];

const ETAPA_LABELS: Record<string, string> = {
  pendente: "Pendente",
  preparando: "Preparando",
  pronto_para_despachar: "Pronto para despachar",
  saiu_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelada: "Cancelada",
};
const ETAPA_ICONS: Record<string, string> = {
  pendente: "time-outline",
  preparando: "flame-outline",
  pronto_para_despachar: "checkmark-done-outline",
  saiu_entrega: "bicycle-outline",
  entregue: "checkmark-circle-outline",
  cancelada: "close-circle-outline",
};
const ETAPA_COLORS: Record<string, string> = {
  pendente: "#6B7280",
  preparando: "#6B7280",
  pronto_para_despachar: "#22C55E",
  saiu_entrega: "#3B82F6",
  entregue: "#22C55E",
  cancelada: "#6B7280",
};
// Cor neutra para passos já concluídos (não o atual)
const DONE_COLOR = "#22C55E";
const DONE_ICON = "checkmark";

function normalizarForma(raw: string | undefined): "dinheiro" | "pix" | "credito" | "debito" {
  if (!raw) return "dinheiro";
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "pix") return "pix";
  if (s.includes("credito") || s === "credito") return "credito";
  if (s.includes("debito") || s === "debito") return "debito";
  return "dinheiro";
}

const MOTIVO_LABELS: Record<string, string> = {
  erro_lancamento: "Erro de lançamento",
  cliente_desistiu: "Cliente desistiu",
  item_em_falta: "Item em falta",
  demora: "Demora",
  qualidade: "Problema de qualidade",
  outro: "Outro",
  cliente_nao_atendeu: "Cliente não atendeu na entrega",
  endereco_fora_area: "Endereço fora da área de entrega",
};

export default function DeliveryDetalhes() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showDespacharForm, setShowDespacharForm] = useState(false);
  const [entregadorNome, setEntregadorNome] = useState("");
  const [entregadorTelefone, setEntregadorTelefone] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cancelDetalhe, setCancelDetalhe] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [cancelFormaEstorno, setCancelFormaEstorno] = useState("");
  const [cancelDetalheEstorno, setCancelDetalheEstorno] = useState("");
  const [cancelObsEstorno, setCancelObsEstorno] = useState("");
  const [cancelConfirmacaoEstorno, setCancelConfirmacaoEstorno] = useState(false);
  const [showConfirmarModal, setShowConfirmarModal] = useState(false);
  const [confirmarForma, setConfirmarForma] = useState<string>("");
  const [confirmarValorRecebido, setConfirmarValorRecebido] = useState("");
  const [confirmarErro, setConfirmarErro] = useState<string | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [perguntarImpressao, setPerguntarImpressao] = useState(false);

  const fetch = useCallback(async () => {
    console.log("[DeliveryDetalhes] Fetching delivery order:", id);
    try {
      const res = await apiGet("/api/delivery/pedidos/" + id);
      console.log("[DeliveryDetalhes] Fetched delivery order:", res);
      setData(res);
    } catch (err) { console.error("[DeliveryDetalhes] Error fetching delivery order:", err); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetch(); }, [fetch]);

  const buildViaParams = (pedidoData: any) => {
    const e = pedidoData.entrega;
    const pag = pedidoData.pagamentos?.[0];
    const jaFoiPago = pag?.status === "confirmado";
    const formaRaw: string = pag?.forma_pagamento || pag?.formaPagamento || "dinheiro";

    let trocoParaRef: string | undefined;
    let troco: number | undefined;
    const ref: string = pag?.referencia || "";
    if (ref.startsWith("Troco")) {
      trocoParaRef = ref;
      if (jaFoiPago && ref.startsWith("Troco:")) {
        const match = ref.match(/[\d,.]+/);
        if (match) {
          troco = parseFloat(match[0].replace(",", "."));
        }
      }
    }

    const itensAtivos = (pedidoData.itens || []).filter((i: any) => i.status !== "cancelado");
    const subtotal = itensAtivos.reduce((acc: number, item: any) => {
      return acc + parseFloat(item.preco_unitario || item.precoUnitario || "0") * (item.quantidade || 1);
    }, 0);

    let horarioLimite: string | undefined;
    if (e.tempo_estimado && e.created_at) {
      const base = new Date(e.created_at);
      if (!isNaN(base.getTime())) {
        const minutos = parseInt(String(e.tempo_estimado), 10);
        if (!isNaN(minutos)) {
          const limite = new Date(base.getTime() + minutos * 60 * 1000);
          const hh = String(limite.getHours()).padStart(2, "0");
          const mm = String(limite.getMinutes()).padStart(2, "0");
          horarioLimite = `${hh}:${mm}`;
        }
      }
    }

    const codigo: string = pedidoData.comanda?.codigo || (e.id || "").slice(0, 6);
    const criadoEm: string = pedidoData.comanda?.created_at || e.created_at || new Date().toISOString();
    const total = parseFloat(pedidoData.comanda?.total || "0");
    const taxaEntrega = parseFloat(e.taxa_entrega || e.taxaEntrega || "0");

    return {
      restaurante: "CozinhaFast Pro",
      codigo,
      criadoEm,
      horarioLimite,
      clienteNome: e.cliente_nome || "",
      clienteTelefone: e.cliente_telefone || undefined,
      endereco: e.endereco || undefined,
      bairro: e.bairro || undefined,
      complemento: e.complemento || undefined,
      cep: e.cep || undefined,
      referencia: e.referencia || undefined,
      observacaoGeral: e.observacao || undefined,
      itens: (pedidoData.itens || []).map((item: any) => ({
        quantidade: item.quantidade || 1,
        nome: item.prato_nome || "Item",
        preco: parseFloat(item.preco_unitario || item.precoUnitario || "0"),
        observacao: item.observacao || undefined,
        cancelado: item.status === "cancelado",
      })),
      subtotal,
      taxaEntrega,
      total,
      pagamento: {
        jaFoiPago,
        forma: formaRaw,
        trocoParaRef,
        troco,
      },
      entregadorNome: e.entregador_nome || undefined,
      saiuEm: e.saiu_em || undefined,
    };
  };

  const handleImprimir = async (tipo: "via" | "etiqueta") => {
    if (!data) return;
    console.log("[DeliveryDetalhes] handleImprimir pressed, tipo:", tipo, "order:", id);
    setImprimindo(true);
    try {
      const params = buildViaParams(data);
      const texto = tipo === "via"
        ? formatViaEntrega(params)
        : formatEtiquetaLacre({
            codigo: params.codigo,
            clienteNome: params.clienteNome,
            bairro: params.bairro,
            pagamento: { jaFoiPago: params.pagamento.jaFoiPago, total: params.total },
          });
      console.log("[DeliveryDetalhes] Calling imprimirViaDelivery, tipo:", tipo);
      const resultado = await imprimirViaDelivery(texto);
      console.log("[DeliveryDetalhes] imprimirViaDelivery result:", resultado);
      if (resultado === "bluetooth") {
        Alert.alert("Impressão", "Via enviada para a impressora.");
      } else if (resultado === "fallback") {
        // Sharing já abriu — nada a fazer
      } else {
        Alert.alert(
          "Impressora não respondeu",
          "Não foi possível enviar para a impressora Bluetooth.",
          [
            {
              text: "Tentar de novo",
              onPress: () => {
                console.log("[DeliveryDetalhes] Retry print pressed, tipo:", tipo);
                handleImprimir(tipo);
              },
            },
            {
              text: "Imprimir pelo aparelho",
              onPress: async () => {
                console.log("[DeliveryDetalhes] Fallback PDF print pressed, tipo:", tipo);
                const params2 = buildViaParams(data);
                const texto2 =
                  tipo === "via"
                    ? formatViaEntrega(params2)
                    : formatEtiquetaLacre({
                        codigo: params2.codigo,
                        clienteNome: params2.clienteNome,
                        bairro: params2.bairro,
                        pagamento: { jaFoiPago: params2.pagamento.jaFoiPago, total: params2.total },
                      });
                const escaped = texto2
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;");
                const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="font-family:monospace;font-size:13px;line-height:1.4;white-space:pre;width:280px;background:#fff;color:#000;padding:8px;margin:0;">${escaped}</body></html>`;
                try {
                  const { uri } = await Print.printToFileAsync({ html, base64: false });
                  const dest = (FileSystem.cacheDirectory ?? "") + "via_delivery_" + Date.now() + ".pdf";
                  await FileSystem.copyAsync({ from: uri, to: dest });
                  await Sharing.shareAsync(dest, { mimeType: "application/pdf", dialogTitle: "Via de entrega" });
                  console.log("[DeliveryDetalhes] Fallback PDF shared successfully");
                } catch (err) {
                  console.error("[DeliveryDetalhes] Fallback PDF error:", err);
                }
              },
            },
            { text: "Cancelar", style: "cancel" },
          ]
        );
      }
    } finally {
      setImprimindo(false);
    }
  };

  const despachar = async () => {
    if (!entregadorNome.trim()) return;
    console.log("[DeliveryDetalhes] Despachar pressed for order:", id, "entregador:", entregadorNome.trim());
    setUpdating(true);
    try {
      await apiPut("/api/delivery/pedidos/" + id + "/status", {
        status: "saiu_entrega",
        entregador_nome: entregadorNome.trim(),
        entregador_telefone: entregadorTelefone.trim() || undefined,
      });
      console.log("[DeliveryDetalhes] Despacho confirmed for order:", id);
      setShowDespacharForm(false);
      setEntregadorNome("");
      setEntregadorTelefone("");
      await fetch();
      setPerguntarImpressao(true);
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error dispatching order:", err);
      const msg = err?.body?.error || err?.message || "Erro ao despachar";
      Alert.alert("Erro", msg);
    } finally {
      setUpdating(false);
    }
  };

  const confirmarEntrega = () => {
    console.log("[DeliveryDetalhes] Confirmar entrega pressed for order:", id);
    const pagPrevisto = data?.pagamentos?.find((p: any) => p.status === "pendente");
    const formaInicial = normalizarForma(pagPrevisto?.forma_pagamento);
    const totalDue = parseFloat(data?.comanda?.total || "0");
    const totalStr = totalDue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setConfirmarForma(formaInicial);
    // Pre-fill valor recebido with total when dinheiro
    setConfirmarValorRecebido(formaInicial === "dinheiro" ? totalStr : "");
    setConfirmarErro(null);
    setShowConfirmarModal(true);
  };

  const executarConfirmacao = async () => {
    console.log("[DeliveryDetalhes] executarConfirmacao pressed for order:", id, "forma:", confirmarForma, "valor:", confirmarValorRecebido);
    setUpdating(true);
    try {
      const body: any = {};
      if (confirmarForma) body.forma_pagamento = confirmarForma;
      if (confirmarForma === "dinheiro" && confirmarValorRecebido) {
        const parsed = parseBRL(confirmarValorRecebido);
        if (parsed !== undefined) body.valor_recebido = parsed;
      }
      console.log("[DeliveryDetalhes] PUT /api/delivery/pedidos/" + id + "/confirmar-entrega", body);
      const res = await apiPut("/api/delivery/pedidos/" + id + "/confirmar-entrega", body);
      console.log("[DeliveryDetalhes] Entrega confirmed for order:", id, res);
      setShowConfirmarModal(false);
      await fetch();
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error confirming delivery:", err);
      const msg = err?.body?.error || err?.message || "Erro ao confirmar entrega";
      setConfirmarErro(msg);
    } finally {
      setUpdating(false);
    }
  };

  const cancelar = () => {
    console.log("[DeliveryDetalhes] Cancel button pressed for order:", id);
    setShowCancelModal(true);
  };

  const confirmarCancelamento = async () => {
    if (!cancelMotivo) return;
    if (cancelMotivo === "outro" && !cancelDetalhe.trim()) return;
    if (data?.exige_estorno) {
      if (!cancelFormaEstorno) return;
      if (cancelFormaEstorno === "outra" && !cancelDetalheEstorno.trim()) return;
      if (!cancelConfirmacaoEstorno) return;
    }
    console.log("[DeliveryDetalhes] Confirming cancellation for order:", id, "motivo:", cancelMotivo, "exige_estorno:", data?.exige_estorno, "forma_estorno:", cancelFormaEstorno);
    setCancelando(true);
    try {
      const body: any = {
        motivo: cancelMotivo,
        detalhe: cancelDetalhe.trim() || undefined,
      };
      if (data?.exige_estorno) {
        body.confirmar_estorno = true;
        body.forma_devolucao = cancelFormaEstorno;
        if (cancelFormaEstorno === "outra") body.detalhe_devolucao = cancelDetalheEstorno.trim();
        if (cancelObsEstorno.trim()) body.observacao_estorno = cancelObsEstorno.trim();
      }
      console.log("[DeliveryDetalhes] PUT /api/delivery/pedidos/" + id + "/cancelar", body);
      await apiPut("/api/delivery/pedidos/" + id + "/cancelar", body);
      console.log("[DeliveryDetalhes] Order cancelled successfully:", id);
      setShowCancelModal(false);
      setCancelMotivo(""); setCancelDetalhe("");
      setCancelFormaEstorno(""); setCancelDetalheEstorno(""); setCancelObsEstorno(""); setCancelConfirmacaoEstorno(false);
      await fetch();
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error cancelling order:", err);
      const msg = err?.body?.error || err?.message || "Erro ao cancelar";
      Alert.alert("Erro", msg);
    } finally {
      setCancelando(false);
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><Text style={{ color: COLORS.textSecondary }}>Pedido não encontrado</Text></View>;

  const e = data.entrega;
  // Usar o campo "etapa" que vem do servidor; fallback para status da entrega
  const etapaAtual: string = e.etapa || e.status || "pendente";
  const currentIdx = ETAPA_FLOW.indexOf(etapaAtual as Etapa);
  const total = parseFloat(data.comanda?.total || "0");

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => { console.log("[DeliveryDetalhes] Back button pressed"); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Pedido #{(e.id || "").slice(0, 6)}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Timeline */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Status da entrega</Text>
          {e.status === "cancelada" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#EF4444", justifyContent: "center", alignItems: "center" }}>
                <Ionicons name="close-circle-outline" size={14} color="white" />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#EF4444" }}>Pedido cancelado</Text>
            </View>
          ) : (
            ETAPA_FLOW.map((s, i) => {
              const isPast = i < currentIdx;
              const isActive = i === currentIdx;
              const isFuture = i > currentIdx;

              // Círculo: passado = verde neutro, atual = cor da etapa, futuro = cinza
              const circleColor = isPast ? DONE_COLOR : isActive ? ETAPA_COLORS[s] : "#D1D5DB";
              // Ícone: passado = checkmark, atual = ícone da etapa, futuro = ícone da etapa
              const iconName = isPast ? DONE_ICON : ETAPA_ICONS[s];
              // Linha conectora: colorida se o próximo passo já foi concluído ou é o atual
              const lineColor = i < currentIdx ? DONE_COLOR : "#D1D5DB";

              return (
                <View key={s} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: i < ETAPA_FLOW.length - 1 ? 4 : 0 }}>
                  <View style={{ alignItems: "center" }}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: circleColor, justifyContent: "center", alignItems: "center" }}>
                      <Ionicons name={iconName as any} size={14} color="white" />
                    </View>
                    {i < ETAPA_FLOW.length - 1 && (
                      <View style={{ width: 2, height: 22, backgroundColor: lineColor }} />
                    )}
                  </View>
                  <View style={{ paddingTop: 3, flex: 1 }}>
                    <Text style={{
                      fontSize: 14,
                      fontWeight: isActive ? "700" : "400",
                      color: isActive ? ETAPA_COLORS[s] : isFuture ? COLORS.textTertiary : COLORS.text,
                    }}>
                      {ETAPA_LABELS[s]}
                    </Text>
                    {/* Subtexto do passo atual pronto_para_despachar */}
                    {isActive && s === "pronto_para_despachar" && (
                      <Text style={{ fontSize: 12, color: "#22C55E", marginTop: 2 }}>Todos os itens prontos. Aguardando despacho.</Text>
                    )}
                    {/* Entregador abaixo de "Saiu para entrega" */}
                    {s === "saiu_entrega" && (isPast || isActive) && e.entregador_nome && (
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                        {e.entregador_nome}{e.entregador_telefone ? " · " + e.entregador_telefone : ""}
                        {e.saiu_em ? " · " + new Date(e.saiu_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Cliente */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Cliente</Text>
          <Text style={{ fontSize: 15, fontWeight: "500", color: COLORS.text }}>{e.cliente_nome}</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4 }}><Ionicons name="call-outline" size={13} /> {e.cliente_telefone}</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4 }}><Ionicons name="location-outline" size={13} /> {e.endereco}{e.bairro ? " - " + e.bairro : ""}</Text>
          {e.complemento && <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{e.complemento}</Text>}
          {e.referencia && <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Ref: {e.referencia}</Text>}
        </View>

        {/* Itens */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Itens</Text>
          {(data.itens || []).map((item: any, i: number) => {
            const itemStatus = item.status || "pendente";
            const statusColor: Record<string, string> = {
              pendente: "#94A3B8",
              em_preparo: "#F59E0B",
              pronto: "#22C55E",
              cancelado: "#EF4444",
              entregue: "#0D9488",
            };
            const statusLabel: Record<string, string> = {
              pendente: "Pendente",
              em_preparo: "Em preparo",
              pronto: "Pronto",
              cancelado: "Cancelado",
              entregue: "Entregue",
            };
            const isCancelado = itemStatus === "cancelado";
            const itemColor = statusColor[itemStatus] || "#94A3B8";
            const itemLabel = statusLabel[itemStatus] || itemStatus;
            const itemsLength = (data.itens || []).length;
            const precoUnitario = parseFloat(item.preco_unitario || item.precoUnitario || "0");
            const itemTotal = precoUnitario * (item.quantidade || 1);
            return (
              <View key={item.id || i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: i < itemsLength - 1 ? 0.5 : 0, borderBottomColor: COLORS.surfaceSecondary }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: isCancelado ? COLORS.textTertiary : COLORS.text, textDecorationLine: isCancelado ? "line-through" : "none" }}>
                    {item.quantidade}x {item.prato_nome || "Item"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: itemColor, marginRight: 4 }} />
                    <Text style={{ fontSize: 11, color: itemColor }}>{itemLabel}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "500", color: isCancelado ? COLORS.textTertiary : COLORS.text }}>
                  {formatCurrency(itemTotal)}
                </Text>
              </View>
            );
          })}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Taxa entrega</Text>
            <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(parseFloat(e.taxa_entrega || e.taxaEntrega || "0"))}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Resumo de pagamento */}
        {data?.pagamentos && data.pagamentos.length > 0 && (() => {
          const pag = data.pagamentos[0];
          const formaLabel: Record<string, string> = { pix: "Pix", credito: "Cartão de crédito", debito: "Cartão de débito", dinheiro: "Dinheiro" };
          return (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6, textTransform: "uppercase" }}>Pagamento</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, color: COLORS.text }}>{formaLabel[normalizarForma(pag.forma_pagamento)]}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: COLORS.text }}>{formatCurrency(parseFloat(pag.valor || "0"))}</Text>
              </View>
              {pag.status === "confirmado" && (
                <Text style={{ fontSize: 11, color: "#22C55E", marginTop: 2 }}>✓ Pago{pag.confirmado_em ? ` em ${new Date(pag.confirmado_em).toLocaleString("pt-BR")}` : ""}</Text>
              )}
              {pag.status === "pendente" && (
                <Text style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}>Aguardando pagamento na entrega</Text>
              )}
              {pag.referencia && (
                <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>{pag.referencia}</Text>
              )}
            </View>
          );
        })()}

        {/* Bloco de cancelamento */}
        {e.status === "cancelada" && e.cancelamento_info && (
          <View style={{ backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: "#FECACA", marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#EF4444", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Pedido cancelado</Text>
            <Text style={{ fontSize: 13, color: "#7F1D1D" }}>
              Cancelado por: {e.cancelamento_info.cancelado_por_nome || "Desconhecido"} ({e.cancelamento_info.cancelado_por_role || ""})
            </Text>
            {e.cancelamento_info.cancelado_em && (
              <Text style={{ fontSize: 12, color: "#991B1B", marginTop: 2 }}>
                Em: {new Date(e.cancelamento_info.cancelado_em).toLocaleString("pt-BR")}
              </Text>
            )}
            <Text style={{ fontSize: 13, color: "#7F1D1D", marginTop: 4 }}>
              Motivo: {MOTIVO_LABELS[e.cancelamento_info.motivo_cancelamento] || e.cancelamento_info.motivo_cancelamento || "Não informado"}
            </Text>
            {e.cancelamento_info.motivo_cancelamento_detalhe && (
              <Text style={{ fontSize: 12, color: "#991B1B", marginTop: 2 }}>{e.cancelamento_info.motivo_cancelamento_detalhe}</Text>
            )}
            {e.cancelamento_info.houve_perda && (
              <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, padding: 8, marginTop: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#EF4444" }}>⚠ Houve perda de comida registrada</Text>
              </View>
            )}
            {e.cancelamento_info?.estorno_info && (
              <View style={{ backgroundColor: "#FEF2F2", borderRadius: 6, padding: 8, marginTop: 8, borderWidth: 0.5, borderColor: "#FECACA" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#EF4444", marginBottom: 4 }}>Estorno manual registrado</Text>
                <Text style={{ fontSize: 12, color: "#7F1D1D" }}>
                  {e.cancelamento_info.estorno_info.referencia_completa}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Bloco pós-entrega */}
        {e.status === "entregue" && (() => {
          const pag = data?.pagamentos?.find((p: any) => p.status === "confirmado");
          const formaLabel: Record<string, string> = { pix: "Pix", credito: "Cartão de crédito", debito: "Cartão de débito", dinheiro: "Dinheiro" };
          return (
            <View style={{ backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: "#BBF7D0", marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: "#22C55E", marginBottom: 8, textTransform: "uppercase" }}>Pedido encerrado</Text>
              {pag && (
                <>
                  <Text style={{ fontSize: 13, color: "#166534" }}>Forma: {formaLabel[normalizarForma(pag.forma_pagamento)]}</Text>
                  <Text style={{ fontSize: 13, color: "#166534", marginTop: 2 }}>Valor cobrado: {formatCurrency(parseFloat(pag.valor || "0"))}</Text>
                  {pag.referencia?.startsWith("Troco:") && (
                    <Text style={{ fontSize: 13, color: "#166534", marginTop: 2 }}>{pag.referencia}</Text>
                  )}
                </>
              )}
              {e.entregue_em && (
                <Text style={{ fontSize: 11, color: "#15803D", marginTop: 4 }}>Entregue em: {new Date(e.entregue_em).toLocaleString("pt-BR")}</Text>
              )}
            </View>
          );
        })()}

        {/* Ações */}
        {e.status !== "entregue" && e.status !== "cancelada" && (
          <View style={{ gap: 10 }}>
            {/* Botão principal contextual */}
            {(() => {
              const itensAtivos = (data.itens || []).filter((i: any) => i.status !== "cancelado");
              const itensProntos = itensAtivos.filter((i: any) => i.status === "pronto");
              // Usar etapa do servidor como fonte de verdade
              const prontoParaDespachar = etapaAtual === "pronto_para_despachar";
              const aguardandoCozinha = !prontoParaDespachar && e.status !== "saiu_entrega";

              if (e.status === "saiu_entrega") {
                return (
                  <Pressable
                    onPress={() => { console.log("[DeliveryDetalhes] Confirmar entrega pressed"); confirmarEntrega(); }}
                    disabled={updating}
                    style={{ backgroundColor: updating ? COLORS.textTertiary : "#22C55E", borderRadius: 12, padding: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    {updating ? <ActivityIndicator color="white" /> : (
                      <><Ionicons name="checkmark-circle-outline" size={20} color="white" /><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Confirmar entrega</Text></>
                    )}
                  </Pressable>
                );
              }

              if (prontoParaDespachar) {
                return (
                  <Pressable
                    onPress={() => { console.log("[DeliveryDetalhes] Despachar button pressed"); setShowDespacharForm(true); }}
                    disabled={updating}
                    style={{ backgroundColor: "#3B82F6", borderRadius: 12, padding: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <Ionicons name="bicycle-outline" size={20} color="white" />
                    <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Despachar</Text>
                  </Pressable>
                );
              }

              if (aguardandoCozinha) {
                return (
                  <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                      Aguardando cozinha ({itensProntos.length} de {itensAtivos.length} itens prontos)
                    </Text>
                  </View>
                );
              }

              return null;
            })()}

            {/* Formulário de despacho */}
            {showDespacharForm && (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, gap: 10 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>Quem vai entregar?</Text>
                <TextInput
                  value={entregadorNome}
                  onChangeText={setEntregadorNome}
                  placeholder="Nome do entregador *"
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                />
                <TextInput
                  value={entregadorTelefone}
                  onChangeText={setEntregadorTelefone}
                  placeholder="Telefone (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="phone-pad"
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => { console.log("[DeliveryDetalhes] Despachar form cancelled"); setShowDespacharForm(false); }} style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, alignItems: "center" }}>
                    <Text style={{ color: COLORS.text }}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={despachar}
                    disabled={updating || !entregadorNome.trim()}
                    style={{ flex: 2, backgroundColor: updating || !entregadorNome.trim() ? COLORS.textTertiary : "#3B82F6", borderRadius: 8, padding: 12, alignItems: "center" }}
                  >
                    {updating ? <ActivityIndicator color="white" size="small" /> : <Text style={{ color: "white", fontWeight: "600" }}>Confirmar despacho</Text>}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Botões de impressão */}
            {authUser?.role !== "cozinheiro" && (
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => { console.log("[DeliveryDetalhes] Imprimir via pressed"); handleImprimir("via"); }}
                  disabled={imprimindo}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, padding: 14 }}
                >
                  <Ionicons name="print-outline" size={18} color={COLORS.primary} />
                  <Text style={{ color: COLORS.primary, fontSize: 14, fontWeight: "500" }}>
                    {imprimindo ? "Imprimindo..." : "Imprimir via de entrega"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { console.log("[DeliveryDetalhes] Imprimir etiqueta pressed"); handleImprimir("etiqueta"); }}
                  disabled={imprimindo}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12 }}
                >
                  <Ionicons name="pricetag-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>Imprimir etiqueta de lacre</Text>
                </Pressable>
              </View>
            )}

            {/* Cancelar */}
            {(() => {
              const podeCancelar = data?.pode_cancelar;
              const motivoNaoPode = data?.motivo_nao_pode_cancelar;
              if (!podeCancelar && motivoNaoPode) {
                return (
                  <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, alignItems: "center" }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: "center" }}>{motivoNaoPode}</Text>
                  </View>
                );
              }
              return (
                <Pressable onPress={cancelar} style={{ borderWidth: 1, borderColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" }}>
                  <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>Cancelar pedido</Text>
                </Pressable>
              );
            })()}
          </View>
        )}
      </ScrollView>

      {/* Modal de cancelamento */}
      <Modal
        visible={showCancelModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCancelModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, marginBottom: 16 }}>Cancelar pedido</Text>

            {data?.exige_estorno && (
              <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#FECACA" }}>
                <Text style={{ color: "#991B1B", fontSize: 13, fontWeight: "700", marginBottom: 4 }}>
                  ⚠ Este pedido já foi pago
                </Text>
                <Text style={{ color: "#7F1D1D", fontSize: 13 }}>
                  {`Valor: ${formatCurrency(data.valor_estorno || 0)}${data.forma_pagamento_original ? ` (${data.forma_pagamento_original})` : ""}`}
                </Text>
                <Text style={{ color: "#7F1D1D", fontSize: 12, marginTop: 4 }}>
                  Cancelar exige devolver o valor ao cliente. O aplicativo não devolve o dinheiro: faça a devolução por fora e registre aqui como foi feita.
                </Text>
              </View>
            )}

            {/* Aviso de consequências */}
            {(() => {
              if (!data) return null;
              const itensAtivos = (data.itens || []).filter((i: any) => i.status !== "cancelado");
              const itensIniciados = itensAtivos.filter((i: any) => i.status === "em_preparo" || i.status === "pronto");
              const entregaSaiu = data.entrega?.status === "saiu_entrega";
              if (entregaSaiu) {
                return (
                  <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "600" }}>⚠ O pedido já saiu para entrega. Todos os itens serão registrados como perda.</Text>
                  </View>
                );
              }
              if (itensIniciados.length > 0) {
                const qtd = itensIniciados.length;
                const singular = qtd === 1;
                const avisoText = singular
                  ? `⚠ ${qtd} item já está em preparo ou pronto e será registrado como perda.`
                  : `⚠ ${qtd} itens já estão em preparo ou prontos e serão registrados como perda.`;
                return (
                  <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <Text style={{ color: "#92400E", fontSize: 13, fontWeight: "600" }}>{avisoText}</Text>
                  </View>
                );
              }
              return null;
            })()}

            {/* Lista de motivos */}
            <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>Motivo *</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {Object.entries(MOTIVO_LABELS).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => { console.log("[DeliveryDetalhes] Cancel motivo selected:", key); setCancelMotivo(key); }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: cancelMotivo === key ? COLORS.primary : COLORS.border, backgroundColor: cancelMotivo === key ? COLORS.primary : "transparent", marginRight: 10 }} />
                  <Text style={{ fontSize: 14, color: COLORS.text }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Detalhe (obrigatório quando motivo='outro') */}
            {cancelMotivo === "outro" && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 6 }}>Detalhe *</Text>
                <TextInput
                  value={cancelDetalhe}
                  onChangeText={setCancelDetalhe}
                  placeholder="Descreva o motivo (obrigatório)"
                  placeholderTextColor={COLORS.textTertiary}
                  multiline
                  maxLength={300}
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14, minHeight: 80, textAlignVertical: "top" }}
                />
              </View>
            )}

            {data?.exige_estorno && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>Como o valor será devolvido *</Text>
                {([
                  { key: "pix", label: "Pix" },
                  { key: "dinheiro", label: "Dinheiro" },
                  { key: "estorno_cartao", label: "Estorno no cartão" },
                  { key: "outra", label: "Outra forma" },
                ] as const).map(({ key, label }) => (
                  <Pressable
                    key={key}
                    onPress={() => { console.log("[DeliveryDetalhes] Cancel forma estorno selected:", key); setCancelFormaEstorno(key); }}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}
                  >
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: cancelFormaEstorno === key ? "#EF4444" : COLORS.border, backgroundColor: cancelFormaEstorno === key ? "#EF4444" : "transparent", marginRight: 10 }} />
                    <Text style={{ fontSize: 14, color: COLORS.text }}>{label}</Text>
                  </Pressable>
                ))}

                {cancelFormaEstorno === "outra" && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 13, color: COLORS.text, marginBottom: 4 }}>Descreva a forma *</Text>
                    <TextInput
                      value={cancelDetalheEstorno}
                      onChangeText={setCancelDetalheEstorno}
                      placeholder="Ex: transferência bancária"
                      placeholderTextColor={COLORS.textTertiary}
                      maxLength={300}
                      style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                    />
                  </View>
                )}

                <View style={{ marginTop: 10 }}>
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Observação (opcional)</Text>
                  <TextInput
                    value={cancelObsEstorno}
                    onChangeText={setCancelObsEstorno}
                    placeholder="Ex: comprovante #123"
                    placeholderTextColor={COLORS.textTertiary}
                    maxLength={300}
                    style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                  />
                </View>

                <Pressable
                  onPress={() => { console.log("[DeliveryDetalhes] Cancel confirmacao estorno toggled:", !cancelConfirmacaoEstorno); setCancelConfirmacaoEstorno(!cancelConfirmacaoEstorno); }}
                  style={{ flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: cancelConfirmacaoEstorno ? "#EF4444" : COLORS.border, backgroundColor: cancelConfirmacaoEstorno ? "#EF4444" : "transparent", justifyContent: "center", alignItems: "center" }}>
                    {cancelConfirmacaoEstorno && <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>✓</Text>}
                  </View>
                  <Text style={{ flex: 1, fontSize: 13, color: COLORS.text }}>
                    {`Confirmo que R$ ${Number(data.valor_estorno || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} será ou foi devolvido ao cliente`}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Botões */}
            {(() => {
              const cancelBtnDisabled = cancelando
                || !cancelMotivo
                || (cancelMotivo === "outro" && !cancelDetalhe.trim())
                || (data?.exige_estorno && (!cancelFormaEstorno || (cancelFormaEstorno === "outra" && !cancelDetalheEstorno.trim()) || !cancelConfirmacaoEstorno));
              const cancelBtnLabel = data?.exige_estorno ? "Cancelar e registrar estorno" : "Confirmar cancelamento";
              return (
                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <Pressable
                    onPress={() => { console.log("[DeliveryDetalhes] Cancel modal dismissed"); setShowCancelModal(false); setCancelMotivo(""); setCancelDetalhe(""); setCancelFormaEstorno(""); setCancelDetalheEstorno(""); setCancelObsEstorno(""); setCancelConfirmacaoEstorno(false); }}
                    style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, alignItems: "center" }}
                  >
                    <Text style={{ color: COLORS.text, fontWeight: "500" }}>Voltar</Text>
                  </Pressable>
                  <Pressable
                    onPress={confirmarCancelamento}
                    disabled={cancelBtnDisabled}
                    style={{ flex: 2, backgroundColor: cancelBtnDisabled ? COLORS.textTertiary : "#EF4444", borderRadius: 10, padding: 14, alignItems: "center" }}
                  >
                    {cancelando ? <ActivityIndicator color="white" size="small" /> : <Text style={{ color: "white", fontWeight: "600" }}>{cancelBtnLabel}</Text>}
                  </Pressable>
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Modal de confirmação de entrega */}
      <Modal
        visible={showConfirmarModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowConfirmarModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, marginBottom: 4 }}>Confirmar entrega</Text>
            {(() => {
              const totalDue = parseFloat(data?.comanda?.total || "0");
              const jaFoiPago = (data?.pagamentos || []).some((p: any) => p.status === "confirmado");
              const pagConfirmado = (data?.pagamentos || []).find((p: any) => p.status === "confirmado");

              const FORMA_LABEL: Record<string, string> = {
                pix: "Pix",
                credito: "Cartão de crédito",
                debito: "Cartão de débito",
                dinheiro: "Dinheiro",
              };

              // Parse valor recebido using parseBRL
              const valorRecebidoNum = parseBRL(confirmarValorRecebido);
              const totalCents = Math.round(totalDue * 100);
              const recebidoCents = valorRecebidoNum !== undefined ? Math.round(valorRecebidoNum * 100) : 0;
              const troco = confirmarForma === "dinheiro" && valorRecebidoNum !== undefined && recebidoCents > totalCents
                ? Math.round((valorRecebidoNum - totalDue) * 100) / 100
                : null;

              // Button disabled logic
              const btnDisabled = updating || (() => {
                if (jaFoiPago) return false;
                if (confirmarForma !== "dinheiro") return !confirmarForma;
                if (valorRecebidoNum === undefined) return true;
                return recebidoCents < totalCents;
              })();

              // Reason text for disabled button
              const btnDisabledReason = (() => {
                if (jaFoiPago || !btnDisabled || updating) return null;
                if (confirmarForma === "dinheiro") {
                  if (valorRecebidoNum === undefined) return "Informe o valor recebido";
                  if (recebidoCents < totalCents) {
                    const totalFmt = totalDue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return `Valor menor que o total (R$ ${totalFmt})`;
                  }
                }
                return null;
              })();

              return (
                <>
                  <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.primary, marginBottom: 16 }}>
                    Total: {formatCurrency(totalDue)}
                  </Text>

                  {jaFoiPago ? (
                    <View style={{ backgroundColor: "#D1FAE5", borderRadius: 8, padding: 10, marginBottom: 16 }}>
                      <Text style={{ color: "#065F46", fontWeight: "600" }}>
                        ✓ Pedido já pago ({FORMA_LABEL[normalizarForma(pagConfirmado?.forma_pagamento)] || pagConfirmado?.forma_pagamento || "—"})
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Forma de pagamento */}
                      <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>Forma de pagamento</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {([
                          { key: "dinheiro", label: "Dinheiro" },
                          { key: "pix", label: "Pix" },
                          { key: "credito", label: "Crédito" },
                          { key: "debito", label: "Débito" },
                        ] as const).map(({ key, label }) => (
                          <Pressable
                            key={key}
                            onPress={() => {
                              console.log("[DeliveryDetalhes] confirmarForma selected:", key);
                              setConfirmarForma(key);
                              if (key === "dinheiro") {
                                const totalStr = totalDue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                setConfirmarValorRecebido(totalStr);
                              } else {
                                setConfirmarValorRecebido("");
                              }
                              setConfirmarErro(null);
                            }}
                            style={{
                              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                              backgroundColor: confirmarForma === key ? COLORS.primary : COLORS.surface,
                              borderWidth: 1, borderColor: confirmarForma === key ? COLORS.primary : COLORS.border,
                            }}
                          >
                            <Text style={{ color: confirmarForma === key ? "#fff" : COLORS.text, fontSize: 13 }}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>

                      {/* Valor recebido (dinheiro) */}
                      {confirmarForma === "dinheiro" && (
                        <View style={{ marginBottom: 12 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Valor recebido *</Text>
                            <Pressable
                              onPress={() => {
                                console.log("[DeliveryDetalhes] Valor exato pressed");
                                const totalStr = totalDue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                setConfirmarValorRecebido(totalStr);
                                setConfirmarErro(null);
                              }}
                              style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }}
                            >
                              <Text style={{ fontSize: 12, color: COLORS.primary }}>Valor exato</Text>
                            </Pressable>
                          </View>
                          <CampoMoeda
                            value={confirmarValorRecebido}
                            onChangeText={(t) => { setConfirmarValorRecebido(t); setConfirmarErro(null); }}
                            placeholder="0,00"
                            placeholderTextColor={COLORS.textTertiary}
                            style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 16 }}
                          />
                          {troco !== null && (
                            <Text style={{ fontSize: 14, color: "#22C55E", fontWeight: "600", marginTop: 6 }}>
                              Troco a devolver: {formatCurrency(troco)}
                            </Text>
                          )}
                        </View>
                      )}
                    </>
                  )}

                  {/* Error from server */}
                  {confirmarErro && (
                    <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                      <Text style={{ color: "#991B1B", fontSize: 13 }}>{confirmarErro}</Text>
                    </View>
                  )}

                  {/* Disabled reason */}
                  {btnDisabledReason && (
                    <Text style={{ fontSize: 13, color: "#EF4444", marginBottom: 8, textAlign: "center" }}>{btnDisabledReason}</Text>
                  )}

                  {/* Botões */}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                      onPress={() => { console.log("[DeliveryDetalhes] Confirmar modal dismissed"); setShowConfirmarModal(false); setConfirmarErro(null); }}
                      style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, alignItems: "center" }}
                    >
                      <Text style={{ color: COLORS.text, fontWeight: "500" }}>Cancelar</Text>
                    </Pressable>
                    <Pressable
                      onPress={executarConfirmacao}
                      disabled={btnDisabled}
                      style={{ flex: 2, borderRadius: 10, padding: 14, alignItems: "center", backgroundColor: btnDisabled ? COLORS.textTertiary : "#22C55E" }}
                    >
                      {updating ? <ActivityIndicator color="white" size="small" /> : <Text style={{ color: "white", fontWeight: "600" }}>Confirmar entrega</Text>}
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Modal de pergunta de impressão pós-despacho */}
      <Modal
        visible={perguntarImpressao}
        transparent
        animationType="fade"
        onRequestClose={() => setPerguntarImpressao(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: COLORS.background, borderRadius: 16, padding: 20, width: "100%" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.text, marginBottom: 8 }}>Imprimir via de entrega?</Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>O pedido foi despachado. Deseja imprimir a via agora?</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => { console.log("[DeliveryDetalhes] Impressao pos-despacho: agora nao"); setPerguntarImpressao(false); }}
                style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, alignItems: "center" }}
              >
                <Text style={{ color: COLORS.text }}>Agora não</Text>
              </Pressable>
              <Pressable
                onPress={() => { console.log("[DeliveryDetalhes] Impressao pos-despacho: imprimir"); setPerguntarImpressao(false); handleImprimir("via"); }}
                style={{ flex: 2, backgroundColor: COLORS.primary, borderRadius: 10, padding: 12, alignItems: "center" }}
              >
                <Text style={{ color: "white", fontWeight: "600" }}>Imprimir</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
