import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql, inArray, or, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import { user } from "../db/schema/auth-schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { resolveGarcomId } from "../utils/garcom.js";
import { realtimeHub } from "../realtime/hub.js";
import { fecharComanda } from "../services/fechamento-comanda.js";
import { liberarMesaSeVazia } from "../services/liberar-mesa.js";
import { abrirComandaNaMesa, TAMANHO_MAXIMO_NOME_COMANDA } from "../services/abrir-comanda.js";

interface CreateComandaBody {
  mesaId?: string;
  mesa_id?: string;
  garcomId?: string;
  garcom_id?: string;
  /** Nome da comanda (obrigatório no modo "individual"; ignorado no modo "mesa"). */
  rotulo?: string;
  nome?: string;
  itens?: Array<{
    prato_id: string;
    quantidade: number;
    preco_unitario: number;
    observacao?: string;
  }>;
}

interface CreatePedidosBody {
  items: Array<{
    prato_id: string;
    quantidade: number;
    observacao?: string;
    preco_unitario: number;
  }>;
}

interface FecharComandaBody {
  gorjeta?: number;
  num_pessoas?: number;
}

export function registerOrderRoutes(app: App) {
  // GET /api/comandas - List all comandas for authenticated user
  app.fastify.get<{ Querystring: { status?: string } }>(
    "/api/comandas",
    {
      schema: {
        description: "List all comandas for authenticated user (requires authentication)",
        tags: ["comandas"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["aberta", "fechada", "cancelada"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    mesa_id: { type: "string", format: "uuid" },
                    mesa_numero: { type: "number" },
                    garcom_id: { type: "string" },
                    rotulo: { type: ["string", "null"] },
                    status: { type: "string" },
                    total: { type: "number" },
                    created_at: { type: "string", format: "date-time" },
                    closed_at: { type: "string", format: "date-time" },
                    item_count: { type: "number" },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const authUserId = authUser.id;
        const userRole = authUser.role?.toLowerCase() ?? "";
        const isManager = ["gerente", "admin", "administrador"].includes(userRole);

        app.logger.info(
          { authUserId, status: request.query.status, userRole, isManager },
          "Listing comandas for user"
        );

        // Build SQL query with GROUP BY and COUNT, calculating total from pedidos
        let sqlQuery = sql`
          SELECT
            c.id,
            c.mesa_id,
            m.numero AS mesa_numero,
            c.garcom_id,
            c.rotulo,
            c.status,
            c.created_at,
            c.closed_at,
            COUNT(p.id) FILTER (WHERE p.status <> 'cancelado')::integer AS item_count,
            COALESCE(SUM(p.quantidade * p.preco_unitario) FILTER (WHERE p.status <> 'cancelado'), 0) as total
          FROM comandas c
          LEFT JOIN mesas m ON m.id = c.mesa_id
          LEFT JOIN pedidos p ON p.comanda_id = c.id
        `;

        const restauranteId = requireTenant(authUser);

        // Add WHERE clause conditionally based on role — always filter by tenant and exclude delivery
        if (!isManager) {
          sqlQuery = sql`${sqlQuery} WHERE c.restaurante_id = ${restauranteId} AND c.garcom_id = ${authUserId} AND c.tipo <> 'delivery'`;
          if (request.query.status) {
            sqlQuery = sql`${sqlQuery} AND c.status = ${request.query.status}`;
          }
        } else {
          sqlQuery = sql`${sqlQuery} WHERE c.restaurante_id = ${restauranteId} AND c.tipo <> 'delivery'`;
          if (request.query.status) {
            sqlQuery = sql`${sqlQuery} AND c.status = ${request.query.status}`;
          }
        }

        sqlQuery = sql`${sqlQuery}
          GROUP BY c.id, c.mesa_id, m.numero, c.garcom_id, c.rotulo, c.status, c.created_at, c.closed_at
          ORDER BY c.created_at DESC
        `;

        const comandas = await (app.db as any).execute(sqlQuery) as any[];

        app.logger.info({ count: comandas.length }, "Comandas retrieved");

        return await reply.code(200).send({
          comandas: comandas.map((c: any) => ({
            id: c.id,
            mesa_id: c.mesa_id,
            mesa_numero: Number(c.mesa_numero),
            garcom_id: c.garcom_id,
            rotulo: c.rotulo ?? null,
            status: c.status,
            total: Number(c.total),
            created_at: c.created_at ? new Date(c.created_at).toISOString() : null,
            closed_at: c.closed_at ? new Date(c.closed_at).toISOString() : null,
            item_count: Number(c.item_count),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list comandas");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/comandas - Open a new comanda for a table
  app.fastify.post<{ Body: CreateComandaBody }>(
    "/api/comandas",
    {
      schema: {
        description: "Open a new comanda for a table with optional items (requires authentication)",
        tags: ["comandas"],
        body: {
          type: "object",
          properties: {
            mesa_id: { type: "string", format: "uuid" },
            mesaId: { type: "string", format: "uuid" },
            garcom_id: { type: "string" },
            garcomId: { type: "string" },
            rotulo: { type: "string" },
            nome: { type: "string" },
            itens: {
              type: "array",
              items: {
                type: "object",
                required: ["prato_id", "quantidade", "preco_unitario"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "number" },
                  preco_unitario: { type: "number" },
                  observacao: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              comanda: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  mesa_id: { type: "string", format: "uuid" },
                  mesa_numero: { type: "number" },
                  garcom_id: { type: "string" },
                  rotulo: { type: ["string", "null"] },
                  status: { type: "string" },
                  total: { type: "string" },
                  created_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateComandaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const mesaId = request.body.mesa_id || request.body.mesaId;

        if (!mesaId) {
          return await reply.code(400).send({ error: "mesa_id is required" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Check if mesa exists and belongs to tenant
        const mesaRecords = await app.db
          .select()
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, mesaId), eq(schema.mesas.restauranteId, restauranteId)))
          .limit(1);

        if (!mesaRecords.length) {
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        const mesa = mesaRecords[0];

        // A conferência de comanda já aberta (modo "mesa") e do nome (modo "individual") acontece
        // dentro da transação, com a mesa travada (services/abrir-comanda.ts).

        // Store garcom_id as the authenticated user's id (text, stable across deploys)
        const garcomId = authUser.id;

        app.logger.info(
          {
            mesaId,
            garcomId,
            restauranteId,
            authUserEmail: authUser.email,
          },
          "Creating comanda with auth user id as garcom_id"
        );

        // Items validation and prato price map
        let initialTotal = "0";
        let pratoPriceMap: Map<string, string> = new Map();

        if (request.body.itens && request.body.itens.length > 0) {
          // Validate quantities
          for (const item of request.body.itens) {
            if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 99) {
              return await reply.code(400).send({ error: "Quantidade inválida: deve ser um número inteiro entre 1 e 99." });
            }
          }

          // Fetch and validate pratos (ownership + availability)
          const uniquePratoIds = Array.from(new Set(request.body.itens.map((i) => i.prato_id)));
          const pratosResult = await app.db
            .select({ id: schema.pratos.id, preco: schema.pratos.preco })
            .from(schema.pratos)
            .where(and(
              inArray(schema.pratos.id, uniquePratoIds),
              eq(schema.pratos.restauranteId, restauranteId),
              eq(schema.pratos.disponivel, true)
            ));

          if (pratosResult.length !== uniquePratoIds.length) {
            return await reply.code(400).send({ error: "Prato indisponível ou não encontrado." });
          }

          for (const p of pratosResult) {
            pratoPriceMap.set(p.id, p.preco);
          }

          const calculatedTotal = request.body.itens.reduce((sum, item) => {
            const preco = parseFloat(pratoPriceMap.get(item.prato_id) ?? "0");
            return sum + (item.quantidade * preco);
          }, 0);
          initialTotal = calculatedTotal.toString();
        }

        // Use transaction to ensure all operations succeed together
        const aberturaResult = await (app.db as any).transaction(async (tx: any) => {
          // Trava a mesa, confere modo/nome e grava a comanda (services/abrir-comanda.ts)
          const abertura = await abrirComandaNaMesa(tx, {
            restauranteId,
            mesaId,
            mesaNumero: mesa.numero,
            garcomId,
            total: initialTotal,
            rotulo: request.body.rotulo ?? request.body.nome,
          });
          if (abertura.tipo !== "criada") return abertura;
          const newComanda = abertura.comanda;

          // Insert pedido items if provided
          if (request.body.itens && request.body.itens.length > 0) {
            app.logger.info({ itemCount: request.body.itens.length }, "Inserting pedido items");

            const itemsToInsert = request.body.itens.map((item) => ({
              comandaId: newComanda.id,
              pratoId: item.prato_id,
              quantidade: item.quantidade,
              precoUnitario: pratoPriceMap.get(item.prato_id) ?? "0",
              observacao: item.observacao || null,
              status: "pendente" as any,
              restauranteId,
            }));

            await tx
              .insert(schema.pedidos)
              .values(itemsToInsert);

            app.logger.info({ itemCount: request.body.itens.length }, "Pedido items inserted");

            // Update comanda total to ensure consistency with pedidos
            await tx
              .execute(sql`UPDATE comandas SET total = (
                SELECT COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0) FROM pedidos WHERE comanda_id = ${newComanda.id}
              ) WHERE id = ${newComanda.id}`);
          }

          // Update mesa status to ocupada
          await tx
            .update(schema.mesas)
            .set({ status: "ocupada" })
            .where(and(eq(schema.mesas.id, mesaId), eq(schema.mesas.restauranteId, restauranteId)));

          return abertura;
        });

        if (aberturaResult.tipo !== "criada") {
          switch (aberturaResult.tipo) {
            case "mesa_nao_encontrada":
              return await reply.code(404).send({ error: "Mesa não encontrada" });
            case "mesa_ja_tem_comanda":
              return await reply.code(409).send({ error: "Esta mesa já tem uma comanda aberta." });
            case "nome_obrigatorio":
              return await reply.code(400).send({ error: "Informe o nome da comanda." });
            case "nome_muito_longo":
              return await reply.code(400).send({ error: `O nome da comanda deve ter no máximo ${TAMANHO_MAXIMO_NOME_COMANDA} caracteres.` });
            case "nome_repetido":
              return await reply.code(409).send({ error: "Já existe uma comanda com esse nome nesta mesa." });
          }
        }
        const comanda = aberturaResult.comanda;

        app.logger.info({ comandaId: comanda.id, mesaId }, "Comanda created successfully");

        // Publish realtime event
        try {
          const restauranteId = requireTenant(authUser);
          realtimeHub.publish(restauranteId, {
            type: "comanda.created",
            entityId: comanda.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish comanda.created event");
        }

        return await reply.code(201).send({
          comanda: {
            id: comanda.id,
            mesa_id: comanda.mesaId,
            mesa_numero: comanda.mesaNumero,
            garcom_id: comanda.garcomId,
            rotulo: comanda.rotulo ?? null,
            status: comanda.status,
            total: comanda.total,
            created_at: comanda.createdAt ? new Date(comanda.createdAt).toISOString() : null,
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/comandas/:id - Get a comanda by ID with pedidos and mesa info
  app.fastify.get<{ Params: { id: string } }>(
    "/api/comandas/:id",
    {
      schema: {
        description: "Get a comanda by ID with pedidos and mesa info (requires authentication)",
        tags: ["comandas"],
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
              mesa_id: { type: "string", format: "uuid" },
              mesa_numero: { type: "number", nullable: true },
              rotulo: { type: ["string", "null"] },
              garcom_id: { type: ["string", "null"] },
              status: { type: "string" },
              total: { type: "string" },
              created_at: { type: "string", format: "date-time" },
              mesa: {
                type: "object",
                properties: {
                  numero: { type: "number" },
                },
              },
              pedidos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    prato_id: { type: "string", format: "uuid" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: "string" },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                    prato: {
                      type: "object",
                      properties: {
                        nome: { type: "string" },
                        imagem_url: { type: "string" },
                      },
                      additionalProperties: true,
                    },
                    additionalProperties: true,
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        app.logger.info({ comandaId: request.params.id }, "Getting comanda");

        // Get comanda with mesa_numero from JOIN with mesas
        const comandas = await app.db
          .select({
            id: schema.comandas.id,
            mesaId: schema.comandas.mesaId,
            mesaNumero: schema.mesas.numero,
            rotulo: schema.comandas.rotulo,
            garcomId: schema.comandas.garcomId,
            status: schema.comandas.status,
            total: schema.comandas.total,
            createdAt: schema.comandas.createdAt,
            tipo: schema.comandas.tipo,
          })
          .from(schema.comandas)
          .leftJoin(schema.mesas, eq(schema.mesas.id, schema.comandas.mesaId))
          .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (!comandas.length) {
          return await reply.code(404).send({ error: "Comanda not found" });
        }

        const c = comandas[0];

        if (c.tipo === 'delivery') {
          return await reply.code(400).send({ error: "Este é um pedido de delivery. Use a tela de Delivery." });
        }

        // Get pedidos with prato details
        const pedidos_data = await app.db
          .select({
            id: schema.pedidos.id,
            pratoId: schema.pedidos.pratoId,
            pratoNome: schema.pratos.nome,
            imagemUrl: schema.pratos.imagemUrl,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(eq(schema.pedidos.comandaId, request.params.id));

        app.logger.info({ comandaId: request.params.id, itemsCount: pedidos_data.length }, "Comanda retrieved successfully");

        return await reply.code(200).send({
          id: c.id,
          mesa_id: c.mesaId,
          mesa_numero: c.mesaNumero,
          rotulo: c.rotulo ?? null,
          garcom_id: c.garcomId,
          status: c.status,
          total: c.total,
          created_at: c.createdAt.toISOString(),
          mesa: {
            numero: c.mesaNumero,
          },
          pedidos: pedidos_data.map((p) => ({
            id: p.id,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt.toISOString(),
            prato: {
              nome: p.pratoNome,
              imagem_url: p.imagemUrl,
            },
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/comandas/:id/pedidos - Add multiple pedidos to a comanda
  app.fastify.post<{ Params: { id: string }; Body: CreatePedidosBody }>(
    "/api/comandas/:id/pedidos",
    {
      schema: {
        description: "Add multiple pedidos to a comanda (requires authentication)",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["prato_id", "quantidade", "preco_unitario"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "number" },
                  observacao: { type: "string" },
                  preco_unitario: { type: "number" },
                },
                additionalProperties: true,
              },
            },
          },
        },
        response: {
          201: {
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
                    quantidade: { type: "number" },
                    preco_unitario: { type: "string" },
                    observacao: { type: ["string", "null"] },
                    status: { type: "string" },
                    created_at: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreatePedidosBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const comandaId = request.params.id;
        const restauranteId = requireTenant(authUser);

        if (!request.body.items || !Array.isArray(request.body.items) || request.body.items.length === 0) {
          return await reply.code(400).send({ error: "items array is required and must not be empty" });
        }

        // Verify comanda exists and belongs to tenant
        const comandas = await app.db
          .select()
          .from(schema.comandas)
          .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)))
          .limit(1);

        if (!comandas.length) {
          return await reply.code(404).send({ error: "Comanda não encontrada" });
        }

        const comanda = comandas[0];

        // Delivery guard
        if (comanda.tipo === 'delivery') {
          return await reply.code(409).send({ error: "Pedido de delivery: use a tela de Delivery." });
        }

        // Status check
        if (comanda.status !== 'aberta') {
          return await reply.code(409).send({ error: "Esta comanda não está aberta." });
        }

        // Role check: cozinheiro blocked. Garçom, gerente e administrador lançam itens em qualquer
        // comanda aberta do restaurante (o cliente pode pedir a qualquer garçom; o dono da comanda não muda).
        const userRole = authUser.role?.toLowerCase() ?? "";
        if (userRole === "cozinheiro" || userRole === "kitchen") {
          return await reply.code(403).send({ error: "Sem permissão para adicionar itens a esta comanda." });
        }

        // Validate quantities
        for (const item of request.body.items) {
          if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 99) {
            return await reply.code(400).send({ error: "Quantidade inválida: deve ser um número inteiro entre 1 e 99." });
          }
        }

        // Fetch and validate pratos (ownership + availability)
        const uniquePratoIds = Array.from(new Set(request.body.items.map((item) => item.prato_id)));
        const pratosResult = await app.db
          .select({ id: schema.pratos.id, preco: schema.pratos.preco })
          .from(schema.pratos)
          .where(and(
            inArray(schema.pratos.id, uniquePratoIds),
            eq(schema.pratos.restauranteId, restauranteId),
            eq(schema.pratos.disponivel, true)
          ));

        if (pratosResult.length !== uniquePratoIds.length) {
          return await reply.code(400).send({ error: "Prato indisponível ou não encontrado." });
        }

        const pratoPriceMap = new Map<string, string>();
        for (const p of pratosResult) {
          pratoPriceMap.set(p.id, p.preco);
        }

        app.logger.info({ comandaId, itemsCount: request.body.items.length }, "Adding pedidos to comanda");

        // Insert all items using real prato prices
        const insertedPedidos = await app.db
          .insert(schema.pedidos)
          .values(
            request.body.items.map((item) => ({
              comandaId,
              pratoId: item.prato_id,
              quantidade: item.quantidade,
              precoUnitario: pratoPriceMap.get(item.prato_id) ?? "0",
              observacao: item.observacao || null,
              status: "pendente" as any,
              restauranteId,
            }))
          )
          .returning();

        // Recalculate total: SUM(quantidade * preco_unitario)
        const subtotalResult = await app.db
          .select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.comandaId, comandaId));

        const subtotalValue = subtotalResult[0]?.subtotal || "0";
        const subtotal = parseFloat(String(subtotalValue));

        const gorjetaResult = await app.db
          .select({ gorjeta: schema.comandas.gorjeta })
          .from(schema.comandas)
          .where(eq(schema.comandas.id, comandaId));

        const gorjetaValue = gorjetaResult[0]?.gorjeta || "0";
        const gorjeta = parseFloat(String(gorjetaValue));
        const total = (subtotal + gorjeta).toFixed(2);

        // Update comanda subtotal and total
        await app.db
          .update(schema.comandas)
          .set({ subtotal: subtotal.toString(), total })
          .where(and(eq(schema.comandas.id, comandaId), eq(schema.comandas.restauranteId, restauranteId)));

        app.logger.info(
          { comandaId, insertedCount: insertedPedidos.length, newTotal: total },
          "Pedidos added successfully"
        );

        // Publish realtime event for each pedido created
        try {
          for (const pedido of insertedPedidos) {
            realtimeHub.publish(restauranteId, {
              type: "pedido.created",
              entityId: pedido.id,
              occurredAt: new Date().toISOString(),
              payload: { comanda_id: comandaId, status: pedido.status },
            });
          }
        } catch (pubErr) {
          app.logger.debug({ err: pubErr }, "Failed to publish pedido.created event");
        }

        return await reply.code(201).send({
          pedidos: insertedPedidos.map((p) => ({
            id: p.id,
            comanda_id: p.comandaId,
            prato_id: p.pratoId,
            quantidade: p.quantidade,
            preco_unitario: p.precoUnitario,
            observacao: p.observacao,
            status: p.status,
            created_at: p.createdAt.toISOString(),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to add pedidos to comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/comandas/:id/gorjeta — atualizar gorjeta da comanda
  app.fastify.put<{ Params: { id: string }; Body: { gorjeta: number } }>(
    "/api/comandas/:id/gorjeta",
    async (request: FastifyRequest<{ Params: { id: string }; Body: { gorjeta: number } }>, reply: FastifyReply) => {
      try {
        const session = await customRequireAuth(app, request, reply);
        if (!session) return;
        const restauranteId = requireTenant(session);

        // Role check: cozinheiro blocked
        const userRole = session.role?.toLowerCase() ?? "";
        if (userRole === "cozinheiro" || userRole === "kitchen") {
          return await reply.code(403).send({ error: "Sem permissão para alterar a gorjeta." });
        }

        const comanda = await app.db.select().from(schema.comandas).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        if (!comanda.length) return await reply.code(404).send({ error: "Comanda não encontrada" });
        if (comanda[0].status !== "aberta") return await reply.code(400).send({ error: "Comanda não está aberta" });

        // Delivery guard
        if (comanda[0].tipo === 'delivery') {
          return await reply.code(400).send({ error: "Pedido de delivery não tem gorjeta nem taxa de serviço. A taxa de entrega já faz parte do total." });
        }

        // Value validation
        const gorjetaRaw = (request.body as any)?.gorjeta;
        const gorjetaValue = typeof gorjetaRaw === 'number' ? gorjetaRaw : parseFloat(String(gorjetaRaw ?? '0'));
        if (!isFinite(gorjetaValue) || gorjetaValue < 0) {
          return await reply.code(400).send({ error: "Gorjeta inválida: deve ser um número maior ou igual a zero." });
        }

        const subtotal = parseFloat(comanda[0].subtotal ?? "0");
        const novoTotal = subtotal + gorjetaValue;
        await app.db.update(schema.comandas).set({ total: novoTotal.toString(), gorjeta: gorjetaValue.toString() }).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        return await reply.code(200).send({ subtotal, gorjeta: gorjetaValue, total: novoTotal });
      } catch (err) {
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // POST /api/comandas/:id/fechar - Close and archive a comanda
  app.fastify.post<{ Params: { id: string }; Body: FecharComandaBody }>(
    "/api/comandas/:id/fechar",
    {
      schema: {
        description: "Close and archive a comanda with optional tip and split information",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            gorjeta: { type: "number", default: 0, minimum: 0 },
            num_pessoas: { type: "integer", default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              mesa_numero: { type: "number" },
              rotulo: { type: "string", nullable: true },
              subtotal: { type: "number" },
              gorjeta: { type: "number" },
              total_final: { type: "number" },
              num_pessoas: { type: "number", nullable: true },
              valor_por_pessoa: { type: "number", nullable: true },
              created_at: { type: "string", format: "date-time" },
              closed_at: { type: "string", format: "date-time" },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    prato_nome: { type: "string" },
                    quantidade: { type: "number" },
                    preco_unitario: { type: "number" },
                    subtotal_item: { type: "number" },
                  },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: FecharComandaBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      // Fechamento é permitido para qualquer garçom ou papel gerencial (não para cozinheiro/kitchen)
      if (
        !(await requireRole(
          session,
          ["garcom", "gerente", "administrador", "admin", "manager", "superadmin", "super_admin"],
          reply
        ))
      )
        return;

      try {
        const restauranteId = requireTenant(session);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ comandaId: request.params.id, restauranteId, closedBy: session.id, closedByRole: session.role }, "Closing and archiving comanda");

        // Parâmetros com valores padrão; a gorjeta é lida como número
        const gorjetaRaw2 = request.body?.gorjeta;
        const gorjetaValue = typeof gorjetaRaw2 === 'number' ? gorjetaRaw2 : parseFloat(String(gorjetaRaw2 ?? '0'));
        const numPessoas = request.body?.num_pessoas ?? 0;

        // Check if this is a delivery order early to provide specific error messages
        const comandaCheck = await app.db
          .select({ tipo: schema.comandas.tipo })
          .from(schema.comandas)
          .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (comandaCheck.length > 0 && comandaCheck[0].tipo === 'delivery') {
          if (gorjetaValue > 0) {
            return await reply.code(400).send({ error: "Pedido de delivery não tem gorjeta nem taxa de serviço. A taxa de entrega já faz parte do total." });
          }
          return await reply.code(400).send({ error: "Pedido de delivery não pode ser fechado por aqui. Use a tela de Delivery." });
        }

        // Validate gorjeta and num_pessoas
        if (!isFinite(gorjetaValue) || gorjetaValue < 0) {
          return await reply.code(400).send({ error: "Gorjeta inválida: deve ser um número maior ou igual a zero." });
        }
        if (!Number.isInteger(numPessoas) || numPessoas < 0) {
          return await reply.code(400).send({ error: "Número de pessoas inválido: deve ser um inteiro maior ou igual a zero." });
        }

        // Toda a regra de fechamento vive no módulo services/fechamento-comanda.ts
        const resultado = await fecharComanda(app, {
          restauranteId,
          comandaId: request.params.id,
          gorjeta: gorjetaValue,
          fechadoPor: { id: session.id, nome: session.name, role: session.role },
        });

        switch (resultado.tipo) {
          case "nao_encontrada":
            return await reply.code(404).send({ error: "Comanda not found" });
          case "tipo_nao_suportado":
            return await reply.code(409).send({ error: "Comandas de delivery não são fechadas por esta rota." });
          case "nao_aberta":
            return await reply.code(409).send({ error: "comanda não está aberta" });
          case "pagamentos_pendentes":
            return await reply.code(400).send({ error: "Existem pagamentos pendentes (ex: Pix aguardando confirmação). Confirme ou cancele antes de fechar." });
          case "pago_a_menos":
            return await reply.code(400).send({ error: `Total pago (R$ ${resultado.totalPago.toFixed(2)}) é menor que o total da comanda (R$ ${resultado.totalDevido.toFixed(2)}).` });
        }

        const valorPorPessoa = numPessoas > 0 ? resultado.totalFinal / numPessoas : null;

        return await reply.code(200).send({
          success: true,
          mesa_numero: resultado.mesaNumero,
          rotulo: resultado.rotulo ?? null,
          subtotal: resultado.subtotal,
          gorjeta: resultado.gorjeta,
          total_final: resultado.totalFinal,
          num_pessoas: numPessoas > 0 ? numPessoas : null,
          valor_por_pessoa: valorPorPessoa,
          created_at: resultado.createdAt.toISOString(),
          closed_at: resultado.closedAt.toISOString(),
          itens: resultado.itens,
          pagamentos: resultado.pagamentos,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to close and archive comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/comandas/:id/cancelar - Cancel a comanda
  app.fastify.put<{ Params: { id: string } }>(
    "/api/comandas/:id/cancelar",
    {
      schema: {
        description: "Cancel a comanda",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: { type: "object" },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ comandaId: request.params.id }, "Canceling comanda");
        const restauranteId = requireTenant(session);

        const existing = await app.db
          .select()
          .from(schema.comandas)
          .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Comanda não encontrada" });
        }

        const comanda = existing[0];

        // Status check
        if (comanda.status !== 'aberta') {
          return await reply.code(409).send({ error: "Só é possível cancelar uma comanda aberta." });
        }

        // Delivery guard
        if (comanda.tipo === 'delivery') {
          return await reply.code(409).send({ error: "Pedido de delivery: use a tela de Delivery." });
        }

        // Role check
        const userRole = session.role?.toLowerCase() ?? "";
        if (userRole === "cozinheiro" || userRole === "kitchen") {
          return await reply.code(403).send({ error: "Sem permissão para cancelar comandas." });
        }
        if (userRole === "garcom") {
          if (comanda.garcomId !== session.id) {
            return await reply.code(403).send({ error: "Você só pode cancelar suas próprias comandas." });
          }
        }
        // gerente, administrador, admin can cancel any comanda of the tenant

        // Cancela e, na mesma transação, libera a mesa só se não restar outra comanda aberta nela
        // (regra única em services/liberar-mesa.ts)
        const updated = await (app.db as any).transaction(async (tx: any) => {
          const [cancelada] = await tx
            .update(schema.comandas)
            .set({
              status: "cancelada",
              closedAt: new Date(),
            })
            .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)))
            .returning();

          await liberarMesaSeVazia(tx, cancelada.mesaId, restauranteId);
          return cancelada;
        });

        app.logger.info({ comandaId: updated.id }, "Comanda cancelled successfully");

        // Publish realtime event
        try {
          realtimeHub.publish(restauranteId, {
            type: "comanda.cancelled",
            entityId: updated.id,
            occurredAt: new Date().toISOString(),
          });
        } catch (err) {
          app.logger.error({ err }, "Failed to publish comanda.cancelled event");
        }

        return await reply.code(200).send({
          id: updated.id,
          mesa_id: updated.mesaId,
          mesa_numero: updated.mesaNumero,
          garcom_id: updated.garcomId,
          status: updated.status,
          total: updated.total,
          closed_at: updated.closedAt?.toISOString(),
          created_at: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to cancel comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/comandas/:id - Delete a comanda and all its pedidos
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/comandas/:id",
    {
      schema: {
        description: "Delete a comanda and all its pedidos",
        tags: ["comandas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: { description: "Comanda deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ comandaId: request.params.id }, "Deleting comanda");
        const restauranteId = requireTenant(session);

        const existing = await app.db
          .select()
          .from(schema.comandas)
          .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

        if (!existing.length) {
          app.logger.warn({ comandaId: request.params.id }, "Comanda not found");
          return await reply.code(404).send({ error: "Comanda não encontrada" });
        }

        const comanda = existing[0];

        // Role check
        const userRole = session.role?.toLowerCase() ?? "";
        if (userRole === "cozinheiro" || userRole === "kitchen") {
          return await reply.code(403).send({ error: "Sem permissão para excluir comandas." });
        }
        if (userRole === "garcom") {
          if (comanda.garcomId !== session.id) {
            return await reply.code(403).send({ error: "Você só pode excluir suas próprias comandas." });
          }
        }
        // gerente, administrador, admin can delete any comanda of the tenant

        // Status check
        if (comanda.status !== 'aberta') {
          return await reply.code(409).send({ error: "Só é possível excluir uma comanda aberta." });
        }

        // Items check: count non-cancelled pedidos
        const activeItemsResult = await (app.db as any).execute(
          sql`SELECT COUNT(*) as count FROM pedidos WHERE comanda_id = ${request.params.id} AND status <> 'cancelado'`
        ) as any[];
        const activeItemsCount = Number(activeItemsResult[0]?.count ?? 0);
        if (activeItemsCount > 0) {
          return await reply.code(409).send({ error: "Não é possível excluir uma comanda com itens. Cancele os itens primeiro." });
        }

        // Delete pedidos and comanda and, na mesma transação, libera a mesa só se não restar
        // outra comanda aberta nela (regra única em services/liberar-mesa.ts)
        app.logger.debug({ comandaId: request.params.id }, "Deleting pedidos for comanda");
        await (app.db as any).transaction(async (tx: any) => {
          await tx
            .delete(schema.pedidos)
            .where(and(eq(schema.pedidos.comandaId, request.params.id), eq(schema.pedidos.restauranteId, restauranteId)));

          await tx
            .delete(schema.comandas)
            .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));

          await liberarMesaSeVazia(tx, comanda.mesaId, restauranteId);
        });

        app.logger.info({ comandaId: request.params.id }, "Comanda deleted successfully");

        return await reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error, comandaId: request.params.id }, "Failed to delete comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PATCH /api/pedidos/:id/observacao - Update pedido observacao
  interface UpdateObservacaoBody {
    observacao: string;
  }

  app.fastify.patch<{ Params: { id: string }; Body: UpdateObservacaoBody }>(
    "/api/pedidos/:id/observacao",
    {
      schema: {
        description: "Update observacao for a pedido",
        tags: ["pedidos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["observacao"],
          properties: {
            observacao: { type: "string" },
          },
        },
        response: {
          200: {
            description: "Pedido updated successfully",
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              comanda_id: { type: "string", format: "uuid" },
              prato_id: { type: "string", format: "uuid" },
              quantidade: { type: "number" },
              preco_unitario: { type: "string" },
              observacao: { type: "string" },
              status: { type: "string" },
              created_at: { type: "string", format: "date-time" },
            },
            additionalProperties: true,
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateObservacaoBody }>,
      reply: FastifyReply
    ) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        app.logger.info({ pedidoId: request.params.id }, "Updating pedido observacao");
        const restauranteId = requireTenant(session);

        // Validate observacao length
        if (request.body.observacao.length > 300) {
          return await reply.code(400).send({ error: "A observação não pode ter mais de 300 caracteres." });
        }

        // Fetch pedido joining comanda for tenant isolation
        const pedidoResult = await app.db
          .select({
            id: schema.pedidos.id,
            comandaId: schema.pedidos.comandaId,
            pratoId: schema.pedidos.pratoId,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            status: schema.pedidos.status,
            createdAt: schema.pedidos.createdAt,
            comandaStatus: schema.comandas.status,
          })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)))
          .limit(1);

        if (!pedidoResult.length) {
          app.logger.warn({ pedidoId: request.params.id }, "Pedido not found");
          return await reply.code(404).send({ error: "Pedido não encontrado" });
        }

        const pedido = pedidoResult[0];

        if (pedido.status !== 'pendente') {
          return await reply.code(400).send({ error: "Só é possível alterar a observação de um item pendente." });
        }

        if (pedido.comandaStatus !== 'aberta') {
          return await reply.code(400).send({ error: "Só é possível alterar a observação de uma comanda aberta." });
        }

        const [updated] = await app.db
          .update(schema.pedidos)
          .set({
            observacao: request.body.observacao,
          })
          .where(and(eq(schema.pedidos.id, request.params.id), eq(schema.pedidos.restauranteId, restauranteId)))
          .returning();

        app.logger.info({ pedidoId: updated.id }, "Pedido observacao updated successfully");

        return await reply.code(200).send({
          id: updated.id,
          comanda_id: updated.comandaId,
          prato_id: updated.pratoId,
          quantidade: updated.quantidade,
          preco_unitario: updated.precoUnitario,
          observacao: updated.observacao,
          status: updated.status,
          created_at: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error, pedidoId: request.params.id }, "Failed to update pedido observacao");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id/comanda - Get the current open comanda for a mesa
  // (devolve UMA comanda: a mais recente. No modo "individual" use GET /api/mesas/:id/comandas)
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id/comanda",
    {
      schema: {
        description: "Get the current open comanda for a mesa with its pedidos",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comanda: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  mesa_id: { type: "string", format: "uuid" },
                  mesa_numero: { type: "number" },
                  garcom_id: { type: "string" },
                  garcom_nome: { type: "string" },
                  garcom_email: { type: "string" },
                  rotulo: { type: ["string", "null"] },
                  status: { type: "string" },
                  total: { type: "string" },
                  created_at: { type: "string", format: "date-time" },
                  pedidos: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", format: "uuid" },
                        prato_id: { type: "string", format: "uuid" },
                        prato_nome: { type: "string" },
                        prato_descricao: { type: "string" },
                        prato_imagem: { type: "string" },
                        quantidade: { type: "number" },
                        preco_unitario: { type: "string" },
                        observacao: { type: "string" },
                        status: { type: "string" },
                        created_at: { type: "string", format: "date-time" },
                      },
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const mesaId = request.params.id;
        const restauranteId = requireTenant(session);
        app.logger.info({ mesaId }, "Fetching current open comanda for mesa");

        // Validate that mesa exists and belongs to tenant
        const mesaExists = await app.db
          .select({ id: schema.mesas.id })
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, mesaId as any), eq(schema.mesas.restauranteId, restauranteId)));

        if (!mesaExists.length) {
          app.logger.warn({ mesaId }, "Mesa not found");
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Query to find the most recent open comanda with dynamic total calculation
        const comandaQuery = sql`
          SELECT
            c.id,
            c.mesa_id,
            c.mesa_numero,
            c.garcom_id,
            c.rotulo,
            c.status,
            c.created_at,
            COALESCE(u.name, us.nome, 'Garçom') AS garcom_nome,
            COALESCE(u.email, us.email) AS garcom_email,
            COALESCE(SUM(p.quantidade * p.preco_unitario) FILTER (WHERE p.status <> 'cancelado'), 0)::float as total
          FROM comandas c
          LEFT JOIN "user" u ON u.id = c.garcom_id
          LEFT JOIN usuarios us ON us.id::text = c.garcom_id
          LEFT JOIN pedidos p ON p.comanda_id = c.id
          WHERE c.mesa_id = ${mesaId} AND c.status = 'aberta'
          GROUP BY c.id, c.mesa_id, c.mesa_numero, c.garcom_id, c.rotulo, c.status, c.created_at, u.name, u.email, us.nome, us.email
          ORDER BY c.created_at DESC
          LIMIT 1
        `;

        const comandaResult = await (app.db as any).execute(comandaQuery) as any[];

        if (!comandaResult || comandaResult.length === 0) {
          app.logger.info({ mesaId }, "No open comanda found for mesa");
          await reply.code(200).send({ comanda: null });
          return;
        }

        const comandaRow = comandaResult[0];

        // Extract ID - handle different column name variations from raw SQL
        let comandaId = comandaRow.comanda_id || comandaRow.id;
        if (!comandaId && Object.keys(comandaRow).length > 0) {
          // Try to find any UUID-like value in the first position (first column selected)
          const firstValue = Object.values(comandaRow)[0];
          if (typeof firstValue === 'string' && firstValue.match(/^[0-9a-f-]{36}$/i)) {
            comandaId = firstValue;
          }
        }

        if (!comandaId) {
          app.logger.error({ comandaRow, keys: Object.keys(comandaRow) }, "Could not extract comanda ID");
          return await reply.code(500).send({ error: "Failed to retrieve comanda" });
        }

        // Query to get pedidos for this comanda
        const pedidosQuery = sql`
          SELECT
            p.id,
            p.prato_id,
            p.quantidade,
            p.preco_unitario::float as preco_unitario,
            p.observacao,
            p.status,
            p.created_at,
            pr.nome AS prato_nome,
            pr.descricao AS prato_descricao,
            pr.imagem_url AS prato_imagem
          FROM pedidos p
          LEFT JOIN pratos pr ON p.prato_id = pr.id
          WHERE p.comanda_id = ${comandaId} AND p.restaurante_id = ${restauranteId}
          ORDER BY p.created_at ASC
        `;

        const pedidosResult = await (app.db as any).execute(pedidosQuery) as any[];

        app.logger.info({ comandaId, pedidoCount: pedidosResult.length }, "Comanda and pedidos retrieved");

        await reply.code(200).send({
          comanda: {
            id: comandaId,
            mesa_id: comandaRow.mesa_id,
            mesa_numero: comandaRow.mesa_numero,
            garcom_id: comandaRow.garcom_id,
            garcom_nome: comandaRow.garcom_nome,
            garcom_email: comandaRow.garcom_email,
            rotulo: comandaRow.rotulo ?? null,
            status: comandaRow.status,
            total: comandaRow.total,
            created_at: comandaRow.created_at ? new Date(comandaRow.created_at).toISOString() : null,
            pedidos: pedidosResult.map((p: any) => ({
              id: p.id,
              prato_id: p.prato_id,
              prato_nome: p.prato_nome,
              prato_descricao: p.prato_descricao,
              prato_imagem: p.prato_imagem,
              quantidade: p.quantidade,
              preco_unitario: p.preco_unitario,
              observacao: p.observacao,
              status: p.status,
              created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
            })),
          },
        });
        return;
      } catch (error) {
        app.logger.error({ err: error, mesaId: request.params.id }, "Failed to fetch comanda for mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id/comandas - Lista TODAS as comandas abertas da mesa (modo "individual" tem várias)
  // Mesma regra de acesso de GET /api/mesas/:id/comanda: qualquer usuário autenticado do restaurante,
  // porque no atendimento da mesa o garçom precisa ver todas as comandas dela.
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id/comandas",
    {
      schema: {
        description: "List all open comandas of a mesa (with name, waiter, total and item count)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              mesa: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  numero: { type: "number" },
                  status: { type: "string" },
                },
              },
              modo_comanda: { type: "string", enum: ["mesa", "individual"] },
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    mesa_id: { type: "string", format: "uuid" },
                    mesa_numero: { type: ["number", "null"] },
                    rotulo: { type: ["string", "null"] },
                    garcom_id: { type: ["string", "null"] },
                    garcom_nome: { type: "string" },
                    status: { type: "string" },
                    total: { type: "number" },
                    item_count: { type: "number" },
                    created_at: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const mesaId = request.params.id;
        const restauranteId = requireTenant(session);

        const mesas = await app.db
          .select({ id: schema.mesas.id, numero: schema.mesas.numero, status: schema.mesas.status })
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, mesaId as any), eq(schema.mesas.restauranteId, restauranteId)));

        if (!mesas.length) {
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        const modos = await app.db
          .select({ modoComanda: schema.restaurante.modoComanda })
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, restauranteId))
          .limit(1);

        const resultado = (await (app.db as any).execute(sql`
          SELECT
            c.id,
            c.mesa_id,
            c.mesa_numero,
            c.rotulo,
            c.garcom_id,
            c.status,
            c.created_at,
            COALESCE(u.name, us.nome, 'Garçom') AS garcom_nome,
            COUNT(p.id) FILTER (WHERE p.status <> 'cancelado')::integer AS item_count,
            COALESCE(SUM(p.quantidade * p.preco_unitario) FILTER (WHERE p.status <> 'cancelado'), 0)::float AS total
          FROM comandas c
          LEFT JOIN "user" u ON u.id = c.garcom_id
          LEFT JOIN usuarios us ON us.id::text = c.garcom_id
          LEFT JOIN pedidos p ON p.comanda_id = c.id
          WHERE c.mesa_id = ${mesaId} AND c.restaurante_id = ${restauranteId} AND c.status = 'aberta'
          GROUP BY c.id, c.mesa_id, c.mesa_numero, c.rotulo, c.garcom_id, c.status, c.created_at, u.name, us.nome
          ORDER BY c.created_at ASC
        `)) as any;
        const linhas: any[] = Array.isArray(resultado) ? resultado : resultado?.rows ?? [];

        return await reply.code(200).send({
          mesa: { id: mesas[0].id, numero: mesas[0].numero, status: mesas[0].status },
          modo_comanda: modos[0]?.modoComanda ?? "mesa",
          comandas: linhas.map((c: any) => ({
            id: c.id,
            mesa_id: c.mesa_id,
            mesa_numero: c.mesa_numero ?? null,
            rotulo: c.rotulo ?? null,
            garcom_id: c.garcom_id ?? null,
            garcom_nome: c.garcom_nome,
            status: c.status,
            total: Number(c.total),
            item_count: Number(c.item_count),
            created_at: c.created_at ? new Date(c.created_at).toISOString() : null,
          })),
        });
      } catch (error) {
        app.logger.error({ err: error, mesaId: request.params.id }, "Failed to list comandas of mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id/historico - Get full historical data for a mesa
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id/historico",
    {
      schema: {
        description: "Get full historical data for a mesa (archived and active comandas with pedidos)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              mesa: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  numero: { type: "number" },
                  status: { type: "string" },
                  capacidade: { type: "number" },
                },
              },
              resumo: {
                type: "object",
                properties: {
                  total_arrecadado: { type: "number" },
                  total_comandas: { type: "number" },
                  total_pedidos: { type: "number" },
                  top_pratos: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        prato_nome: { type: "string" },
                        total_quantidade: { type: "number" },
                        total_receita: { type: "number" },
                      },
                    },
                  },
                },
              },
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    status: { type: "string" },
                    rotulo: { type: "string", nullable: true },
                    total: { type: "number" },
                    subtotal: { type: "number" },
                    gorjeta: { type: "number" },
                    garcom_id: { type: ["string", "null"] },
                    garcom_nome: { type: "string" },
                    created_at: { type: "string", format: "date-time", nullable: true },
                    closed_at: { type: "string", format: "date-time", nullable: true },
                    source: { type: "string", enum: ["historico", "ativa"] },
                    pedidos: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          prato_nome: { type: "string" },
                          quantidade: { type: "number" },
                          preco_unitario: { type: "number" },
                          observacao: { type: ["string", "null"] },
                          status: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const mesaId = request.params.id;
        const restauranteId = requireTenant(session);
        app.logger.info({ mesaId }, "Fetching historical data for mesa");

        // Step 1: Fetch mesa with tenant isolation
        const mesaResult = await app.db
          .select()
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, mesaId), eq(schema.mesas.restauranteId, restauranteId)))
          .limit(1);

        if (!mesaResult.length) {
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        const mesa = mesaResult[0];

        // Step 2: Fetch archived comandas with garcom names via LEFT JOIN
        const archivedComandasResult = await (app.db as any).execute(
          sql`
            SELECT
              ch.id, ch.mesa_id, ch.mesa_numero, ch.garcom_id, ch.status, ch.rotulo,
              ch.total, ch.subtotal, ch.gorjeta,
              ch.created_at, ch.closed_at, ch.archived_at,
              COALESCE(u.name, 'Não informado') as garcom_nome
            FROM comandas_historico ch
            LEFT JOIN "user" u ON u.id = ch.garcom_id
            WHERE ch.mesa_id = ${mesaId}
              AND ch.restaurante_id = ${restauranteId}
            ORDER BY ch.created_at DESC
          `
        ) as any[];

        // Step 3: Fetch active comandas with garcom names via LEFT JOIN
        const activeComandasResult = await (app.db as any).execute(
          sql`
            SELECT
              c.id, c.mesa_id, c.mesa_numero, c.garcom_id, c.status, c.rotulo,
              c.total, c.subtotal, c.gorjeta,
              c.created_at, c.closed_at,
              COALESCE(u.name, 'Não informado') as garcom_nome
            FROM comandas c
            LEFT JOIN "user" u ON u.id = c.garcom_id
            WHERE c.mesa_id = ${mesaId}
              AND c.restaurante_id = ${restauranteId}
            ORDER BY c.created_at DESC
          `
        ) as any[];

        // Collect all comanda IDs for the query below
        const archivedComandasIds = archivedComandasResult.map((c) => c.id);
        const activeComandasIds = activeComandasResult.map((c) => c.id);

        // Step 4: Fetch archived pedidos
        let archivedPedidosMap: Record<string, any[]> = {};
        if (archivedComandasIds.length > 0) {
          const archivedPedidosResult = await app.db
            .select()
            .from(schema.pedidosHistorico)
            .where(inArray(schema.pedidosHistorico.comandaId, archivedComandasIds));

          for (const pedido of archivedPedidosResult) {
            if (!archivedPedidosMap[pedido.comandaId]) {
              archivedPedidosMap[pedido.comandaId] = [];
            }
            archivedPedidosMap[pedido.comandaId].push({
              id: pedido.id,
              prato_nome: pedido.pratoNome,
              quantidade: pedido.quantidade,
              preco_unitario: parseFloat(pedido.precoUnitario || "0"),
              observacao: pedido.observacao,
              status: pedido.status,
            });
          }
        }

        // Step 5: Fetch active pedidos with prato info
        let activePedidosMap: Record<string, any[]> = {};
        if (activeComandasIds.length > 0) {
          const activePedidosResult = await app.db
            .select({
              id: schema.pedidos.id,
              comandaId: schema.pedidos.comandaId,
              quantidade: schema.pedidos.quantidade,
              precoUnitario: schema.pedidos.precoUnitario,
              observacao: schema.pedidos.observacao,
              status: schema.pedidos.status,
              pratoNome: schema.pratos.nome,
            })
            .from(schema.pedidos)
            .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
            .where(inArray(schema.pedidos.comandaId, activeComandasIds));

          for (const pedido of activePedidosResult) {
            if (!activePedidosMap[pedido.comandaId]) {
              activePedidosMap[pedido.comandaId] = [];
            }
            activePedidosMap[pedido.comandaId].push({
              id: pedido.id,
              prato_nome: pedido.pratoNome || "N/A",
              quantidade: pedido.quantidade,
              preco_unitario: parseFloat(pedido.precoUnitario || "0"),
              observacao: pedido.observacao,
              status: pedido.status,
            });
          }
        }

        // Step 6: Merge and tag comandas, sort by created_at DESC
        const allComandasWithSource = [
          ...archivedComandasResult.map((c) => ({
            ...c,
            source: "historico" as const,
          })),
          ...activeComandasResult.map((c) => ({
            ...c,
            source: "ativa" as const,
          })),
        ];

        allComandasWithSource.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateB - dateA; // DESC order
        });

        // Build comandas response with pedidos
        const comandasResponse = allComandasWithSource.map((comanda) => {
          const pedidos =
            comanda.source === "historico"
              ? archivedPedidosMap[comanda.id] || []
              : activePedidosMap[comanda.id] || [];

          const closedAtField = comanda.source === "historico" ? comanda.archived_at : comanda.closed_at;

          return {
            id: comanda.id,
            status: comanda.status,
            rotulo: comanda.rotulo ?? null,
            total: parseFloat(comanda.total || "0"),
            subtotal: parseFloat(comanda.subtotal || "0"),
            gorjeta: parseFloat(comanda.gorjeta || "0"),
            garcom_id: comanda.garcom_id || null,
            garcom_nome: comanda.garcom_nome,
            created_at: comanda.created_at ? new Date(comanda.created_at).toISOString() : null,
            closed_at: closedAtField ? new Date(closedAtField).toISOString() : null,
            source: comanda.source,
            pedidos,
          };
        });

        // Step 9: Compute resumo (using GREATEST(subtotal, total) for revenue)
        const totalArrecadado =
          archivedComandasResult.reduce((sum, c) => sum + Math.max(parseFloat(c.subtotal || "0"), parseFloat(c.total || "0")), 0) +
          activeComandasResult.reduce((sum, c) => sum + Math.max(parseFloat(c.subtotal || "0"), parseFloat(c.total || "0")), 0);

        const totalComandasCount = archivedComandasResult.length + activeComandasResult.length;

        const totalPedidosCount =
          Object.values(archivedPedidosMap).reduce((sum, pedidos) => sum + pedidos.length, 0) +
          Object.values(activePedidosMap).reduce((sum, pedidos) => sum + pedidos.length, 0);

        // Compute top_pratos from both archived and active pedidos
        let topPratosMap: Record<string, { total_quantidade: number; total_receita: number }> = {};

        // Aggregate from archived pedidos
        for (const pedido of Object.values(archivedPedidosMap).flat()) {
          const pratoNome = pedido.prato_nome;
          if (!topPratosMap[pratoNome]) {
            topPratosMap[pratoNome] = { total_quantidade: 0, total_receita: 0 };
          }
          topPratosMap[pratoNome].total_quantidade += pedido.quantidade;
          topPratosMap[pratoNome].total_receita += pedido.quantidade * pedido.preco_unitario;
        }

        // Aggregate from active pedidos
        for (const pedido of Object.values(activePedidosMap).flat()) {
          const pratoNome = pedido.prato_nome;
          if (!topPratosMap[pratoNome]) {
            topPratosMap[pratoNome] = { total_quantidade: 0, total_receita: 0 };
          }
          topPratosMap[pratoNome].total_quantidade += pedido.quantidade;
          topPratosMap[pratoNome].total_receita += pedido.quantidade * pedido.preco_unitario;
        }

        // Convert to array, sort by total_quantidade DESC, take top 10
        const topPratos = Object.entries(topPratosMap)
          .map(([prato_nome, data]) => ({
            prato_nome,
            total_quantidade: data.total_quantidade,
            total_receita: parseFloat(data.total_receita.toFixed(2)),
          }))
          .sort((a, b) => b.total_quantidade - a.total_quantidade)
          .slice(0, 10);

        app.logger.info(
          {
            mesaId,
            archivedComandasCount: archivedComandasResult.length,
            activeComandasCount: activeComandasResult.length,
            totalArrecadado,
            topPratosCount: topPratos.length,
          },
          "Historical data retrieved successfully"
        );

        return await reply.code(200).send({
          mesa: {
            id: mesa.id,
            numero: mesa.numero,
            status: mesa.status,
            capacidade: mesa.capacidade,
          },
          resumo: {
            total_arrecadado: totalArrecadado,
            total_comandas: totalComandasCount,
            total_pedidos: totalPedidosCount,
            top_pratos: topPratos,
          },
          comandas: comandasResponse,
        });
      } catch (error) {
        app.logger.error({ err: error, mesaId: request.params.id }, "Failed to fetch mesa historico");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/cozinha/comandas - Get active comandas for kitchen display (requires authentication)
  app.fastify.get(
    "/api/cozinha/comandas",
    {
      schema: {
        description: "Get all comandas for kitchen display system (requires authentication)",
        tags: ["cozinha"],
        querystring: {
          type: "object",
          properties: {
            ativas: { type: "string", enum: ["true", "false"], description: "Filter only active comandas" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    numero_comanda: { type: "string" },
                    mesa_numero: { type: "number" },
                    created_at: { type: "string", format: "date-time" },
                    garcom_id: { type: "string" },
                    garcom_nome: { type: "string" },
                    status: { type: "string" },
                    total: { type: "string" },
                    total_itens: { type: "number" },
                    tipo: { type: "string" },
                    entrega_cliente_nome: { type: "string" },
                    entrega_bairro: { type: "string" },
                    entrega_observacao: { type: "string" },
                    entrega_tempo_estimado: { type: "number" },
                    entrega_horario_limite: { type: "string" },
                    pedidos: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          prato_nome: { type: "string" },
                          tempo_preparo_min: { type: "number" },
                          quantidade: { type: "number" },
                          status: { type: "string" },
                          observacao: { type: "string" },
                          created_at: { type: "string", format: "date-time" },
                          iniciado_em: { type: "string", format: "date-time", nullable: true },
                          pronto_em: { type: "string", format: "date-time", nullable: true },
                        },
                        additionalProperties: true,
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { ativas?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;
        const filtrarAtivas = (request.query as any).ativas === "true";
        app.logger.info({ tenantId, filtrarAtivas }, "Fetching comandas for kitchen display");

        let comandasQuery;
        let pedidosQuery;

        if (filtrarAtivas) {
          // Query for active comandas only
          comandasQuery = sql`
            SELECT
              c.id,
              c.mesa_numero,
              c.garcom_id,
              c.status,
              c.total,
              c.created_at,
              c.tipo,
              COALESCE(u.nome, 'Não informado') as garcom_nome,
              e.cliente_nome   as entrega_cliente_nome,
              e.bairro         as entrega_bairro,
              e.observacao     as entrega_observacao,
              e.tempo_estimado as entrega_tempo_estimado,
              e.created_at     as entrega_created_at
            FROM comandas c
            LEFT JOIN usuarios u ON u.id::text = c.garcom_id
            LEFT JOIN LATERAL (
              SELECT cliente_nome, bairro, observacao, tempo_estimado, created_at
              FROM entregas
              WHERE comanda_id = c.id
                AND restaurante_id = c.restaurante_id
              ORDER BY created_at DESC
              LIMIT 1
            ) e ON true
            WHERE c.restaurante_id = ${tenantId}
              AND (
                (c.tipo <> 'delivery' AND c.status = 'aberta')
                OR
                (c.tipo = 'delivery' AND EXISTS (
                  SELECT 1 FROM entregas en
                  WHERE en.comanda_id = c.id
                    AND en.restaurante_id = c.restaurante_id
                    AND en.status NOT IN ('saiu_entrega', 'cancelada', 'entregue')
                ))
              )
              AND EXISTS (
                SELECT 1 FROM pedidos p2
                WHERE p2.comanda_id = c.id
                  AND p2.status IN ('pendente', 'em_preparo', 'pronto')
              )
            ORDER BY c.created_at DESC
          `;

          // Query for active pedidos only
          pedidosQuery = sql`
            SELECT
              p.id,
              p.comanda_id,
              COALESCE(pr.nome, 'Prato') as prato_nome,
              pr.tempo_preparo_min,
              p.quantidade,
              p.status,
              p.observacao,
              p.created_at,
              p.iniciado_em,
              p.pronto_em
            FROM pedidos p
            LEFT JOIN pratos pr ON pr.id = p.prato_id
            WHERE p.restaurante_id = ${tenantId}
              AND p.status IN ('pendente', 'em_preparo', 'pronto')
            ORDER BY p.created_at ASC
          `;
        } else {
          // Query to get all comandas for this tenant with garcom info from usuarios table
          comandasQuery = sql`
            SELECT
              c.id,
              c.mesa_numero,
              c.garcom_id,
              c.status,
              c.total,
              c.created_at,
              c.tipo,
              COALESCE(u.nome, 'Não informado') as garcom_nome,
              e.cliente_nome   as entrega_cliente_nome,
              e.bairro         as entrega_bairro,
              e.observacao     as entrega_observacao,
              e.tempo_estimado as entrega_tempo_estimado,
              e.created_at     as entrega_created_at
            FROM comandas c
            LEFT JOIN usuarios u ON u.id::text = c.garcom_id
            LEFT JOIN LATERAL (
              SELECT cliente_nome, bairro, observacao, tempo_estimado, created_at
              FROM entregas
              WHERE comanda_id = c.id
                AND restaurante_id = c.restaurante_id
              ORDER BY created_at DESC
              LIMIT 1
            ) e ON true
            WHERE c.restaurante_id = ${tenantId}
            ORDER BY c.created_at DESC
          `;

          // Query to get all pedidos for this tenant with prato names
          pedidosQuery = sql`
            SELECT
              p.id,
              p.comanda_id,
              COALESCE(pr.nome, 'Prato') as prato_nome,
              pr.tempo_preparo_min,
              p.quantidade,
              p.status,
              p.observacao,
              p.created_at,
              p.iniciado_em,
              p.pronto_em
            FROM pedidos p
            LEFT JOIN pratos pr ON pr.id = p.prato_id
            WHERE p.restaurante_id = ${tenantId}
            ORDER BY p.created_at ASC
          `;
        }

        const comandasResult = await (app.db as any).execute(comandasQuery) as any[];
        const pedidosResult = await (app.db as any).execute(pedidosQuery) as any[];

        // Group pedidos by comanda_id for efficient lookup
        const pedidosByComandaId = new Map<string, any[]>();
        for (const pedido of pedidosResult) {
          const comandaId = pedido.comanda_id;
          if (!pedidosByComandaId.has(comandaId)) {
            pedidosByComandaId.set(comandaId, []);
          }
          pedidosByComandaId.get(comandaId)!.push(pedido);
        }

        app.logger.info({ tenantId, count: comandasResult.length }, "Comandas retrieved for kitchen display");

        // Transform results to the expected format
        const comandas = comandasResult.map((row: any) => {
          // Extract last 8 characters of UUID and uppercase it (equivalent to RIGHT(c.id::text, 8))
          const uuidStr = String(row.id);
          const numeroComanda = uuidStr.slice(-8).toUpperCase();

          // Get pedidos for this comanda
          const comandaPedidos = pedidosByComandaId.get(row.id) || [];
          const totalItens = comandaPedidos
            .filter((p) => p.status !== "cancelado")
            .reduce((sum, p) => sum + (Number(p.quantidade) || 0), 0);

          return {
            id: row.id,
            numero_comanda: numeroComanda,
            mesa_numero: row.mesa_numero ? Number(row.mesa_numero) : null,
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            garcom_id: row.garcom_id || null,
            garcom_nome: row.garcom_nome || "Não informado",
            status: row.status,
            total: row.total,
            total_itens: totalItens,
            tipo: row.tipo || "mesa",
            entrega_cliente_nome: row.entrega_cliente_nome || null,
            entrega_bairro: row.entrega_bairro || null,
            entrega_observacao: row.entrega_observacao || null,
            entrega_tempo_estimado: row.entrega_tempo_estimado !== null && row.entrega_tempo_estimado !== undefined ? Number(row.entrega_tempo_estimado) : null,
            entrega_horario_limite: (row.entrega_created_at && row.entrega_tempo_estimado)
              ? new Date(new Date(row.entrega_created_at).getTime() + Number(row.entrega_tempo_estimado) * 60000).toISOString()
              : null,
            pedidos: comandaPedidos.map((p: any) => ({
              id: p.id,
              prato_nome: p.prato_nome || "Prato",
              tempo_preparo_min: p.tempo_preparo_min !== null && p.tempo_preparo_min !== undefined ? Number(p.tempo_preparo_min) : null,
              quantidade: Number(p.quantidade) || 0,
              status: p.status,
              observacao: p.observacao || null,
              created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
              iniciado_em: p.iniciado_em ? new Date(p.iniciado_em).toISOString() : null,
              pronto_em: p.pronto_em ? new Date(p.pronto_em).toISOString() : null,
            })),
          };
        });

        return await reply.code(200).send({ comandas });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch comandas for kitchen");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
