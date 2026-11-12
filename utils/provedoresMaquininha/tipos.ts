// Executor de provedor de maquininha para o modo "aparelho": o app abre o aplicativo de pagamento
// instalado no aparelho com os dados da instrução de pagamento devolvida pelo servidor.
export type ModoProvedor = "aparelho" | "nuvem";

export type InstrucaoPagamento = {
  provedor: string;
  modo: ModoProvedor | string;
  dados: Record<string, any>;
};

export type ExecutorProvedor = {
  // Nome mostrado ao usuário (ex.: "Stone")
  nomeExibicao: string;
  // Abre o aplicativo de pagamento do aparelho. Lança erro se não conseguir abrir.
  abrir: (dados: Record<string, any>) => Promise<void>;
  // Mensagem quando o aplicativo de pagamento não é encontrado
  mensagemAppNaoEncontrado: string;
};
