import { eq } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";

// === Plans Definition ===
export const PLANOS = {
  trial: { nome: "Trial", preco: 0, dias_trial: 14, max_mesas: 5, max_usuarios: 2 },
  basico: { nome: "Básico", preco: 99.90, dias_trial: 0, max_mesas: 15, max_usuarios: 5 },
  profissional: { nome: "Profissional", preco: 199.90, dias_trial: 0, max_mesas: 50, max_usuarios: 15 },
  enterprise: { nome: "Enterprise", preco: 399.90, dias_trial: 0, max_mesas: 999, max_usuarios: 999 },
};

// === Middleware ===
export async function checkAssinatura(app: App, restauranteId: string): Promise<boolean> {
  const db = app.db as any;
  const rest = await db.select({
    plano: schema.restaurante.plano,
    assinaturaStatus: schema.restaurante.assinaturaStatus,
    trialExpiraEm: schema.restaurante.trialExpiraEm,
  }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));

  if (!rest.length) return false;
  const restaurante = rest[0];

  // Check if trial expired
  if (restaurante.plano === "trial" && restaurante.trialExpiraEm) {
    if (new Date(restaurante.trialExpiraEm) < new Date()) {
      await db.update(schema.restaurante).set({ assinaturaStatus: "expirada" }).where(eq(schema.restaurante.id, restauranteId));
      return false;
    }
  }

  // Check status
  if (restaurante.assinaturaStatus === "cancelada" || restaurante.assinaturaStatus === "expirada") {
    return false;
  }

  return true;
}

export function registerAssinaturaRoutes(app: App) {
  const db = app.db as any;

  // GET /api/planos — list all available plans (public)
  app.fastify.get(
    "/api/planos",
    {
      schema: {
        description: "Get all available subscription plans",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              planos: {
                type: "object",
                properties: {
                  trial: {
                    type: "object",
                    properties: {
                      nome: { type: "string" },
                      preco: { type: "number" },
                      dias_trial: { type: "number" },
                      max_mesas: { type: "number" },
                      max_usuarios: { type: "number" },
                    },
                  },
                  basico: { type: "object" },
                  profissional: { type: "object" },
                  enterprise: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      app.logger.info("Getting available plans");
      return { planos: PLANOS };
    }
  );

  // GET /api/assinatura — get current subscription status (protected)
  app.fastify.get(
    "/api/assinatura",
    {
      schema: {
        description: "Get current subscription status",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              plano: { type: "string" },
              plano_detalhes: { type: "object" },
              assinatura_status: { type: "string" },
              trial_expira_em: { type: "string", nullable: true },
              trial_expirado: { type: "boolean" },
              assinatura_asaas_id: { type: "string", nullable: true },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return await reply.code(404).send({ error: "Restaurante não encontrado" });

        const restaurante = rest[0];
        const trialExpirado = restaurante.plano === "trial" && restaurante.trialExpiraEm ? new Date(restaurante.trialExpiraEm) < new Date() : false;

        app.logger.info({ restauranteId, plano: restaurante.plano }, "Getting subscription status");
        return await reply.code(200).send({
          plano: restaurante.plano,
          plano_detalhes: PLANOS[restaurante.plano as keyof typeof PLANOS],
          assinatura_status: restaurante.assinaturaStatus,
          trial_expira_em: restaurante.trialExpiraEm ? restaurante.trialExpiraEm.toISOString() : null,
          trial_expirado: trialExpirado,
          assinatura_asaas_id: restaurante.assinaturaAsaasId,
        });
      } catch (err) {
        app.logger.error({ err }, "Erro ao obter assinatura");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/assinatura/upgrade — upgrade plan (protected)
  app.fastify.post<{ Body: { plano: string; email: string; cpf_cnpj: string } }>(
    "/api/assinatura/upgrade",
    {
      schema: {
        description: "Upgrade to a paid subscription plan",
        tags: ["subscription"],
        body: {
          type: "object",
          properties: {
            plano: { type: "string", enum: ["basico", "profissional", "enterprise"] },
            email: { type: "string", format: "email" },
            cpf_cnpj: { type: "string" },
          },
          required: ["plano", "email", "cpf_cnpj"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              plano: { type: "string" },
              assinatura_id: { type: "string" },
              valor_mensal: { type: "number" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          502: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { plano: string; email: string; cpf_cnpj: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        // Billing with the platform itself is an owner-level action — gerente
        // and other staff roles should not be able to change the plan.
        if (!(await requireRole(authUser, ["administrador", "admin", "superadmin", "super_admin"], reply))) return;
        const restauranteId = requireTenant(authUser);

        const { plano, email, cpf_cnpj } = request.body;

        if (!["basico", "profissional", "enterprise"].includes(plano)) {
          return await reply.code(400).send({ error: "Plano inválido" });
        }

        if (!email || !cpf_cnpj) {
          return await reply.code(400).send({ error: "Email e CPF/CNPJ são obrigatórios" });
        }

        app.logger.info({ restauranteId, plano, email }, "Upgrading subscription");

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return await reply.code(404).send({ error: "Restaurante não encontrado" });

        const valor = PLANOS[plano as keyof typeof PLANOS].preco;

        await db.update(schema.restaurante).set({
          plano,
          assinaturaStatus: "ativa",
          trialExpiraEm: null,
        }).where(eq(schema.restaurante.id, restauranteId));

        app.logger.info({ restauranteId, plano }, "Subscription upgraded successfully");
        return await reply.code(200).send({
          success: true,
          plano,
          assinatura_id: null,
          valor_mensal: valor,
        });
      } catch (err) {
        app.logger.error({ err }, "Erro ao fazer upgrade");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/assinatura/cancelar — cancel subscription (protected)
  app.fastify.post(
    "/api/assinatura/cancelar",
    {
      schema: {
        description: "Cancel subscription",
        tags: ["subscription"],
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        // Billing with the platform itself is an owner-level action — gerente
        // and other staff roles should not be able to cancel the subscription.
        if (!(await requireRole(authUser, ["administrador", "admin", "superadmin", "super_admin"], reply))) return;
        const restauranteId = requireTenant(authUser);

        app.logger.info({ restauranteId }, "Cancelling subscription");

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) return await reply.code(404).send({ error: "Restaurante não encontrado" });

        await db.update(schema.restaurante).set({
          assinaturaStatus: "cancelada",
        }).where(eq(schema.restaurante.id, restauranteId));

        app.logger.info({ restauranteId }, "Subscription cancelled successfully");
        return await reply.code(200).send({
          success: true,
          message: "Assinatura cancelada",
        });
      } catch (err) {
        app.logger.error({ err }, "Erro ao cancelar assinatura");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );
}
