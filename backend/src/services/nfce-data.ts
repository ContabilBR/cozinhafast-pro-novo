/**
 * NFC-e — carregamento de dados da comanda.
 *
 * Fonte dupla: o fechamento (orders.ts) move a comanda para as tabelas
 * *_historico preservando o mesmo UUID e deleta os pagamentos vivos.
 * Como a NFC-e normalmente e emitida apos o fechamento, cada consulta
 * tenta a tabela viva e cai para o historico.
 */

import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

export async function carregarComandaFiscal(
  db: any,
  comandaId: string,
  restauranteId: string
): Promise<{ comanda: any; arquivada: boolean } | null> {
  const ativaRows = await db
    .select()
    .from(schema.comandas)
    .where(
      and(
        eq(schema.comandas.id, comandaId),
        eq(schema.comandas.restauranteId, restauranteId)
      )
    );
  if (ativaRows.length) return { comanda: ativaRows[0], arquivada: false };

  const histRows = await db
    .select()
    .from(schema.comandasHistorico)
    .where(
      and(
        eq(schema.comandasHistorico.id, comandaId),
        eq(schema.comandasHistorico.restauranteId, restauranteId)
      )
    );
  if (histRows.length) return { comanda: histRows[0], arquivada: true };

  return null;
}

export async function carregarPagamentosFiscais(
  db: any,
  comandaId: string,
  restauranteId: string,
  arquivada: boolean
): Promise<any[]> {
  if (arquivada) {
    return db
      .select()
      .from(schema.pagamentosHistorico)
      .where(
        and(
          eq(schema.pagamentosHistorico.comandaId, comandaId),
          eq(schema.pagamentosHistorico.restauranteId, restauranteId)
        )
      );
  }
  return db
    .select()
    .from(schema.pagamentos)
    .where(
      and(
        eq(schema.pagamentos.comandaId, comandaId),
        eq(schema.pagamentos.restauranteId, restauranteId)
      )
    );
}

export async function carregarPedidosFiscais(
  db: any,
  comandaId: string,
  restauranteId: string,
  arquivada: boolean
): Promise<any[]> {
  if (arquivada) {
    return db
      .select()
      .from(schema.pedidosHistorico)
      .where(
        and(
          eq(schema.pedidosHistorico.comandaId, comandaId),
          eq(schema.pedidosHistorico.restauranteId, restauranteId)
        )
      );
  }
  return db
    .select()
    .from(schema.pedidos)
    .where(
      and(
        eq(schema.pedidos.comandaId, comandaId),
        eq(schema.pedidos.restauranteId, restauranteId)
      )
    );
}

export async function carregarPratosMap(
  db: any,
  pratoIds: string[],
  restauranteId: string
): Promise<Map<string, any>> {
  if (!pratoIds.length) return new Map();
  const rows = await db
    .select()
    .from(schema.pratos)
    .where(
      and(
        inArray(schema.pratos.id, pratoIds),
        eq(schema.pratos.restauranteId, restauranteId)
      )
    );
  return new Map<string, any>(rows.map((p: any) => [p.id, p]));
}

/** Retorna NFC-e autorizada ou em processamento que impeca nova emissao. */
export async function buscarNfceBloqueante(
  db: any,
  comandaId: string,
  restauranteId: string
): Promise<any | null> {
  const rows = await db
    .select()
    .from(schema.notasFiscais)
    .where(
      and(
        eq(schema.notasFiscais.comandaHistoricoId, comandaId),
        eq(schema.notasFiscais.restauranteId, restauranteId),
        eq(schema.notasFiscais.tipoDocumento, "nfce")
      )
    );
  return (
    rows.find(
      (n: any) => n.status === "autorizada" || n.status === "processando"
    ) ?? null
  );
}

/** Proximo numero sequencial de NFC-e do restaurante. */
export async function proximoNumeroNfce(
  db: any,
  restauranteId: string
): Promise<number> {
  const rows = await db
    .select()
    .from(schema.notasFiscais)
    .where(
      and(
        eq(schema.notasFiscais.restauranteId, restauranteId),
        eq(schema.notasFiscais.tipoDocumento, "nfce"),
        isNotNull(schema.notasFiscais.numeroNota)
      )
    )
    .orderBy(desc(schema.notasFiscais.numeroNota))
    .limit(1);
  return (rows[0]?.numeroNota ?? 0) + 1;
}
