/**
 * Custo de cada insumo na ficha de cada prato, por dia, a partir do histórico da linha da ficha
 * (tabela prato_insumo_custo_historico).
 *
 * Regra de vigência: para um prato, um insumo e um dia, vale o registro mais recente cujo início,
 * convertido para o dia no fuso de Brasília, seja igual ou anterior a esse dia. Se o dia for anterior
 * ao primeiro registro, vale o primeiro. Se a linha não tiver registro, a função devolve null e quem
 * chama usa o custo próprio da linha (prato_insumos.custo_unitario) e, se não houver, o custo atual do insumo.
 *
 * O histórico do restaurante inteiro é carregado em uma única consulta; depois disso as respostas
 * saem da memória.
 */
import { sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { FUSO_PADRAO, fusoSql } from "./fuso.js";

export interface HistoricoCustoFichas {
  /** Custo do insumo na ficha do prato no dia ("YYYY-MM-DD"), ou null se a linha não tem nenhum registro. */
  custoNoDia(pratoId: string, insumoId: string, dia: string): number | null;
}

interface Vigencia {
  dia: string; // "YYYY-MM-DD" no fuso de Brasília
  custo: number;
}

export async function carregarHistoricoCustoFichas(
  app: App,
  restauranteId: string
): Promise<HistoricoCustoFichas> {
  let linhas: any[] = [];
  try {
    const resultado: any = await (app.db as any).execute(
      sql`
        SELECT h.prato_id,
               h.insumo_id,
               h.custo,
               (h.vigencia_inicio AT TIME ZONE ${fusoSql(FUSO_PADRAO)})::date::text AS dia
        FROM ${schema.pratoInsumoCustoHistorico} h
        WHERE h.restaurante_id = ${restauranteId}
        ORDER BY h.prato_id, h.insumo_id, h.vigencia_inicio ASC, h.id ASC
      `
    );
    linhas = Array.isArray(resultado) ? resultado : resultado?.rows ?? [];
  } catch (err) {
    // Sem histórico (por exemplo, tabela ainda inexistente): os relatórios usam o custo próprio da linha ou o do insumo.
    app.logger.warn({ err, restauranteId }, "Histórico de custo das fichas técnicas indisponível; usando o custo da linha ou do insumo");
    linhas = [];
  }

  // Em ordem crescente de início; em empate de início, o último registro vence.
  const porLinha = new Map<string, Vigencia[]>();
  for (const l of linhas) {
    const id = `${l.prato_id}|${l.insumo_id}`;
    let lista = porLinha.get(id);
    if (!lista) {
      lista = [];
      porLinha.set(id, lista);
    }
    lista.push({ dia: String(l.dia), custo: Number(l.custo) });
  }

  return {
    custoNoDia(pratoId: string, insumoId: string, dia: string): number | null {
      const lista = porLinha.get(`${pratoId}|${insumoId}`);
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
