import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, ne, and, gte, lte } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole } from "../utils/auth.js";
import { generateQrToken } from "../utils/qr-token.js";

// Teto realista para o número de uma mesa
const NUMERO_MAXIMO_MESA = 9999;

// Quantidade máxima de mesas criadas em uma única solicitação em lote
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

export function registerTableRoutes(app: App) {
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
          app.logger.warn({ tenantId, numero }, "Mesa creation refused: numero above allowed maximum");
          return await reply.code(400).send({ error: `Número da mesa inválido: o máximo permitido é ${NUMERO_MAXIMO_MESA}.` });
        }

        app.logger.info({ tenantId, numero }, "Creating mesa");

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

        let newMesa;
        let attempts = 0;
        const maxAttempts = 2; // Initial attempt + 1 retry on UNIQUE collision

        while (attempts < maxAttempts && !newMesa) {
          try {
            const qrToken = generateQrToken();
            const [mesa] = await app.db
              .insert(schema.mesas)
              .values({
                numero,
                capacidade,
                status: status as any,
                restauranteId: tenantId as any,
                qrToken,
                createdAt: new Date(),
              })
              .returning();
            newMesa = mesa;
          } catch (err) {
            attempts++;
            // Check if this is a UNIQUE constraint violation on qr_token
            const sqlstate = (err as any)?.cause?.code || (err as any)?.code;
            const isQrTokenCollision = sqlstate === "23505" &&
              (String((err as any)?.cause?.message || "").includes("mesas_qr_token_uq") ||
               String((err as any)?.message || "").includes("mesas_qr_token_uq"));

            if (isQrTokenCollision && attempts < maxAttempts) {
              // Retry once with new token
              continue;
            } else if (isQrTokenCollision) {
              // Failed twice on token collision
              app.logger.warn({ sqlstate: "23505" }, "QR token collision in mesa creation");
              return reply.code(500).send({ error: "Internal server error" });
            } else {
              // Other errors - pass through
              throw err;
            }
          }
        }

        if (!newMesa) {
          app.logger.warn({ sqlstate: "UNKNOWN" }, "Failed to create mesa");
          return await reply.code(500).send({ error: "Internal server error" });
        }

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

  // POST /api/mesas/lote - Cria várias mesas de uma vez
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
          app.logger.warn({ tenantId, numero_inicial, numero_final }, "Bulk mesa creation refused: numero above allowed maximum");
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
          app.logger.warn({ tenantId, numero_inicial, numero_final }, "Bulk mesa creation refused: numeros already exist");
          const lista = numeros.length > 10 ? `${numeros.slice(0, 10).join(", ")} e outras ${numeros.length - 10}` : numeros.join(", ");
          return reply.code(409).send({
            error: `${numeros.length === 1 ? "A mesa" : "As mesas"} ${lista} já ${numeros.length === 1 ? "existe" : "existem"}. Nenhuma mesa foi criada.`,
          });
        }

        app.logger.info({ tenantId, numero_inicial, numero_final, quantidade }, "Creating mesas in bulk");

        const agora = new Date();

        // Generate initial tokens for each mesa
        const valores = [];
        for (let i = 0; i < quantidade; i++) {
          valores.push({
            numero: numero_inicial + i,
            capacidade,
            status: "disponivel" as any,
            restauranteId: tenantId as any,
            qrToken: generateQrToken(),
            createdAt: agora,
          });
        }

        let criadas;
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts && !criadas) {
          try {
            criadas = await app.db.insert(schema.mesas).values(valores).returning();
          } catch (err) {
            attempts++;
            const sqlstate = (err as any)?.cause?.code || (err as any)?.code;
            const isQrTokenCollision = sqlstate === "23505" &&
              (String((err as any)?.cause?.message || "").includes("mesas_qr_token_uq") ||
               String((err as any)?.message || "").includes("mesas_qr_token_uq"));

            if (isQrTokenCollision && attempts < maxAttempts) {
              // Regenerate all tokens and retry
              for (let i = 0; i < valores.length; i++) {
                (valores[i] as any).qrToken = generateQrToken();
              }
              continue;
            } else if (isQrTokenCollision) {
              app.logger.warn({ sqlstate: "23505", faixa: `${numero_inicial}-${numero_final}` }, "QR token collision in bulk mesa creation");
              return reply.code(500).send({ error: "Internal server error" });
            } else {
              // Other errors - pass through
              throw err;
            }
          }
        }

        if (!criadas) {
          app.logger.warn({ sqlstate: "UNKNOWN" }, "Failed to create mesas in bulk");
          return await reply.code(500).send({ error: "Internal server error" });
        }

        app.logger.info({ tenantId, quantidade: criadas.length }, "Mesas created in bulk successfully");

        return await reply.code(201).send({
          criadas: criadas.length,
          mesas: criadas
            .sort((a, b) => a.numero - b.numero)
            .map((m) => ({ id: m.id, numero: m.numero, status: m.status, capacidade: m.capacidade })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to create mesas in bulk");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas - List all mesas for a restaurant
  app.fastify.get(
    "/api/mesas",
    {
      schema: {
        description: "Get all mesas for the authenticated restaurant",
        tags: ["mesas"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                numero: { type: "number" },
                status: { type: "string" },
                capacidade: { type: "number" },
                created_at: { type: "string", format: "date-time" },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = authUser.restauranteId;
        const mesas = await app.db
          .select()
          .from(schema.mesas)
          .where(eq(schema.mesas.restauranteId, tenantId as any));

        app.logger.info({ tenantId, quantidade: mesas.length }, "Fetched mesas list");

        return await reply.code(200).send(
          mesas.map((m) => ({
            id: m.id,
            numero: m.numero,
            status: m.status,
            capacidade: m.capacidade,
            created_at: m.createdAt.toISOString(),
          }))
        );
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch mesas");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/mesas/:id - Get a specific mesa
  app.fastify.get<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Get a specific mesa by ID",
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
        const { id } = request.params;
        const tenantId = authUser.restauranteId;

        const mesa = await app.db
          .select()
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, id), eq(schema.mesas.restauranteId, tenantId as any)))
          .limit(1);

        if (mesa.length === 0) {
          return await reply.code(404).send({ error: "Mesa not found" });
        }

        const m = mesa[0];
        return await reply.code(200).send({
          id: m.id,
          numero: m.numero,
          status: m.status,
          capacidade: m.capacidade,
          created_at: m.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/mesas/:id - Delete a mesa
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/mesas/:id",
    {
      schema: {
        description: "Delete a mesa (requires admin/gerente role)",
        tags: ["mesas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const { id } = request.params;
        const tenantId = authUser.restauranteId;

        // Check permission
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

        // Check mesa exists
        const existing = await app.db
          .select()
          .from(schema.mesas)
          .where(and(eq(schema.mesas.id, id), eq(schema.mesas.restauranteId, tenantId as any)))
          .limit(1);

        if (existing.length === 0) {
          return await reply.code(404).send({ error: "Mesa not found" });
        }

        // Delete
        await app.db.delete(schema.mesas).where(and(eq(schema.mesas.id, id), eq(schema.mesas.restauranteId, tenantId as any)));

        app.logger.info({ mesaId: id, tenantId }, "Mesa deleted successfully");

        return await reply.code(200).send({ success: true });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
