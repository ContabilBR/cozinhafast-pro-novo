/**
 * Lançamento de itens (pedidos) em uma comanda.
 *
 * Única definição das regras de "adicionar itens a uma comanda", usada pela rota legada
 * POST /api/pedidos (mantida só para os aplicativos já instalados).
 *
 * Regras:
 * - A comanda tem que ser do restaurante de quem chama (comanda de outro restaurante = não encontrada).
 * - Só comanda ABERTA recebe item; comanda de delivery tem tela e fluxo próprios.
 * - Cozinheiro não lança item. Garçom, gerente e administrador lançam em qualquer comanda aberta do
 *   restaurante (o cliente pode pedir a qualquer garçom; o garçom dono da comanda não muda).
 * - Cada prato tem que ser do restaurante e estar disponível; o preço vem SEMPRE do cadastro do prato.
 * - Quantidade: inteiro de 1 a 99. Observação: até 500 caracteres. No máximo 50 itens por lançamento.
 * - Tudo ou nada: os itens e o novo total entram na mesma transação, com a comanda travada
 *   (a mesma trava do fechamento e do cancelamento: não entra item numa comanda que está fechando).
 *
 * O módulo não conhece HTTP: devolve um resultado com desfecho nomeado.
 * Ordem de trava: primeiro a linha da comanda (a mesma do fechamento e do cancelamento).
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import { ehGestor } from "./cancelamento-pedido.js";
import { subtotalDaComanda } from "./total-comanda.js";

export const QUANTIDADE_MINIMA = 1;
export const QUANTIDADE_MAXIMA = 99;
export const OBSERVACAO_MAX_CARACTERES = 500;
export const MAX_ITENS_POR_LANCAMENTO = 50;

export interface ItemLancamento {
  pratoId: string;
  quantidade: number;
  observacao?: string | null;
}

export interface EntradaLancamento {
  restauranteId: string;
  comandaId: string;
  usuario: { id: string; role: string };
  itens: ItemLancamento[];
}

export type PedidoLancado = typeof schema.pedidos.$inferSelect;

export type ResultadoLancamento =
  | { tipo: "lancado"; pedidos: PedidoLancado[]; subtotalComanda: number; totalComanda: number }
  | { tipo: "itens_invalidos"; mensagem: string }
  | { tipo: "comanda_nao_encontrada" }
  | { tipo: "comanda_delivery" }
  | { tipo: "comanda_nao_aberta" }
  | { tipo: "sem_permissao" }
  | { tipo: "prato_indisponivel" };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

/** Valida a lista de itens antes de abrir a transação. Devolve a mensagem de erro, ou null se estiver ok. */
export function validarItens(itens: ItemLancamento[]): string | null {
  if (!Array.isArray(itens) || itens.length === 0) {
    return "Informe ao menos um item.";
  }
  if (itens.length > MAX_ITENS_POR_LANCAMENTO) {
    return `Máximo de ${MAX_ITENS_POR_LANCAMENTO} itens por envio.`;
  }
  for (const item of itens) {
    if (
      !Number.isInteger(item.quantidade) ||
      item.quantidade < QUANTIDADE_MINIMA ||
      item.quantidade > QUANTIDADE_MAXIMA
    ) {
      return `Quantidade inválida: deve ser um número inteiro entre ${QUANTIDADE_MINIMA} e ${QUANTIDADE_MAXIMA}.`;
    }
    if (item.observacao != null && item.observacao.length > OBSERVACAO_MAX_CARACTERES) {
      return `Observação muito longa (máximo de ${OBSERVACAO_MAX_CARACTERES} caracteres).`;
    }
  }
  return null;
}

export async function lancarItens(
  app: App,
  entrada: EntradaLancamento,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoLancamento> {
  const { restauranteId, comandaId, usuario, itens } = entrada;

  const mensagemInvalida = validarItens(itens);
  if (mensagemInvalida) return { tipo: "itens_invalidos", mensagem: mensagemInvalida };

  const dados = await (app.db as any).transaction(async (tx: any) => {
    // 1) Trava a comanda DO restaurante (comanda de outro restaurante = não encontrada)
    const comandas = await tx
      .select({
        id: schema.comandas.id,
        status: schema.comandas.status,
        tipo: schema.comandas.tipo,
        gorjeta: schema.comandas.gorjeta,
      })
      .from(schema.comandas)
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
      .for("update");
    if (!comandas.length) return { resultado: { tipo: "comanda_nao_encontrada" } as ResultadoLancamento };
    const comanda = comandas[0];

    if (comanda.tipo === "delivery") return { resultado: { tipo: "comanda_delivery" } as ResultadoLancamento };
    if (comanda.status !== "aberta") return { resultado: { tipo: "comanda_nao_aberta" } as ResultadoLancamento };

    // 2) Papel: garçom, gerente e administrador lançam em qualquer comanda aberta do restaurante; demais papéis não
    const papel = (usuario.role ?? "").toLowerCase();
    const podeLancar = ehGestor(papel) || papel === "garcom";
    if (!podeLancar) return { resultado: { tipo: "sem_permissao" } as ResultadoLancamento };

    // 3) Pratos: do restaurante e disponíveis; o preço vem do cadastro
    const pratoIds = Array.from(new Set(itens.map((i) => i.pratoId)));
    const pratos = await tx
      .select({ id: schema.pratos.id, preco: schema.pratos.preco })
      .from(schema.pratos)
      .where(
        and(
          inArray(schema.pratos.id, pratoIds),
          eq(schema.pratos.restauranteId, restauranteId),
          eq(schema.pratos.disponivel, true)
        )
      );
    if (pratos.length !== pratoIds.length) return { resultado: { tipo: "prato_indisponivel" } as ResultadoLancamento };

    const precoPorPrato = new Map<string, string>();
    for (const p of pratos) precoPorPrato.set(p.id, p.preco);

    // 4) Grava os itens
    const inseridos: PedidoLancado[] = await tx
      .insert(schema.pedidos)
      .values(
        itens.map((item) => ({
          comandaId,
          pratoId: item.pratoId,
          quantidade: item.quantidade,
          precoUnitario: precoPorPrato.get(item.pratoId) as string,
          observacao: item.observacao?.trim() ? item.observacao.trim() : null,
          status: "pendente" as any,
          restauranteId,
        }))
      )
      .returning();

    // 5) Recalcula o total gravado na comanda (itens cancelados não contam)
    const subtotal = await subtotalDaComanda(tx, comandaId);
    const gorjeta = parseFloat(String(comanda.gorjeta || "0"));
    const total = subtotal + gorjeta;
    await tx
      .update(schema.comandas)
      .set({ subtotal: subtotal.toString(), total: total.toFixed(2) })
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

    return {
      resultado: {
        tipo: "lancado",
        pedidos: inseridos,
        subtotalComanda: subtotal,
        totalComanda: total,
      } as ResultadoLancamento,
    };
  });

  const resultado: ResultadoLancamento = dados.resultado;

  // Aviso em tempo real (a cozinha precisa ver o item) depois da transação confirmada
  if (resultado.tipo === "lancado") {
    for (const pedido of resultado.pedidos) {
      try {
        hub.publish(restauranteId, {
          type: "pedido.created",
          entityId: pedido.id,
          occurredAt: new Date().toISOString(),
          payload: { comanda_id: comandaId, status: pedido.status },
        });
      } catch (err) {
        app.logger.debug({ err }, "Falha ao publicar pedido.created");
      }
    }
  }

  return resultado;
}
