/**
 * Cancelamento de item (pedido).
 *
 * Regras:
 * - Item cancelado NÃO é venda: sai do total da comanda, dos relatórios e da nota fiscal.
 * - Só cancela item de comanda ABERTA (depois do fechamento não há cancelamento; estorno é outra etapa).
 * - pendente: garçom, gerente ou administrador.
 * - em_preparo / pronto: só gerente ou administrador; fica marcado como perda (canceladoAposInicio).
 * - entregue: não cancela (cortesia/estorno é outra etapa).
 * - Motivo obrigatório; quem cancelou e quando ficam registrados.
 *
 * O módulo não conhece HTTP: devolve um resultado com desfecho nomeado.
 * Ordem de trava: primeiro a linha da comanda, depois a do pedido (a mesma do fechamento,
 * para não haver deadlock entre cancelar e fechar).
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import { subtotalDaComanda, totalDelivery, calcularTotalComandaMesa, calcularTotalComandaMesaComDesconto } from "./total-comanda.js";

export const MOTIVOS_CANCELAMENTO = [
  "erro_lancamento",
  "cliente_desistiu",
  "item_em_falta",
  "demora",
  "qualidade",
  "outro",
  "cliente_nao_atendeu",
  "endereco_fora_area",
] as const;
export type MotivoCancelamento = (typeof MOTIVOS_CANCELAMENTO)[number];

export const ROLES_GESTAO = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"];
export const ROLES_ATENDIMENTO = ["garcom", ...ROLES_GESTAO];

export function ehGestor(role: string | null | undefined): boolean {
  return ROLES_GESTAO.includes((role ?? "").toLowerCase());
}

export interface EntradaCancelamento {
  restauranteId: string;
  pedidoId: string;
  motivo: MotivoCancelamento;
  detalhe: string | null;
  canceladoPor: { id: string; nome: string; role: string };
  quantidade?: number;
  autorizadorGerente?: { id: string; nome: string; role: string };
}

export type ResultadoCancelamento =
  | {
      tipo: "cancelado";
      pedidoId: string;
      pedidoCanceladoId: string;
      comandaId: string;
      canceladoAposInicio: boolean;
      subtotalComanda: number;
      totalComanda: number;
      parcial: boolean;
      quantidadeCancelada: number;
      quantidadeRestante: number;
      autorizadoPorNome: string | null;
    }
  | { tipo: "nao_encontrado" }
  | { tipo: "comanda_nao_aberta" }
  | { tipo: "ja_cancelado" }
  | { tipo: "ja_entregue" }
  | { tipo: "requer_gestor" }
  | { tipo: "quantidade_invalida"; quantidadeMaxima: number };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

export async function cancelarPedido(
  app: App,
  entrada: EntradaCancelamento,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoCancelamento> {
  const { restauranteId, pedidoId, motivo, detalhe, canceladoPor, quantidade, autorizadorGerente } = entrada;

  const dados = await (app.db as any).transaction(async (tx: any) => {
    // 1) Acha o pedido dentro do restaurante (pedido de outro restaurante = não encontrado)
    const achado = await tx
      .select({
        comandaId: schema.pedidos.comandaId,
        quantidade: schema.pedidos.quantidade,
        precoUnitario: schema.pedidos.precoUnitario,
        observacao: schema.pedidos.observacao,
        createdAt: schema.pedidos.createdAt,
        iniciadoEm: schema.pedidos.iniciadoEm,
        prontoEm: schema.pedidos.prontoEm,
      })
      .from(schema.pedidos)
      .where(and(eq(schema.pedidos.id, pedidoId), eq(schema.pedidos.restauranteId, restauranteId)));
    if (!achado.length) return { resultado: { tipo: "nao_encontrado" } as ResultadoCancelamento };

    const comandaId: string = achado[0].comandaId;
    const quantidadeOriginal = achado[0].quantidade;

    // Validar quantidade se foi fornecida
    const quantidadeCancelar = quantidade ?? quantidadeOriginal;
    if (quantidadeCancelar < 1 || quantidadeCancelar > quantidadeOriginal) {
      return { resultado: { tipo: "quantidade_invalida", quantidadeMaxima: quantidadeOriginal } as ResultadoCancelamento };
    }

    // 2) Trava a comanda (se o fechamento já a apagou, o pedido também não existe mais)
    const comandas = await tx
      .select({
        id: schema.comandas.id,
        status: schema.comandas.status,
        gorjeta: schema.comandas.gorjeta,
        mesaNumero: schema.comandas.mesaNumero,
        tipo: schema.comandas.tipo,
        descontoValor: schema.comandas.descontoValor,
        descontoTipo: schema.comandas.descontoTipo,
      })
      .from(schema.comandas)
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
      .for("update");
    if (!comandas.length) return { resultado: { tipo: "nao_encontrado" } as ResultadoCancelamento };
    const comanda = comandas[0];

    if (comanda.status !== "aberta") {
      return { resultado: { tipo: "comanda_nao_aberta" } as ResultadoCancelamento };
    }

    // 3) Relê e trava o pedido, já com a comanda travada
    const pedidos = await tx
      .select({
        id: schema.pedidos.id,
        status: schema.pedidos.status,
        pratoId: schema.pedidos.pratoId,
      })
      .from(schema.pedidos)
      .where(eq(schema.pedidos.id, pedidoId))
      .for("update");
    if (!pedidos.length) return { resultado: { tipo: "nao_encontrado" } as ResultadoCancelamento };
    const pedido = pedidos[0];

    if (pedido.status === "cancelado") return { resultado: { tipo: "ja_cancelado" } as ResultadoCancelamento };
    if (pedido.status === "entregue") return { resultado: { tipo: "ja_entregue" } as ResultadoCancelamento };

    const aposInicio = pedido.status === "em_preparo" || pedido.status === "pronto";

    // Determine who will be recorded as canceling (gerente autorizador or canceladoPor)
    const quemCancelou = autorizadorGerente ?? canceladoPor;

    if (aposInicio && !ehGestor(canceladoPor.role)) {
      // Garçom canceling em_preparo/pronto without autorizador = require manager
      if (!autorizadorGerente) {
        return { resultado: { tipo: "requer_gestor" } as ResultadoCancelamento };
      }
    }

    // 4) Determine if partial or total cancellation
    const parcial = quantidadeCancelar < quantidadeOriginal;
    const quantidadeRestante = quantidadeOriginal - quantidadeCancelar;
    let pedidoCanceladoId = pedidoId;

    if (parcial) {
      // 4a) Partial cancellation: create new canceled line, reduce original quantity

      // First, reduce the original item quantity and clear its kitchen timings
      await tx
        .update(schema.pedidos)
        .set({ quantidade: quantidadeRestante })
        .where(and(eq(schema.pedidos.id, pedidoId), eq(schema.pedidos.restauranteId, restauranteId)));

      // Then create new canceled item (copy of original with canceled quantity)
      const [novoItem] = await tx
        .insert(schema.pedidos)
        .values({
          comandaId: achado[0].comandaId,
          pratoId: pedido.pratoId,
          quantidade: quantidadeCancelar,
          precoUnitario: achado[0].precoUnitario,
          observacao: achado[0].observacao,
          status: "cancelado" as any,
          restauranteId,
          createdAt: achado[0].createdAt,
          iniciadoEm: achado[0].iniciadoEm,
          prontoEm: achado[0].prontoEm,
          canceladoEm: new Date(),
          canceladoPorId: quemCancelou.id,
          canceladoPorNome: quemCancelou.nome,
          canceladoPorRole: quemCancelou.role,
          motivoCancelamento: motivo,
          motivoCancelamentoDetalhe: detalhe,
          canceladoAposInicio: aposInicio,
        })
        .returning();

      pedidoCanceladoId = novoItem.id;
    } else {
      // 4b) Total cancellation: mark original item as canceled
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
        .where(and(eq(schema.pedidos.id, pedidoId), eq(schema.pedidos.restauranteId, restauranteId)));
    }

    // 5) Recalcula o total gravado na comanda (sem os itens cancelados)
    const subtotal = await subtotalDaComanda(tx, comandaId);
    let total: number;
    let descontoEfetivo: number | undefined;
    if (comanda.tipo === "delivery") {
      // Para delivery: subtotal + taxa de entrega (gorjeta não se aplica)
      total = await totalDelivery(tx, comandaId);
    } else {
      const gorjeta = parseFloat(String(comanda.gorjeta || "0"));
      const result = calcularTotalComandaMesaComDesconto(subtotal, gorjeta, comanda.descontoTipo, comanda.descontoValor);
      total = result.total;
      descontoEfetivo = result.descontoEfetivo;
    }
    await tx
      .update(schema.comandas)
      .set({
        subtotal: subtotal.toString(),
        total: total.toFixed(2),
        ...(descontoEfetivo !== undefined && { descontoValor: descontoEfetivo.toFixed(2) })
      })
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

    // Bug 4: Se for delivery, atualizar o valor do pagamento pendente para refletir o novo total
    if (comanda.tipo === "delivery") {
      await tx
        .update(schema.pagamentos)
        .set({ valor: total.toFixed(2) })
        .where(and(
          eq(schema.pagamentos.comandaId, comandaId),
          eq(schema.pagamentos.status, "pendente" as any),
          eq(schema.pagamentos.restauranteId, restauranteId)
        ));
    }

    // Nome do prato, só para o aviso em tempo real
    let pratoNome: string | null = null;
    if (pedido.pratoId) {
      const pratos = await tx
        .select({ nome: schema.pratos.nome })
        .from(schema.pratos)
        .where(eq(schema.pratos.id, pedido.pratoId));
      pratoNome = pratos.length ? pratos[0].nome : null;
    }

    // Nome do cliente, só para delivery
    let clienteNome: string | null = null;
    if (comanda.tipo === "delivery") {
      const entregas = await tx
        .select({ clienteNome: schema.entregas.clienteNome })
        .from(schema.entregas)
        .where(eq(schema.entregas.comandaId, comandaId))
        .orderBy(sql`created_at DESC`)
        .limit(1);
      clienteNome = entregas.length ? entregas[0].clienteNome : null;
    }

    return {
      resultado: {
        tipo: "cancelado",
        pedidoId,
        pedidoCanceladoId,
        comandaId,
        canceladoAposInicio: aposInicio,
        subtotalComanda: subtotal,
        totalComanda: total,
        parcial,
        quantidadeCancelada: quantidadeCancelar,
        quantidadeRestante: parcial ? quantidadeRestante : 0,
        autorizadoPorNome: autorizadorGerente?.nome ?? null,
      } as ResultadoCancelamento,
      evento: { comandaId, mesaNumero: comanda.mesaNumero ?? null, pratoNome, aposInicio, tipo: comanda.tipo, clienteNome, parcial, quantidadeCancelada: quantidadeCancelar, quantidadeRestante: parcial ? quantidadeRestante : 0, pedidoOriginalId: pedidoId, pedidoCanceladoId },
    };
  });

  const resultado: ResultadoCancelamento = dados.resultado;

  // Aviso em tempo real (a cozinha precisa parar o preparo) depois da transação confirmada
  if (resultado.tipo === "cancelado") {
    try {
      // For partial cancellations, first publish update to original item
      if (resultado.parcial) {
        hub.publish(restauranteId, {
          type: "pedido.updated",
          entityId: resultado.pedidoId,
          occurredAt: new Date().toISOString(),
          payload: {
            quantidade: resultado.quantidadeRestante,
          },
        });
      }

      // Publish cancellation event for the canceled line
      hub.publish(restauranteId, {
        type: "pedido.status_changed",
        entityId: resultado.pedidoCanceladoId,
        occurredAt: new Date().toISOString(),
        payload: {
          status: "cancelado",
          comanda_id: dados.evento.comandaId,
          mesa_numero: dados.evento.mesaNumero,
          prato_nome: dados.evento.pratoNome,
          cancelado_apos_inicio: dados.evento.aposInicio,
          motivo,
          comanda_tipo: dados.evento.tipo || "mesa",
          entrega_cliente_nome: dados.evento.clienteNome || null,
          parcial: resultado.parcial,
          quantidade_cancelada: resultado.quantidadeCancelada,
          quantidade_restante: resultado.quantidadeRestante,
          pedido_origem_id: dados.evento.pedidoOriginalId,
        },
      });
    } catch (err) {
      app.logger.error({ err }, "Failed to publish pedido.status_changed (cancelado) event");
    }
  }

  return resultado;
}
