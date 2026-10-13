/**
 * Garantia de colunas na inicialização do backend.
 *
 * Por que existe: as migrações do Drizzle (backend/drizzle) não rodam sozinhas quando o
 * backend sobe, e o Database Viewer do Specular não aceita comandos de estrutura
 * (ALTER TABLE). Se o código novo for para o ar antes da migração, toda consulta a
 * `pedidos` falha ("column ... does not exist").
 *
 * O que faz: confere no banco se as colunas de cancelamento de item existem e cria só as
 * que faltam (ALTER TABLE ... ADD COLUMN IF NOT EXISTS). É idempotente e segura para rodar
 * junto com a migração 20260929175938_cancelamento_pedido: os dois usam IF NOT EXISTS.
 * Nas inicializações normais (colunas já existem) só faz uma consulta de leitura.
 *
 * Quando remover: assim que as migrações passarem a ser aplicadas de forma confiável no deploy.
 */
import { sql } from "drizzle-orm";
import type { App } from "../index.js";

const TABELAS = ["pedidos", "pedidos_historico"] as const;

const COLUNAS_CANCELAMENTO: Array<[coluna: string, tipo: string]> = [
  ["cancelado_em", "timestamp with time zone"],
  ["cancelado_por_id", "text"],
  ["cancelado_por_nome", "text"],
  ["cancelado_por_role", "text"],
  ["motivo_cancelamento", "text"],
  ["motivo_cancelamento_detalhe", "text"],
  ["cancelado_apos_inicio", "boolean"],
];

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

/** Devolve quantas colunas foram criadas (0 quando o banco já estava em dia). */
export async function garantirColunasDeCancelamento(app: App): Promise<number> {
  const db = app.db as any;
  let criadas = 0;

  try {
    const nomes = COLUNAS_CANCELAMENTO.map(([coluna]) => coluna);
    let existentes: any[] = [];

    try {
      const result = await db.execute(
        sql`SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name IN ('pedidos', 'pedidos_historico')
              AND column_name IN (${sql.join(nomes.map((n) => sql`${n}`), sql`, `)})`
      );
      existentes = linhasDe(result);
    } catch (queryErr) {
      app.logger.warn({ err: queryErr }, "Failed to query information_schema at startup - proceeding anyway");
      // Continue without checking existing columns - ALTER TABLE will use IF NOT EXISTS
    }

    const jaExiste = new Set(existentes.map((r: any) => `${r.table_name}.${r.column_name}`));

    for (const tabela of TABELAS) {
      for (const [coluna, tipo] of COLUNAS_CANCELAMENTO) {
        if (jaExiste.has(`${tabela}.${coluna}`)) continue;
        try {
          await db.execute(sql.raw(`ALTER TABLE "${tabela}" ADD COLUMN IF NOT EXISTS "${coluna}" ${tipo}`));
          criadas++;
        } catch (err) {
          // Não derruba o backend: o erro aparece no log e as demais colunas seguem
          app.logger.error({ err, tabela, coluna }, "Failed to add missing column at startup");
        }
      }
    }

    if (criadas > 0) {
      app.logger.warn({ criadas }, "Missing cancelamento columns were created at startup");
    } else {
      app.logger.debug("Cancelamento columns already present");
    }
  } catch (err) {
    app.logger.error({ err }, "Failed to check cancelamento columns at startup");
  }

  return criadas;
}

/**
 * Comanda individual (modo de comanda do restaurante e nome da comanda).
 *
 * Cria, só se faltarem, o tipo `modo_comanda` e as colunas:
 *  - restaurante.modo_comanda (NOT NULL, padrão 'mesa': restaurantes existentes ficam em "mesa");
 *  - comandas.rotulo e comandas_historico.rotulo (texto, opcional).
 * Idempotente: confere o information_schema antes e usa IF NOT EXISTS, então convive com
 * colunas já criadas à mão no banco e com uma eventual migração do Drizzle.
 * Devolve quantas colunas foram criadas (0 quando o banco já estava em dia).
 */
const COLUNAS_MODO_COMANDA: Array<[tabela: string, coluna: string, definicao: string]> = [
  ["restaurante", "modo_comanda", "modo_comanda NOT NULL DEFAULT 'mesa'"],
  ["comandas", "rotulo", "text"],
  ["comandas_historico", "rotulo", "text"],
];

export async function garantirColunasDeModoComanda(app: App): Promise<number> {
  const db = app.db as any;
  let criadas = 0;

  try {
    let existentes: any[] = [];

    try {
      const result = await db.execute(
        sql`SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND ((table_name = 'restaurante' AND column_name = 'modo_comanda')
                OR (table_name IN ('comandas', 'comandas_historico') AND column_name = 'rotulo'))`
      );
      existentes = linhasDe(result);
    } catch (queryErr) {
      app.logger.warn({ err: queryErr }, "Failed to query information_schema for modo_comanda columns - proceeding anyway");
    }

    const jaExiste = new Set(existentes.map((r: any) => `${r.table_name}.${r.column_name}`));
    const faltando = COLUNAS_MODO_COMANDA.filter(([tabela, coluna]) => !jaExiste.has(`${tabela}.${coluna}`));

    if (faltando.length === 0) {
      app.logger.debug("Modo comanda columns already present");
      return 0;
    }

    // O tipo precisa existir antes da coluna que o usa
    if (faltando.some(([, coluna]) => coluna === "modo_comanda")) {
      try {
        await db.execute(
          sql.raw(
            `DO $$ BEGIN IF to_regtype('modo_comanda') IS NULL THEN CREATE TYPE modo_comanda AS ENUM ('mesa', 'individual'); END IF; END $$;`
          )
        );
      } catch (err) {
        app.logger.error({ err }, "Failed to create modo_comanda type at startup");
      }
    }

    for (const [tabela, coluna, definicao] of faltando) {
      try {
        await db.execute(sql.raw(`ALTER TABLE "${tabela}" ADD COLUMN IF NOT EXISTS "${coluna}" ${definicao}`));
        criadas++;
      } catch (err) {
        // Não derruba o backend: o erro aparece no log e as demais colunas seguem
        app.logger.error({ err, tabela, coluna }, "Failed to add missing modo_comanda column at startup");
      }
    }

    if (criadas > 0) {
      app.logger.warn({ criadas }, "Missing modo_comanda columns were created at startup");
    }
  } catch (err) {
    app.logger.error({ err }, "Failed to check modo_comanda columns at startup");
  }

  return criadas;
}
