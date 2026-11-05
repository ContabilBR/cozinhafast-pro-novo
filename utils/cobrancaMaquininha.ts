import { Alert } from "react-native";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { apiPost } from "@/utils/api";
import { salvarTransacaoPendente, limparTransacaoPendente, RetornoCobranca } from "@/utils/terminalPendente";

export type PedidoCobranca = {
  comandaId: string;
  forma: string;
  valor: number;
  parcelas?: number;
  tipoParcelamento?: "lojista" | "emissor";
  gorjeta?: number;
  retorno?: RetornoCobranca;
};

// Inicia a transação no servidor, abre o app da Stone e leva para a tela de espera.
// Não interpreta o resultado nem registra pagamento.
export async function cobrarNaMaquininha(p: PedidoCobranca): Promise<void> {
  console.log("[Maquininha] Cobrar:", p);
  try {
    const body: any = { forma_pagamento: p.forma, valor: p.valor };
    if (p.forma === "cartao_credito") {
      body.parcelas = p.parcelas || 1;
      if ((p.parcelas || 1) > 1) body.tipo_parcelamento = p.tipoParcelamento || "lojista";
    }
    if (p.gorjeta && p.gorjeta > 0) body.gorjeta = Math.round(p.gorjeta * 100) / 100;
    const res: any = await apiPost("/api/comandas/" + p.comandaId + "/terminal/transacoes", body);
    const transacaoId: string | undefined = res?.transacao?.id;
    const t = res?.terminal;
    if (!transacaoId || !t) throw new Error("Resposta inesperada do servidor.");
    await salvarTransacaoPendente({ transacaoId, comandaId: p.comandaId, retorno: p.retorno });

    const qs = new URLSearchParams();
    qs.set("return_scheme", "cozinhafastpro");
    qs.set("amount", String(t.amount_centavos));
    qs.set("editable_amount", "0");
    qs.set("transaction_type", String(t.transaction_type));
    if (t.installment_type) qs.set("installment_type", String(t.installment_type));
    if (t.installment_count) qs.set("installment_count", String(t.installment_count));
    qs.set("order_id", String(t.order_id));
    const url = "payment-app://pay?" + qs.toString();
    console.log("[Maquininha] Abrindo:", url);
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.log("[Maquininha] Stone não encontrada:", e);
      await apiPost("/api/terminal/transacoes/" + transacaoId + "/sem-retorno", {}).catch(() => {});
      await limparTransacaoPendente();
      Alert.alert("Maquininha", "Aplicativo de pagamento da Stone não encontrado neste aparelho. Use o registro manual.");
      return;
    }
    const params: Record<string, string> = { transacaoId, comandaId: p.comandaId };
    if (p.retorno) params.retorno = p.retorno;
    router.push({ pathname: "/comanda/aguardando-maquininha", params });
  } catch (err: any) {
    console.log("[Maquininha] Erro ao iniciar cobrança:", err);
    Alert.alert("Erro", err?.message || "Não foi possível iniciar a cobrança.");
  }
}

// Destino de volta (Não recebi resposta / Voltar à comanda)
export function voltarDaMaquininha(comandaId: string | undefined, retorno?: RetornoCobranca | string) {
  if (retorno === "fechar-conta" && comandaId) {
    router.dismissTo({ pathname: "/comanda/fechar-conta", params: { id: comandaId, etapa: "pagamento" } });
    return true;
  }
  return false;
}
