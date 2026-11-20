/**
 * Custo do insumo por dia, a partir do histórico (tabela insumo_custo_historico).
 *
 * Regra de vigência: para um insumo e um dia, vale o registro mais recente cujo início, convertido
 * para o dia no fuso de Brasília, seja igual ou anterior a esse dia. Se o dia for anterior ao primeiro
 * registro, vale o primeiro. Se o insumo não tiver registro, a função devolve null e quem chama usa
 * o custo atual do insumo.
 *
 * O histórico do restaurante inteiro é carregado em uma única consulta; depois disso as respostas
 * saem da memória.
 */
import { sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { FUSO_PADRAO, fusoSql } from "./fuso.js";

export interface HistoricoCustoInsumos {
  /** Custo do insumo no dia ("YYYY-MM-DD"), ou null se o insumo não tem nenhum registro. */
  custoNoDia(insumoId: string, dia: string): number | null;
}

interface Vigencia {
  dia: string; // "YYYY-MM-DD" no fuso de Brasília
  custo: number;
}

export async function carregarHistoricoCustoInsumos(
  app: App,
  restauranteId: string
): Promise<HistoricoCustoInsumos> {
  let linhas: any[] = [];
  try {
    const resultado: any = await (app.db as any).execute(
      sql`
        SELECT h.insumo_id,
               h.custo,
               (h.vigencia_inicio AT TIME ZONE ${fusoSql(FUSO_PADRAO)})::date::text AS dia
        FROM ${schema.insumoCustoHistorico} h
        WHERE h.restaurante_id = ${restauranteId}
        ORDER BY h.insumo_id, h.vigencia_inicio ASC, h.id ASC
      `
    );
    linhas = Array.isArray(resultado) ? resultado : resultado?.rows ?? [];
  } catch (err) {
    // Sem histórico (por exemplo, tabela ainda inexistente): os relatórios usam o custo atual do insumo.
    app.logger.warn({ err, restauranteId }, "Histórico de custo dos insumos indisponível; usando o custo atual dos insumos");
    linhas = [];
  }

  // Em ordem crescente de início; em empate de início, o último registro vence.
  const porInsumo = new Map<string, Vigencia[]>();
  for (const l of linhas) {
    const id = String(l.insumo_id);
    let lista = porInsumo.get(id);
    if (!lista) {
      lista = [];
      porInsumo.set(id, lista);
    }
    lista.push({ dia: String(l.dia), custo: Number(l.custo) });
  }

  return {
    custoNoDia(insumoId: string, dia: string): number | null {
      const lista = porInsumo.get(insumoId);
      if (!lista || lista.length === 0) return null;
      // Último registro com dia <= dia pedido (busca binária; "YYYY-MM-DD" ordena como texto).
      let lo = 0;
      let hi = lista.length - 1;
      let achado = -1;
      while (lo <= hi) {
        const meio = (lo + hi) >> 1;
        if (lista[meio].dia <= dia) {
          achado = meio;
          lo = meio + 1;
        } else {
          hi = meio - 1;
        }
      }
      return (achado >= 0 ? lista[achado] : lista[0]).custo;
    },
  };
}
