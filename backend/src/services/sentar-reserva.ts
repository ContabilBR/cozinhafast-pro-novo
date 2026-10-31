/**
 * Serviço para sentar um cliente de uma reserva.
 * Abre a comanda na mesa usando o serviço existente (abrirComandaNaMesa)
 * e marca a reserva como sentada, tudo em uma única transação.
 */

import { and, eq } from "drizzle-orm";
import type { App } from "../index.js";
import * as schema from "../db/schema/schema.js";
import {
  abrirComandaNaMesa,
  normalizarNomeComanda,
  publicarEventoComandaCriada,
  type EntradaAbertura,
  type ResultadoAbertura,
} from "./abrir-comanda.js";
import { realtimeHub } from "../realtime/hub.js";

export interface ResultadoSentarReserva {
  tipo:
    | "sucesso"
    | "reserva_nao_encontrada"
    | "reserva_nao_confirmada"
    | "reserva_sem_mesa"
    | "mesa_nao_encontrada"
    | "mesa_ja_ocupada"
    | "nome_obrigatorio"
    | "nome_muito_longo"
    | "nome_repetido"
    | "erro_interno";
  comandaId?: string;
  detalhes?: string;
  metadata?: any;
}

export async function sentarReserva(
  app: App,
  restauranteId: string,
  reservaId: string,
  usuarioId: string
): Promise<ResultadoSentarReserva> {
  try {
    // Read reserva without lock, just to get mesa_id
    const reserva = await app.db
      .select()
      .from(schema.reservas)
      .where(
        and(
          eq(schema.reservas.id, reservaId as any),
          eq(schema.reservas.restauranteId, restauranteId)
        )
      )
      .limit(1);

    if (reserva.length === 0) {
      return { tipo: "reserva_nao_encontrada" };
    }

    const res = reserva[0];
    const mesaId = res.mesaId;

    // Execute everything in transaction with proper locking
    const resultado = await (app.db as any).transaction(async (tx: any) => {
      // 1. Lock restaurant (FOR SHARE read lock)
      const restLocked = await tx
        .select()
        .from(schema.restaurante)
        .where(eq(schema.restaurante.id, restauranteId))
        .for("share");

      if (restLocked.length === 0) {
        return { tipo: "erro_interno", detalhes: "Restaurante não encontrado" };
      }

      const modo = restLocked[0].modoComanda;

      // 2. Lock mesa (FOR UPDATE write lock with restaurant filter)
      if (mesaId) {
        const mesaLocked = await tx
          .select()
          .from(schema.mesas)
          .where(
            and(
              eq(schema.mesas.id, mesaId as any),
              eq(schema.mesas.restauranteId, restauranteId)
            )
          )
          .for("update");

        if (mesaLocked.length === 0) {
          return { tipo: "mesa_nao_encontrada" };
        }
      } else {
        return { tipo: "reserva_sem_mesa" };
      }

      // 3. Re-lock reserva line (FOR UPDATE) and validate
      const reservaLocked = await tx
        .select()
        .from(schema.reservas)
        .where(
          and(
            eq(schema.reservas.id, reservaId as any),
            eq(schema.reservas.restauranteId, restauranteId)
          )
        )
        .for("update")
        .limit(1);

      if (reservaLocked.length === 0) {
        return { tipo: "reserva_nao_encontrada" };
      }

      const resLocked = reservaLocked[0];

      // Validate: status must be confirmada, has mesa, same mesa as before
      if (resLocked.status !== "confirmada") {
        return {
          tipo: "reserva_nao_confirmada",
          detalhes: `Status atual: ${resLocked.status}`,
        };
      }

      if (!resLocked.mesaId) {
        return { tipo: "reserva_sem_mesa" };
      }

      if (resLocked.mesaId !== mesaId) {
        // Mesa changed between read and lock - shouldn't happen but handle it
        return { tipo: "reserva_sem_mesa" };
      }

      // 4. Prepare comanda opening
      let nomeComanda: string | null = null;
      if (modo === "individual") {
        nomeComanda = normalizarNomeComanda(resLocked.nomePessoa);
        if (!nomeComanda) {
          return { tipo: "nome_obrigatorio" };
        }
      }

      // 5. Call abrirComandaNaMesa service with external transaction
      const abertura = await abrirComandaNaMesa(tx, {
        restauranteId,
        mesaId: mesaId!,
        mesaNumero: 0, // Will be fetched from mesa in service
        garcomId: usuarioId,
        total: "0",
        rotulo: nomeComanda,
      } as EntradaAbertura);

      if (abertura.tipo !== "criada") {
        // Map service errors to result types
        const erroMap: Record<string, ResultadoSentarReserva["tipo"]> = {
          mesa_nao_encontrada: "mesa_nao_encontrada",
          nome_obrigatorio: "nome_obrigatorio",
          nome_muito_longo: "nome_muito_longo",
          nome_repetido: "nome_repetido",
          mesa_ja_tem_comanda: "mesa_ja_ocupada",
        };
        const tipo = erroMap[abertura.tipo] || "mesa_ja_ocupada";
        return { tipo };
      }

      const comanda = abertura.comanda;
      const comandaId = comanda.id;

      // 6. Mark mesa as occupied in same transaction (exact same way as abrir-comanda does)
      const mesasAtualizadas = await tx
        .update(schema.mesas)
        .set({ status: "ocupada" as any })
        .where(
          and(
            eq(schema.mesas.id, mesaId as any),
            eq(schema.mesas.restauranteId, restauranteId)
          )
        )
        .returning();

      if (mesasAtualizadas.length === 0) {
        // Mesa disappeared - shouldn't happen but let transaction rollback
        throw new Error("Mesa not found when marking as occupied");
      }

      // 7. Update reserva: status sentada and comanda_id, filtering by id, restaurante, status confirmada
      const [reservaAtualizada] = await tx
        .update(schema.reservas)
        .set({
          comandaId,
          status: "sentada" as any,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.reservas.id, reservaId as any),
            eq(schema.reservas.restauranteId, restauranteId),
            eq(schema.reservas.status, "confirmada" as any)
          )
        )
        .returning();

      if (!reservaAtualizada) {
        // Reserva was modified or deleted - let transaction rollback
        throw new Error("Reserva status changed or deleted during transaction");
      }

      // Return success with metadata for event publishing
      return {
        tipo: "sucesso",
        comandaId,
        metadata: abertura.__metadataParaPublicar,
      };
    });

    // Publish event AFTER transaction is confirmed
    if (resultado.tipo === "sucesso" && resultado.metadata) {
      publicarEventoComandaCriada(app, resultado.metadata, realtimeHub);
    }

    return resultado;
  } catch (error) {
    app.logger.error(
      { err: error, reservaId, restauranteId },
      "Erro inesperado ao sentar reserva"
    );
    return { tipo: "erro_interno", detalhes: "Erro inesperado ao processar a reserva" };
  }
}
