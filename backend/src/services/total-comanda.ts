/**
 * Total da comanda.
 *
 * Única definição de "o que conta como venda": pedidos que NÃO estão cancelados.
 * Todo cálculo de total (fechamento, pagamentos, divisão de conta, totais gravados
 * na comanda) deve passar por aqui ou usar o mesmo filtro.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

export const STATUS_PEDIDO_CANCELADO = "cancelado";

/**
 * Soma quantidade x preço unitário dos pedidos não cancelados de uma comanda.
 * `executor` é o banco (app.db) ou uma transação (tx).
 */
export async function subtotalDaComanda(executor: any, comandaId: string): Promise<number> {
  const linhas = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${schema.pedidos.quantidade} * CAST(${schema.pedidos.precoUnitario} AS DECIMAL(10,2))) FILTER (WHERE ${schema.pedidos.status} <> 'cancelado'), 0)`,
    })
    .from(schema.pedidos)
    .where(eq(schema.pedidos.comandaId, comandaId));
  return parseFloat(String(linhas[0]?.total ?? "0"));
}

/**
 * Total de um pedido de delivery: subtotal dos itens não cancelados + taxa de entrega.
 * Gorjeta não se aplica ao delivery.
 */
export async function totalDelivery(executor: any, comandaId: string): Promise<number> {
  const subtotal = await subtotalDaComanda(executor, comandaId);
  const linhas = await executor
    .select({
      taxa: sql<string>`COALESCE(MAX(CAST(${schema.entregas.taxaEntrega} AS DECIMAL(10,2))), 0)`,
    })
    .from(schema.entregas)
    .where(eq(schema.entregas.comandaId, comandaId));
  const taxa = parseFloat(String(linhas[0]?.taxa ?? "0"));
  return subtotal + taxa;
}
