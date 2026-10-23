import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { CampoMoeda } from "@/components/CampoMoeda";
import { formatReceipt } from "@/utils/printer";
import { useAuth } from "@/contexts/AuthContext";
import { useReceiptPreview } from "@/components/ReceiptPreview";
import { calcularTotalComDesconto } from "@/utils/desconto";

const ETAPAS = ["resumo", "gorjeta", "divisao", "pagamento"] as const;
type Etapa = typeof ETAPAS[number];

const FORMAS = [
  { key: "dinheiro", label: "Dinheiro", icon: "cash-outline" as const },
  { key: "pix", label: "Pix", icon: "qr-code-outline" as const },
  { key: "cartao_credito", label: "Crédito", icon: "card-outline" as const },
  { key: "cartao_debito", label: "Débito", icon: "card-outline" as const },
];

export default function FecharContaScreen() {
  const COLORS = useColors();
  const { previewReceipt, previewModal } = useReceiptPreview();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [etapa, setEtapa] = useState<Etapa>("resumo");
  const [comanda, setComanda] = useState<any>(null);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [gorjetaMode, setGorjetaMode] = useState<"none"|"10"|"custom">("none");
  const [gorjetaInput, setGorjetaInput] = useState("0");
  const [dividir, setDividir] = useState(false);
  const [numPessoas, setNumPessoas] = useState(2);
  const [divisaoResult, setDivisaoResult] = useState<any>(null);
  const [forma, setForma] = useState("dinheiro");
  const [trocoInput, setTrocoInput] = useState("0");
  const [saving, setSaving] = useState(false);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [totalPago, setTotalPago] = useState(0);
  const [pessoaAtual, setPessoaAtual] = useState(0);
  const { user } = useAuth();
  const [restaurante, setRestaurante] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const c = await apiGet<any>("/api/comandas/" + id);
        setComanda(c);
        setPedidos(c.pedidos || []);
        const pag = await apiGet<any>("/api/comandas/" + id + "/pagamentos");
        setPagamentos(pag.pagamentos || []);
        setTotalPago(pag.total_pago || 0);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  // Dados do restaurante para o cabeçalho da conferência: carga separada, sem bloquear a tela.
  useEffect(() => {
    apiGet<any>("/api/restaurante").then((r) => setRestaurante(r?.restaurante || r)).catch(() => setRestaurante(null));
  }, []);

  // Item cancelado não é venda: fica fora do subtotal (e da gorjeta calculada sobre ele)
  const subtotal = pedidos
    .filter((p: any) => p.status !== "cancelado")
    .reduce((s: number, p: any) => s + parseFloat(p.precoUnitario || p.preco_unitario || "0") * (p.quantidade || 1), 0);
  const gorjetaValue = gorjetaMode === "10" ? subtotal * 0.1 : gorjetaMode === "custom" ? subtotal * (Math.max(0, parseFloat(gorjetaInput.replace(",", ".")) || 0) / 100) : 0;
  const { descontoEfetivo } = calcularTotalComDesconto(subtotal, comanda?.desconto_tipo, comanda?.desconto_valor);
  const temDesconto = comanda?.desconto_tipo === "desconto" || comanda?.desconto_tipo === "cortesia";
  const totalFinal = subtotal - descontoEfetivo + gorjetaValue;
  const semCobranca = totalFinal < 0.01;
  const restante = totalFinal - totalPago;
  const valorPorPessoa = dividir && numPessoas > 1 ? Math.ceil(restante / numPessoas * 100) / 100 : restante;
  const valorPessoaAtual = dividir && divisaoResult?.divisao ? (divisaoResult.divisao[pessoaAtual]?.total_a_pagar || divisaoResult.divisao[pessoaAtual]?.valor || valorPorPessoa) : restante;

  const selectGorjeta = (mode: "none"|"10"|"custom") => {
    setGorjetaMode(mode);
    if (mode === "none") setGorjetaInput("0");
    if (mode === "10") setGorjetaInput("10");
    if (mode === "custom") setGorjetaInput("");
  };

  const calcularDivisao = async () => {
    try {
      const res = await apiPost("/api/comandas/" + id + "/divisao", { tipo: "igual", num_pessoas: numPessoas, gorjeta: gorjetaValue });
      setDivisaoResult(res);
    } catch (err: any) { Alert.alert("Erro", err?.message || "Erro ao calcular"); }
  };

  const refreshPagamentos = async () => {
    try {
      const pag = await apiGet<any>("/api/comandas/" + id + "/pagamentos");
      setPagamentos(pag.pagamentos || []);
      setTotalPago(pag.total_pago || 0);
    } catch (err) {}
  };

  const registrarPagamento = async (valor: number) => {
    setSaving(true);
    try {
      await apiPost("/api/comandas/" + id + "/pagamentos", {
        forma_pagamento: forma, valor, troco: forma === "dinheiro" ? parseFloat(trocoInput.replace(",", ".")) || 0 : 0, gorjeta: gorjetaValue,
      });
      await refreshPagamentos();
      if (dividir && pessoaAtual < numPessoas - 1) {
        setPessoaAtual(pessoaAtual + 1);
        setForma("dinheiro");
        Alert.alert("OK", "Pessoa " + (pessoaAtual + 1) + " pagou " + formatCurrency(valor));
      } else { await fecharComanda(); }
    } catch (err: any) { Alert.alert("Erro", err?.message || "Erro"); }
    finally { setSaving(false); }
  };

  const fecharComanda = async () => {
    try {
      await apiPost("/api/comandas/" + id + "/fechar", { gorjeta: gorjetaValue });
      Alert.alert("Conta fechada!", "Comanda encerrada.", [{ text: "OK", onPress: () => router.dismissAll() }]);
    } catch (err: any) {
      if (err?.status === 400) {
        Alert.alert("Registrado!", "Volte para fechar quando pronto.", [{ text: "OK", onPress: () => router.back() }]);
      } else {
        Alert.alert("Erro ao fechar", err?.message || "Não foi possível fechar a comanda. Tente novamente.");
      }
    }
  };

  // Mesmo fechamento sem pagamento usado quando todos os itens estão cancelados.
  const encerrarSemCobranca = async () => {
    setSaving(true);
    try {
      await apiPost('/api/comandas/' + id + '/fechar', { gorjeta: 0 });
      Alert.alert('Comanda encerrada', 'A comanda foi encerrada sem cobrança.', [
        { text: 'OK', onPress: () => router.dismissAll() },
      ]);
    } catch (err: any) {
      Alert.alert('Erro', err?.message || 'Não foi possível encerrar a comanda. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const etapaAnterior = () => { const idx = ETAPAS.indexOf(etapa); if (idx > 0) setEtapa(ETAPAS[idx - 1]); else router.back(); };

  const cardStyle = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 };
  const labelStyle = { fontSize: 12, fontWeight: "600" as const, color: COLORS.primary, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: 0.5 };
  const btnPrimary = { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" as const };

  const imprimirConferencia = async () => {
    const itensRecibo = pedidos.filter((p: any) => p.status !== "cancelado").map((p: any) => {
      const unit = parseFloat(p.precoUnitario || p.preco_unitario || "0");
      const q = p.quantidade || 1;
      return { quantidade: q, nome: p.pratoNome || p.prato_nome || p.prato?.nome || "Item", preco: unit * q, precoUnitario: unit };
    });
    const texto = formatReceipt({
      restaurante,
      mesa: comanda?.mesa_numero,
      rotulo: comanda?.rotulo,
      abertura: comanda?.created_at || comanda?.createdAt,
      impressoPor: user?.nome,
      itens: itensRecibo,
      subtotal,
      desconto: descontoEfetivo,
      descontoRotulo: comanda?.desconto_tipo === "cortesia" ? "Cortesia" : "Desconto",
      gorjeta: gorjetaValue,
      total: totalFinal,
      divisao: dividir && numPessoas > 1 ? { pessoas: numPessoas, valorPorPessoa } : null,
    });
    await previewReceipt(texto, "Conferência de conta da mesa");
  };
  const botaoConferencia = (
    <Pressable onPress={imprimirConferencia} style={{ borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 10 }}>
      <Ionicons name="print-outline" size={20} color={COLORS.primary} />
      <Text style={{ color: COLORS.primary, fontSize: 15, fontWeight: "600" }}>Imprimir conferência</Text>
    </Pressable>
  );

  const linhaDesconto = temDesconto ? (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, marginVertical: 6 }}>
      <Text style={{ fontSize: 13, color: COLORS.danger }}>{comanda?.desconto_tipo === "cortesia" ? "Cortesia" : "Desconto"}</Text>
      <Text style={{ fontSize: 13, color: COLORS.danger }}>- {formatCurrency(descontoEfetivo)}</Text>
    </View>
  ) : null;
  const resumoComDesconto = (
    <View style={cardStyle}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Subtotal</Text>
        <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(subtotal)}</Text>
      </View>
      {linhaDesconto}
      {gorjetaValue > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Gorjeta</Text>
        <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(gorjetaValue)}</Text>
      </View>}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 18, fontWeight: "600", color: COLORS.text }}>Total</Text>
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(totalFinal)}</Text>
      </View>
    </View>
  );
  const avisoSemCobranca = (
    <View style={cardStyle}>
      <Text style={{ fontSize: 15, color: COLORS.text, textAlign: "center", marginBottom: 14 }}>Conta sem valor a cobrar (desconto ou cortesia)</Text>
      <Pressable onPress={encerrarSemCobranca} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
        {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Encerrar conta sem cobrança</Text>}
      </Pressable>
    </View>
  );

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  if (!loading && subtotal === 0 && pedidos.length > 0) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => { console.log('[FecharConta] back pressed (sem consumo)'); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
          <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.text }}>Fechar conta</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 20 }}>
          <Ionicons name="close-circle-outline" size={64} color={COLORS.textTertiary} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, textAlign: 'center' }}>
            Todos os itens foram cancelados
          </Text>
          <Text style={{ fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 }}>
            Todos os itens desta comanda foram cancelados. Ela será encerrada sem cobrança e ficará no histórico com total zero. Os cancelamentos continuam registrados.
          </Text>
          <Pressable
            onPress={async () => {
              console.log('[FecharConta] Encerrar sem consumo pressed', { comandaId: id });
              console.log('[FecharConta] POST /api/comandas/' + id + '/fechar (sem consumo)');
              await encerrarSemCobranca();
            }}
            disabled={saving}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', width: '100%', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Encerrar sem consumo</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {previewModal}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={etapaAnterior}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Fechar conta</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 }}>
          {ETAPAS.map((e, i) => (
            <View key={e} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: ETAPAS.indexOf(etapa) >= i ? COLORS.primary : COLORS.surfaceSecondary, justifyContent: "center", alignItems: "center" }}>
                {ETAPAS.indexOf(etapa) > i ? <Ionicons name="checkmark" size={16} color="white" /> : <Text style={{ fontSize: 12, fontWeight: "600", color: ETAPAS.indexOf(etapa) >= i ? "white" : COLORS.textTertiary }}>{i + 1}</Text>}
              </View>
              {i < ETAPAS.length - 1 && <View style={{ width: 20, height: 2, backgroundColor: ETAPAS.indexOf(etapa) > i ? COLORS.primary : COLORS.surfaceSecondary }} />}
            </View>
          ))}
        </View>

        {etapa === "resumo" && (<>
          <View style={cardStyle}>
            <Text style={labelStyle}>Itens do pedido</Text>
            {pedidos.filter((p: any) => p.status !== "cancelado").map((p: any, i: number) => {
              const nome = p.pratoNome || p.prato_nome || p.prato?.nome || "Item";
              const preco = parseFloat(p.precoUnitario || p.preco_unitario || "0");
              return (
                <View key={p.id || i} style={{ paddingVertical: 8, borderBottomWidth: i < pedidos.length - 1 ? 0.5 : 0, borderBottomColor: COLORS.surfaceSecondary }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 15, color: COLORS.text, flex: 1 }}>{p.quantidade}x {nome}</Text>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{formatCurrency(preco * (p.quantidade || 1))}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 2 }}>{formatCurrency(preco)} cada</Text>
                  {p.observacao && <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontStyle: "italic", marginTop: 2 }}>{p.observacao}</Text>}
                </View>
              );
            })}
          </View>
          {temDesconto ? resumoComDesconto : (
            <View style={{ ...cardStyle, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "600", color: COLORS.text }}>Subtotal</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(subtotal)}</Text>
            </View>
          )}
          <Pressable onPress={() => setEtapa("gorjeta")} style={btnPrimary}><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Próximo: Gorjeta</Text></Pressable>
        </>)}

        {etapa === "gorjeta" && (<>
          <View style={{ ...cardStyle, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Subtotal</Text>
            <Text style={{ fontSize: 24, fontWeight: "700", color: COLORS.text }}>{formatCurrency(subtotal)}</Text>
          </View>
          {temDesconto && <View style={cardStyle}>{linhaDesconto}</View>}
          <Text style={labelStyle}>Gorjeta</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {[{ mode: "none" as const, label: "Sem gorjeta" }, { mode: "10" as const, label: "10%" }, { mode: "custom" as const, label: "Outro" }].map((opt) => (
              <Pressable key={opt.mode} onPress={() => selectGorjeta(opt.mode)} style={{ flex: 1, backgroundColor: gorjetaMode === opt.mode ? COLORS.primary : COLORS.surface, borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 0.5, borderColor: gorjetaMode === opt.mode ? COLORS.primary : COLORS.surfaceSecondary }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: gorjetaMode === opt.mode ? "white" : COLORS.text }}>{opt.label}</Text>
                {opt.mode === "10" && <Text style={{ fontSize: 11, color: gorjetaMode === opt.mode ? "rgba(255,255,255,0.7)" : COLORS.textTertiary, marginTop: 2 }}>{formatCurrency(subtotal * 0.1)}</Text>}
              </Pressable>
            ))}
          </View>
          {gorjetaMode === "custom" && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, paddingHorizontal: 12 }}>
                <TextInput
                  value={gorjetaInput}
                  onChangeText={setGorjetaInput}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ flex: 1, padding: 12, fontSize: 20, color: COLORS.text, textAlign: "center", fontWeight: "600" }}
                />
                <Text style={{ fontSize: 18, fontWeight: "600", color: COLORS.textSecondary }}>%</Text>
              </View>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginTop: 6 }}>{formatCurrency(gorjetaValue)}</Text>
            </View>
          )}
          <View style={{ ...cardStyle, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total com gorjeta</Text>{gorjetaValue > 0 && <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>Gorjeta: {formatCurrency(gorjetaValue)}</Text>}</View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(totalFinal)}</Text>
          </View>
          {botaoConferencia}
          {semCobranca ? avisoSemCobranca : <Pressable onPress={() => setEtapa("divisao")} style={btnPrimary}><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Próximo: Divisão</Text></Pressable>}
        </>)}

        {etapa === "divisao" && (<>
          {temDesconto ? resumoComDesconto : (
            <View style={{ ...cardStyle, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total a pagar</Text>
              <Text style={{ fontSize: 24, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(totalFinal)}</Text>
            </View>
          )}
          {semCobranca ? avisoSemCobranca : (<>
          <Text style={labelStyle}>Dividir a conta?</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <Pressable onPress={() => { setDividir(false); setDivisaoResult(null); }} style={{ flex: 1, backgroundColor: !dividir ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: !dividir ? COLORS.primary : COLORS.surfaceSecondary }}>
              <Ionicons name="person-outline" size={24} color={!dividir ? "white" : COLORS.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: "500", color: !dividir ? "white" : COLORS.text, marginTop: 6 }}>Uma pessoa</Text>
            </Pressable>
            <Pressable onPress={() => setDividir(true)} style={{ flex: 1, backgroundColor: dividir ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: dividir ? COLORS.primary : COLORS.surfaceSecondary }}>
              <Ionicons name="people-outline" size={24} color={dividir ? "white" : COLORS.textSecondary} />
              <Text style={{ fontSize: 13, fontWeight: "500", color: dividir ? "white" : COLORS.text, marginTop: 6 }}>Dividir</Text>
            </Pressable>
          </View>
          {dividir && (<>
            <Text style={labelStyle}>Número de pessoas</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
              <Pressable onPress={() => setNumPessoas(Math.max(2, numPessoas - 1))} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surfaceSecondary, justifyContent: "center", alignItems: "center" }}><Ionicons name="remove" size={24} color={COLORS.text} /></Pressable>
              <Text style={{ fontSize: 36, fontWeight: "700", color: COLORS.text, minWidth: 50, textAlign: "center" }}>{numPessoas}</Text>
              <Pressable onPress={() => setNumPessoas(numPessoas + 1)} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center" }}><Ionicons name="add" size={24} color="white" /></Pressable>
            </View>
            <View style={{ ...cardStyle, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Valor por pessoa</Text>
              <Text style={{ fontSize: 28, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(valorPorPessoa)}</Text>
            </View>
          </>)}
          {botaoConferencia}
          <Pressable onPress={() => { if (dividir) calcularDivisao(); setEtapa("pagamento"); }} style={btnPrimary}><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Próximo: Pagamento</Text></Pressable>
          </>)}
        </>)}

        {etapa === "pagamento" && (<>
          <View style={cardStyle}>
            {temDesconto ? (<>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Subtotal</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(subtotal)}</Text></View>
              {linhaDesconto}
              {gorjetaValue > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Gorjeta</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(gorjetaValue)}</Text></View>}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total da comanda</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(totalFinal)}</Text></View>
            </>) : (<>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total da comanda</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(totalFinal)}</Text></View>
              {gorjetaValue > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Gorjeta (no fechamento)</Text><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{formatCurrency(gorjetaValue)}</Text></View>}
              {gorjetaValue > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Gorjeta</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(gorjetaValue)}</Text></View>}
            </>)}
            {totalPago > 0 && <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}><Text style={{ fontSize: 13, color: "#22C55E" }}>Já pago</Text><Text style={{ fontSize: 13, color: "#22C55E" }}>{formatCurrency(totalPago)}</Text></View>}
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>{dividir ? "Pessoa " + (pessoaAtual + 1) + "/" + numPessoas : "Restante"}</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(dividir ? valorPessoaAtual : restante)}</Text>
            </View>
          </View>
          {semCobranca ? avisoSemCobranca : (<>
          <Text style={labelStyle}>Forma de pagamento</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {FORMAS.map((f) => (
              <Pressable key={f.key} onPress={() => setForma(f.key)} style={{ flex: 1, minWidth: "45%", backgroundColor: forma === f.key ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: forma === f.key ? COLORS.primary : COLORS.surfaceSecondary }}>
                <Ionicons name={f.icon} size={24} color={forma === f.key ? "white" : COLORS.textSecondary} />
                <Text style={{ fontSize: 13, fontWeight: "500", color: forma === f.key ? "white" : COLORS.text, marginTop: 6 }}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {forma === "dinheiro" && (<><Text style={labelStyle}>Troco para (R$)</Text><CampoMoeda value={trocoInput} onChangeText={setTrocoInput} placeholder="0,00" placeholderTextColor={COLORS.textTertiary} style={{ backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 16, color: COLORS.text, marginBottom: 16 }} /></>)}
          {pagamentos.length > 0 && <View style={{ ...cardStyle, marginBottom: 16 }}><Text style={labelStyle}>Pagamentos registrados</Text>{pagamentos.map((p: any, i: number) => (<View key={p.id || i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{p.formaPagamento || p.forma_pagamento}</Text><Text style={{ fontSize: 13, color: p.status === "confirmado" ? "#22C55E" : "#F59E0B", fontWeight: "500" }}>{formatCurrency(parseFloat(p.valor))} {p.status === "pendente" ? "(pendente)" : "✓"}</Text></View>))}</View>}
          <Pressable onPress={() => registrarPagamento(dividir ? valorPessoaAtual : restante)} disabled={saving || restante <= 0} style={{ ...btnPrimary, backgroundColor: saving || restante <= 0 ? COLORS.textTertiary : COLORS.primary }}>
            {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>{restante <= 0 ? "Tudo pago" : "Pagar " + formatCurrency(dividir ? valorPessoaAtual : restante)}</Text>}
          </Pressable>
          {restante <= 0 && <Pressable onPress={fecharComanda} style={{ ...btnPrimary, marginTop: 10, backgroundColor: "#22C55E" }}><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Fechar comanda</Text></Pressable>}
          </>)}
        </>)}
      </ScrollView>
    </View>
  );
}
