/**
 * Serviço para sentar um cliente de uma reserva.
 * Abre a comanda na mesa usando o serviço existente (abrirComandaNaMesa)
 * e marca a reserva como sentada, tudo em uma única transação.
 *
 * Para reservas de grupo (grupo_id não nulo), senta o grupo inteiro em uma transação,
 * abrindo uma comanda por mesa.
 */

import { and, eq, sql } from "drizzle-orm";
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

export interface ComandaGrupo {
  mesa_id: string;
  mesa_numero: number;
  comanda_id: string;
}

export interface ResultadoSentarReserva {
  tipo:
    | "sucesso"
    | "reserva_nao_encontrada"
    | "reserva_nao_confirmada"
    | "reserva_sem_mesa"
    | "mesa_nao_encontrada"
    | "mesa_ja_ocupada"
    | "mesa_nao_livre"
    | "nome_obrigatorio"
    | "nome_muito_longo"
    | "nome_repetido"
    | "erro_interno"
    | "reserva_alterada";
  comandaId?: string;
  comandas?: ComandaGrupo[];
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
    app.logger.info(
      { restauranteId, reservaId, usuarioId },
      "Starting sentar reserva"
    );

    // Read reserva without lock, just to check if it exists and get grupo_id
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
    const grupoId = res.grupoId;

    // Decide: grupo ou single
    if (grupoId) {
      app.logger.info(
        { restauranteId, reservaId, grupoId },
        "Processing group reservation"
      );
      return await sentarGrupo(app, restauranteId, grupoId, usuarioId);
    } else {
      app.logger.info(
        { restauranteId, reservaId },
        "Processing single reservation"
      );
      return await sentarUnica(app, restauranteId, reservaId, usuarioId);
    }
  } catch (error) {
    app.logger.error(
      { err: error, reservaId, restauranteId },
      "Erro inesperado ao sentar reserva"
    );
    return { tipo: "erro_interno", detalhes: "Erro inesperado ao processar a reserva" };
  }
}

async function sentarUnica(
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

        if (mesaLocked[0].status !== "disponivel") {
          return { tipo: "mesa_nao_livre", detalhes: `A mesa ${mesaLocked[0].numero} não está livre.` };
        }

        // Store the mesa number for later use
        var mesaNumero = mesaLocked[0].numero;
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
        return { tipo: "reserva_alterada", detalhes: "A reserva foi alterada ou não está mais disponível para sentar." };
      }

      const resLocked = reservaLocked[0];

      // Validate: status must be confirmada, has mesa, same mesa as before
      if (resLocked.status !== "confirmada") {
        return {
          tipo: "reserva_alterada",
          detalhes: "A reserva foi alterada ou não está mais disponível para sentar.",
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
      // Use the actual mesa number retrieved from the locked row
      const abertura = await abrirComandaNaMesa(tx, {
        restauranteId,
        mesaId: mesaId!,
        mesaNumero: mesaNumero!,
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
        // Reserva was modified or deleted - treat as 409 race condition
        return { tipo: "reserva_alterada", detalhes: "A reserva foi alterada ou não está mais disponível para sentar." };
      }

      // Return success with metadata for event publishing
      return {
        tipo: "sucesso",
        comandaId,
        metadata: abertura.__metadataParaPublicar,
      };
    });

    // Handle reserva_alterada as 409 response before throwing
    if (resultado.tipo === "reserva_alterada") {
      return resultado;
    }

    // Publish event AFTER transaction is confirmed
    if (resultado.tipo === "sucesso" && resultado.metadata) {
      publicarEventoComandaCriada(app, resultado.metadata, realtimeHub);
    }

    return resultado;
  } catch (error) {
    app.logger.error(
      { err: error, reservaId, restauranteId },
      "Erro ao sentar reserva única"
    );
    return { tipo: "erro_interno", detalhes: "Erro inesperado ao processar a reserva" };
  }
}

async function sentarGrupo(
  app: App,
  restauranteId: string,
  grupoId: string,
  usuarioId: string
): Promise<ResultadoSentarReserva> {
  try {
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

      // 2. Read all reservas of the group (without lock first, to get mesa_ids)
      const grupoReservas = await tx
        .select()
        .from(schema.reservas)
        .where(
          and(
            eq(schema.reservas.grupoId, grupoId as any),
            eq(schema.reservas.restauranteId, restauranteId)
          )
        )
        .orderBy(schema.reservas.id);

      if (grupoReservas.length === 0) {
        return { tipo: "reserva_nao_encontrada" };
      }

      // Validate all are confirmada
      if (grupoReservas.some((r: any) => r.status !== "confirmada")) {
        return {
          tipo: "reserva_alterada",
          detalhes: "A reserva foi alterada ou não está mais disponível para sentar.",
        };
      }

      // Get unique mesa IDs in ascending order
      const mesasDoGrupo = Array.from(new Set(grupoReservas.map((r: any) => r.mesaId))).sort() as string[];

      if (mesasDoGrupo.length === 0) {
        return { tipo: "reserva_sem_mesa" };
      }

      // 3. Lock all mesas of the group in ascending order (FOR UPDATE)
      const mesasLocked: any[] = [];
      for (const mesaId of mesasDoGrupo) {
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
          return { tipo: "mesa_nao_encontrada", detalhes: "Uma ou mais mesas não foram encontradas no restaurante." };
        }

        // Check mesa is available (disponivel)
        if (mesaLocked[0].status !== "disponivel") {
          return { tipo: "mesa_nao_livre", detalhes: `A mesa ${mesaLocked[0].numero} não está livre.` };
        }

        mesasLocked.push(mesaLocked[0]);
      }

      // 4. Lock all reserva lines of the group in ascending order (FOR UPDATE)
      const reservasLocked = await tx
        .select()
        .from(schema.reservas)
        .where(
          and(
            eq(schema.reservas.grupoId, grupoId as any),
            eq(schema.reservas.restauranteId, restauranteId)
          )
        )
        .for("update")
        .orderBy(schema.reservas.id);

      if (reservasLocked.length === 0) {
        return {
          tipo: "reserva_alterada",
          detalhes: "A reserva foi alterada ou não está mais disponível para sentar.",
        };
      }

      // Re-validate all are confirmada
      if (reservasLocked.some((r: any) => r.status !== "confirmada")) {
        return {
          tipo: "reserva_alterada",
          detalhes: "A reserva foi alterada ou não está mais disponível para sentar.",
        };
      }

      // 5. For each mesa in ascending order: open comanda, mark mesa as ocupada, update reserva
      const comandasAbiertas: { comanda: any; metadata: any }[] = [];
      const mesasAtualizadas: any[] = [];
      const reservasParaAtualizar: any[] = [];

      for (let i = 0; i < mesasDoGrupo.length; i++) {
        const mesaId = mesasDoGrupo[i];
        const mesaLocked = mesasLocked[i];

        // Find corresponding reserva for this mesa
        const reservaParaMesa = reservasLocked.find((r: any) => r.mesaId === mesaId);
        if (!reservaParaMesa) {
          throw new Error(`Reserva for mesa ${mesaId} not found in locked group`);
        }

        // Prepare comanda name
        let nomeComanda: string | null = null;
        if (modo === "individual") {
          nomeComanda = normalizarNomeComanda(reservaParaMesa.nomePessoa);
          if (!nomeComanda) {
            return { tipo: "nome_obrigatorio" };
          }
        }

        // Open comanda
        const abertura = await abrirComandaNaMesa(tx, {
          restauranteId,
          mesaId,
          mesaNumero: mesaLocked.numero,
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

        comandasAbiertas.push({
          comanda: abertura.comanda,
          metadata: abertura.__metadataParaPublicar,
        });

        // Mark mesa as ocupada
        const mesaAtualizada = await tx
          .update(schema.mesas)
          .set({ status: "ocupada" as any })
          .where(
            and(
              eq(schema.mesas.id, mesaId as any),
              eq(schema.mesas.restauranteId, restauranteId)
            )
          )
          .returning();

        if (mesaAtualizada.length === 0) {
          throw new Error(`Mesa ${mesaId} not found when marking as occupied`);
        }

        mesasAtualizadas.push(mesaAtualizada[0]);

        // Prepare reserva update
        reservasParaAtualizar.push({
          reservaId: reservaParaMesa.id,
          comandaId: abertura.comanda.id,
        });
      }

      // 6. Update all reserva lines to sentada with their respective comanda_id
      for (const update of reservasParaAtualizar) {
        const [reservaAtualizada] = await tx
          .update(schema.reservas)
          .set({
            comandaId: update.comandaId,
            status: "sentada" as any,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.reservas.id, update.reservaId as any),
              eq(schema.reservas.restauranteId, restauranteId),
              eq(schema.reservas.status, "confirmada" as any)
            )
          )
          .returning();

        if (!reservaAtualizada) {
          // Reserva was modified or deleted - treat as 409 race condition
          return {
            tipo: "reserva_alterada",
            detalhes: "A reserva foi alterada ou não está mais disponível para sentar.",
          };
        }
      }

      // Return success with all comandas metadata for event publishing
      return {
        tipo: "sucesso",
        comandaId: comandasAbiertas[0].comanda.id,
        comandas: comandasAbiertas.map((c, idx) => ({
          mesa_id: mesasDoGrupo[idx],
          mesa_numero: mesasLocked[idx].numero,
          comanda_id: c.comanda.id,
        })),
        metadata: comandasAbiertas.map((c) => c.metadata),
      };
    });

    // Handle reserva_alterada as 409 response before throwing
    if (resultado.tipo === "reserva_alterada") {
      return resultado;
    }

    // Publish events AFTER transaction is confirmed (one per mesa)
    if (resultado.tipo === "sucesso" && resultado.metadata) {
      for (const metadata of resultado.metadata) {
        publicarEventoComandaCriada(app, metadata, realtimeHub);
      }
      app.logger.info(
        { grupoId, restauranteId, count: resultado.metadata.length },
        "Grupo seated successfully, events published"
      );
    }

    return resultado;
  } catch (error) {
    app.logger.error(
      { err: error, grupoId, restauranteId },
      "Erro ao sentar grupo de reservas"
    );
    return { tipo: "erro_interno", detalhes: "Erro inesperado ao processar o grupo de reservas" };
  }
}
