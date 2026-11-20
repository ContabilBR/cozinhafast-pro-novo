/**
 * Histórico de custo dos insumos (etapa 1: somente gravação).
 *
 * - garantirPontoInicialHistoricoCusto: chamada na subida do backend. Para cada insumo que ainda
 *   não tem nenhum registro no histórico, insere o custo atual com vigência desde a criação do
 *   insumo e origem "ponto_inicial". Idempotente, em uma única transação, sem apagar nem alterar nada.
 * - registrarCustoInsumo: usada pelas rotas que gravam o custo, dentro da mesma transação da gravação.
 *
 * A tabela insumo_custo_historico é criada pela migração do Drizzle (20261120192511_brief_the_stranger).
 */
import { sql } from "drizzle-orm";
import * as schema from "./schema/schema.js";
import type { App } from "../index.js";

export type OrigemCustoInsumo = "ponto_inicial" | "cadastro" | "edicao" | "importacao";

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

/** Devolve quantos registros de ponto inicial foram criados. Não lança erro. */
export async function garantirPontoInicialHistoricoCusto(app: App): Promise<number> {
  const db = app.db as any;
  try {
    const tabela = await db.execute(
      sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'insumo_custo_historico'`
    );
    if (linhasDe(tabela).length === 0) {
      app.logger.warn("Tabela insumo_custo_historico ainda não existe; ponto inicial do histórico de custo não foi criado");
      return 0;
    }

    const criados: number = await db.transaction(async (tx: any) => {
      // Evita duplicar se duas instâncias subirem ao mesmo tempo
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insumo_custo_historico_ponto_inicial')::bigint)`);
      const inseridos = await tx.execute(sql`
        INSERT INTO "insumo_custo_historico" ("restaurante_id", "insumo_id", "custo", "vigencia_inicio", "usuario_id", "origem")
        SELECT i."restaurante_id", i."id", i."custo_unitario", i."created_at", NULL, 'ponto_inicial'
        FROM "insumos" i
        WHERE NOT EXISTS (SELECT 1 FROM "insumo_custo_historico" h WHERE h."insumo_id" = i."id")
        RETURNING "id"
      `);
      return linhasDe(inseridos).length;
    });

    if (criados > 0) {
      app.logger.warn({ criados }, "Histórico de custo dos insumos: registros de ponto inicial criados");
    } else {
      app.logger.info("Histórico de custo dos insumos: nenhum insumo sem ponto inicial");
    }
    return criados;
  } catch (err) {
    const sqlstate = (err as any)?.cause?.code || (err as any)?.code || "UNKNOWN";
    app.logger.warn(
      { codigo: sqlstate, mensagem: "Falha ao criar o ponto inicial do histórico de custo" },
      "Ensure insumo_custo_historico ponto inicial"
    );
    return 0;
  }
}

/** Insere um registro no histórico. `executor` é a transação (tx) da gravação do custo. */
export async function registrarCustoInsumo(
  executor: any,
  dados: { restauranteId: string; insumoId: string; custo: string; usuarioId: string | null; origem: OrigemCustoInsumo }
): Promise<void> {
  await executor.insert(schema.insumoCustoHistorico).values({
    restauranteId: dados.restauranteId,
    insumoId: dados.insumoId,
    custo: dados.custo,
    vigenciaInicio: new Date(),
    usuarioId: dados.usuarioId,
    origem: dados.origem,
  });
}
