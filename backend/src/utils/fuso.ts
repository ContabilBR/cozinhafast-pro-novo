import { eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { FUSOS_BRASIL } from "./fusos-brasil.js";

// Fuso padrão do negócio (Brasília)
export const FUSO_PADRAO = "America/Sao_Paulo";

export interface DiaLocal {
  ano: number;
  mes0: number; // 0-11
  dia: number;
}

function fusoValido(valor: unknown): valor is string {
  return typeof valor === "string" && (FUSOS_BRASIL as readonly string[]).includes(valor);
}

// Lê o fuso do restaurante. Em qualquer problema devolve o padrão e registra um aviso.
export async function obterFusoRestaurante(app: App, restauranteId: string): Promise<string> {
  try {
    const linhas = await app.db
      .select({ fuso: schema.restaurante.fusoHorario })
      .from(schema.restaurante)
      .where(eq(schema.restaurante.id, restauranteId))
      .limit(1);
    if (linhas.length === 0) {
      app.logger.warn({ restauranteId }, "Restaurante não encontrado ao ler o fuso; usando o padrão");
      return FUSO_PADRAO;
    }
    const fuso = linhas[0].fuso;
    if (!fusoValido(fuso)) {
      app.logger.warn({ restauranteId, fuso }, "Fuso do restaurante fora da lista; usando o padrão");
      return FUSO_PADRAO;
    }
    return fuso;
  } catch (err) {
    app.logger.warn({ err, restauranteId }, "Falha ao ler o fuso do restaurante; usando o padrão");
    return FUSO_PADRAO;
  }
}

// Diferença (em ms) entre a hora de parede no fuso e UTC, no instante informado.
function deslocamentoMs(instanteMs: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instanteMs));
  const v: Record<string, number> = {};
  for (const p of partes) {
    if (p.type !== "literal") v[p.type] = Number(p.value);
  }
  const parede = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return parede - Math.floor(instanteMs / 1000) * 1000;
}

// Meia-noite local do dia informado, expressa como instante UTC.
// Date.UTC normaliza estouros (dia 0 = último dia do mês anterior, dia 32 = dia 1 do seguinte).
export function inicioDoDiaLocal(ano: number, mes0: number, dia: number, fuso: string): Date {
  const parede = Date.UTC(ano, mes0, dia);
  let utc = parede - deslocamentoMs(parede, fuso);
  utc = parede - deslocamentoMs(utc, fuso);
  return new Date(utc);
}

// Dia civil do instante no fuso informado.
export function diaLocalDeInstante(instante: Date, fuso: string): DiaLocal {
  const l = new Date(instante.getTime() + deslocamentoMs(instante.getTime(), fuso));
  return { ano: l.getUTCFullYear(), mes0: l.getUTCMonth(), dia: l.getUTCDate() };
}

// Trecho SQL com o fuso como literal entre aspas simples (não como parâmetro),
// para que SELECT e GROUP BY fiquem textualmente iguais.
export function fusoSql(fuso: string) {
  const seguro = fusoValido(fuso) ? fuso : FUSO_PADRAO;
  return sql.raw(`'${seguro}'`);
}
