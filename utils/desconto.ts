import { apiDelete, apiPut } from "@/utils/api";

export type MotivoDesconto = "cliente" | "erro_atendimento" | "promocao" | "funcionario" | "outro";
export type TipoDesconto = "desconto" | "cortesia";

export const MOTIVOS_DESCONTO: { value: MotivoDesconto; label: string }[] = [
  { value: "cliente", label: "Cliente" },
  { value: "erro_atendimento", label: "Erro de atendimento" },
  { value: "promocao", label: "Promoção" },
  { value: "funcionario", label: "Funcionário" },
  { value: "outro", label: "Outro" },
];

/** Mesmos três perfis aceitos pelo servidor; não usa a lista de gestão do cancelamento. */
export function podeConcederDesconto(role: string | null | undefined): boolean {
  return ["gerente", "administrador", "admin"].includes((role ?? "").toLowerCase());
}

export function podeAbrirFluxoDesconto(role: string | null | undefined): boolean {
  return podeConcederDesconto(role) || exigeAutorizacaoGerente(role);
}

export function exigeAutorizacaoGerente(role: string | null | undefined): boolean {
  return (role ?? "").toLowerCase() === "garcom";
}

export interface AutorizacaoGerente {
  email: string;
  senha: string;
}

function numeroNaoNegativo(valor: unknown): number {
  if (typeof valor !== "number" && typeof valor !== "string") return 0;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.max(0, numero) : 0;
}

/** Somente itens: não inclui gorjeta. Cortesia acompanha o subtotal atual. */
export function calcularTotalComDesconto(subtotal: unknown, tipo: string | null | undefined, valorGravado: unknown) {
  const subtotalAtual = numeroNaoNegativo(subtotal);
  const descontoEfetivo = tipo === "cortesia"
    ? subtotalAtual
    : tipo === "desconto" ? Math.min(numeroNaoNegativo(valorGravado), subtotalAtual) : 0;
  return { descontoEfetivo, total: Math.round((subtotalAtual - descontoEfetivo) * 100) / 100 };
}

export interface DescontoAtual {
  desconto_valor: number;
  desconto_tipo: string | null;
  desconto_motivo: string | null;
}

export type AplicarDescontoCorpo = { motivo: MotivoDesconto; detalhe?: string } & (
  | { tipo: "desconto"; valor: number; percentual?: never }
  | { tipo: "desconto"; percentual: number; valor?: never }
  | { tipo: "cortesia"; valor?: never; percentual?: never }
);

export interface RespostaDesconto {
  subtotal: number;
  gorjeta: number;
  desconto_valor: number;
  desconto_tipo: string | null;
  desconto_motivo: string | null;
  desconto_por_nome: string | null;
  desconto_aplicado_por_nome: string | null;
  total: number;
}

/** Erros mantêm a mensagem do servidor através do mesmo cliente usado no cancelamento. */
export function aplicarDesconto(comandaId: string, corpo: AplicarDescontoCorpo, autorizacao?: AutorizacaoGerente): Promise<RespostaDesconto> {
  const { motivo, detalhe } = corpo;
  const dados = {
    motivo,
    ...(detalhe?.trim() ? { detalhe: detalhe.trim() } : {}),
  };
  const payload = corpo.tipo === "cortesia"
    ? { ...dados, tipo: "cortesia" }
    : "valor" in corpo && corpo.valor !== undefined
      ? { ...dados, tipo: "desconto", valor: corpo.valor }
      : { ...dados, tipo: "desconto", percentual: corpo.percentual };
  return apiPut<RespostaDesconto>(`/api/comandas/${comandaId}/desconto`, autorizacao
    ? { ...payload, autorizacao: { email: autorizacao.email.trim(), senha: autorizacao.senha } }
    : payload);
}

export function removerDesconto(comandaId: string, autorizacao?: AutorizacaoGerente): Promise<RespostaDesconto> {
  if (autorizacao) {
    return apiDelete<RespostaDesconto>(`/api/comandas/${comandaId}/desconto`, {
      autorizacao: { email: autorizacao.email.trim(), senha: autorizacao.senha },
    });
  }
  return apiDelete<RespostaDesconto>(`/api/comandas/${comandaId}/desconto`);
}
