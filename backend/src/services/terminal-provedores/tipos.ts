// Camada comum (neutra) dos provedores de maquininha.
// Cada provedor tem um adaptador que implementa ProvedorTerminal; as rotas só falam com esta interface.

export type FormaTerminal = "cartao_credito" | "cartao_debito" | "pix";

// "aparelho": o app abre o app de pagamento instalado no aparelho e devolve o resultado ao backend.
// "nuvem": o backend manda a cobrança ao provedor e recebe o resultado por webhook/consulta.
//         (apenas previsto na definição; nenhum adaptador implementa este modo ainda)
export type ModoProvedor = "aparelho" | "nuvem";

export interface EntradaCobranca {
  forma_pagamento: FormaTerminal;
  parcelas?: number;
  tipo_parcelamento?: "lojista" | "emissor";
}

// Cobrança já traduzida para o vocabulário do provedor (é o que fica gravado na tabela).
export interface CobrancaTraduzida {
  tipoTransacao: string;
  tipoParcelamento: string | null;
  parcelas: number | null;
}

export type ResultadoTraducao = { ok: true; cobranca: CobrancaTraduzida } | { ok: false; erro: string };

export interface EntradaInstrucao {
  valorCentavos: number;
  orderId: number;
  cobranca: CobrancaTraduzida;
}

// O que o app executa para cobrar. "dados" é específico do provedor/modo.
export interface InstrucaoPagamento {
  provedor: string;
  modo: ModoProvedor;
  dados: Record<string, unknown>;
}

export interface EntradaRetorno {
  resultado: "aprovada" | "recusada" | "cancelada";
  idExterno: string | undefined;
}

export interface ProvedorTerminal {
  readonly nome: string;
  readonly modo: ModoProvedor;
  readonly maxParcelas: number;

  // Valida e traduz forma de pagamento, parcelas e tipo de parcelamento para o vocabulário do provedor.
  traduzirCobranca(entrada: EntradaCobranca): ResultadoTraducao;
  // Forma de pagamento do sistema a partir do tipo de transação gravado.
  formaPagamentoDe(tipoTransacao: string): FormaTerminal | null;
  // Instrução de pagamento que o app executa (modo "aparelho").
  montarInstrucao(entrada: EntradaInstrucao): InstrucaoPagamento;
  // Valida o retorno; devolve a mensagem de erro (400) ou null se estiver tudo certo.
  validarRetorno(entrada: EntradaRetorno): string | null;
  // Colunas legadas (atk/itk) que o provedor ainda preenche além do id_externo.
  camposLegados(entrada: { idExterno: string | undefined; itk: string | undefined }): { atk?: string; itk?: string };
}
