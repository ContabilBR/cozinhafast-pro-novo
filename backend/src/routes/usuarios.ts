import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";
import { normalizarEmail, papelNormalizado, ehAdministrador, validarSenhaNova, PAPEIS_ADMINISTRADOR } from "../utils/credenciais.js";

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
          return await reply.code(400).send({ error: "nome, email e senha são obrigatórios" });
        }

        const emailNormalizado = normalizarEmail(request.body.email);
        const roleNormalizado = papelNormalizado(request.body.role || "garcom");

        if (!VALID_ROLES.includes(roleNormalizado as any)) {
          return await reply.code(400).send({ error: "role inválido" });
        }

        const authUserRoleNormalizado = papelNormalizado(authUser.role || "");
        if (ehAdministrador(roleNormalizado) && !ehAdministrador(authUserRoleNormalizado)) {
          return await reply.code(403).send({ error: "Somente o administrador pode criar outro administrador." });
        }

        const erroSenha = validarSenhaNova(request.body.senha);
        if (erroSenha) {
          return await reply.code(400).send({ error: erroSenha });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        app.logger.info({ email: emailNormalizado, restauranteId, authUserId: authUser.id, authUserEmail: authUser.email }, "Creating usuario");

        // Verificar se e-mail já existe em qualquer restaurante
        const existingEmail = await app.db
          .select()
          .from(schema.usuarios)
          .where(sql`LOWER(${schema.usuarios.email}) = LOWER(${emailNormalizado})`)
          .limit(1);

        if (existingEmail.length > 0) {
          return await reply.code(409).send({ error: "Este e-mail já está em uso." });
        }

        const hashedPassword = await bcrypt.hash(request.body.senha, 10);

        const [usuario] = await app.db
          .insert(schema.usuarios)
          .values({
            id: randomUUID(),
            nome: request.body.nome,
            email: emailNormalizado,
            senhaHash: hashedPassword,
            role: roleNormalizado,
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
      } catch (error: any) {
        if (error.code === "23505" || error.cause?.code === "23505") {
          app.logger.warn({ err: error }, "Email unique constraint violation");
          return await reply.code(409).send({ error: "Este e-mail já está em uso." });
        }
        app.logger.error({ err: error }, "Failed to create usuario");
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

        const roleNormalizado = request.body.role !== undefined ? papelNormalizado(request.body.role) : undefined;
        if (roleNormalizado !== undefined && !VALID_ROLES.includes(roleNormalizado as any)) {
          return await reply.code(400).send({ error: "role inválido" });
        }

        const existing = await app.db
          .select()
          .from(schema.usuarios)
          .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Usuario not found" });
        }

        const alvo = existing[0];
        const authUserRoleNormalizado = papelNormalizado(authUser.role || "");
        const isAuthUserAdmin = ehAdministrador(authUserRoleNormalizado);
        const alvoRoleNormalizado = papelNormalizado(alvo.role || "");

        if (!isAuthUserAdmin) {
          if (ehAdministrador(alvo.role)) {
            return await reply.code(403).send({ error: "Somente o administrador pode alterar um administrador." });
          }

          // Gerente: validação de mudança de papel
          if (roleNormalizado !== undefined && roleNormalizado !== alvoRoleNormalizado) {
            // Verifica se alvo é o próprio gerente que chama
            const authUserEmail = normalizarEmail(authUser.email || "");
            const alvoEmail = normalizarEmail(alvo.email || "");
            if (authUser.id === alvo.id || authUserEmail === alvoEmail) {
              return await reply.code(403).send({ error: "Você não pode alterar a sua própria função. Peça a um administrador." });
            }

            // Verifica se nova função é administrador
            if (ehAdministrador(roleNormalizado)) {
              return await reply.code(403).send({ error: "Somente o administrador pode atribuir a função de administrador." });
            }
          }
        }

        // Verificar se é rebaixamento: alvo é admin ativo, nova função é diferente e não é admin
        const ehRebaixamento = alvo.ativo && ehAdministrador(alvo.role) &&
          roleNormalizado !== undefined &&
          roleNormalizado !== alvoRoleNormalizado &&
          !ehAdministrador(roleNormalizado);

        // Validar e-mail se fornecido
        let emailNormalizado = alvo.email;
        if (request.body.email !== undefined) {
          emailNormalizado = normalizarEmail(request.body.email);
          if (!emailNormalizado) {
            return await reply.code(400).send({ error: "E-mail inválido." });
          }

          // Se o e-mail normalizado é diferente do atual, verificar unicidade
          if (emailNormalizado !== papelNormalizado(alvo.email)) {
            const existingEmail = await app.db
              .select()
              .from(schema.usuarios)
              .where(
                and(
                  sql`LOWER(${schema.usuarios.email}) = LOWER(${emailNormalizado})`,
                  sql`${schema.usuarios.id} != ${request.params.id}`
                )
              )
              .limit(1);

            if (existingEmail.length > 0) {
              return await reply.code(409).send({ error: "Este e-mail já está em uso." });
            }
          }
        }

        // Validar senha se fornecida
        if (request.body.senha !== undefined) {
          const erroSenha = validarSenhaNova(request.body.senha);
          if (erroSenha) {
            return await reply.code(400).send({ error: erroSenha });
          }
        }

        const updates: any = {};
        if (request.body.nome !== undefined) updates.nome = request.body.nome;
        if (request.body.email !== undefined) updates.email = emailNormalizado;
        if (roleNormalizado !== undefined) updates.role = roleNormalizado;
        if (request.body.senha !== undefined) {
          updates.senhaHash = await bcrypt.hash(request.body.senha, 10);
        }
        updates.updatedAt = new Date();

        let updated: any = null;

        if (ehRebaixamento) {
          const resultado = await (app.db as any).transaction(async (tx: any) => {
            const admisAtivos = await tx
              .select()
              .from(schema.usuarios)
              .where(
                and(
                  eq(schema.usuarios.restauranteId, restauranteId),
                  eq(schema.usuarios.ativo, true),
                  sql`LOWER(${schema.usuarios.role}) IN (${sql.join(PAPEIS_ADMINISTRADOR.map((r) => sql`${r}`), sql`, `)})`
                )
              )
              .for("update");

            const quantosSobram = admisAtivos.filter((a: any) => a.id !== alvo.id).length;
            if (quantosSobram === 0) {
              const authUserEmail = normalizarEmail(authUser.email || "");
              const alvoEmail = normalizarEmail(alvo.email || "");
              const ehMesmaLinha = authUser.id === alvo.id || authUserEmail === alvoEmail;
              const podeRebaixar = isAuthUserAdmin && !ehMesmaLinha;
              if (!podeRebaixar) {
                return { podeRebaixar: false, updated: null };
              }
            }

            const [updatedRow] = await tx
              .update(schema.usuarios)
              .set(updates)
              .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)))
              .returning();

            return { podeRebaixar: true, updated: updatedRow };
          });

          if (!resultado.podeRebaixar) {
            return await reply.code(409).send({
              error: "Este é o único administrador do restaurante. Promova outro usuário a administrador antes de continuar.",
            });
          }

          updated = resultado.updated;
        } else {
          const [updatedRow] = await app.db
            .update(schema.usuarios)
            .set(updates)
            .where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)))
            .returning();

          updated = updatedRow;
        }

        if (!updated) {
          return await reply.code(404).send({ error: "Usuario not found" });
        }

        app.logger.info({ usuarioId: updated.id }, "Usuario updated successfully");

        return await reply.code(200).send({
          id: updated.id,
          nome: updated.nome,
          email: updated.email,
          role: updated.role,
          createdAt: updated.createdAt.toISOString(),
        });
      } catch (error: any) {
        if (error.code === "23505" || error.cause?.code === "23505") {
          app.logger.warn({ err: error }, "Email unique constraint violation");
          return await reply.code(409).send({ error: "Este e-mail já está em uso." });
        }
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

        const alvo = existing[0];
        const authUserRoleNormalizado = papelNormalizado(authUser.role || "");

        if (ehAdministrador(alvo.role) && !ehAdministrador(authUserRoleNormalizado)) {
          return await reply.code(403).send({ error: "Somente o administrador pode excluir um administrador." });
        }

        // Proteção do último administrador se o alvo é admin ativo
        if (alvo.ativo && ehAdministrador(alvo.role)) {
          const resultado = await (app.db as any).transaction(async (tx: any) => {
            const admisAtivos = await tx
              .select()
              .from(schema.usuarios)
              .where(
                and(
                  eq(schema.usuarios.restauranteId, restauranteId),
                  eq(schema.usuarios.ativo, true),
                  sql`LOWER(${schema.usuarios.role}) IN (${sql.join(PAPEIS_ADMINISTRADOR.map((r) => sql`${r}`), sql`, `)})`
                )
              )
              .for("update");

            const quantosSobram = admisAtivos.filter((a: any) => a.id !== alvo.id).length;
            if (quantosSobram === 0) {
              const authUserEmail = normalizarEmail(authUser.email || "");
              const alvoEmail = normalizarEmail(alvo.email || "");
              const ehMesmaLinha = authUser.id === alvo.id || authUserEmail === alvoEmail;
              const podeExcluir = ehAdministrador(authUserRoleNormalizado) && !ehMesmaLinha;
              if (!podeExcluir) {
                return { podeExcluir: false };
              }
            }

            await tx.delete(schema.usuarios).where(eq(schema.usuarios.id, request.params.id));
            return { podeExcluir: true };
          });

          if (!resultado.podeExcluir) {
            return await reply.code(409).send({
              error: "Este é o único administrador do restaurante. Promova outro usuário a administrador antes de continuar.",
            });
          }
        } else {
          // Operação normal sem transação
          await app.db.delete(schema.usuarios).where(and(eq(schema.usuarios.id, request.params.id), eq(schema.usuarios.restauranteId, restauranteId)));
        }

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
