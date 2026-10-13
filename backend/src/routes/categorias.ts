import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";

interface CreateCategoriaBody {
  nome: string;
  descricao?: string;
}

interface UpdateCategoriaBody {
  nome?: string;
  descricao?: string;
}

export function registerCategoriasRoutes(app: App) {
  // GET /api/categorias - List all categories
  app.fastify.get(
    "/api/categorias",
    {
      schema: {
        description: "List all categorias (requires authentication)",
        tags: ["categorias"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                nome: { type: "string" },
                descricao: { type: "string", nullable: true },
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
        const tenantId = requireTenant(authUser);
        app.logger.info({ tenantId }, "Listing categorias");

        const result = await app.db
          .select()
          .from(schema.categorias)
          .where(eq(schema.categorias.restauranteId, tenantId as any))
          .orderBy(schema.categorias.nome);

        return await reply.code(200).send(
          result.map((c) => ({
            id: c.id,
            nome: c.nome,
            descricao: c.descricao,
            created_at: c.createdAt.toISOString(),
          }))
        );
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list categorias");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/categorias - Create a new category
  app.fastify.post<{ Body: CreateCategoriaBody }>(
    "/api/categorias",
    {
      schema: {
        description: "Create a new categoria (requires authentication)",
        tags: ["categorias"],
        body: {
          type: "object",
          required: ["nome"],
          properties: {
            nome: { type: "string" },
            descricao: { type: "string", nullable: true },
          },
        },
        response: {
          201: {
            description: "Categoria created successfully",
            type: "object",
            properties: {
              categoria: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  descricao: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateCategoriaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        if (!request.body.nome) {
          return await reply.code(400).send({ error: "nome is required" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ nome: request.body.nome, restauranteId }, "Creating categoria");

        const [categoria] = await app.db
          .insert(schema.categorias)
          .values({
            nome: request.body.nome,
            descricao: request.body.descricao,
            restauranteId,
          })
          .returning();

        app.logger.info({ categoriaId: categoria.id }, "Categoria created successfully");

        return await reply.code(201).send({
          categoria: {
            id: categoria.id,
            nome: categoria.nome,
            descricao: categoria.descricao,
            createdAt: categoria.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create categoria");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/categorias/:id - Update a category
  app.fastify.put<{ Params: { id: string }; Body: UpdateCategoriaBody }>(
    "/api/categorias/:id",
    {
      schema: {
        description: "Update a categoria (requires authentication)",
        tags: ["categorias"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            nome: { type: "string" },
            descricao: { type: "string", nullable: true },
          },
        },
        response: {
          200: {
            description: "Categoria updated successfully",
            type: "object",
            properties: {
              categoria: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  descricao: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateCategoriaBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const restauranteId = requireTenant(authUser);
        app.logger.info({ categoriaId: request.params.id }, "Updating categoria");

        const existing = await app.db
          .select()
          .from(schema.categorias)
          .where(and(eq(schema.categorias.id, request.params.id), eq(schema.categorias.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Categoria not found" });
        }

        const updates: any = {};
        if (request.body.nome !== undefined) updates.nome = request.body.nome;
        if (request.body.descricao !== undefined) updates.descricao = request.body.descricao;

        const [updated] = await app.db
          .update(schema.categorias)
          .set(updates)
          .where(eq(schema.categorias.id, request.params.id))
          .returning();

        app.logger.info({ categoriaId: updated.id }, "Categoria updated successfully");

        return await reply.code(200).send({
          categoria: {
            id: updated.id,
            nome: updated.nome,
            descricao: updated.descricao,
            createdAt: updated.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update categoria");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/categorias/:id - Delete a category
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/categorias/:id",
    {
      schema: {
        description: "Delete a categoria (requires authentication and admin/gerente role)",
        tags: ["categorias"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            description: "Categoria deleted successfully",
            type: "object",
            properties: {
              success: { type: "boolean" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const restauranteId = requireTenant(authUser);
        app.logger.info({ categoriaId: request.params.id }, "Deleting categoria");

        // Check if categoria exists
        const existing = await app.db
          .select()
          .from(schema.categorias)
          .where(and(eq(schema.categorias.id, request.params.id), eq(schema.categorias.restauranteId, restauranteId)));

        if (!existing.length) {
          app.logger.warn({ categoriaId: request.params.id }, "Categoria not found");
          return await reply.code(404).send({ error: "Category não encontrada." });
        }

        // Nullify categoria_id on all linked pratos
        await app.db
          .update(schema.pratos)
          .set({ categoriaId: null })
          .where(eq(schema.pratos.categoriaId, request.params.id));

        // Delete categoria
        await app.db.delete(schema.categorias).where(eq(schema.categorias.id, request.params.id));

        app.logger.info({ categoriaId: request.params.id }, "Categoria deleted successfully");

        return await reply.code(200).send({ success: true });
      } catch (error) {
        app.logger.error({ err: error, categoriaId: request.params.id }, "Failed to delete categoria");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
