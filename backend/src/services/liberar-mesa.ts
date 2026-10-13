/**
 * Liberação da mesa.
 *
 * Única regra para devolver uma mesa ao estado "disponivel" depois que uma comanda deixa de
 * estar aberta (fechamento, cancelamento, exclusão da comanda vazia ou do último item):
 * a mesa só é liberada se NÃO restar nenhuma outra comanda aberta dela, no mesmo restaurante.
 *
 * Com uma comanda por mesa (modo "mesa") o resultado é o mesmo de sempre: ao sair a única
 * comanda, a mesa é liberada. No modo "individual" a mesa continua ocupada enquanto houver
 * alguma comanda aberta nela.
 *
 * Como funciona e por quê:
 *  - trava a linha da mesa (SELECT ... FOR UPDATE) ANTES de contar: dois fechamentos simultâneos
 *    de comandas diferentes da mesma mesa passam a andar em fila. Sem a trava, cada um veria a
 *    outra comanda ainda aberta e nenhum liberaria a mesa (mesa ocupada sem comanda);
 *  - a contagem é convertida para número (o banco pode devolver COUNT como texto, e "0" === 0 é falso);
 *  - precisa rodar DENTRO de uma transação (`tx`): fora dela a trava é solta na hora e perde o efeito.
 *    Chame depois que a comanda já saiu do estado "aberta" (ou foi apagada) nessa mesma transação.
 *
 * Devolve true quando a mesa foi liberada e false quando continuou ocupada (ou não existe).
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

export async function liberarMesaSeVazia(
  tx: any,
  mesaId: string | null | undefined,
  restauranteId: string
): Promise<boolean> {
  if (!mesaId) return false;

  // 1) Trava a mesa DO RESTAURANTE. Sem linha, a mesa não existe (ou é de outro restaurante).
  const travada = linhasDe(
    await tx.execute(
      sql`SELECT id FROM mesas WHERE id = ${mesaId} AND restaurante_id = ${restauranteId} FOR UPDATE`
    )
  );
  if (travada.length === 0) return false;

  // 2) Conta as comandas ainda abertas dessa mesa (já com a mesa travada)
  const contagem = linhasDe(
    await tx.execute(
      sql`SELECT COUNT(*) AS count FROM comandas WHERE mesa_id = ${mesaId} AND restaurante_id = ${restauranteId} AND status = 'aberta'`
    )
  );
  const abertas = Number(contagem[0]?.count ?? 0);
  if (abertas > 0) return false;

  // 3) Nenhuma comanda aberta: libera a mesa
  await tx
    .update(schema.mesas)
    .set({ status: "disponivel" })
    .where(and(eq(schema.mesas.id, mesaId), eq(schema.mesas.restauranteId, restauranteId)));

  return true;
}
