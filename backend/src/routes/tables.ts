import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, ne, and, gte, lte } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole } from "../utils/auth.js";

// Teto realista para o número de uma mesa. Nenhum restaurante tem mais de 9.999 mesas;
// números acima disso só aparecem por erro ou por dados de teste gravados no banco real
// (os testes automáticos usam números de 100000 em diante). Por isso o servidor recusa.
const NUMERO_MAXIMO_MESA = 9999;

// Quantidade máxima de mesas criadas em uma única solicitação em lote.
// (O app aplica o mesmo limite na tela; o servidor é quem garante.)
const MAX_MESAS_POR_LOTE = 100;

interface CreateMesaBody {
  numero: number;
  capacidade?: number;
  status?: string;
}

interface CreateMesasLoteBody {
  numero_inicial: number;
  numero_final: number;
  capacidade?: number;
}

interface UpdateMesaBody {
  numero?: number;
  status?: string;
  capacidade?: number;
}

export function registerTableRoutes(app: App) {
  // GET /api/mesas - List all mesas ordered by numero, optional status filter
  app.fastify.get<{ Querystring: { status?: string } }>(
    "/api/mesas",
    {
      schema: {
        description: "List all mesas ordered by numero with optional status filter (requires authentication)",
        tags: ["mesas"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                numero: { type: "number" },
                status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
                capacidade: { type: "number" },
                created_at: { type: "string", format: "date-time" },
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
        const tenantId = authUser.restauranteId;
        app.logger.info({ tenantId, status: request.query.status }, "Listing mesas");

        let mesasQuery = app.db
          .select()
          .from(schema.mesas)
          .where(eq(schema.mesas.restauranteId, tenantId as any))
          .orderBy(schema.mesas.numero);

        if (request.query.status) {
          mesasQuery = app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.restauranteId, tenantId as any),
              eq(schema.mesas.status, request.query.status as any)
            ))
            .orderBy(schema.mesas.numero);
        }

        const mesas = await mesasQuery;
        app.logger.info({ tenantId, count: mesas.length }, "Mesas listed successfully");

        return mesas.map((m) => ({
          id: m.id,
          numero: m.numero,
          status: m.status,
          capacidade: m.capacidade,
          created_at: m.createdAt.toISOString(),
        }));
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list mesas");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/mesas - Create a new mesa
  app.fastify.post<{ Body: CreateMesaBody }>(
    "/api/mesas",
    {
      schema: {
        description: "Create a new mesa (requires admin/gerente role)",
        tags: ["mesas"],
        body: {
          type: "object",
          required: ["numero"],
          properties: {
            numero: { type: "number" },
            capacidade: { type: "number" },
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateMesaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to create mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { numero, capacidade = 4, status = "disponivel" } = request.body;

        // Validate numero and capacidade
        if (!Number.isInteger(numero) || numero <= 0 || !Number.isInteger(capacidade) || capacidade <= 0) {
          return await reply.code(400).send({ error: "Número e capacidade devem ser inteiros maiores que zero." });
        }

        if (!numero) {
          return await reply.code(400).send({ error: "numero é obrigatório" });
        }

        if (numero > NUMERO_MAXIMO_MESA) {
          app.logger.warn({ tenantId, numero, criadoPor: authUser.id }, "Mesa creation refused: numero above allowed maximum");
          return await reply.code(400).send({ error: `Número da mesa inválido: o máximo permitido é ${NUMERO_MAXIMO_MESA}.` });
        }

        app.logger.info({ tenantId, numero, criadoPor: authUser.id, criadoPorRole: authUser.role }, "Creating mesa");

        // Check for duplicate numero within same tenant
        const existing = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.restauranteId, tenantId as any),
            eq(schema.mesas.numero, numero)
          ))
          .limit(1);

        if (existing.length > 0) {
          app.logger.warn({ tenantId, numero }, "Mesa numero already exists");
          return reply.code(409).send({ error: "Mesa com este número já existe" });
        }

        const [newMesa] = await app.db
          .insert(schema.mesas)
          .values({
            numero,
            capacidade,
            status: status as any,
            restauranteId: tenantId as any,
            createdAt: new Date(),
          })
          .returning();

        app.logger.info({ mesaId: newMesa.id, tenantId }, "Mesa created successfully");

        return await reply.code(201).send({
          id: newMesa.id,
          numero: newMesa.numero,
          status: newMesa.status,
          capacidade: newMesa.capacidade,
          created_at: newMesa.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to create mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/mesas/lote - Cria várias mesas de uma vez (do número inicial ao final)
  // Tudo ou nada: se alguma mesa da faixa já existir, nada é criado.
  app.fastify.post<{ Body: CreateMesasLoteBody }>(
    "/api/mesas/lote",
    {
      schema: {
        description: "Create several consecutive mesas at once, from numero_inicial to numero_final (requires admin/gerente role). All or nothing.",
        tags: ["mesas"],
        body: {
          type: "object",
          required: ["numero_inicial", "numero_final"],
          properties: {
            numero_inicial: { type: "number" },
            numero_final: { type: "number" },
            capacidade: { type: "number" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              criadas: { type: "number" },
              mesas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    numero: { type: "number" },
                    status: { type: "string" },
                    capacidade: { type: "number" },
                  },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateMesasLoteBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Mesma regra da criação individual: só administrador ou gerente
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to create mesas in bulk");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { numero_inicial, numero_final, capacidade = 4 } = request.body;

        if (
          !Number.isInteger(numero_inicial) || !Number.isInteger(numero_final) || !Number.isInteger(capacidade) ||
          numero_inicial <= 0 || numero_final <= 0 || capacidade <= 0
        ) {
          return await reply.code(400).send({ error: "Número inicial, número final e capacidade devem ser inteiros maiores que zero." });
        }

        if (numero_final < numero_inicial) {
          return await reply.code(400).send({ error: "O número final deve ser maior ou igual ao número inicial." });
        }

        if (numero_final > NUMERO_MAXIMO_MESA) {
          app.logger.warn({ tenantId, numero_inicial, numero_final, criadoPor: authUser.id }, "Bulk mesa creation refused: numero above allowed maximum");
          return await reply.code(400).send({ error: `Número da mesa inválido: o máximo permitido é ${NUMERO_MAXIMO_MESA}.` });
        }

        const quantidade = numero_final - numero_inicial + 1;
        if (quantidade > MAX_MESAS_POR_LOTE) {
          return await reply.code(400).send({ error: `Você pode criar no máximo ${MAX_MESAS_POR_LOTE} mesas por vez. A faixa informada tem ${quantidade}.` });
        }

        // Se alguma mesa da faixa já existir neste restaurante, recusa tudo (nada é criado)
        const existentes = await app.db
          .select({ numero: schema.mesas.numero })
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.restauranteId, tenantId as any),
            gte(schema.mesas.numero, numero_inicial),
            lte(schema.mesas.numero, numero_final)
          ));

        if (existentes.length > 0) {
          const numeros = existentes.map((m) => m.numero).sort((a, b) => a - b);
          app.logger.warn({ tenantId, numero_inicial, numero_final, conflitos: numeros }, "Bulk mesa creation refused: numeros already exist");
          const lista = numeros.length > 10 ? `${numeros.slice(0, 10).join(", ")} e outras ${numeros.length - 10}` : numeros.join(", ");
          return reply.code(409).send({
            error: `${numeros.length === 1 ? "A mesa" : "As mesas"} ${lista} já ${numeros.length === 1 ? "existe" : "existem"}. Nenhuma mesa foi criada.`,
          });
        }

        app.logger.info(
          { tenantId, numero_inicial, numero_final, quantidade, criadoPor: authUser.id, criadoPorRole: authUser.role },
          "Creating mesas in bulk"
        );

        const agora = new Date();
        const valores = Array.from({ length: quantidade }, (_, i) => ({
          numero: numero_inicial + i,
          capacidade,
          status: "disponivel" as any,
          restauranteId: tenantId as any,
          createdAt: agora,
        }));

        // Um único INSERT: ou entram todas as mesas, ou nenhuma
        const criadas = await app.db.insert(schema.mesas).values(valores).returning();

        app.logger.info({ tenantId, quantidade: criadas.length }, "Mesas created in bulk successfully");

        return await reply.code(201).send({
          criadas: criadas.length,
          mesas: criadas
            .sort((a, b) => a.numero - b.numero)
            .map((m) => ({ id: m.id, numero: m.numero, status: m.status, capacidade: m.capacidade })),
        });
      } catch (error) {
        const codigo = (error as any)?.code ?? (error as any)?.cause?.code;
        if (codigo === "23505") {
          // Outra solicitação criou uma dessas mesas ao mesmo tempo
          return await reply.code(409).send({ error: "Alguma mesa dessa faixa foi criada por outra solicitação ao mesmo tempo. Nenhuma mesa foi criada; tente novamente." });
        }
        app.logger.error({ err: error }, "Failed to create mesas in bulk");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id - Get a single mesa by ID
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Get a single mesa by ID (requires authentication)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
              created_at: { type: "string", format: "date-time" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;
        const { id } = request.params;

        app.logger.info({ tenantId, mesaId: id }, "Getting mesa");

        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (mesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        return await reply.code(200).send({
          id: mesa[0].id,
          numero: mesa[0].numero,
          status: mesa[0].status,
          capacidade: mesa[0].capacidade,
          created_at: mesa[0].createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/mesas/:id - Update a mesa
  app.fastify.put<{ Params: { id: string }; Body: UpdateMesaBody }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Update a mesa (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          properties: {
            numero: { type: "number" },
            status: { type: "string", enum: ["disponivel", "ocupada", "reservada"] },
            capacidade: { type: "number" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              numero: { type: "number" },
              status: { type: "string" },
              capacidade: { type: "number" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateMesaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to update mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { id } = request.params;
        const { numero, status, capacidade } = request.body;

        // Validate numero and capacidade when provided
        if ((numero !== undefined && (!Number.isInteger(numero) || numero <= 0)) ||
            (capacidade !== undefined && (!Number.isInteger(capacidade) || capacidade <= 0))) {
          return await reply.code(400).send({ error: "Número e capacidade devem ser inteiros maiores que zero." });
        }

        if (numero !== undefined && numero > NUMERO_MAXIMO_MESA) {
          app.logger.warn({ tenantId, mesaId: id, numero, editadoPor: authUser.id }, "Mesa update refused: numero above allowed maximum");
          return await reply.code(400).send({ error: `Número da mesa inválido: o máximo permitido é ${NUMERO_MAXIMO_MESA}.` });
        }

        app.logger.info({ tenantId, mesaId: id }, "Updating mesa");

        // Check mesa belongs to tenant
        const existingMesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (existingMesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // If setting status to "disponivel", check for open comanda
        if (status === "disponivel") {
          const openComanda = await app.db
            .select()
            .from(schema.comandas)
            .where(and(
              eq(schema.comandas.mesaId, id as any),
              eq(schema.comandas.status, "aberta" as any)
            ))
            .limit(1);

          if (openComanda.length > 0) {
            app.logger.warn({ tenantId, mesaId: id }, "Cannot set mesa to disponivel with open comanda");
            return reply.code(409).send({ error: "A mesa tem uma comanda aberta e não pode ficar disponível." });
          }
        }

        // Check for duplicate numero if changing it
        if (numero && numero !== existingMesa[0].numero) {
          const duplicate = await app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.restauranteId, tenantId as any),
              eq(schema.mesas.numero, numero),
              ne(schema.mesas.id, id as any)
            ))
            .limit(1);

          if (duplicate.length > 0) {
            app.logger.warn({ tenantId, numero }, "Duplicate mesa numero");
            return reply.code(409).send({ error: "Mesa com este número já existe" });
          }
        }

        const updateData = {
          ...(numero !== undefined && { numero }),
          ...(status && { status: status as any }),
          ...(capacidade !== undefined && { capacidade }),
        };

        const [updated] = await app.db
          .update(schema.mesas)
          .set(updateData)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .returning();

        app.logger.info({ mesaId: id }, "Mesa updated successfully");

        return await reply.code(200).send({
          id: updated.id,
          numero: updated.numero,
          status: updated.status,
          capacidade: updated.capacidade,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/mesas/:id - Delete a mesa with cascading delete
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Delete a mesa with cascading delete (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          204: { description: "Mesa deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;

        // Check current database role
        const authUserProfile = await app.db
          .select()
          .from(schema.profiles)
          .where(and(
            eq(schema.profiles.userId, authUser.id),
            eq(schema.profiles.restauranteId, tenantId as any)
          ))
          .limit(1);

        const dbRole = authUserProfile.length > 0 ? authUserProfile[0].role?.toLowerCase() : authUser.role?.toLowerCase();
        const isAdmin = ["admin", "administrador", "gerente"].includes(dbRole ?? "");

        if (!isAdmin) {
          app.logger.warn({ tenantId }, "User lacks permission to delete mesa");
          return reply.code(403).send({ error: "Forbidden" });
        }

        const { id } = request.params;

        app.logger.info({ tenantId, mesaId: id }, "Deleting mesa");

        // Check mesa belongs to tenant
        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.id, id as any),
            eq(schema.mesas.restauranteId, tenantId as any)
          ))
          .limit(1);

        if (mesa.length === 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Mesa not found");
          return await reply.code(404).send({ error: "Mesa não encontrada" });
        }

        // Check for open comanda
        const openComanda = await app.db
          .select()
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.mesaId, id as any),
            eq(schema.comandas.status, "aberta" as any)
          ))
          .limit(1);

        if (openComanda.length > 0) {
          app.logger.warn({ tenantId, mesaId: id }, "Cannot delete mesa with open comanda");
          return reply.code(409).send({ error: "Esta mesa tem uma comanda aberta. Feche ou cancele a comanda antes de excluir a mesa." });
        }

        // Delete pedidos associated with this mesa's comandas
        const comandasForMesa = await app.db
          .select()
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.mesaId, id as any),
            eq(schema.comandas.restauranteId, tenantId as any)
          ));

        for (const comanda of comandasForMesa) {
          await app.db.delete(schema.pedidos).where(and(
            eq(schema.pedidos.comandaId, comanda.id),
            eq(schema.pedidos.restauranteId, tenantId as any)
          ));
        }

        // Delete comandas
        await app.db.delete(schema.comandas).where(and(
          eq(schema.comandas.mesaId, id as any),
          eq(schema.comandas.restauranteId, tenantId as any)
        ));

        // Delete mesa
        await app.db.delete(schema.mesas).where(and(
          eq(schema.mesas.id, id as any),
          eq(schema.mesas.restauranteId, tenantId as any)
        ));

        app.logger.info({ mesaId: id }, "Mesa deleted successfully");
        return reply.code(204).send();
      } catch (error) {
        const errorStr = JSON.stringify(error).toLowerCase();
        const isFKError = errorStr.includes('foreign key') || errorStr.includes('restrict');
        if (isFKError) {
          app.logger.warn({ err: error }, "Cannot delete mesa - has dependent records");
          return await reply.code(400).send({ error: "Não é possível deletar mesa com registros relacionados" });
        }
        app.logger.error({ err: error }, "Failed to delete mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

}
