/**
 * Cancelamento de item (pedido) no app.
 *
 * Regras (espelham o backend, PUT /api/pedidos/:id/cancelar; o servidor é quem decide):
 * - Item cancelado NÃO é venda: sai do total da comanda, dos relatórios e da nota fiscal.
 * - pendente: garçom, gerente e administrador cancelam.
 * - em preparo / pronto: só gerente e administrador (fica registrado como perda).
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
  /** texto para explicar por que não pode (quando pode = false) */
  motivoNegado?: string;
}

export function permissaoCancelarItem(role: string | null | undefined, status: string): PermissaoCancelamento {
  if (status === "cancelado") {
    return { pode: false, aposInicio: false, motivoNegado: "Este item já está cancelado." };
  }
  if (status === "entregue") {
    return { pode: false, aposInicio: false, motivoNegado: "Item já entregue não pode ser cancelado." };
  }
  if (!ehAtendimento(role)) {
    return { pode: false, aposInicio: false, motivoNegado: "Seu perfil não pode cancelar itens." };
  }
  const aposInicio = status === "em_preparo" || status === "pronto";
  if (aposInicio && !ehGestor(role)) {
    return {
      pode: false,
      aposInicio,
      motivoNegado: "Só gerente ou administrador pode cancelar um item que já está em preparo ou pronto.",
    };
  }
  return { pode: true, aposInicio };
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
}

/** Cancela o item no servidor. Em caso de erro lança Error com a mensagem do servidor. */
export function cancelarItem(
  pedidoId: string,
  motivo: MotivoCancelamento,
  detalhe?: string | null
): Promise<RespostaCancelamento> {
  const corpo: { motivo: MotivoCancelamento; detalhe?: string } = { motivo };
  if (detalhe && detalhe.trim()) corpo.detalhe = detalhe.trim();
  return apiPut<RespostaCancelamento>(`/api/pedidos/${pedidoId}/cancelar`, corpo);
}
