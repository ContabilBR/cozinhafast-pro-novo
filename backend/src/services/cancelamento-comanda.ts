/**
 * Cancelamento de comanda (whole-table order cancellation).
 *
 * Regras:
 * - Só cancela comanda ABERTA de tipo "mesa" (delivery tem tela própria).
 * - Permissões: gerente e administrador cancelam qualquer comanda; garçom só a sua.
 *   Cozinheiro/kitchen nunca cancela.
 * - Items considerados: apenas os não-cancelados (status != 'cancelado').
 *   a) Se há algum "entregue": recusa com 409 (comanda tem item entregue).
 *   b) Se há "em_preparo" ou "pronto": só gerente/admin ou garçom com autorização do gerente.
 *   c) "pendente": qualquer autorizado (garçom da comanda, gerente, admin).
 * - Pagamento: comanda com pagamento status 'confirmado' não cancela (recusa 409).
 *   Pagamento 'pendente' não bloqueia.
 * - Items "em_preparo" ou "pronto" marcam canceladoAposInicio = true (perda).
 * - Transação: trava comanda (FOR UPDATE), depois trava pedidos (FOR UPDATE),
 *   valida tudo de novo, marca items cancelados, atualiza comanda status e totais,
 *   libera mesa.
 * - Publicação realtime: após commit, publica 'comanda.cancelled' + evento de cada item.
 *
 * O módulo não conhece HTTP: devolve um resultado com desfecho nomeado.
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import { subtotalDaComanda } from "./total-comanda.js";
import { liberarMesaSeVazia } from "./liberar-mesa.js";
import { MOTIVOS_CANCELAMENTO, ehGestor, type MotivoCancelamento } from "./cancelamento-pedido.js";

export interface EntradaCancelamentoComanda {
  restauranteId: string;
  comandaId: string;
  motivo: MotivoCancelamento;
  detalhe: string | null;
  canceladoPor: { id: string; nome: string; role: string };
  autorizadorGerente?: { id: string; nome: string; role: string };
}

export type ResultadoCancelamentoComanda =
  | {
      tipo: "cancelada";
      comandaId: string;
      mesaId: string | null;
      mesaNumero: number | null;
      garcomId: string | null;
      status: string;
      total: number;
      closedAt: Date;
      createdAt: Date;
      itensCancelados: number;
      itensPerda: number;
      autorizadoPorNome: string | null;
    }
  | { tipo: "nao_encontrada" }
  | { tipo: "delivery" }
  | { tipo: "nao_aberta" }
  | { tipo: "sem_permissao" }
  | { tipo: "so_propria_comanda" }
  | { tipo: "item_entregue" }
  | { tipo: "requer_gestor" }
  | { tipo: "pagamento_confirmado" };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

export async function cancelarComanda(
  app: App,
  entrada: EntradaCancelamentoComanda,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoCancelamentoComanda> {
  const { restauranteId, comandaId, motivo, detalhe, canceladoPor, autorizadorGerente } = entrada;

  const dados = await (app.db as any).transaction(async (tx: any) => {
    // 1) Trava e valida a comanda (do restaurante)
    const comandas = await tx
      .select({
        id: schema.comandas.id,
        mesaId: schema.comandas.mesaId,
        mesaNumero: schema.comandas.mesaNumero,
        garcomId: schema.comandas.garcomId,
        tipo: schema.comandas.tipo,
        status: schema.comandas.status,
        gorjeta: schema.comandas.gorjeta,
        descontoValor: schema.comandas.descontoValor,
        descontoTipo: schema.comandas.descontoTipo,
        createdAt: schema.comandas.createdAt,
      })
      .from(schema.comandas)
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
      .for("update");

    if (!comandas.length) {
      return { resultado: { tipo: "nao_encontrada" } as ResultadoCancelamentoComanda };
    }

    const comanda = comandas[0];

    // Delivery: recusado
    if (comanda.tipo === "delivery") {
      return { resultado: { tipo: "delivery" } as ResultadoCancelamentoComanda };
    }

    // Não-aberta: recusado
    if (comanda.status !== "aberta") {
      return { resultado: { tipo: "nao_aberta" } as ResultadoCancelamentoComanda };
    }

    // 2) Valida permissões (de novo, dentro da trava)
    // Cozinheiro/kitchen: sem permissão
    if (!ehGestor(canceladoPor.role) && canceladoPor.role?.toLowerCase() !== "garcom") {
      return { resultado: { tipo: "sem_permissao" } as ResultadoCancelamentoComanda };
    }

    // Garçom: só a própria comanda
    if (canceladoPor.role?.toLowerCase() === "garcom" && comanda.garcomId !== canceladoPor.id) {
      return { resultado: { tipo: "so_propria_comanda" } as ResultadoCancelamentoComanda };
    }

    // 3) Trava os pedidos
    const pedidos = await tx
      .select({
        id: schema.pedidos.id,
        status: schema.pedidos.status,
        pratoId: schema.pedidos.pratoId,
        quantidade: schema.pedidos.quantidade,
      })
      .from(schema.pedidos)
      .where(and(eq(schema.pedidos.comandaId, comandaId), eq(schema.pedidos.restauranteId, restauranteId)))
      .for("update");

    // 4) Valida os itens (não-cancelados apenas)
    const ativos = pedidos.filter((p: any) => p.status !== "cancelado");

    // Se há entregue: recusa
    if (ativos.some((p: any) => p.status === "entregue")) {
      return { resultado: { tipo: "item_entregue" } as ResultadoCancelamentoComanda };
    }

    // Se há em_preparo ou pronto e canceladoPor não é gestor e não há autorização: recusa
    const temPreparo = ativos.some((p: any) => p.status === "em_preparo" || p.status === "pronto");
    if (temPreparo && !ehGestor(canceladoPor.role) && !autorizadorGerente) {
      return { resultado: { tipo: "requer_gestor" } as ResultadoCancelamentoComanda };
    }

    // 5) Valida pagamentos: se há confirmado, recusa
    const pagamentos = await tx
      .select({ status: schema.pagamentos.status })
      .from(schema.pagamentos)
      .where(eq(schema.pagamentos.comandaId, comandaId));

    if (pagamentos.some((p: any) => p.status === "confirmado")) {
      return { resultado: { tipo: "pagamento_confirmado" } as ResultadoCancelamentoComanda };
    }

    // 6) Quem cancelou (gerente autorizador ou canceladoPor)
    const quemCancelou = autorizadorGerente ?? canceladoPor;

    // 7) Carrega nomes dos pratos (uma query, sem N+1)
    const pratoIds = pedidos.map((p: any) => p.pratoId).filter((id: any) => id);
    const uniquePratoIds = [...new Set(pratoIds)] as string[];
    const pratos = uniquePratoIds.length
      ? await tx
          .select({ id: schema.pratos.id, nome: schema.pratos.nome })
          .from(schema.pratos)
          .where(and(inArray(schema.pratos.id, uniquePratoIds), eq(schema.pratos.restauranteId, restauranteId)))
      : [];
    const mapaPratoNome = new Map(pratos.map((p: any) => [p.id, p.nome]));

    // 8) Marca os ativos como cancelados
    let itensCancelados = 0;
    let itensPerda = 0;
    const eventosItem = [];

    for (const pedido of ativos) {
      const aposInicio = pedido.status === "em_preparo" || pedido.status === "pronto";
      if (aposInicio) {
        itensPerda++;
      }
      itensCancelados++;

      const pratoNome = mapaPratoNome.get(pedido.pratoId) || null;

      await tx
        .update(schema.pedidos)
        .set({
          status: "cancelado",
          canceladoEm: new Date(),
          canceladoPorId: quemCancelou.id,
          canceladoPorNome: quemCancelou.nome,
          canceladoPorRole: quemCancelou.role,
          motivoCancelamento: motivo,
          motivoCancelamentoDetalhe: detalhe,
          canceladoAposInicio: aposInicio,
        })
        .where(and(eq(schema.pedidos.id, pedido.id), eq(schema.pedidos.restauranteId, restauranteId)));

      eventosItem.push({
        pedidoId: pedido.id,
        pratoNome,
        aposInicio,
        quantidade: pedido.quantidade,
      });
    }

    // 9) Comanda cancelada: total e subtotal são 0
    const total = 0;

    // 10) Atualiza a comanda: status, total, closedAt
    const now = new Date();
    await tx
      .update(schema.comandas)
      .set({
        status: "cancelada",
        closedAt: now,
        subtotal: "0",
        total: "0.00",
      })
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

    // 11) Libera a mesa (se não houver outra comanda aberta)
    await liberarMesaSeVazia(tx, comanda.mesaId, restauranteId);

    return {
      resultado: {
        tipo: "cancelada",
        comandaId,
        mesaId: comanda.mesaId ?? null,
        mesaNumero: comanda.mesaNumero ?? null,
        garcomId: comanda.garcomId ?? null,
        status: "cancelada",
        total,
        closedAt: now,
        createdAt: comanda.createdAt,
        itensCancelados,
        itensPerda,
        autorizadoPorNome: autorizadorGerente?.nome ?? null,
      } as ResultadoCancelamentoComanda,
      eventosItem,
      tipo: comanda.tipo,
    };
  });

  const resultado: ResultadoCancelamentoComanda = dados.resultado;

  // Publicar eventos realtime após commit
  if (resultado.tipo === "cancelada") {
    try {
      // Evento da comanda
      hub.publish(restauranteId, {
        type: "comanda.cancelled",
        entityId: resultado.comandaId,
        occurredAt: resultado.closedAt.toISOString(),
        payload: {
          id: resultado.comandaId,
          mesa_numero: resultado.mesaNumero,
          status: resultado.status,
          total: resultado.total,
          closed_at: resultado.closedAt.toISOString(),
        },
      });

      // Eventos dos itens
      for (const evento of dados.eventosItem) {
        hub.publish(restauranteId, {
          type: "pedido.status_changed",
          entityId: evento.pedidoId,
          occurredAt: resultado.closedAt.toISOString(),
          payload: {
            status: "cancelado",
            comanda_id: resultado.comandaId,
            mesa_numero: resultado.mesaNumero,
            prato_nome: evento.pratoNome,
            cancelado_apos_inicio: evento.aposInicio,
            motivo,
            comanda_tipo: dados.tipo || "mesa",
            entrega_cliente_nome: null,
            parcial: false,
            quantidade_cancelada: evento.quantidade,
            quantidade_restante: 0,
            pedido_origem_id: evento.pedidoId,
          },
        });
      }
    } catch (err) {
      app.logger.error({ err }, "Failed to publish cancelamento-comanda events");
    }
  }

  return resultado;
}

export const MOTIVOS_CANCELAMENTO_REEXPORT = MOTIVOS_CANCELAMENTO;
