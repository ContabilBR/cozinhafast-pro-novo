import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, desc, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireSuperAdmin } from "../utils/auth.js";
import { verifyAndAttachUser } from "./auth-custom.js";
import { randomUUID } from "crypto";
import { cnpjValido, somenteDigitosCnpj } from "../utils/cnpj.js";
import * as bcryptjs from "bcryptjs";

interface GetRestaurantesResponse {
  id: string;
  nome: string;
  cnpj: string | null;
  uf: string | null;
  assinatura_status: string;
  created_at: Date;
  email_responsavel: string | null;
  ativo: boolean;
}

interface CreateRestauranteBody {
  nome: string;
  cnpj?: string;
  telefone?: string;
  uf?: string;
  responsavelNome: string;
  responsavelEmail: string;
  responsavelSenha: string;
  responsavelRole: "administrador" | "gerente";
}

interface UpdateRestauranteStatusBody {
  ativo: boolean;
}

interface UpdateRestauranteAssinaturaBody {
  plano?: "trial" | "basico" | "profissional" | "enterprise";
  assinatura_status?: "trial" | "ativa" | "inadimplente" | "cancelada" | "expirada";
}

export function registerSuperAdminRoutes(app: App) {
  // GET /api/superadmin/restaurantes - List all restaurants (Super Admin only)
  app.fastify.get<{}>(
    "/api/superadmin/restaurantes",
    {
      schema: {
        description: "List all restaurants (Super Admin only)",
        tags: ["superadmin"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                nome: { type: "string" },
                cnpj: { type: "string", nullable: true },
                uf: { type: "string", nullable: true },
                assinatura_status: { type: "string" },
                created_at: { type: "string", format: "date-time" },
                email_responsavel: { type: "string", nullable: true },
                ativo: { type: "boolean" },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      app.logger.info("GET /api/superadmin/restaurantes - Fetching all restaurants");

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!(await requireSuperAdmin(request, reply))) return;

      try {
        // Fetch all restaurants
        const restaurantes = await app.db.select().from(schema.restaurante);
        app.logger.debug(
          { count: restaurantes.length },
          "Fetched restaurants from database"
        );

        // For each restaurant, fetch the responsible user (first admin/gerente by creation date)
        const result: GetRestaurantesResponse[] = [];

        for (const rest of restaurantes) {
          const responsavelUsers = await app.db
            .select()
            .from(schema.usuarios)
            .where(
              and(
                eq(schema.usuarios.restauranteId, rest.id),
                // Match administrador OR gerente
                eq(schema.usuarios.role, "administrador")
              )
            )
            .orderBy(desc(schema.usuarios.createdAt))
            .limit(1);

          let emailResponsavel: string | null = null;

          if (responsavelUsers.length === 0) {
            // Try to find gerente if no administrador
            const gerenteUsers = await app.db
              .select()
              .from(schema.usuarios)
              .where(
                and(
                  eq(schema.usuarios.restauranteId, rest.id),
                  eq(schema.usuarios.role, "gerente")
                )
              )
              .orderBy(desc(schema.usuarios.createdAt))
              .limit(1);

            if (gerenteUsers.length > 0) {
              emailResponsavel = gerenteUsers[0].email;
            }
          } else {
            emailResponsavel = responsavelUsers[0].email;
          }

          result.push({
            id: rest.id,
            nome: rest.nome,
            cnpj: rest.cnpj || null,
            uf: rest.uf || null,
            assinatura_status: rest.assinaturaStatus,
            created_at: rest.createdAt,
            email_responsavel: emailResponsavel,
            ativo: rest.ativo,
          });
        }

        app.logger.info(
          { totalRestaurantes: result.length },
          "Returning restaurants list"
        );
        return result;
      } catch (err) {
        app.logger.error(
          { err },
          "Failed to fetch restaurants for super admin"
        );
        throw err;
      }
    }
  );

  // POST /api/superadmin/restaurantes - Create new restaurant (Super Admin only)
  app.fastify.post<{ Body: CreateRestauranteBody }>(
    "/api/superadmin/restaurantes",
    {
      schema: {
        description: "Create a new restaurant (Super Admin only)",
        tags: ["superadmin"],
        body: {
          type: "object",
          required: [
            "nome",
            "responsavelNome",
            "responsavelEmail",
            "responsavelSenha",
            "responsavelRole",
          ],
          properties: {
            nome: { type: "string" },
            cnpj: { type: "string" },
            telefone: { type: "string" },
            uf: { type: "string" },
            responsavelNome: { type: "string" },
            responsavelEmail: { type: "string", format: "email" },
            responsavelSenha: { type: "string" },
            responsavelRole: {
              type: "string",
              enum: ["administrador", "gerente"],
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              restaurante: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                },
              },
              usuario: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  nome: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
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
    async (request: FastifyRequest<{ Body: CreateRestauranteBody }>, reply: FastifyReply) => {
      const {
        nome,
        cnpj,
        telefone,
        uf,
        responsavelNome,
        responsavelEmail,
        responsavelSenha,
        responsavelRole,
      } = request.body;

      app.logger.info(
        { restauranteName: nome, responsavelEmail },
        "POST /api/superadmin/restaurantes - Creating new restaurant"
      );

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!(await requireSuperAdmin(request, reply))) return;

      try {
        // Validate required fields
        if (
          !nome ||
          !responsavelNome ||
          !responsavelEmail ||
          !responsavelSenha
        ) {
          app.logger.warn({ body: request.body }, "Missing required fields");
          return reply
            .code(400)
            .send({ error: "Missing required fields" });
        }

        // O id do restaurante é o CNPJ: obrigatório, válido e único
        const cnpjDigitos = somenteDigitosCnpj(cnpj);
        if (!cnpjValido(cnpjDigitos)) {
          return reply
            .code(400)
            .send({ error: "CNPJ inválido. Informe os 14 dígitos de um CNPJ válido." });
        }
        const existingRestaurante = await app.db
          .select({ id: schema.restaurante.id })
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, cnpjDigitos))
          .limit(1);
        if (existingRestaurante.length > 0) {
          return await reply.code(409).send({ error: "Já existe um restaurante cadastrado com este CNPJ" });
        }

        // Check if email already exists
        const existingUsuario = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.email, responsavelEmail.toLowerCase().trim()))
          .limit(1);

        if (existingUsuario.length > 0) {
          app.logger.warn(
            { responsavelEmail },
            "Email already exists in usuarios"
          );
          return await reply.code(409).send({ error: "E-mail já cadastrado" });
        }

        // Transaction: create restaurant and user
        const result = await (app.db as any).transaction(async (tx: any) => {
          // Create restaurant
          const trialExpiraEm = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          const restauranteResult = await tx
            .insert(schema.restaurante)
            .values({
              id: cnpjDigitos,
              nome,
              cnpj: cnpjDigitos,
              telefone: telefone || null,
              uf: uf || null,
              plano: "trial",
              assinaturaStatus: "trial",
              trialExpiraEm,
              ativo: true,
              ambienteFocus: 2,
              ncmPadrao: "21069090",
            })
            .returning();

          const newRestaurante = Array.isArray(restauranteResult)
            ? restauranteResult[0]
            : restauranteResult;
          app.logger.info(
            { restauranteId: newRestaurante.id, nome },
            "Restaurant created"
          );

          // Hash password
          const senhaHash = await bcryptjs.hash(responsavelSenha, 10);
          app.logger.debug({ email: responsavelEmail }, "Password hashed");

          // Create user
          const usuarioId = randomUUID();
          const now = new Date();
          const usuarioResult = await tx
            .insert(schema.usuarios)
            .values({
              id: usuarioId,
              nome: responsavelNome,
              email: responsavelEmail.toLowerCase().trim(),
              senhaHash,
              role: responsavelRole,
              restauranteId: newRestaurante.id,
              ativo: true,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const newUsuario = Array.isArray(usuarioResult)
            ? usuarioResult[0]
            : usuarioResult;
          app.logger.info(
            {
              usuarioId: newUsuario.id,
              restauranteId: newRestaurante.id,
              role: responsavelRole,
            },
            "Responsible user created"
          );

          return { restaurante: newRestaurante, usuario: newUsuario };
        });

        app.logger.info(
          { restauranteId: result.restaurante.id },
          "Restaurant creation completed successfully"
        );

        return await reply.code(201).send({
          restaurante: {
            id: result.restaurante.id,
            nome: result.restaurante.nome,
          },
          usuario: {
            id: result.usuario.id,
            nome: result.usuario.nome,
            email: result.usuario.email,
            role: result.usuario.role,
          },
        });
      } catch (err) {
        if ((err as any)?.code === "23505") {
          return await reply.code(409).send({ error: "CNPJ ou e-mail já cadastrado" });
        }
        app.logger.error(
          { err, responsavelEmail, body: request.body },
          "Failed to create restaurant"
        );
        throw err;
      }
    }
  );

  // PATCH /api/superadmin/restaurantes/:id/status - Update restaurant status (Super Admin only)
  app.fastify.patch<{
    Params: { id: string };
    Body: UpdateRestauranteStatusBody;
  }>(
    "/api/superadmin/restaurantes/:id/status",
    {
      schema: {
        description: "Update restaurant active status (Super Admin only)",
        tags: ["superadmin"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["ativo"],
          properties: {
            ativo: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              ativo: { type: "boolean" },
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
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateRestauranteStatusBody;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { ativo } = request.body;

      app.logger.info(
        { restauranteId: id, ativo },
        "PATCH /api/superadmin/restaurantes/:id/status - Updating restaurant status"
      );

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!(await requireSuperAdmin(request, reply))) return;

      try {
        // Check if restaurant exists
        const restaurantes = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, id as any));

        if (restaurantes.length === 0) {
          app.logger.warn({ restauranteId: id }, "Restaurant not found");
          return await reply.code(404).send({ error: "Restaurant not found" });
        }

        // Update restaurant status
        await app.db
          .update(schema.restaurante)
          .set({ ativo })
          .where(eq(schema.restaurante.id, id as any));

        app.logger.info(
          { restauranteId: id, ativo },
          "Restaurant status updated successfully"
        );

        return await reply.code(200).send({ success: true, ativo });
      } catch (err) {
        app.logger.error({ err, restauranteId: id }, "Failed to update restaurant status");
        throw err;
      }
    }
  );

  // PATCH /api/superadmin/restaurantes/:id/assinatura - Update restaurant subscription (Super Admin only)
  app.fastify.patch<{
    Params: { id: string };
    Body: UpdateRestauranteAssinaturaBody;
  }>(
    "/api/superadmin/restaurantes/:id/assinatura",
    {
      schema: {
        description: "Update restaurant subscription plan and status (Super Admin only)",
        tags: ["superadmin"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            plano: { type: "string", enum: ["trial", "basico", "profissional", "enterprise"], nullable: true },
            assinatura_status: { type: "string", enum: ["trial", "ativa", "inadimplente", "cancelada", "expirada"], nullable: true },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              plano: { type: "string", nullable: true },
              assinatura_status: { type: "string", nullable: true },
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
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateRestauranteAssinaturaBody;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { plano, assinatura_status } = request.body;

      app.logger.info(
        { restauranteId: id, plano, assinatura_status },
        "PATCH /api/superadmin/restaurantes/:id/assinatura - Updating restaurant subscription"
      );

      // Verify authentication and super admin status
      const isAuth = await verifyAndAttachUser(app, request, reply);
      if (!isAuth) return;

      if (!(await requireSuperAdmin(request, reply))) return;

      try {
        // Check if at least one field is provided
        if (plano === undefined && assinatura_status === undefined) {
          app.logger.warn({ restauranteId: id }, "No fields provided for update");
          return await reply.code(400).send({ error: "Nenhum campo para atualizar" });
        }

        // Check if restaurant exists
        const restaurantes = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, id as any));

        if (restaurantes.length === 0) {
          app.logger.warn({ restauranteId: id }, "Restaurant not found");
          return await reply.code(404).send({ error: "Restaurant not found" });
        }

        // Build update object with only provided fields
        const updates: any = {};
        if (plano !== undefined) updates.plano = plano;
        if (assinatura_status !== undefined) updates.assinaturaStatus = assinatura_status;

        // Update restaurant record
        await app.db
          .update(schema.restaurante)
          .set(updates)
          .where(eq(schema.restaurante.id, id as any));

        app.logger.info(
          { restauranteId: id, plano, assinatura_status },
          "Restaurant subscription updated successfully"
        );

        return await reply.code(200).send({
          success: true,
          plano: plano ?? null,
          assinatura_status: assinatura_status ?? null,
        });
      } catch (err) {
        app.logger.error({ err, restauranteId: id }, "Failed to update restaurant subscription");
        throw err;
      }
    }
  );
}
