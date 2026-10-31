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
    | "nome_repetido";
  comandaId?: string;
  detalhes?: string;
}

export async function sentarReserva(
  app: App,
  restauranteId: string,
  reservaId: string,
  usuarioId: string
): Promise<ResultadoSentarReserva> {
  try {
    // Buscar a reserva
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

    // Validar status
    if (res.status !== "confirmada") {
      return {
        tipo: "reserva_nao_confirmada",
        detalhes: `Status atual: ${res.status}`,
      };
    }

    // Validar mesa
    if (!res.mesaId) {
      return { tipo: "reserva_sem_mesa" };
    }

    // Buscar a mesa
    const mesa = await app.db
      .select()
      .from(schema.mesas)
      .where(eq(schema.mesas.id, res.mesaId as any))
      .limit(1);

    if (mesa.length === 0) {
      return { tipo: "mesa_nao_encontrada" };
    }

    const msa = mesa[0];

    // Buscar o restaurante para saber o modo de comanda
    const rest = await app.db
      .select()
      .from(schema.restaurante)
      .where(eq(schema.restaurante.id, restauranteId))
      .limit(1);

    if (rest.length === 0) {
      return { tipo: "mesa_nao_encontrada", detalhes: "Restaurante não encontrado" };
    }

    const modo = rest[0].modoComanda;

    // Executar em transação
    const resultado = await (app.db as any).transaction(async (tx: any) => {
      // Tentar abrir a comanda
      let nomeComanda: string | null = null;
      if (modo === "individual") {
        nomeComanda = normalizarNomeComanda(res.nomePessoa);
        if (!nomeComanda) {
          return { tipo: "nome_obrigatorio" };
        }
      }

      const abertura = await abrirComandaNaMesa(tx, {
        restauranteId,
        mesaId: res.mesaId!,
        mesaNumero: msa.numero,
        garcomId: usuarioId,
        total: "0",
        rotulo: nomeComanda,
      } as EntradaAbertura);

      if (abertura.tipo !== "criada") {
        // Mapear erros de abertura
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

      // Atualizar a reserva com a comanda e marcar como sentada
      await tx
        .update(schema.reservas)
        .set({
          comandaId,
          status: "sentada",
          updatedAt: new Date(),
        })
        .where(eq(schema.reservas.id, reservaId as any));

      // Retornar sucesso com o ID da comanda
      return {
        tipo: "sucesso",
        comandaId,
        metadata: abertura.__metadataParaPublicar,
      };
    });

    // Publicar evento APÓS a transação ser confirmada
    if (resultado.tipo === "sucesso" && resultado.metadata) {
      publicarEventoComandaCriada(app, resultado.metadata, realtimeHub);
    }

    return resultado;
  } catch (error) {
    app.logger.error(
      { err: error, reservaId, restauranteId },
      "Erro ao sentar reserva"
    );
    return { tipo: "mesa_nao_encontrada", detalhes: "Erro interno" };
  }
}
