/**
 * Lançamento de itens (pedidos) em uma comanda.
 *
 * Única definição das regras de "adicionar itens a uma comanda", usada pela rota legada
 * POST /api/pedidos (mantida só para os aplicativos já instalados).
 *
 * Regras:
 * - A comanda tem que ser do restaurante de quem chama (comanda de outro restaurante = não encontrada).
 * - Só comanda ABERTA recebe item; comanda de delivery tem tela e fluxo próprios.
 * - Cozinheiro não lança item. Garçom, gerente e administrador lançam em qualquer comanda aberta do
 *   restaurante (o cliente pode pedir a qualquer garçom; o garçom dono da comanda não muda).
 * - Cada prato tem que ser do restaurante e estar disponível; o preço vem SEMPRE do cadastro do prato.
 * - Quantidade: inteiro de 1 a 99. Observação: até 500 caracteres. No máximo 50 itens por lançamento.
 * - Tudo ou nada: os itens e o novo total entram na mesma transação, com a comanda travada
 *   (a mesma trava do fechamento e do cancelamento: não entra item numa comanda que está fechando).
 *
 * O módulo não conhece HTTP: devolve um resultado com desfecho nomeado.
 * Ordem de trava: primeiro a linha da comanda (a mesma do fechamento e do cancelamento).
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import { ehGestor } from "./cancelamento-pedido.js";
import { subtotalDaComanda, calcularTotalComandaMesa, calcularTotalComandaMesaComDesconto } from "./total-comanda.js";

export const QUANTIDADE_MINIMA = 1;
export const QUANTIDADE_MAXIMA = 99;
export const OBSERVACAO_MAX_CARACTERES = 500;
export const MAX_ITENS_POR_LANCAMENTO = 50;

export interface ItemLancamento {
  pratoId: string;
  quantidade: number;
  observacao?: string | null;
}

export interface EntradaLancamento {
  restauranteId: string;
  comandaId: string;
  usuario: { id: string; role: string };
  itens: ItemLancamento[];
}

export type PedidoLancado = typeof schema.pedidos.$inferSelect;

export type ResultadoLancamento =
  | {
      tipo: "lancado";
      pedidos: PedidoLancado[];
      subtotalComanda: number;
      totalComanda: number;
      /** Internal metadata for publishing events after transaction confirmation. Only present on success. */
      __metadataParaPublicar?: MetadadosLancamento;
    }
  | { tipo: "itens_invalidos"; mensagem: string }
  | { tipo: "comanda_nao_encontrada" }
  | { tipo: "comanda_delivery" }
  | { tipo: "comanda_nao_aberta" }
  | { tipo: "sem_permissao" }
  | { tipo: "prato_indisponivel" };

export interface MetadadosLancamento {
  restauranteId: string;
  comandaId: string;
  pedidos: Array<{ id: string; status: string }>;
}

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

/**
 * Publica os eventos de pedido criado no hub de eventos.
 * Chamado após a transação ser confirmada (modo com transação própria) ou externamente
 * (modo com transação externa, pelo dono da transação).
 */
export function publicarEventosPedidosLancados(
  app: App,
  restauranteId: string,
  comandaId: string,
  pedidos: Array<{ id: string; status: string }>,
  hub: HubDeEventos = realtimeHub
): void {
  for (const pedido of pedidos) {
    try {
      hub.publish(restauranteId, {
        type: "pedido.created",
        entityId: pedido.id,
        occurredAt: new Date().toISOString(),
        payload: { comanda_id: comandaId, status: pedido.status },
      });
    } catch (err) {
      app.logger.debug({ err }, "Falha ao publicar pedido.created");
    }
  }
}

/** Valida a lista de itens antes de abrir a transação. Devolve a mensagem de erro, ou null se estiver ok. */
export function validarItens(itens: ItemLancamento[]): string | null {
  if (!Array.isArray(itens) || itens.length === 0) {
    return "Informe ao menos um item.";
  }
  if (itens.length > MAX_ITENS_POR_LANCAMENTO) {
    return `Máximo de ${MAX_ITENS_POR_LANCAMENTO} itens por envio.`;
  }
  for (const item of itens) {
    if (
      !Number.isInteger(item.quantidade) ||
      item.quantidade < QUANTIDADE_MINIMA ||
      item.quantidade > QUANTIDADE_MAXIMA
    ) {
      return `Quantidade inválida: deve ser um número inteiro entre ${QUANTIDADE_MINIMA} e ${QUANTIDADE_MAXIMA}.`;
    }
    if (item.observacao != null && item.observacao.length > OBSERVACAO_MAX_CARACTERES) {
      return `Observação muito longa (máximo de ${OBSERVACAO_MAX_CARACTERES} caracteres).`;
    }
  }
  return null;
}

/**
 * Lança itens em uma comanda.
 *
 * Modo com transação própria (tx não fornecido):
 * - Abre e confirma a transação automaticamente
 * - Publica eventos após confirmação
 * - Retorna resultado com metadados internos ignorados por callers legados
 *
 * Modo com transação externa (tx fornecido):
 * - Executa tudo dentro do tx fornecido (sem abrir novo, sem commit)
 * - Não publica eventos (deixa para o dono da transação após commit)
 * - Retorna resultado com metadados para o caller publicar após commit
 *
 * Preserva compatibilidade com callers legados que não passam tx.
 */
export async function lancarItens(
  app: App,
  entrada: EntradaLancamento,
  hub: HubDeEventos = realtimeHub,
  txExterno?: any
): Promise<ResultadoLancamento> {
  const { restauranteId, comandaId, usuario, itens } = entrada;

  const mensagemInvalida = validarItens(itens);
  if (mensagemInvalida) return { tipo: "itens_invalidos", mensagem: mensagemInvalida };

  // Lógica de núcleo extraída: aceita tx já aberto (externo) ou abre novo (próprio)
  const executarNoTx = async (tx: any): Promise<ResultadoLancamento> => {
    // 1) Trava a comanda DO restaurante (comanda de outro restaurante = não encontrada)
    const comandas = await tx
      .select({
        id: schema.comandas.id,
        status: schema.comandas.status,
        tipo: schema.comandas.tipo,
        gorjeta: schema.comandas.gorjeta,
        descontoValor: schema.comandas.descontoValor,
        descontoTipo: schema.comandas.descontoTipo,
      })
      .from(schema.comandas)
      .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
      .for("update");
    if (!comandas.length) return { tipo: "comanda_nao_encontrada" };
    const comanda = comandas[0];

    if (comanda.tipo === "delivery") return { tipo: "comanda_delivery" };
    if (comanda.status !== "aberta") return { tipo: "comanda_nao_aberta" };

    // 2) Papel: garçom, gerente e administrador lançam em qualquer comanda aberta do restaurante; demais papéis não
    const papel = (usuario.role ?? "").toLowerCase();
    const podeLancar = ehGestor(papel) || papel === "garcom";
    if (!podeLancar) return { tipo: "sem_permissao" };

    // 3) Pratos: do restaurante e disponíveis; o preço vem do cadastro
    const pratoIds = Array.from(new Set(itens.map((i) => i.pratoId)));
    const pratos = await tx
      .select({ id: schema.pratos.id, preco: schema.pratos.preco })
      .from(schema.pratos)
      .where(
        and(
          inArray(schema.pratos.id, pratoIds),
          eq(schema.pratos.restauranteId, restauranteId),
          eq(schema.pratos.disponivel, true)
        )
      );
    if (pratos.length !== pratoIds.length) return { tipo: "prato_indisponivel" };

    const precoPorPrato = new Map<string, string>();
    for (const p of pratos) precoPorPrato.set(p.id, p.preco);

    // 4) Grava os itens
    const inseridos: PedidoLancado[] = await tx
      .insert(schema.pedidos)
      .values(
        itens.map((item) => ({
          comandaId,
          pratoId: item.pratoId,
          quantidade: item.quantidade,
          precoUnitario: precoPorPrato.get(item.pratoId) as string,
          observacao: item.observacao?.trim() ? item.observacao.trim() : null,
          status: "pendente" as any,
          restauranteId,
        }))
      )
      .returning();

    // 5) Recalcula o total gravado na comanda (itens cancelados não contam)
    const subtotal = await subtotalDaComanda(tx, comandaId);
    const gorjeta = parseFloat(String(comanda.gorjeta || "0"));
    let total: number;
    let descontoEfetivo: number | undefined;

    if (comanda.tipo === "delivery") {
      total = subtotal;
    } else {
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

    return {
      tipo: "lancado",
      pedidos: inseridos,
      subtotalComanda: subtotal,
      totalComanda: total,
      __metadataParaPublicar: {
        restauranteId,
        comandaId,
        pedidos: inseridos.map(p => ({ id: p.id, status: p.status })),
      },
    };
  };

  // Modo: tx externo (não publica) ou tx próprio (abre, confirma e publica)
  if (txExterno) {
    return executarNoTx(txExterno);
  }

  const dados = await (app.db as any).transaction(async (tx: any) => {
    return executarNoTx(tx);
  });

  // Aviso em tempo real (a cozinha precisa ver o item) depois da transação confirmada
  // (Só acontece em modo com transação própria; modo com tx externo deixa para o dono da tx)
  if (dados.tipo === "lancado" && dados.__metadataParaPublicar) {
    const { restauranteId, comandaId, pedidos } = dados.__metadataParaPublicar;
    publicarEventosPedidosLancados(app, restauranteId, comandaId, pedidos, hub);
  }

  return dados;
}
