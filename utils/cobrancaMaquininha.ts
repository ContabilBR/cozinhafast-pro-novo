import { Alert } from "react-native";
import { router } from "expo-router";
import { apiPost } from "@/utils/api";
import { obterExecutor, PROVEDOR_STONE } from "@/utils/provedoresMaquininha/registro";
import type { InstrucaoPagamento } from "@/utils/provedoresMaquininha/tipos";
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

// Inicia a transação no servidor, abre o aplicativo de pagamento do provedor e leva para a tela de espera.
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
    // Instrução neutra; backend antigo só devolve o bloco "terminal" (Stone)
    const instrucao: InstrucaoPagamento | null =
      res?.instrucao_pagamento?.dados
        ? res.instrucao_pagamento
        : res?.terminal
          ? { provedor: PROVEDOR_STONE, modo: "aparelho", dados: res.terminal }
          : null;
    if (!transacaoId || !instrucao) throw new Error("Resposta inesperada do servidor.");

    const executor = obterExecutor(instrucao.provedor, instrucao.modo);
    if (!executor) {
      console.log("[Maquininha] Provedor não suportado neste aparelho:", instrucao.provedor, instrucao.modo);
      Alert.alert("Maquininha", "Este provedor de maquininha ainda não é suportado neste aparelho. Use o registro manual.");
      return;
    }
    await salvarTransacaoPendente({ transacaoId, comandaId: p.comandaId, retorno: p.retorno, provedor: instrucao.provedor });

    try {
      await executor.abrir(instrucao.dados);
    } catch (e) {
      console.log("[Maquininha] Aplicativo de pagamento não encontrado:", e);
      await apiPost("/api/terminal/transacoes/" + transacaoId + "/sem-retorno", {}).catch(() => {});
      await limparTransacaoPendente();
      Alert.alert("Maquininha", executor.mensagemAppNaoEncontrado);
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
