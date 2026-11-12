import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost } from "@/utils/api";
import { isAdmin } from "@/utils/helpers";
import { lerTransacaoPendente, limparTransacaoPendente, TransacaoPendente } from "@/utils/terminalPendente";
import { voltarDaMaquininha } from "@/utils/cobrancaMaquininha";
import { obterInterpretador, nomeExibicaoProvedor } from "@/utils/provedoresMaquininha/registro";
import type { RetornoInterpretado } from "@/utils/provedoresMaquininha/tipos";

// Destino de cozinhafastpro://pay-response, para onde o aplicativo de pagamento devolve o resultado.
// Interpreta o retorno e registra no servidor (POST .../retorno ou .../sem-retorno). O servidor é
// idempotente: reenviar o mesmo retorno não duplica o pagamento. Não fecha a comanda.

type Desfecho = { tipo: RetornoInterpretado["resultado"]; resposta: any; mensagem?: string };

const reais = (n: any) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");

export default function PayResponseScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { user } = useAuth();
  const [pendente, setPendente] = useState<TransacaoPendente | null>(null);
  const [lido, setLido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desfecho, setDesfecho] = useState<Desfecho | null>(null);
  const emAndamento = useRef(false);
  const iniciou = useRef(false);

  const textoParams = useMemo(() => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) r[k] = Array.isArray(v) ? v.join(", ") : String(v);
    return r;
  }, [params]);

  const interpretado = useMemo(() => {
    const interpretar = obterInterpretador(pendente?.provedor);
    return interpretar ? interpretar(textoParams) : null;
  }, [pendente, textoParams]);

  // Parâmetros exibidos (gerência): o interpretador já tira pan e nome do portador
  const linhas = useMemo(() => {
    if (!interpretado) return [] as string[][];
    return Object.entries(JSON.parse(interpretado.retornoBruto) as Record<string, string>).map(([k, v]) => [k, String(v)]);
  }, [interpretado]);

  const enviar = useCallback(async (p: TransacaoPendente, r: RetornoInterpretado | null) => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setEnviando(true);
    setErro(null);
    try {
      if (!r) throw new Error("Provedor de maquininha não suportado neste aparelho.");
      let resposta: any;
      if (r.resultado === "inconclusivo") {
        resposta = await apiPost("/api/terminal/transacoes/" + p.transacaoId + "/sem-retorno", {});
      } else {
        const body: any = { resultado: r.resultado, dados_provedor: r.dadosProvedor, retorno_bruto: r.retornoBruto };
        if (r.idExterno) body.id_externo = r.idExterno;
        if (r.itk) body.itk = r.itk;
        resposta = await apiPost("/api/terminal/transacoes/" + p.transacaoId + "/retorno", body);
      }
      // Só limpa a transação pendente depois que o servidor respondeu com sucesso
      await limparTransacaoPendente();
      setDesfecho({ tipo: r.resultado, resposta, mensagem: r.mensagem });
    } catch (e: any) {
      console.log("[PayResponse] Erro ao registrar retorno:", e);
      setErro(e?.message || "Não foi possível registrar o resultado da cobrança.");
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }, []);

  useEffect(() => {
    lerTransacaoPendente().then((p) => {
      setPendente(p);
      setLido(true);
    });
  }, []);

  // Dispara uma única vez, quando a transação pendente e a interpretação estão prontas
  useEffect(() => {
    if (!lido || !pendente || iniciou.current) return;
    iniciou.current = true;
    enviar(pendente, interpretado);
  }, [lido, pendente, interpretado, enviar]);

  const voltar = () => {
    console.log("[PayResponse] Voltar à comanda pressed");
    if (voltarDaMaquininha(pendente?.comandaId, pendente?.retorno)) return;
    if (pendente?.comandaId) router.replace({ pathname: "/comanda/[id]", params: { id: pendente.comandaId } });
    else router.replace("/(tabs)/(home)");
  };

  const card = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16 } as const;
  const titulo = { fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 } as const;
  const grande = { fontSize: 18, fontWeight: "700", color: COLORS.text, marginBottom: 6 } as const;
  const texto = { fontSize: 14, color: COLORS.text } as const;

  const resp = desfecho?.resposta;
  const naoRegistrado = desfecho?.tipo === "aprovada" && resp?.pagamento_registrado === false;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Resposta da maquininha</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        {!lido || enviando ? (
          <View style={[card, { alignItems: "center", gap: 10 }]}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={texto}>Registrando o resultado da cobrança...</Text>
          </View>
        ) : null}

        {lido && !pendente && !desfecho ? (
          <View style={card}>
            <Text style={grande}>Nenhuma cobrança pendente</Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary }}>Não há cobrança aguardando resultado neste aparelho.</Text>
          </View>
        ) : null}

        {erro && !enviando ? (
          <View style={card}>
            <Text style={grande}>Não foi possível registrar</Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 }}>
              {erro} A cobrança continua pendente neste aparelho. Tente novamente; reenviar é seguro e não duplica o pagamento.
            </Text>
            <Pressable
              onPress={() => pendente && enviar(pendente, interpretado)}
              disabled={enviando}
              style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: "center" }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : null}

        {desfecho?.tipo === "aprovada" ? (
          <View style={card}>
            <Text style={grande}>Pagamento aprovado</Text>
            {naoRegistrado ? (
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#B91C1C" }}>
                {resp?.aviso || "A cobrança foi aprovada, mas o pagamento não foi registrado: a comanda não está mais aberta. Avise a gerência."}
              </Text>
            ) : resp?.resumo ? (
              <>
                <Text style={texto}>Restante da conta: {reais(resp.resumo.restante)}</Text>
                <Text style={texto}>{resp.resumo.quitada ? "A conta foi quitada." : "A conta ainda não foi quitada."}</Text>
              </>
            ) : null}
            {resp?.repetido ? <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>Resultado já registrado antes.</Text> : null}
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>A comanda não é fechada automaticamente.</Text>
          </View>
        ) : null}

        {desfecho?.tipo === "recusada" ? (
          <View style={card}>
            <Text style={grande}>Pagamento não aprovado</Text>
            {desfecho.mensagem ? <Text style={texto}>{nomeExibicaoProvedor(pendente?.provedor)}: {desfecho.mensagem}</Text> : null}
            {resp?.repetido ? <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>Resultado já registrado antes.</Text> : null}
          </View>
        ) : null}

        {desfecho?.tipo === "inconclusivo" ? (
          <View style={card}>
            <Text style={grande}>Resultado não confirmado</Text>
            <Text style={texto}>
              Não foi possível confirmar o resultado da cobrança. A gerência deve conferir a cobrança na maquininha antes de cobrar de novo.
            </Text>
          </View>
        ) : null}

        {isAdmin(user?.role) && linhas.length > 0 ? (
          <>
            <Text style={titulo}>Parâmetros recebidos</Text>
            <View style={card}>
              {linhas.map(([k, v]) => (
                <View key={k} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{k}</Text>
                  <Text selectable style={{ fontSize: 14, color: COLORS.text }}>{v}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Pressable onPress={voltar} disabled={enviando} style={{ backgroundColor: enviando ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Voltar à comanda</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
