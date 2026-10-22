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
