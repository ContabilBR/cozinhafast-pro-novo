/**
 * Custo próprio de cada insumo em cada ficha técnica (por prato).
 *
 * - prato_insumos.custo_unitario: custo do insumo naquela ficha (pode ficar vazio por compatibilidade).
 * - prato_insumo_custo_historico: histórico do custo de cada linha da ficha.
 * - O custo do cadastro do insumo (insumos.custo_unitario e insumo_custo_historico) segue como custo de
 *   referência e não altera as fichas existentes.
 *
 * As tabelas e a coluna são criadas pela migração do Drizzle (20261120215234_lying_mulholland_black).
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "./schema/schema.js";
import type { App } from "../index.js";

export type OrigemCustoFicha =
  | "ponto_inicial"
  | "adicao_ficha"
  | "importacao"
  | "edicao_ficha"
  | "aplicacao_em_lote";

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

/**
 * Preenchimento inicial, idempotente, chamado na subida do backend.
 * 1) Linhas da ficha sem custo recebem o custo atual do insumo.
 * 2) Linhas sem nenhum registro no histórico ganham o ponto inicial (origem "ponto_inicial").
 * Uma única transação com trava contra execução dupla. Devolve quantas linhas foram atualizadas.
 */
export async function garantirCustoInicialDasFichas(app: App): Promise<number> {
  const db = app.db as any;
  try {
    const estrutura = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'prato_insumos' AND column_name = 'custo_unitario') AS coluna,
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'prato_insumo_custo_historico') AS tabela
    `);
    const e = linhasDe(estrutura)[0];
    if (!e || Number(e.coluna) === 0 || Number(e.tabela) === 0) {
      app.logger.warn("Custo da ficha técnica: coluna ou tabela de histórico ainda não existe; preenchimento inicial não foi feito");
      return 0;
    }

    const resultado = await db.transaction(async (tx: any) => {
      // Evita duplicar se duas instâncias subirem ao mesmo tempo
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('prato_insumos_custo_inicial')::bigint)`);

      const atualizadas = await tx.execute(sql`
        UPDATE "prato_insumos" pi
        SET "custo_unitario" = i."custo_unitario"
        FROM "insumos" i
        WHERE i."id" = pi."insumo_id" AND pi."custo_unitario" IS NULL
        RETURNING pi."id"
      `);

      const historico = await tx.execute(sql`
        INSERT INTO "prato_insumo_custo_historico" ("restaurante_id", "prato_id", "insumo_id", "custo", "vigencia_inicio", "usuario_id", "origem")
        SELECT pi."restaurante_id", pi."prato_id", pi."insumo_id", pi."custo_unitario", i."created_at", NULL, 'ponto_inicial'
        FROM "prato_insumos" pi
        INNER JOIN "insumos" i ON i."id" = pi."insumo_id"
        WHERE pi."custo_unitario" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "prato_insumo_custo_historico" h
            WHERE h."prato_id" = pi."prato_id" AND h."insumo_id" = pi."insumo_id"
          )
        RETURNING "id"
      `);

      return { linhas: linhasDe(atualizadas).length, historico: linhasDe(historico).length };
    });

    if (resultado.linhas > 0 || resultado.historico > 0) {
      app.logger.warn(
        { linhasAtualizadas: resultado.linhas, pontosIniciaisCriados: resultado.historico },
        "Custo da ficha técnica: linhas atualizadas com o custo atual do insumo"
      );
    } else {
      app.logger.info("Custo da ficha técnica: nenhuma linha sem custo ou sem ponto inicial (0 linhas atualizadas)");
    }
    return resultado.linhas;
  } catch (err) {
    const sqlstate = (err as any)?.cause?.code || (err as any)?.code || "UNKNOWN";
    app.logger.warn(
      { codigo: sqlstate, mensagem: "Falha no preenchimento inicial do custo da ficha técnica" },
      "Ensure prato_insumos custo inicial"
    );
    return 0;
  }
}

/** Registra um ponto no histórico de uma linha da ficha. `executor` é a transação (tx). */
export async function registrarCustoFicha(
  executor: any,
  dados: { restauranteId: string; pratoId: string; insumoId: string; custo: string; usuarioId: string | null; origem: OrigemCustoFicha }
): Promise<void> {
  await executor.insert(schema.pratoInsumoCustoHistorico).values({
    restauranteId: dados.restauranteId,
    pratoId: dados.pratoId,
    insumoId: dados.insumoId,
    custo: dados.custo,
    vigenciaInicio: new Date(),
    usuarioId: dados.usuarioId,
    origem: dados.origem,
  });
}

/**
 * ÚNICA porta de criação de linhas da ficha técnica. Copia o custo atual do insumo para a linha e
 * registra o histórico da linha, tudo na transação `tx` de quem chama. Devolve a linha criada.
 * Se a linha já existir (índice único), o erro do banco sobe para quem chama, como antes.
 */
export async function criarLinhaDeFicha(
  tx: any,
  dados: {
    restauranteId: string;
    pratoId: string;
    insumoId: string;
    quantidadeUsada: string;
    usuarioId: string | null;
    origem: OrigemCustoFicha;
  }
): Promise<any> {
  const [insumo] = await tx
    .select({ custoUnitario: schema.insumos.custoUnitario })
    .from(schema.insumos)
    .where(and(eq(schema.insumos.id, dados.insumoId), eq(schema.insumos.restauranteId, dados.restauranteId)));
  if (!insumo) throw new Error("INSUMO_DA_FICHA_NAO_ENCONTRADO");

  const [linha] = await tx
    .insert(schema.pratoInsumos)
    .values({
      pratoId: dados.pratoId,
      insumoId: dados.insumoId,
      quantidadeUsada: dados.quantidadeUsada,
      custoUnitario: insumo.custoUnitario,
      restauranteId: dados.restauranteId,
    })
    .returning();

  await registrarCustoFicha(tx, {
    restauranteId: dados.restauranteId,
    pratoId: dados.pratoId,
    insumoId: dados.insumoId,
    custo: insumo.custoUnitario,
    usuarioId: dados.usuarioId,
    origem: dados.origem,
  });
  return linha;
}

/** Valida um custo: número (ou texto numérico) >= 0 com no máximo 2 casas. Devolve o texto com 2 casas. */
export function validarCustoFicha(valor: unknown): { valido: boolean; custo?: string; erro?: string } {
  if (typeof valor !== "string" && typeof valor !== "number") {
    return { valido: false, erro: "custo deve ser um número." };
  }
  const texto = String(valor).trim().replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(texto)) {
    return { valido: false, erro: "custo deve ser um número maior ou igual a zero, com no máximo 2 casas decimais." };
  }
  return { valido: true, custo: Number(texto).toFixed(2) };
}

/**
 * Altera o custo de um insumo na ficha de UM prato, dentro da transação `tx`.
 * Devolve null se a linha não existe nesse restaurante; `alterado` é false se o custo não mudou
 * (nesse caso nada é gravado nem entra no histórico).
 */
export async function alterarCustoNaFicha(
  tx: any,
  dados: { restauranteId: string; pratoId: string; insumoId: string; custo: string; usuarioId: string | null; origem: OrigemCustoFicha }
): Promise<{ linha: any; alterado: boolean } | null> {
  const [linha] = await tx
    .select()
    .from(schema.pratoInsumos)
    .where(
      and(
        eq(schema.pratoInsumos.pratoId, dados.pratoId),
        eq(schema.pratoInsumos.insumoId, dados.insumoId),
        eq(schema.pratoInsumos.restauranteId, dados.restauranteId)
      )
    );
  if (!linha) return null;

  const atual = linha.custoUnitario === null || linha.custoUnitario === undefined ? null : Math.round(parseFloat(linha.custoUnitario) * 100);
  const novo = Math.round(parseFloat(dados.custo) * 100);
  if (atual !== null && atual === novo) return { linha, alterado: false };

  const [atualizada] = await tx
    .update(schema.pratoInsumos)
    .set({ custoUnitario: dados.custo })
    .where(and(eq(schema.pratoInsumos.id, linha.id), eq(schema.pratoInsumos.restauranteId, dados.restauranteId)))
    .returning();

  await registrarCustoFicha(tx, dados);
  return { linha: atualizada, alterado: true };
}
