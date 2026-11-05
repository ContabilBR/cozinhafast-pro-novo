/**
 * Cancelamento de item (pedido) no app.
 *
 * Regras (espelham o backend, PUT /api/pedidos/:id/cancelar; o servidor é quem decide):
 * - Item cancelado NÃO é venda: sai do total da comanda, dos relatórios e da nota fiscal.
 * - pendente: garçom, gerente e administrador cancelam.
 * - em preparo / pronto: gerente e administrador cancelam direto; o garçom também pode, mas só com a
 *   autorização de um gerente (e-mail e senha digitados na hora). Fica registrado como perda.
 * - Cancelamento parcial: a quantidade (1 até a do item) cancela só essa parte; o restante continua ativo.
 * - Cozinheiro não cancela.
 * - entregue: não cancela.
 * - Motivo obrigatório; "outro" exige detalhe.
 */
import { apiPut } from "@/utils/api";

export type MotivoCancelamento =
  | "erro_lancamento"
  | "cliente_desistiu"
  | "item_em_falta"
  | "demora"
  | "qualidade"
  | "outro";

export const MOTIVOS_CANCELAMENTO: { value: MotivoCancelamento; label: string }[] = [
  { value: "erro_lancamento", label: "Erro de lançamento" },
  { value: "cliente_desistiu", label: "Cliente desistiu" },
  { value: "item_em_falta", label: "Item em falta" },
  { value: "demora", label: "Demora no preparo" },
  { value: "qualidade", label: "Problema de qualidade" },
  { value: "outro", label: "Outro motivo" },
];

const ROLES_GESTAO = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"];
const ROLES_ATENDIMENTO = ["garcom", ...ROLES_GESTAO];

export function ehGestor(role: string | null | undefined): boolean {
  return ROLES_GESTAO.includes((role ?? "").toLowerCase());
}

export function ehAtendimento(role: string | null | undefined): boolean {
  return ROLES_ATENDIMENTO.includes((role ?? "").toLowerCase());
}

export interface PermissaoCancelamento {
  /** true quando este usuário pode cancelar este item agora */
  pode: boolean;
  /** true quando o item já foi iniciado (em preparo ou pronto): conta como perda */
  aposInicio: boolean;
  /** true quando o cancelamento exige e-mail e senha de um gerente (garçom em item iniciado) */
  exigeAutorizacao: boolean;
  /** texto para explicar por que não pode (quando pode = false) */
  motivoNegado?: string;
}

export function permissaoCancelarItem(role: string | null | undefined, status: string): PermissaoCancelamento {
  if (status === "cancelado") {
    return { pode: false, aposInicio: false, exigeAutorizacao: false, motivoNegado: "Este item já está cancelado." };
  }
  if (status === "entregue") {
    return { pode: false, aposInicio: false, exigeAutorizacao: false, motivoNegado: "Item já entregue não pode ser cancelado." };
  }
  if (!ehAtendimento(role)) {
    return { pode: false, aposInicio: false, exigeAutorizacao: false, motivoNegado: "Seu perfil não pode cancelar itens." };
  }
  const aposInicio = status === "em_preparo" || status === "pronto";
  return { pode: true, aposInicio, exigeAutorizacao: aposInicio && !ehGestor(role) };
}

export interface PermissaoCancelarComanda {
  /** true quando o botão "Cancelar comanda" deve aparecer */
  pode: boolean;
  /** true quando há item em preparo ou pronto (conta como perda) */
  temPerda: boolean;
  /** true quando um gerente precisa autorizar com e-mail e senha (garçom com item em preparo ou pronto) */
  exigeAutorizacao: boolean;
}

/**
 * Cancelamento da comanda inteira (PUT /api/comandas/:id/cancelar). O servidor é quem decide.
 * Aparece com pelo menos um item ativo e nenhum item ativo entregue; cozinheiro não cancela.
 */
export function permissaoCancelarComanda(
  role: string | null | undefined,
  itens: Array<{ status?: string | null }>
): PermissaoCancelarComanda {
  const ativos = itens.filter((i) => itemConta(i.status));
  const temPerda = ativos.some((i) => i.status === "em_preparo" || i.status === "pronto");
  const temEntregue = ativos.some((i) => i.status === "entregue");
  const pode = ehAtendimento(role) && ativos.length > 0 && !temEntregue;
  return { pode, temPerda, exigeAutorizacao: pode && temPerda && !ehGestor(role) };
}

/** Item que conta como venda (não cancelado). */
export function itemConta(status: string | null | undefined): boolean {
  return status !== "cancelado";
}

/** Soma quantidade x preço apenas dos itens que contam como venda. Aceita preco_unitario ou precoUnitario. */
export function subtotalItensAtivos(
  itens: Array<{ status?: string | null; quantidade?: number | null; preco_unitario?: unknown; precoUnitario?: unknown }>
): number {
  return itens
    .filter((i) => itemConta(i.status))
    .reduce((soma, i) => {
      const preco = parseFloat(String(i.precoUnitario ?? i.preco_unitario ?? "0").replace(",", "."));
      const qtd = i.quantidade ?? 1;
      return soma + (isNaN(preco) ? 0 : preco) * qtd;
    }, 0);
}

export interface RespostaCancelamento {
  success: boolean;
  id: string;
  comanda_id: string;
  status: string;
  cancelado_apos_inicio: boolean;
  subtotal_comanda: number;
  total_comanda: number;
  parcial?: boolean;
  quantidade_cancelada?: number;
  quantidade_restante?: number;
  autorizado_por_nome?: string | null;
  id_cancelado?: string;
}

export interface AutorizacaoCancelamento {
  email: string;
  senha: string;
}

/** Cancela a comanda inteira no servidor. Em caso de erro lança Error com a mensagem do servidor. */
export function cancelarComanda(
  comandaId: string,
  motivo: MotivoCancelamento,
  detalhe?: string | null,
  autorizacao?: AutorizacaoCancelamento
): Promise<unknown> {
  const corpo: { motivo: MotivoCancelamento; detalhe?: string; autorizacao?: AutorizacaoCancelamento } = { motivo };
  if (detalhe && detalhe.trim()) corpo.detalhe = detalhe.trim();
  if (autorizacao && autorizacao.email.trim() && autorizacao.senha) {
    corpo.autorizacao = { email: autorizacao.email.trim(), senha: autorizacao.senha };
  }
  return apiPut<unknown>(`/api/comandas/${comandaId}/cancelar`, corpo);
}

/** Cancela o item no servidor. Em caso de erro lança Error com a mensagem do servidor. */
export function cancelarItem(
  pedidoId: string,
  motivo: MotivoCancelamento,
  detalhe?: string | null,
  quantidade?: number,
  autorizacao?: AutorizacaoCancelamento
): Promise<RespostaCancelamento> {
  const corpo: {
    motivo: MotivoCancelamento;
    detalhe?: string;
    quantidade?: number;
    autorizacao?: AutorizacaoCancelamento;
  } = { motivo };
  if (detalhe && detalhe.trim()) corpo.detalhe = detalhe.trim();
  if (quantidade !== undefined) corpo.quantidade = quantidade;
  if (autorizacao && autorizacao.email.trim() && autorizacao.senha) {
    corpo.autorizacao = { email: autorizacao.email.trim(), senha: autorizacao.senha };
  }
  return apiPut<RespostaCancelamento>(`/api/pedidos/${pedidoId}/cancelar`, corpo);
}
