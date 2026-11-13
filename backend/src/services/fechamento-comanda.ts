/**
 * Fechamento de comanda.
 *
 * Único módulo responsável pela regra de fechar uma comanda: confere pagamentos,
 * calcula o total, arquiva comanda, pedidos e pagamentos confirmados nas tabelas
 * *_historico (preservando o mesmo UUID), remove os registros ativos, libera a mesa
 * e avisa o tempo real.
 *
 * O módulo não conhece HTTP: recebe dados simples e devolve um resultado com desfecho
 * nomeado. A rota (routes/orders.ts) autentica, confere papéis, lê o corpo e traduz
 * o resultado para HTTP.
 *
 * Contrato de saída (não mudar sem revisar relatórios, histórico e fiscal):
 * - comandas_historico / pedidos_historico / pagamentos_historico mantêm o UUID original;
 * - só pagamentos CONFIRMADOS vão para o histórico;
 * - services/nfce-data.ts lê o histórico quando a comanda viva já não existe.
 *
 * ETAPA B (correções sobre a extração da Etapa A):
 *  - a comanda é buscada só dentro do restaurante de quem fecha; comanda de outro
 *    restaurante é tratada como inexistente;
 *  - tudo acontece dentro de UMA transação que começa travando a linha da comanda
 *    (SELECT ... FOR UPDATE): duas chamadas simultâneas não fecham a mesma comanda
 *    duas vezes, e um pedido lançado no meio do fechamento espera, em vez de ser
 *    apagado em silêncio;
 *  - comandas de delivery são recusadas (o delivery terá fluxo de encerramento próprio:
 *    apagar a comanda apagaria a entrega por cascade, e não existe histórico de entregas).
 *
 * ETAPA C (cancelamento de item):
 *  - o total ignora pedidos cancelados (ver services/total-comanda.ts): item cancelado não é venda;
 *  - o recibo (itens) não lista itens cancelados, mas o histórico de pedidos guarda TODOS,
 *    inclusive os cancelados, com motivo, quem cancelou e se foi após o início (perda).
 *
 * ETAPA D (pagamento obrigatório):
 *  - comanda com total a receber (> 0) só fecha com pagamentos confirmados cobrindo o total;
 *    sem nenhum pagamento o desfecho é "pago_a_menos" com totalPago = 0;
 *  - total zero (encerramento sem consumo, todos os itens cancelados) fecha sem pagamento.
 *
 * ETAPA E (fechamento automático no pagamento):
 *  - o miolo do fechamento virou fecharComandaEmTransacao(app, tx, entrada), que roda DENTRO de uma
 *    transação já aberta pelo chamador. routes/pagamentos.ts a usa para fechar a comanda na mesma
 *    transação do pagamento que quita a conta (a trava da comanda é a mesma, sem deadlock);
 *  - fecharComanda continua sendo o ponto de entrada de /fechar: abre a transação, chama o miolo
 *    e publica o evento depois do commit;
 *  - /fechar idempotente: se a comanda já não existe viva mas está arquivada como "fechada" neste
 *    restaurante (por exemplo, fechada pelo próprio pagamento), devolve o recibo do histórico com
 *    jaFechada = true, sem erro e sem publicar o evento outra vez.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import { subtotalDaComanda, calcularTotalComandaMesa, calcularTotalComandaMesaComDesconto } from "./total-comanda.js";
import { liberarMesaSeVazia } from "./liberar-mesa.js";

export interface QuemFechou {
  id: string;
  nome: string;
  role: string;
}

export interface EntradaFechamento {
  restauranteId: string;
  comandaId: string;
  gorjeta: number;
  fechadoPor: QuemFechou;
}

export interface ItemFechado {
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  subtotal_item: number;
}

export interface PagamentoFechado {
  forma_pagamento: string;
  valor: number;
  troco: number;
}

export type ResultadoFechamento =
  | {
      tipo: "fechada";
      mesaNumero: number | null;
      rotulo: string | null;
      subtotal: number;
      gorjeta: number;
      desconto_valor: number;
      desconto_tipo: string | null;
      totalFinal: number;
      createdAt: Date;
      closedAt: Date;
      itens: ItemFechado[];
      pagamentos: PagamentoFechado[];
      /** true quando a comanda já estava arquivada: o recibo veio do histórico e nada foi alterado. */
      jaFechada?: boolean;
    }
  | { tipo: "nao_encontrada" }
  | { tipo: "tipo_nao_suportado"; tipoComanda: string }
  | { tipo: "nao_aberta" }
  | { tipo: "pagamentos_pendentes" }
  | { tipo: "pago_a_menos"; totalPago: number; totalDevido: number };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

/**
 * Fecha a comanda DENTRO de uma transação já aberta (`tx`). Não publica evento: quem chamou
 * publica depois do commit, com registrarEPublicarFechamento. Quando o resultado não é "fechada",
 * nada foi escrito (todas as recusas acontecem antes do arquivamento), e o chamador decide
 * se confirma a transação.
 */
export async function fecharComandaEmTransacao(
  app: App,
  tx: any,
  entrada: EntradaFechamento
): Promise<ResultadoFechamento> {
  const { restauranteId, comandaId, fechadoPor } = entrada;
  const gorjetaValue = entrada.gorjeta;

  // 1) Trava a linha da comanda DO RESTAURANTE. A consulta não usa join: o Postgres
  //    não permite FOR UPDATE no lado anulável de um LEFT JOIN.
  const comandas = await tx
    .select({
      id: schema.comandas.id,
      mesaId: schema.comandas.mesaId,
      garcomId: schema.comandas.garcomId,
      status: schema.comandas.status,
      tipo: schema.comandas.tipo,
      rotulo: schema.comandas.rotulo,
      createdAt: schema.comandas.createdAt,
      gorjeta: schema.comandas.gorjeta,
      descontoValor: schema.comandas.descontoValor,
      descontoTipo: schema.comandas.descontoTipo,
      descontoMotivo: schema.comandas.descontoMotivo,
      descontoMotivoDetalhe: schema.comandas.descontoMotivoDetalhe,
      descontoPorId: schema.comandas.descontoPorId,
      descontoPorNome: schema.comandas.descontoPorNome,
      descontoAplicadoPorNome: schema.comandas.descontoAplicadoPorNome,
      descontoEm: schema.comandas.descontoEm,
    })
    .from(schema.comandas)
    .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
    .for("update");

  if (!comandas.length) {
    return { tipo: "nao_encontrada" };
  }

  const comanda = comandas[0];
  const mesaId: string | null = comanda.mesaId;
  app.logger.info({ comandaId, mesaId }, "Comanda found and locked");

  // 2) Delivery tem fluxo próprio de encerramento
  if (comanda.tipo === "delivery") {
    return { tipo: "tipo_nao_suportado", tipoComanda: "delivery" };
  }

  // 3) Só comandas abertas fecham (conferência já com a linha travada)
  if (comanda.status !== "aberta") {
    return { tipo: "nao_aberta" };
  }

  // Número da mesa (consulta separada, sem join)
  let mesaNumero: number | null = null;
  if (mesaId) {
    const mesas = await tx
      .select({ numero: schema.mesas.numero })
      .from(schema.mesas)
      .where(eq(schema.mesas.id, mesaId));
    mesaNumero = mesas.length ? mesas[0].numero : null;
  }

  // 4) Subtotal calculado a partir dos pedidos
  const subtotal = await subtotalDaComanda(tx, comandaId);
  app.logger.info({ comandaId, subtotalCalculated: subtotal }, "Subtotal dynamically calculated from pedidos");

  // Determine desconto (either type 'cortesia' at 100% of subtotal, or parse descontoValor)
  const { total: totalFinal, descontoEfetivo } = calcularTotalComandaMesaComDesconto(subtotal, gorjetaValue, comanda.descontoTipo, comanda.descontoValor);

  const createdAt: Date = comanda.createdAt;
  const closedAt = new Date();

  // 5) Pedidos (com nome do prato), para a resposta e o histórico
  const pedidos = await tx
    .select({
      id: schema.pedidos.id,
      comandaId: schema.pedidos.comandaId,
      pratoId: schema.pedidos.pratoId,
      quantidade: schema.pedidos.quantidade,
      precoUnitario: schema.pedidos.precoUnitario,
      observacao: schema.pedidos.observacao,
      status: schema.pedidos.status,
      createdAt: schema.pedidos.createdAt,
      canceladoEm: schema.pedidos.canceladoEm,
      canceladoPorId: schema.pedidos.canceladoPorId,
      canceladoPorNome: schema.pedidos.canceladoPorNome,
      canceladoPorRole: schema.pedidos.canceladoPorRole,
      motivoCancelamento: schema.pedidos.motivoCancelamento,
      motivoCancelamentoDetalhe: schema.pedidos.motivoCancelamentoDetalhe,
      canceladoAposInicio: schema.pedidos.canceladoAposInicio,
      iniciadoEm: schema.pedidos.iniciadoEm,
      prontoEm: schema.pedidos.prontoEm,
      pratoNome: schema.pratos.nome,
    })
    .from(schema.pedidos)
    .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
    .where(eq(schema.pedidos.comandaId, comandaId));

  // O recibo lista só o que foi vendido: itens cancelados ficam de fora
  const itens: ItemFechado[] = pedidos
    .filter((p: any) => p.status !== "cancelado")
    .map((p: any) => ({
    prato_nome: p.pratoNome || "N/A",
    quantidade: p.quantidade,
    preco_unitario: parseFloat(p.precoUnitario || "0"),
    subtotal_item: p.quantidade * parseFloat(p.precoUnitario || "0"),
  }));

  // 6) Verificação de pagamentos
  const pagamentosComanda = await tx
    .select()
    .from(schema.pagamentos)
    .where(eq(schema.pagamentos.comandaId, comandaId));

  const totalPagoConfirmado = pagamentosComanda
    .filter((p: any) => p.status === "confirmado")
    .reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);

  const pagamentosPendentes = pagamentosComanda.filter((p: any) => p.status === "pendente");

  if (pagamentosPendentes.length > 0) {
    return { tipo: "pagamentos_pendentes" };
  }

  // Comanda com valor a receber só fecha com pagamentos confirmados cobrindo o total.
  // Antes a conferência só rodava quando já existia algum pagamento, e uma comanda com itens
  // fechava com R$ 0 recebido e entrava como venda. O encerramento sem consumo (total zero)
  // continua fechando sem pagamento.
  if (totalFinal > 0.01 && totalPagoConfirmado < totalFinal - 0.01) {
    return { tipo: "pago_a_menos", totalPago: totalPagoConfirmado, totalDevido: totalFinal };
  }

  // 7) Arquivamento
  // Copia a comanda para o histórico com status 'fechada'
  await tx.insert(schema.comandasHistorico).values({
    id: comanda.id,
    mesaId: comanda.mesaId,
    mesaNumero,
    rotulo: comanda.rotulo ?? null,
    garcomId: comanda.garcomId,
    status: "fechada",
    total: totalFinal.toString(),
    subtotal: subtotal.toString(),
    gorjeta: gorjetaValue.toString(),
    descontoValor: descontoEfetivo.toString(),
    descontoTipo: comanda.descontoTipo ?? null,
    descontoMotivo: comanda.descontoMotivo ?? null,
    descontoMotivoDetalhe: comanda.descontoMotivoDetalhe ?? null,
    descontoPorId: comanda.descontoPorId ?? null,
    descontoPorNome: comanda.descontoPorNome ?? null,
    descontoAplicadoPorNome: comanda.descontoAplicadoPorNome ?? null,
    descontoEm: comanda.descontoEm ?? null,
    createdAt: createdAt,
    closedAt: closedAt,
    archivedAt: closedAt,
    fechadoPorId: fechadoPor.id,
    fechadoPorNome: fechadoPor.nome,
    fechadoPorRole: fechadoPor.role,
    restauranteId,
  });

  // Copia os pedidos para o histórico
  if (pedidos.length > 0) {
    await tx.insert(schema.pedidosHistorico).values(
      pedidos.map((p: any) => ({
        id: p.id,
        comandaId: p.comandaId,
        pratoId: p.pratoId,
        pratoNome: p.pratoNome,
        quantidade: p.quantidade,
        precoUnitario: p.precoUnitario,
        observacao: p.observacao,
        status: p.status,
        createdAt: p.createdAt,
        canceladoEm: p.canceladoEm,
        canceladoPorId: p.canceladoPorId,
        canceladoPorNome: p.canceladoPorNome,
        canceladoPorRole: p.canceladoPorRole,
        motivoCancelamento: p.motivoCancelamento,
        motivoCancelamentoDetalhe: p.motivoCancelamentoDetalhe,
        canceladoAposInicio: p.canceladoAposInicio,
        iniciadoEm: p.iniciadoEm,
        prontoEm: p.prontoEm,
        archivedAt: closedAt,
        restauranteId,
      }))
    );
  }

  // Copia os pagamentos confirmados para o histórico e apaga os pagamentos da comanda
  if (pagamentosComanda.length > 0) {
    await tx.insert(schema.pagamentosHistorico).values(
      pagamentosComanda
        .filter((p: any) => p.status === "confirmado")
        .map((p: any) => ({
          id: p.id,
          comandaId: p.comandaId,
          formaPagamento: p.formaPagamento,
          status: p.status,
          valor: p.valor,
          troco: p.troco,
          pixTxId: p.pixTxId,
          referencia: p.referencia,
          confirmadoEm: p.confirmadoEm,
          createdAt: p.createdAt,
          archivedAt: closedAt,
          restauranteId,
        }))
    );

    await tx.delete(schema.pagamentos).where(and(eq(schema.pagamentos.comandaId, comandaId), eq(schema.pagamentos.restauranteId, restauranteId)));
  }

  // Grava subtotal e gorjeta na comanda antes de apagá-la
  await tx
    .update(schema.comandas)
    .set({
      subtotal: subtotal.toString(),
      gorjeta: gorjetaValue.toString(),
    })
    .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

  // Apaga pedidos e comanda
  await tx.delete(schema.pedidos).where(and(eq(schema.pedidos.comandaId, comandaId), eq(schema.pedidos.restauranteId, restauranteId)));
  await tx.delete(schema.comandas).where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

  // Depois de arquivar, libera a mesa só se não restar outra comanda aberta nela
  // (regra única em services/liberar-mesa.ts; com uma comanda por mesa libera como sempre)
  if (mesaId) {
    try {
      const liberada = await liberarMesaSeVazia(tx, mesaId, restauranteId);
      app.logger.info(
        { mesaId, liberada },
        liberada ? "Mesa released to disponivel" : "Mesa kept occupied: other open comandas"
      );
    } catch (err) {
      app.logger.error({ mesaId, error: (err as any).message }, "Failed to release mesa");
      throw err;
    }
  }

  return {
    tipo: "fechada",
    mesaNumero,
    rotulo: comanda.rotulo ?? null,
    subtotal,
    gorjeta: gorjetaValue,
    desconto_valor: descontoEfetivo,
    desconto_tipo: comanda.descontoTipo ?? null,
    totalFinal,
    createdAt,
    closedAt,
    itens,
    pagamentos: pagamentosComanda
      .filter((p: any) => p.status === "confirmado")
      .map((p: any) => ({
        forma_pagamento: p.formaPagamento,
        valor: parseFloat(p.valor),
        troco: parseFloat(p.troco || "0"),
      })),
  };
}

/**
 * Registro em log e evento de tempo real de uma comanda recém-fechada. Chamar DEPOIS do commit.
 * Falha no evento só vai para o log.
 */
export function registrarEPublicarFechamento(
  app: App,
  restauranteId: string,
  comandaId: string,
  resultado: Extract<ResultadoFechamento, { tipo: "fechada" }>,
  hub: HubDeEventos = realtimeHub
): void {
  app.logger.info(
    {
      comandaId,
      subtotal: resultado.subtotal,
      gorjeta: resultado.gorjeta,
      totalFinal: resultado.totalFinal,
      itemCount: resultado.itens.length,
    },
    `[fechar] comanda ${comandaId}: subtotal=${resultado.subtotal}, gorjeta=${resultado.gorjeta}, total=${resultado.totalFinal}`
  );

  // Evento de tempo real depois da transação confirmada; falha só vai para o log
  try {
    hub.publish(restauranteId, {
      type: "comanda.closed",
      entityId: comandaId,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    app.logger.error({ err }, "Failed to publish comanda.closed event");
  }
}

/**
 * Comanda que já foi fechada (arquivada) neste restaurante: monta o mesmo recibo a partir do
 * histórico. Devolve null se não houver registro "fechada" desse restaurante com esse id.
 * Não altera nada: serve para o /fechar ser idempotente depois de um pagamento que já fechou.
 */
async function reciboDaComandaJaFechada(
  app: App,
  restauranteId: string,
  comandaId: string
): Promise<Extract<ResultadoFechamento, { tipo: "fechada" }> | null> {
  const db = app.db as any;

  const historico = await db
    .select()
    .from(schema.comandasHistorico)
    .where(
      and(
        eq(schema.comandasHistorico.id, comandaId),
        eq(schema.comandasHistorico.restauranteId, restauranteId),
        eq(schema.comandasHistorico.status, "fechada")
      )
    );
  if (!historico.length) return null;
  const h = historico[0];

  const pedidos = await db
    .select()
    .from(schema.pedidosHistorico)
    .where(and(eq(schema.pedidosHistorico.comandaId, comandaId), eq(schema.pedidosHistorico.restauranteId, restauranteId)));

  const pagamentos = await db
    .select()
    .from(schema.pagamentosHistorico)
    .where(
      and(
        eq(schema.pagamentosHistorico.comandaId, comandaId),
        eq(schema.pagamentosHistorico.restauranteId, restauranteId),
        eq(schema.pagamentosHistorico.status, "confirmado")
      )
    );

  return {
    tipo: "fechada",
    jaFechada: true,
    mesaNumero: h.mesaNumero ?? null,
    rotulo: h.rotulo ?? null,
    subtotal: parseFloat(h.subtotal || "0"),
    gorjeta: parseFloat(h.gorjeta || "0"),
    desconto_valor: parseFloat(h.descontoValor || "0"),
    desconto_tipo: h.descontoTipo ?? null,
    totalFinal: parseFloat(h.total || "0"),
    createdAt: h.createdAt,
    closedAt: h.closedAt ?? h.archivedAt,
    itens: pedidos
      .filter((p: any) => p.status !== "cancelado")
      .map((p: any) => ({
        prato_nome: p.pratoNome || "N/A",
        quantidade: p.quantidade,
        preco_unitario: parseFloat(p.precoUnitario || "0"),
        subtotal_item: p.quantidade * parseFloat(p.precoUnitario || "0"),
      })),
    pagamentos: pagamentos.map((p: any) => ({
      forma_pagamento: p.formaPagamento,
      valor: parseFloat(p.valor),
      troco: parseFloat(p.troco || "0"),
    })),
  };
}

export async function fecharComanda(
  app: App,
  entrada: EntradaFechamento,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoFechamento> {
  const { restauranteId, comandaId } = entrada;

  const resultado: ResultadoFechamento = await (app.db as any).transaction(
    (tx: any): Promise<ResultadoFechamento> => fecharComandaEmTransacao(app, tx, entrada)
  );

  // Já arquivada neste restaurante (ex.: o pagamento que quitou a conta já fechou): sucesso, sem evento
  if (resultado.tipo === "nao_encontrada") {
    const jaFechada = await reciboDaComandaJaFechada(app, restauranteId, comandaId);
    if (jaFechada) {
      app.logger.info({ comandaId }, "[fechar] comanda já estava fechada; devolvendo o recibo do histórico");
      return jaFechada;
    }
    return resultado;
  }

  if (resultado.tipo !== "fechada") {
    return resultado;
  }

  registrarEPublicarFechamento(app, restauranteId, comandaId, resultado, hub);

  return resultado;
}
