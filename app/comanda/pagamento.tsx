// force rebuild v3
import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput, Platform } from "react-native";
import * as Linking from "expo-linking";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { CampoMoeda } from "@/components/CampoMoeda";
import { salvarTransacaoPendente, limparTransacaoPendente } from "@/utils/terminalPendente";

const FORMAS = [
  { key: "dinheiro", label: "Dinheiro", icon: "cash-outline" },
  { key: "pix", label: "Pix", icon: "qr-code-outline" },
  { key: "cartao_credito", label: "Crédito", icon: "card-outline" },
  { key: "cartao_debito", label: "Débito", icon: "card-outline" },
];

export default function PagamentoScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id, valor: valorParam } = useLocalSearchParams<{ id: string; valor?: string }>();
  const insets = useSafeAreaInsets();
  const [forma, setForma] = useState("dinheiro");
  const [valor, setValor] = useState(valorParam || "");
  const [troco, setTroco] = useState("0");
  const [saving, setSaving] = useState(false);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [totalComanda, setTotalComanda] = useState(0);
  const [totalPago, setTotalPago] = useState(0);

  useEffect(() => {
    console.log("[PagamentoScreen] Fetching pagamentos for comanda:", id);
    apiGet("/api/comandas/" + id + "/pagamentos").then((d: any) => {
      console.log("[PagamentoScreen] Pagamentos loaded:", d);
      setPagamentos(d.pagamentos || []);
      setTotalPago(d.total_pago || 0);
    }).catch((err) => { console.log("[PagamentoScreen] Error fetching pagamentos:", err); });
    console.log("[PagamentoScreen] Fetching comanda:", id);
    apiGet("/api/comandas/" + id).then((d: any) => {
      console.log("[PagamentoScreen] Comanda loaded:", d);
      const t = parseFloat(d.comanda?.total || d.total || "0");
      setTotalComanda(t);
      if (!valorParam) setValor(t.toFixed(2));
    }).catch((err) => { console.log("[PagamentoScreen] Error fetching comanda:", err); });
  }, [id, valorParam]);

  const restante = totalComanda - totalPago;

  const [parcelas, setParcelas] = useState(1);
  const [tipoParcelamento, setTipoParcelamento] = useState<"lojista" | "emissor">("lojista");
  const [cobrando, setCobrando] = useState(false);
  const podeMaquininha = Platform.OS === "android" && (forma === "pix" || forma === "cartao_credito" || forma === "cartao_debito");

  const cobrarNaMaquininha = async () => {
    const v = parseFloat(valor.replace(",", "."));
    if (!v || v <= 0) return Alert.alert("Erro", "Informe o valor");
    console.log("[PagamentoScreen] Cobrar na maquininha:", { forma, valor: v, parcelas, tipoParcelamento });
    setCobrando(true);
    let transacaoId: string | undefined;
    try {
      const body: any = { forma_pagamento: forma, valor: v };
      if (forma === "cartao_credito") {
        body.parcelas = parcelas;
        if (parcelas > 1) body.tipo_parcelamento = tipoParcelamento;
      }
      const res: any = await apiPost("/api/comandas/" + id + "/terminal/transacoes", body);
      transacaoId = res?.transacao?.id;
      const t = res?.terminal;
      if (!transacaoId || !t) throw new Error("Resposta inesperada do servidor.");
      await salvarTransacaoPendente({ transacaoId, comandaId: String(id) });

      const qs = new URLSearchParams();
      qs.set("return_scheme", "cozinhafastpro");
      qs.set("amount", String(t.amount_centavos));
      qs.set("editable_amount", "0");
      qs.set("transaction_type", String(t.transaction_type));
      if (t.installment_type) qs.set("installment_type", String(t.installment_type));
      if (t.installment_count) qs.set("installment_count", String(t.installment_count));
      qs.set("order_id", String(t.order_id));
      const url = "payment-app://pay?" + qs.toString();
      console.log("[PagamentoScreen] Abrindo maquininha:", url);
      try {
        await Linking.openURL(url);
      } catch (e) {
        console.log("[PagamentoScreen] Stone não encontrada:", e);
        await apiPost("/api/terminal/transacoes/" + transacaoId + "/sem-retorno", {}).catch(() => {});
        await limparTransacaoPendente();
        Alert.alert("Maquininha", "Aplicativo de pagamento da Stone não encontrado neste aparelho. Use o registro manual.");
        return;
      }
      router.push({ pathname: "/comanda/aguardando-maquininha", params: { transacaoId, comandaId: String(id) } });
    } catch (err: any) {
      console.log("[PagamentoScreen] Erro ao iniciar cobrança:", err);
      Alert.alert("Erro", err?.message || "Não foi possível iniciar a cobrança.");
    } finally { setCobrando(false); }
  };

  const submit = async () => {
    const v = parseFloat(valor.replace(",", "."));
    if (!v || v <= 0) return Alert.alert("Erro", "Informe o valor");
    console.log("[PagamentoScreen] Registering payment:", { forma, valor: v, comanda: id });
    setSaving(true);
    try {
      const res: any = await apiPost("/api/comandas/" + id + "/pagamentos", {
        forma_pagamento: forma, valor: v, troco: forma === "dinheiro" ? parseFloat(troco.replace(",", ".")) || 0 : 0,
      });
      console.log("[PagamentoScreen] Payment registered:", res);
      const formaLabel = FORMAS.find(f => f.key === forma)?.label;
      if (res?.comanda_fechada) {
        // O servidor fechou a comanda junto com o pagamento que quitou a conta: a mesa já foi liberada
        Alert.alert("Conta paga e encerrada", formatCurrency(v) + " em " + formaLabel + ". A mesa foi liberada.", [{ text: "OK", onPress: () => router.dismissAll() }]);
      } else if (res?.aguardando_itens) {
        Alert.alert("Pagamento registrado", formatCurrency(v) + " em " + formaLabel + ". A conta está paga, mas ainda há item pendente ou em preparo na cozinha. A comanda continua aberta: a gerência pode cancelar o item e fechar a conta.", [{ text: "OK", onPress: () => router.back() }]);
      } else {
        Alert.alert("Pagamento registrado", formatCurrency(v) + " em " + formaLabel);
        router.back();
      }
    } catch (err: any) {
      console.log("[PagamentoScreen] Error registering payment:", err);
      if (err?.status === 409) {
        // Comanda já encerrada (por exemplo, toque duplo): não há mais o que pagar aqui
        Alert.alert("Comanda encerrada", err?.message || "Esta comanda já foi encerrada.", [{ text: "OK", onPress: () => router.dismissAll() }]);
      } else {
        Alert.alert("Erro", err?.message || "Erro ao registrar pagamento");
      }
    } finally { setSaving(false); }
  };

  const inputStyle = { backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 16, color: COLORS.text };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => { console.log("[PagamentoScreen] Back pressed"); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Pagamento</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total da comanda</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(totalComanda)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Já pago</Text><Text style={{ fontSize: 13, color: "#22C55E" }}>{formatCurrency(totalPago)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}><Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>Restante</Text><Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(restante)}</Text></View>
        </View>

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Forma de pagamento</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {FORMAS.map(f => (
            <Pressable key={f.key} onPress={() => { console.log("[PagamentoScreen] Payment method selected:", f.key); setForma(f.key); }} style={{ flex: 1, minWidth: "45%", backgroundColor: forma === f.key ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: forma === f.key ? COLORS.primary : COLORS.surfaceSecondary }}>
              <Ionicons name={f.icon as any} size={24} color={forma === f.key ? "white" : COLORS.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: "500", color: forma === f.key ? "white" : COLORS.text, marginTop: 6 }}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Valor</Text>
        <CampoMoeda value={valor} onChangeText={setValor} placeholder="0,00" placeholderTextColor={COLORS.textTertiary} style={{ ...inputStyle, marginBottom: 12, fontSize: 24, textAlign: "center", fontWeight: "600" }} />

        {forma === "dinheiro" && (
          <><Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Troco para</Text>
          <CampoMoeda value={troco} onChangeText={setTroco} placeholder="0,00" placeholderTextColor={COLORS.textTertiary} style={{ ...inputStyle, marginBottom: 12 }} /></>
        )}

        {pagamentos.length > 0 && (
          <View style={{ marginTop: 8, marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Pagamentos anteriores</Text>
            {pagamentos.map((p: any, i: number) => (
              <View key={p.id || i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{p.formaPagamento || p.forma_pagamento}</Text>
                <Text style={{ fontSize: 13, color: p.status === "confirmado" ? "#22C55E" : "#F59E0B", fontWeight: "500" }}>{formatCurrency(parseFloat(p.valor))} {p.status === "pendente" ? "(pendente)" : ""}</Text>
              </View>
            ))}
          </View>
        )}

        {podeMaquininha && (
          <View style={{ marginTop: 8, marginBottom: 8 }}>
            {forma === "cartao_credito" && (
              <>
                <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Parcelas</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                    <Pressable key={n} onPress={() => setParcelas(n)} style={{ width: 52, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: parcelas === n ? COLORS.primary : COLORS.surface, borderWidth: 0.5, borderColor: parcelas === n ? COLORS.primary : COLORS.surfaceSecondary }}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: parcelas === n ? "white" : COLORS.text }}>{n}x</Text>
                    </Pressable>
                  ))}
                </View>
                {parcelas > 1 && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                    {([["lojista", "Sem juros (lojista)"], ["emissor", "Com juros (emissor)"]] as const).map(([k, l]) => (
                      <Pressable key={k} onPress={() => setTipoParcelamento(k)} style={{ flex: 1, padding: 12, borderRadius: 10, alignItems: "center", backgroundColor: tipoParcelamento === k ? COLORS.primary : COLORS.surface, borderWidth: 0.5, borderColor: tipoParcelamento === k ? COLORS.primary : COLORS.surfaceSecondary }}>
                        <Text style={{ fontSize: 13, fontWeight: "500", color: tipoParcelamento === k ? "white" : COLORS.text }}>{l}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
            <Pressable onPress={cobrarNaMaquininha} disabled={cobrando || saving} style={{ backgroundColor: cobrando ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
              {cobrando ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Cobrar na maquininha</Text>}
            </Pressable>
          </View>
        )}

        <Pressable onPress={submit} disabled={saving} style={{ backgroundColor: saving ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 }}>
          {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Registrar pagamento</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}
