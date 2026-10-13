import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";

const VALID_ROLES = ["administrador", "gerente", "garcom", "cozinheiro"] as const;

interface CreateUsuarioBody {
  nome: string;
  email: string;
  senha: string;
  role?: string;
}

interface UpdateUsuarioBody {
  nome?: string;
  email?: string;
  senha?: string;
  role?: string;
}

export function registerUsuariosRoutes(app: App) {

  // GET /api/usuarios - List all usuarios
  app.fastify.get(
    "/api/usuarios",
    {
      schema: {
        description: "List all usuarios (requires authentication)",
        tags: ["usuarios"],
        response: {
          200: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    nome: { type: "string" },
                    email: { type: "string" },
                    role: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      const restauranteId = requireTenant(session);
      if (!restauranteId) {
        return await reply.code(404).send({ error: "Nenhum restaurante associado" });
      }

      try {
        app.logger.info({ restauranteId, authUserId: session.id, authUserEmail: session.email }, "Listing usuarios");

        const result = await app.db
          .select({
            id: schema.usuarios.id,
            nome: schema.usuarios.nome,
            email: schema.usuarios.email,
            role: schema.usuarios.role,
            createdAt: schema.usuarios.createdAt,
          })
          .from(schema.usuarios)
          .where(eq(schema.usuarios.restauranteId, restauranteId))
          .orderBy(schema.usuarios.nome);

        return await reply.code(200).send({
          data: result.map((u) => ({
            id: u.id,
            nome: u.nome,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt.toISOString(),
          })),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list usuarios");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/usuarios - Create a new usuario
  app.fastify.post<{ Body: CreateUsuarioBody }>(
    "/api/usuarios",
    {
      schema: {
        description: "Create a new usuario",
        tags: ["usuarios"],
        body: {
          type: "object",
          required: ["nome", "email", "senha"],
          properties: {
            nome: { type: "string" },
            email: { type: "string", format: "email" },
            senha: { type: "string" },
            role: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              nome: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateUsuarioBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply))) return;

      try {
        if (!request.body.nome || !request.body.email || !request.body.senha) {
          return await reply.code(400).send({ error: "nome, email, and senha are required" });
        }

        if (request.body.role !== undefined && !VALID_ROLES.includes(request.body.role as any)) {
          return await reply.code(400).send({ error: "role inválido" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ email: request.body.email, restauranteId, authUserId: authUser.id, authUserEmail: authUser.email }, "Creating usuario");

        const hashedPassword = await bcrypt.hash(request.body.senha, 10);

        const [usuario] = await app.db
          .insert(schema.usuarios)
          .values({
            id: randomUUID(),
            nome: request.body.nome,
            email: request.body.email,
            senhaHash: hashedPassword,
            role: request.body.role || "garcom",
            restauranteId,
            ativo: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        app.logger.info({ usuarioId: usuario.id }, "Usuario created successfully");

        return await reply.code(201).send({
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          role: usuario.role,
          createdAt: usuario.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create usuario");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/usuarios/:id - Update a usuario
  app.fastify.put<{ Params: { id: string }; Body: UpdateUsuarioBody }>(
    "/api/usuarios/:id",
    {
      schema: {
        description: "Update a usuario",
        tags: ["usuarios"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            nome: { type: "string" },
            email: { type: "string", format: "email" },
            senha: { type: "string" },
            role: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              nome: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateUsuarioBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply))) return;

      const restauranteId = requireTenant(authUser);
      if (!restauranteId) {
        return await reply.code(404).send({ error: "Nenhum restaurante associado" });
      }

      try {
        app.logger.info({ usuarioId: request.params.id }, "Updating usuario");

        if (request.body.role !== undefined && !VALID_ROLES.includes(request.body.role as any)) {
          return await reply.code(400).send({ error: "role inválido" });
        }

        const existing = await app.db
          .select()
          .from(schema.usuarios)
          .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Usuario not found" });
        }

        const updates: any = {};
        if (request.body.nome !== undefined) updates.nome = request.body.nome;
        if (request.body.email !== undefined) updates.email = request.body.email;
        if (request.body.role !== undefined) updates.role = request.body.role;
        if (request.body.senha !== undefined) {
          updates.senhaHash = await bcrypt.hash(request.body.senha, 10);
        }

        const [updated] = await app.db
          .update(schema.usuarios)
          .set(updates)
          .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)))
          .returning();

        app.logger.info({ usuarioId: updated.id }, "Usuario updated successfully");

        return await reply.code(200).send({
          id: updated.id,
          nome: updated.nome,
          email: updated.email,
          role: updated.role,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update usuario");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/usuarios/:id - Delete a usuario
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/usuarios/:id",
    {
      schema: {
        description: "Delete a usuario (requires authentication and admin/gerente role)",
        tags: ["usuarios"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: { description: "Usuario deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente", "admin", "manager", "superadmin", "super_admin"], reply))) return;

      const restauranteId = requireTenant(authUser);
      if (!restauranteId) {
        return await reply.code(404).send({ error: "Nenhum restaurante associado" });
      }

      try {
        app.logger.info({ usuarioId: request.params.id }, "Deleting usuario");

        const existing = await app.db
          .select()
          .from(schema.usuarios)
          .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Usuario not found" });
        }

        await app.db.delete(schema.usuarios).where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)));

        app.logger.info({ usuarioId: request.params.id }, "Usuario deleted successfully");

        return await reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete usuario");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/usuarios/garcons - List all garcons (waiters)
  app.fastify.get(
    "/api/usuarios/garcons",
    {
      schema: {
        description: "List all usuarios with role='garcom' (requires authentication)",
        tags: ["usuarios"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                nome: { type: "string" },
                email: { type: "string" },
                role: { type: "string" },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      const restauranteId = requireTenant(session);

      try {
        app.logger.info({ restauranteId }, "Listing garcons (usuarios with role=garcom)");

        const garcons = await app.db
          .select({
            id: schema.usuarios.id,
            nome: schema.usuarios.nome,
            email: schema.usuarios.email,
            role: schema.usuarios.role,
          })
          .from(schema.usuarios)
          .where(and(eq(schema.usuarios.role, "garcom"), eq(schema.usuarios.restauranteId, restauranteId)))
          .orderBy(schema.usuarios.nome);

        return await reply.code(200).send(
          garcons.map((g) => ({
            id: g.id,
            nome: g.nome,
            email: g.email,
            role: g.role,
          }))
        );
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list garcons");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
