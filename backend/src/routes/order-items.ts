import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql, desc, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { realtimeHub } from "../realtime/hub.js";
import { cancelarPedido, MOTIVOS_CANCELAMENTO, ROLES_ATENDIMENTO } from "../services/cancelamento-pedido.js";
import { liberarMesaSeVazia } from "../services/liberar-mesa.js";
import { lancarItens } from "../services/lancamento-pedidos.js";
import { subtotalDaComanda, totalDelivery, calcularTotalComandaMesa, calcularTotalComandaMesaComDesconto } from "../services/total-comanda.js";
import { avaliarTransicao, validarEdicao } from "../services/transicao-pedidos.js";

// Recalcula e grava o subtotal e o total da comanda depois de mexer num item (item cancelado fica
// de fora). Mesma regra do cancelamento de item: delivery = subtotal + taxa de entrega (e o pagamento
// pendente acompanha o novo total); mesa = subtotal + gorjeta. `executor` é o banco ou uma transação.
async function regravarTotaisDaComanda(
  executor: any,
  comanda: { id: string; tipo: string | null; gorjeta: string | null; descontoValor?: string | null; descontoTipo?: string | null },
  restauranteId: string
): Promise<{ descontoEfetivo?: number }> {
  const subtotal = await subtotalDaComanda(executor, comanda.id);
  let total: number;
  let descontoEfetivo: number | undefined;
  if (comanda.tipo === "delivery") {
    total = await totalDelivery(executor, comanda.id);
  } else {
    const gorjeta = parseFloat(String(comanda.gorjeta || "0"));
    const result = calcularTotalComandaMesaComDesconto(subtotal, gorjeta, comanda.descontoTipo, comanda.descontoValor);
    total = result.total;
    descontoEfetivo = result.descontoEfetivo;
  }
  await executor
    .update(schema.comandas)
    .set({
      subtotal: subtotal.toString(),
      total: total.toFixed(2),
      ...(descontoEfetivo !== undefined && { descontoValor: descontoEfetivo.toFixed(2) })
    })
    .where(and(eq(schema.comandas.id, comanda.id), eq(schema.comandas.restauranteId, restauranteId)));

  if (comanda.tipo === "delivery") {
    await executor
      .update(schema.pagamentos)
      .set({ valor: total.toFixed(2) })
      .where(and(eq(schema.pagamentos.comandaId, comanda.id), eq(schema.pagamentos.status, "pendente" as any), eq(schema.pagamentos.restauranteId, restauranteId)));
  }

  return { descontoEfetivo };
}

interface CreatePedidoBody {
  comanda_id?: string;
  comandaId?: string;
  prato_id?: string;
  pratoId?: string;
  quantidade?: number;
  observacao?: string;
}

interface UpdatePedidoStatusBody {
  status: string;
}

export function registerOrderItemRoutes(app: App) {
  // GET /api/pedidos - List all pedidos for authenticated user
  app.fastify.get<{ Querystring: { comanda_id?: string } }>(
    "/api/pedidos",
    {
      schema: {
        description: "List all pedidos for authenticated user (requires authentication)",
        tags: ["pedidos"],
        querystring: {
          type: "object",
          properties: {
            comanda_id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              pedidos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    comanda_id: { type: "string", format: "uuid" },
                    prato_id: { type: "string", format: "uuid" },
                    prato_nome: { type: "string" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: "string" },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                    mesa_numero: { type: "number" },
                    comanda_status: { type: "string" },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { comanda_id?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const authUserId = authUser.id;
        const userRole = authUser.role?.toLowerCase() ?? "";
        const isManager = ["gerente", "admin", "administrador"].includes(userRole);
        const comandaIdFilter = request.query.comanda_id;

        app.logger.info({ authUserId, userRole, isManager, comandaIdFilter }, "Listing pedidos for user");

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(401).send({ error: "Nenhum restaurante associado" });
        }

        const tenantCondition = eq(schema.comandas.restauranteId, restauranteId);

        let whereCondition;
        if (comandaIdFilter) {
          whereCondition = and(
            tenantCondition,
            eq(schema.pedidos.comandaId, comandaIdFilter)
          );
        } else if (isManager) {
          whereCondition = tenantCondition;
        } else {
          whereCondition = and(
            tenantCondition,
            eq(schema.comandas.garcomId, authUserId)
          );
        }

        const pedidos = await app.db
          .select({
            id: schema.pedidos.id,
            comandaId: schema.pedidos.comandaId,
            pratoId: schema.pedidos.pratoId,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
            pratoNome: schema.pratos.nome,
            pratoDescricao: schema.pratos.descricao,
            pratoImagem: schema.pratos.imagemUrl,
            mesaNumero: schema.mesas.numero,
            comandaStatus: schema.comandas.status,
            garcomId: schema.comandas.garcomId,
          })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(whereCondition)
          .orderBy(desc(schema.pedidos.createdAt));

        app.logger.info({ count: pedidos.length }, "Pedidos retrieved");

        return await reply.code(200).send({
          pedidos: pedidos.map((p) => ({
            id: p.id,
            comanda_id: p.comandaId,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
            prato_nome: p.pratoNome,
            prato_descricao: p.pratoDescricao,
            prato_imagem: p.pratoImagem,
            mesa_numero: p.mesaNumero,
            comanda_status: p.comandaStatus,
            garcom_id: p.garcomId,
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list pedidos");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/pedidos - Cria um pedido (rota legada: mantida só para os aplicativos já instalados).
  // O aplicativo atual lança os itens em POST /api/comandas/:id/pedidos (todos de uma vez, tudo ou nada).
  // As regras ficam em services/lancamento-pedidos.ts.
  app.fastify.post<{ Body: CreatePedidoBody }>(
    "/api/pedidos",
    {
      schema: {
        description:
          "Cria um pedido em uma comanda aberta (legada; prefira POST /api/comandas/:id/pedidos). O preço vem sempre do cadastro do prato.",
        tags: ["pedidos"],
        body: {
          type: "object",
          required: ["comanda_id", "prato_id"],
          properties: {
            comanda_id: { type: "string", format: "uuid" },
            comandaId: { type: "string", format: "uuid" },
            prato_id: { type: "string", format: "uuid" },
            pratoId: { type: "string", format: "uuid" },
            quantidade: { type: "integer", minimum: 1, maximum: 99 },
            observacao: { type: "string", maxLength: 500 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              pedido: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  comanda_id: { type: "string" },
                  prato_id: { type: "string" },
                  quantidade: { type: "number" },
                  preco_unitario: { type: "string" },
                  observacao: { type: ["string", "null"] },
                  status: { type: "string" },
                  created_at: { type: "string" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreatePedidoBody }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const comandaId = request.body.comanda_id || request.body.comandaId;
        const pratoId = request.body.prato_id || request.body.pratoId;

        if (!comandaId || !pratoId) {
          return await reply.code(400).send({ error: "comanda_id and prato_id are required" });
        }

        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ comandaId, pratoId, restauranteId }, "Creating pedido");

        const resultado = await lancarItens(app, {
          restauranteId,
          comandaId,
          usuario: { id: session.id, role: session.role },
          itens: [{ pratoId, quantidade: request.body.quantidade ?? 1, observacao: request.body.observacao ?? null }],
        });

        switch (resultado.tipo) {
          case "itens_invalidos":
            return await reply.code(400).send({ error: resultado.mensagem });
          case "comanda_nao_encontrada":
            return await reply.code(404).send({ error: "Comanda não encontrada" });
          case "comanda_delivery":
            return await reply.code(409).send({ error: "Pedido de delivery: use a tela de Delivery." });
          case "comanda_nao_aberta":
            return await reply.code(409).send({ error: "Esta comanda não está aberta." });
          case "sem_permissao":
            return await reply.code(403).send({ error: "Sem permissão para adicionar itens a esta comanda." });
          case "prato_indisponivel":
            return await reply.code(400).send({ error: "Prato indisponível ou não encontrado." });
        }

        const pedido = resultado.pedidos[0];
        app.logger.info({ pedidoId: pedido.id }, "Pedido created successfully");

        return await reply.code(201).send({
          pedido: {
            id: pedido.id,
            comanda_id: pedido.comandaId,
            prato_id: pedido.pratoId,
            quantidade: pedido.quantidade,
            preco_unitario: pedido.precoUnitario,
            observacao: pedido.observacao,
            status: pedido.status,
            created_at: pedido.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create pedido");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/pedidos/:id - Get a pedido
  app.fastify.get<{ Params: { id: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Get a pedido by ID",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: "string", format: "uuid" },
              prato_nome: { type: "string" },
              mesa_numero: { type: "number" },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: "string" },
              status: { type: "string" },
              created_at: { type: "string", format: "date-time" },
            },
            additionalProperties: true,
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id }, "Getting pedido");
        const restauranteId = requireTenant(session);

        const pedidos = await app.db
          .select({
            id: schema.pedidos.id,
            comandaId: schema.pedidos.comandaId,
            pratoId: schema.pedidos.pratoId,
            pratoNome: schema.pratos.nome,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
            mesaNumero: schema.comandas.mesaNumero,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (!pedidos.length) {
          return await reply.code(404).send({ error: "Pedido não encontrado" });
        }

        const p = pedidos[0];
        return await reply.code(200).send({
          id: p.id,
          comanda_id: p.comandaId,
          prato_id: p.pratoId,
          prato_nome: p.pratoNome || "Desconhecido",
          mesa_numero: p.mesaNumero,
          quantidade: p.quantidade,
          preco_unitario: p.precoUnitario,
          observacao: p.observacao,
          status: p.status,
          created_at: p.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get pedido");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id/status - Update pedido status
  app.fastify.put<{ Params: { id: string }; Body: UpdatePedidoStatusBody }>(
    "/api/pedidos/:id/status",
    {
      schema: {
        description: "Update pedido status",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["pendente", "em_preparo", "pronto", "entregue", "cancelado"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              comandaId: { type: "string" },
              pratoId: { type: "string" },
              quantidade: { type: "number" },
              precoUnitario: { type: "string" },
              observacao: { type: "string" },
              status: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdatePedidoStatusBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id, status: request.body.status }, "Updating pedido status");

        const restauranteIdAtual = requireTenant(session);
        if (!restauranteIdAtual) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Cancelar tem rota própria (motivo obrigatório, permissões e registro de quem cancelou)
        if (request.body.status === "cancelado") {
          return await reply.code(400).send({ error: "Para cancelar um item use PUT /api/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteIdAtual)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Pedido not found" });
        }

        if (existing[0].status === "cancelado") {
          return await reply.code(409).send({ error: "Item cancelado não pode mudar de status." });
        }

        // Bug 6: verificar se é delivery e se a entrega já saiu/foi entregue/cancelada
        // Este check fica ANTES da transação
        let entregaDelivery: { id: string; status: string; clienteNome: string } | null = null;
        let comandaTipo: string | null = null;

        const [comandaCheck] = await app.db
          .select({ tipo: schema.comandas.tipo, id: schema.comandas.id, status: schema.comandas.status })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, existing[0].comandaId));

        // Só comanda aberta tem item andando na cozinha (comanda cancelada mantém os itens para histórico)
        if (comandaCheck && comandaCheck.status !== "aberta") {
          return await reply.code(409).send({ error: "Esta comanda não está aberta." });
        }

        if (comandaCheck?.tipo === "delivery") {
          comandaTipo = "delivery";
          const [entregaCheck] = await app.db
            .select({ id: schema.entregas.id, status: schema.entregas.status, clienteNome: schema.entregas.clienteNome })
            .from(schema.entregas)
            .where(eq(schema.entregas.comandaId, existing[0].comandaId))
            .orderBy(desc(schema.entregas.createdAt))
            .limit(1);

          if (entregaCheck) {
            if (["saiu_entrega", "entregue", "cancelada"].includes(entregaCheck.status)) {
              return await reply.code(409).send({ error: `Não é possível alterar itens de um delivery que já ${entregaCheck.status === "saiu_entrega" ? "saiu para entrega" : entregaCheck.status === "entregue" ? "foi entregue" : "foi cancelado"}.` });
            }
            entregaDelivery = entregaCheck;
          }
        }

        const novoStatus = request.body.status;

        // Máquina de estados e papéis (services/transicao-pedidos.ts): avanço uma etapa por vez,
        // retrocesso só da gestão (a cozinha só desfaz "pronto" nos primeiros 2 minutos)
        const avaliacao = avaliarTransicao({
          papel: session.role,
          statusAtual: existing[0].status,
          novoStatus,
          prontoEm: existing[0].prontoEm,
        });
        if (avaliacao.tipo === "recusada") {
          return await reply.code(avaliacao.http).send({ error: avaliacao.erro });
        }
        if (avaliacao.semMudanca) {
          // Toque duplo ou reenvio: devolve o item como está, sem mexer nos tempos nem avisar o tempo real
          return await reply.code(200).send({
            id: existing[0].id,
            comandaId: existing[0].comandaId,
            pratoId: existing[0].pratoId,
            quantidade: existing[0].quantidade,
            precoUnitario: existing[0].precoUnitario,
            observacao: existing[0].observacao,
            status: existing[0].status,
            createdAt: existing[0].createdAt.toISOString(),
          });
        }

        // Bug 6a: Transação única para atualizar item + avanço automático da entrega
        const updated = await (app.db as any).transaction(async (tx: any) => {
          // Prep time tracking: set timestamps based on status transitions
          const updateSet: any = { status: novoStatus as any };

          if (novoStatus === "em_preparo") {
            // Início do preparo (o tempo do item conta a partir daqui) ou volta de "pronto/entregue":
            // o início original é mantido e o "pronto" anterior deixa de valer
            if (!existing[0].iniciadoEm) {
              updateSet.iniciadoEm = new Date();
            }
            updateSet.prontoEm = null;
          } else if (novoStatus === "pronto") {
            updateSet.prontoEm = new Date();
          } else if (novoStatus === "pendente") {
            updateSet.iniciadoEm = null;
            updateSet.prontoEm = null;
          }

          // O status atual entra na condição: se outra chamada mexeu no item no meio tempo, não sobrescreve
          const [updatedItem] = await tx
            .update(schema.pedidos)
            .set(updateSet)
            .where(and(
              eq(schema.pedidos.id, request.params.id),
              eq(schema.pedidos.restauranteId, restauranteIdAtual),
              eq(schema.pedidos.status, existing[0].status as any)
            ))
            .returning();

          if (!updatedItem) {
            return null;
          }

          // Avanço automático: pendente → preparando quando item entra em preparo ou fica pronto
          if (
            comandaTipo === "delivery" &&
            entregaDelivery &&
            (novoStatus === "em_preparo" || novoStatus === "pronto") &&
            entregaDelivery.status === "pendente"
          ) {
            await tx
              .update(schema.entregas)
              .set({ status: "preparando" as any })
              .where(eq(schema.entregas.id, entregaDelivery.id));
            // Atualizar o status local para os eventos realtime abaixo
            entregaDelivery = { ...entregaDelivery, status: "preparando" };
          }

          return updatedItem;
        });

        if (!updated) {
          return await reply.code(409).send({ error: "O item mudou de status enquanto você agia. Atualize a tela e tente de novo." });
        }

        app.logger.info({ pedidoId: updated.id }, "Pedido status updated successfully");

        // Eventos realtime ficam FORA da transação (falha de evento não reverte a operação)
        try {
          const restauranteId = requireTenant(session);

          let mesaNumero: number | null = null;
          let pratoNome: string | null = null;
          let comandaTipo: string | null = null;
          try {
            const [enriched] = await app.db
              .select({
                mesaNumero: schema.comandas.mesaNumero,
                pratoNome: schema.pratos.nome,
                comandaTipo: schema.comandas.tipo,
              })
              .from(schema.pedidos)
              .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
              .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
              .where(eq(schema.pedidos.id, updated.id))
              .limit(1);
            if (enriched) {
              mesaNumero = enriched.mesaNumero;
              pratoNome = enriched.pratoNome;
              comandaTipo = enriched.comandaTipo;
            }
          } catch (enrichErr) {
            app.logger.warn({ err: enrichErr }, "Failed to enrich pedido.status_changed event, publishing minimal payload");
          }

          realtimeHub.publish(restauranteId, {
            type: "pedido.status_changed",
            entityId: updated.id,
            occurredAt: new Date().toISOString(),
            payload: {
              status: updated.status,
              comanda_id: updated.comandaId,
              mesa_numero: mesaNumero,
              prato_nome: pratoNome,
              comanda_tipo: comandaTipo,
            },
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish pedido.status_changed event");
        }

        // Eventos de delivery (status_changed e pronto) fora da transação
        try {
          if (comandaTipo === "delivery" && entregaDelivery) {
            // Publicar mudança de status da entrega se avançou para preparando
            if (novoStatus === "em_preparo" || novoStatus === "pronto") {
              realtimeHub.publish(restauranteIdAtual, {
                type: "delivery.status_changed",
                entityId: updated.comandaId,
                occurredAt: new Date().toISOString(),
                payload: { comanda_id: updated.comandaId, tipo: "delivery", status: entregaDelivery.status, cliente_nome: entregaDelivery.clienteNome },
              });
            }

            // Evento delivery.pronto quando último item ativo fica pronto
            if (novoStatus === "pronto") {
              const todosItens = await app.db
                .select({ status: schema.pedidos.status })
                .from(schema.pedidos)
                .where(eq(schema.pedidos.comandaId, updated.comandaId));
              const ativos = todosItens.filter((i: any) => i.status !== "cancelado");
              const prontos = ativos.filter((i: any) => i.status === "pronto");
              if (ativos.length > 0 && prontos.length === ativos.length) {
                realtimeHub.publish(restauranteIdAtual, {
                  type: "delivery.pronto",
                  entityId: updated.comandaId,
                  occurredAt: new Date().toISOString(),
                  payload: { comanda_id: updated.comandaId, entrega_id: entregaDelivery.id, cliente_nome: entregaDelivery.clienteNome },
                });
              }
            }
          }
        } catch (deliveryErr) {
          app.logger.warn({ err: deliveryErr }, "Failed to publish delivery realtime events");
        }

        return await reply.code(200).send({
          id: updated.id,
          comandaId: updated.comandaId,
          pratoId: updated.pratoId,
          quantidade: updated.quantidade,
          precoUnitario: updated.precoUnitario,
          observacao: updated.observacao,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update pedido status");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id/cancelar - Cancela um item (item cancelado não é venda)
  app.fastify.put<{ Params: { id: string }; Body: { motivo: string; detalhe?: string } }>(
    "/api/pedidos/:id/cancelar",
    {
      schema: {
        description:
          "Cancela um item de uma comanda aberta. Item cancelado não conta como venda. Itens pendentes podem ser cancelados por garçom, gerente ou administrador; itens já em preparo ou prontos, só por gerente ou administrador (ficam marcados como perda). Item entregue não pode ser cancelado.",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["motivo"],
          properties: {
            motivo: { type: "string", enum: [...MOTIVOS_CANCELAMENTO] },
            detalhe: { type: "string", maxLength: 300 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              id: { type: "string" },
              comanda_id: { type: "string" },
              status: { type: "string" },
              cancelado_apos_inicio: { type: "boolean" },
              subtotal_comanda: { type: "number" },
              total_comanda: { type: "number" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { motivo: string; detalhe?: string } }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      // Cozinheiro não cancela item: só garçom e papéis gerenciais
      if (!(await requireRole(session, ROLES_ATENDIMENTO, reply))) return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        const detalhe = request.body.detalhe?.trim() || null;
        if (request.body.motivo === "outro" && !detalhe) {
          return await reply.code(400).send({ error: "Informe o detalhe do motivo quando o motivo for 'outro'." });
        }

        const resultado = await cancelarPedido(app, {
          restauranteId,
          pedidoId: request.params.id,
          motivo: request.body.motivo as any,
          detalhe,
          canceladoPor: { id: session.id, nome: session.name, role: session.role },
        });

        if (resultado.tipo !== "cancelado") {
          switch (resultado.tipo) {
            case "nao_encontrado":
              return await reply.code(404).send({ error: "Pedido not found" });
            case "comanda_nao_aberta":
              return await reply.code(409).send({ error: "Só é possível cancelar itens de uma comanda aberta." });
            case "ja_cancelado":
              return await reply.code(409).send({ error: "Item já está cancelado." });
            case "ja_entregue":
              return await reply.code(409).send({ error: "Item já entregue não pode ser cancelado. Cortesia e estorno ainda não estão disponíveis." });
            case "requer_gestor":
              return await reply.code(403).send({ error: "Só gerente ou administrador pode cancelar um item que já está em preparo ou pronto." });
          }
        }

        // Publicar delivery.pronto se aplicável (após sucesso da transação)
        if (resultado.tipo === "cancelado") {
          try {
            // Verificar se é delivery
            const [cmdCheck] = await app.db
              .select({ tipo: schema.comandas.tipo })
              .from(schema.comandas)
              .where(eq(schema.comandas.id, resultado.comandaId));

            if (cmdCheck?.tipo === "delivery") {
              // Buscar todos os pedidos da comanda
              const todosItens = await app.db
                .select({ status: schema.pedidos.status })
                .from(schema.pedidos)
                .where(eq(schema.pedidos.comandaId, resultado.comandaId));

              const ativos = todosItens.filter((i: any) => i.status !== "cancelado");
              const prontos = ativos.filter((i: any) => i.status === "pronto");

              // Se há itens ativos e TODOS são pronto
              if (ativos.length > 0 && prontos.length === ativos.length) {
                // Buscar entrega mais recente
                const [entrega] = await app.db
                  .select({ id: schema.entregas.id, status: schema.entregas.status, clienteNome: schema.entregas.clienteNome })
                  .from(schema.entregas)
                  .where(eq(schema.entregas.comandaId, resultado.comandaId))
                  .orderBy(desc(schema.entregas.createdAt))
                  .limit(1);

                if (entrega && ["pendente", "preparando"].includes(entrega.status)) {
                  realtimeHub.publish(restauranteId, {
                    type: "delivery.pronto",
                    entityId: resultado.comandaId,
                    occurredAt: new Date().toISOString(),
                    payload: {
                      comanda_id: resultado.comandaId,
                      entrega_id: entrega.id,
                      cliente_nome: entrega.clienteNome,
                    },
                  });
                }
              }
            }
          } catch (deliveryErr) {
            app.logger.warn({ err: deliveryErr }, "Failed to publish delivery.pronto event after cancellation");
          }
        }

        return await reply.code(200).send({
          success: true,
          id: resultado.pedidoId,
          comanda_id: resultado.comandaId,
          status: "cancelado",
          cancelado_apos_inicio: resultado.canceladoAposInicio,
          subtotal_comanda: resultado.subtotalComanda,
          total_comanda: resultado.totalComanda,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to cancel pedido");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pedidos/:id - Update a pedido
  app.fastify.put<{ Params: { id: string }; Body: { quantidade?: number; observacao?: string; status?: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Update a pedido (requires authentication)",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            quantidade: { type: "number" },
            observacao: { type: "string" },
            status: { type: "string", enum: ["pendente", "em_preparo", "pronto", "entregue", "cancelado"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: "string", format: "uuid" },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: "string" },
              status: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { quantidade?: number; observacao?: string; status?: string } }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id, body: request.body }, "Updating pedido");

        const restauranteIdAtual = requireTenant(session);
        if (!restauranteIdAtual) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Papel: garçom, gerente e administrador editam item; a cozinha não
        if (!(await requireRole(session, ROLES_ATENDIMENTO, reply))) return;

        // Cancelar tem rota própria (motivo obrigatório, permissões e registro de quem cancelou)
        if (request.body.status === "cancelado") {
          return await reply.code(400).send({ error: "Para cancelar um item use PUT /api/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteIdAtual)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Pedido not found" });
        }

        const pedido = existing[0];

        if (pedido.status === "cancelado") {
          return await reply.code(409).send({ error: "Item cancelado não pode ser alterado." });
        }

        // O status tem rota própria (máquina de estados e papéis). Esta rota só aceita o status
        // quando ele repete o atual (clientes antigos mandam o campo junto com a quantidade).
        if (request.body.status !== undefined && request.body.status !== pedido.status) {
          return await reply.code(400).send({ error: "Para mudar o status do item use PUT /api/pedidos/:id/status." });
        }

        const edicao = validarEdicao({ quantidade: request.body.quantidade, observacao: request.body.observacao });
        if (edicao.tipo === "invalida") {
          return await reply.code(400).send({ error: edicao.erro });
        }

        // Regra de edição: só item que a cozinha ainda não iniciou. Depois disso o item só sai por cancelamento, com motivo.
        if (pedido.status !== "pendente") {
          return await reply.code(409).send({
            error: "Este item já foi iniciado pela cozinha e não pode mais ser alterado. Para retirá-lo, cancele o item informando o motivo.",
          });
        }

        const updates: any = { ...edicao.campos };

        // Tudo numa transação: trava primeiro a linha da comanda do restaurante e depois o item
        // (mesma ordem do fechamento e do cancelamento), para não haver deadlock nem total fora de sincronia.
        const resultadoEdicao = await (app.db as any).transaction(async (tx: any) => {
          const comandas = await tx
            .select({
              id: schema.comandas.id,
              tipo: schema.comandas.tipo,
              status: schema.comandas.status,
              gorjeta: schema.comandas.gorjeta,
              descontoValor: schema.comandas.descontoValor,
              descontoTipo: schema.comandas.descontoTipo,
            })
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, pedido.comandaId), eq(schema.comandas.restauranteId, restauranteIdAtual)))
            .for("update");

          if (!comandas.length) return { tipo: "comanda_nao_encontrada" as const };
          const comandaTravada = comandas[0];
          if (comandaTravada.status !== "aberta") return { tipo: "comanda_nao_aberta" as const };

          // O status "pendente" entra na condição: se a cozinha iniciou o item nesse meio tempo, a edição não passa
          const atualizados = await tx
            .update(schema.pedidos)
            .set(updates)
            .where(and(
              eq(schema.pedidos.id, request.params.id),
              eq(schema.pedidos.restauranteId, restauranteIdAtual),
              eq(schema.pedidos.status, "pendente" as any)
            ))
            .returning();

          if (!atualizados.length) return { tipo: "item_mudou" as const };

          await regravarTotaisDaComanda(tx, comandaTravada, restauranteIdAtual);
          return { tipo: "ok" as const, pedido: atualizados[0] };
        });

        if (resultadoEdicao.tipo === "comanda_nao_encontrada") {
          return await reply.code(404).send({ error: "Comanda não encontrada." });
        }
        if (resultadoEdicao.tipo === "comanda_nao_aberta") {
          return await reply.code(409).send({ error: "Esta comanda não está aberta." });
        }
        if (resultadoEdicao.tipo === "item_mudou") {
          return await reply.code(409).send({
            error: "A cozinha iniciou este item enquanto você editava. Para retirá-lo, cancele o item informando o motivo.",
          });
        }

        const updated = resultadoEdicao.pedido;

        app.logger.info({ pedidoId: updated.id }, "Pedido updated successfully");

        try {
          const restauranteId = requireTenant(session);
          if (request.body.status !== undefined && request.body.status !== pedido.status) {
            realtimeHub.publish(restauranteId, {
              type: "pedido.status_changed",
              entityId: updated.id,
              occurredAt: new Date().toISOString(),
              payload: { new_status: request.body.status, old_status: pedido.status },
            });
          } else {
            realtimeHub.publish(restauranteId, {
              type: "pedido.updated",
              entityId: updated.id,
              occurredAt: new Date().toISOString(),
              payload: { quantidade: request.body.quantidade, observacao: request.body.observacao },
            });
          }
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido event");
        }

        return await reply.code(200).send({
          id: updated.id,
          comanda_id: updated.comandaId,
          prato_id: updated.pratoId,
          quantidade: updated.quantidade,
          preco_unitario: updated.precoUnitario.toString(),
          observacao: updated.observacao,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update pedido");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/pedidos/:id - Delete a pedido
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/pedidos/:id",
    {
      schema: {
        description: "Delete a pedido (requires authentication)",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: {},
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Papel: garçom, gerente e administrador; a cozinha não exclui item
        if (!(await requireRole(session, ROLES_ATENDIMENTO, reply))) return;

        app.logger.info({ pedidoId: request.params.id, restauranteId }, "Deleting pedido");

        const existing = await app.db
          .select()
          .from(schema.pedidos)
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Pedido not found" });
        }

        const pedido = existing[0];

        // Exclusão só de item que a cozinha ainda não iniciou. Depois disso (ou se já foi cancelado)
        // o registro precisa ficar: o item sai por cancelamento, com motivo e, se for o caso, perda.
        if (pedido.status !== "pendente") {
          return await reply.code(409).send({
            error: pedido.status === "cancelado"
              ? "Item cancelado não pode ser excluído."
              : "Este item já foi iniciado pela cozinha e não pode ser excluído. Para retirá-lo, cancele o item informando o motivo.",
          });
        }

        const [comandaDoItem] = await app.db
          .select({ tipo: schema.comandas.tipo, status: schema.comandas.status })
          .from(schema.comandas)
          .where(and(eq(schema.comandas.id, pedido.comandaId), eq(schema.comandas.restauranteId, restauranteId)));

        if (!comandaDoItem) {
          return await reply.code(404).send({ error: "Comanda não encontrada." });
        }
        if (comandaDoItem.status !== "aberta") {
          return await reply.code(409).send({ error: "Esta comanda não está aberta." });
        }
        if (comandaDoItem.tipo === "delivery") {
          return await reply.code(409).send({ error: "Em pedido de delivery o item não é excluído: cancele o item informando o motivo." });
        }

        let pratoNome: string | null = null;
        if (pedido.pratoId) {
          const pratoResult = await app.db
            .select({ nome: schema.pratos.nome })
            .from(schema.pratos)
            .where(eq(schema.pratos.id, pedido.pratoId));

          if (pratoResult.length) {
            pratoNome = pratoResult[0].nome;
          }
        }

        // O status "pendente" entra na condição: se a cozinha iniciou o item nesse meio tempo, nada é apagado
        const excluidos = await app.db
          .delete(schema.pedidos)
          .where(and(
            eq(schema.pedidos.id, request.params.id),
            eq(schema.pedidos.restauranteId, restauranteId),
            eq(schema.pedidos.status, "pendente" as any)
          ))
          .returning({ id: schema.pedidos.id });

        if (!excluidos.length) {
          return await reply.code(409).send({
            error: "A cozinha iniciou este item enquanto você agia. Para retirá-lo, cancele o item informando o motivo.",
          });
        }

        try {
          realtimeHub.publish(restauranteId, {
            type: "pedido.deleted",
            entityId: request.params.id,
            occurredAt: new Date().toISOString(),
            payload: { comanda_id: pedido.comandaId, prato_id: pedido.pratoId },
          });
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido.deleted event");
        }

        const subtotalResult = await app.db
          .select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, pedido.comandaId));

        const subtotalValue = subtotalResult[0]?.subtotal || "0";
        const subtotal = parseFloat(String(subtotalValue));

        const comandaResult = await app.db
          .select({
            gorjeta: schema.comandas.gorjeta,
            tipo: schema.comandas.tipo,
            descontoValor: schema.comandas.descontoValor,
            descontoTipo: schema.comandas.descontoTipo,
          })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, pedido.comandaId));

        const gorjeta = parseFloat(String(comandaResult[0]?.gorjeta || "0"));
        let newTotal: string;
        let descontoEfetivo: number | undefined;

        if (comandaResult[0]?.tipo === "delivery") {
          newTotal = subtotal.toFixed(2);
        } else {
          const result = calcularTotalComandaMesaComDesconto(subtotal, gorjeta, comandaResult[0]?.descontoTipo, comandaResult[0]?.descontoValor);
          newTotal = result.total.toFixed(2);
          descontoEfetivo = result.descontoEfetivo;
        }

        await app.db
          .update(schema.comandas)
          .set({
            subtotal: subtotal.toString(),
            total: newTotal,
            ...(descontoEfetivo !== undefined && { descontoValor: descontoEfetivo.toFixed(2) })
          })
          .where(eq(schema.comandas.id, pedido.comandaId));

        const remainingPedidos = await app.db
          .select()
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, pedido.comandaId));

        const remainingCount = remainingPedidos.length;

        if (remainingCount === 0) {
          const comandaInfo = await app.db
            .select({
              id: schema.comandas.id,
              mesaId: schema.comandas.mesaId,
              garcomId: schema.comandas.garcomId,
              status: schema.comandas.status,
              total: schema.comandas.total,
              createdAt: schema.comandas.createdAt,
              closedAt: schema.comandas.closedAt,
              mesaNumero: schema.comandas.mesaNumero,
              rotulo: schema.comandas.rotulo,
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
            .where(eq(schema.comandas.id, pedido.comandaId));

          if (comandaInfo.length) {
            const comanda = comandaInfo[0];

            // Arquiva, apaga a comanda e libera a mesa na mesma transação; a mesa só é liberada
            // se não restar outra comanda aberta nela (regra única em services/liberar-mesa.ts)
            await (app.db as any).transaction(async (tx: any) => {
              await tx.insert(schema.comandasHistorico).values({
                id: comanda.id,
                mesaId: comanda.mesaId,
                mesaNumero: comanda.mesaNumero,
                rotulo: comanda.rotulo ?? null,
                garcomId: comanda.garcomId,
                status: comanda.status,
                total: comanda.total as any,
                descontoValor: descontoEfetivo !== undefined ? descontoEfetivo.toString() : (comanda.descontoValor ?? null),
                descontoTipo: comanda.descontoTipo ?? null,
                descontoMotivo: comanda.descontoMotivo ?? null,
                descontoMotivoDetalhe: comanda.descontoMotivoDetalhe ?? null,
                descontoPorId: comanda.descontoPorId ?? null,
                descontoPorNome: comanda.descontoPorNome ?? null,
                descontoAplicadoPorNome: comanda.descontoAplicadoPorNome ?? null,
                descontoEm: comanda.descontoEm ?? null,
                createdAt: comanda.createdAt,
                closedAt: comanda.closedAt,
                archivedAt: new Date(),
                restauranteId,
              });

              await tx.insert(schema.pedidosHistorico).values({
                id: pedido.id,
                comandaId: pedido.comandaId,
                pratoId: pedido.pratoId,
                pratoNome,
                quantidade: pedido.quantidade,
                precoUnitario: pedido.precoUnitario as any,
                observacao: pedido.observacao,
                status: pedido.status,
                createdAt: pedido.createdAt,
                archivedAt: new Date(),
                restauranteId,
              });

              await tx.delete(schema.comandas).where(and(eq(schema.comandas.id, pedido.comandaId), eq(schema.comandas.restauranteId, restauranteId)));

              await liberarMesaSeVazia(tx, comanda.mesaId, restauranteId);
            });

            app.logger.info(
              { pedidoId: request.params.id, comandaId: pedido.comandaId },
              "Pedido deleted and comanda archived"
            );

            return await reply.code(204).send();
          }
        }

        app.logger.info({ pedidoId: request.params.id }, "Pedido deleted successfully");

        return await reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete pedido");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
