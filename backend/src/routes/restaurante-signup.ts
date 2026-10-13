import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcrypt from "bcrypt";
import { cnpjValido, somenteDigitosCnpj } from "../utils/cnpj.js";

interface SignupBody {
  nome: string;
  cnpj?: string;
  adminNome: string;
  adminEmail: string;
  adminSenha: string;
}

// In-memory rate limiting: max 10 requests per IP per hour
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  let record = rateLimitStore.get(ip);

  if (!record || now >= record.resetTime) {
    // Reset counter
    rateLimitStore.set(ip, { count: 1, resetTime: now + ONE_HOUR });
    return true;
  }

  // Increment and check limit
  record.count += 1;
  if (record.count > 10) {
    return false;
  }

  return true;
}

export function registerRestauranteSignupRoutes(app: App) {
  app.fastify.post<{ Body: SignupBody }>(
    "/api/restaurantes/signup",
    {
      schema: {
        description: "Create a new restaurante with admin user",
        tags: ["restaurante"],
        body: {
          type: "object",
          required: ["nome", "adminNome", "adminEmail", "adminSenha"],
          properties: {
            nome: { type: "string" },
            cnpj: { type: "string" },
            adminNome: { type: "string" },
            adminEmail: { type: "string" },
            adminSenha: { type: "string" },
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
              token: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
      return await reply.code(404).send();
      const { nome, cnpj, adminNome, adminEmail, adminSenha } = request.body;

      try {
        // 0. Rate limiting check
        const clientIp = request.ip || request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || 'unknown';
        app.logger.debug({ clientIp }, "Rate limit check for signup");

        if (!checkRateLimit(clientIp)) {
          app.logger.warn({ clientIp }, "Rate limit exceeded for signup endpoint");
          return await reply.code(429).send({ error: "Muitas tentativas. Tente novamente em 1 hora." });
        }

        // 1. Validate required fields
        if (!nome || !adminNome || !adminEmail || !adminSenha) {
          app.logger.warn({ body: request.body }, "Sign up failed: missing required fields");
          return await reply.code(400).send({ error: "nome, adminNome, adminEmail, adminSenha are required" });
        }

        const cnpjDigitos = somenteDigitosCnpj(cnpj);
        if (!cnpjValido(cnpjDigitos)) {
          return await reply.code(400).send({ error: "CNPJ inválido" });
        }

        app.logger.info({ restauranteName: nome, adminEmail }, "Creating new restaurante signup");

        // 2. Check if email already exists
        const existingUsuario = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.email, adminEmail))
          .limit(1);

        if (existingUsuario.length > 0) {
          app.logger.warn({ adminEmail }, "Email already exists");
          return await reply.code(409).send({ error: "Email already exists" });
        }

        // 3. Execute transaction
        const result = await (app.db as any).transaction(async (tx: any) => {
          // 3a. Insert restaurante
          const trialExpiraEm = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          const restauranteResult = await tx
            .insert(schema.restaurante)
            .values({ id: cnpjDigitos, nome, cnpj: cnpjDigitos, plano: "trial", assinaturaStatus: "trial", trialExpiraEm })
            .returning();

          const newRestaurante = Array.isArray(restauranteResult) ? restauranteResult[0] : restauranteResult;
          app.logger.info({ restauranteId: newRestaurante.id }, "Restaurante created");

          // 3b. Hash password
          const senhaHash = await bcrypt.hash(adminSenha, 10);
          app.logger.debug({ adminEmail }, "Password hashed");

          // 3c. Insert admin usuario
          const usuarioId = randomUUID();
          const now = new Date();
          const usuarioResult = await tx
            .insert(schema.usuarios)
            .values({
              id: usuarioId,
              nome: adminNome,
              email: adminEmail,
              senhaHash,
              role: "administrador",
              restauranteId: newRestaurante.id,
              ativo: true,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const newUsuario = Array.isArray(usuarioResult) ? usuarioResult[0] : usuarioResult;
          app.logger.info({ usuarioId: newUsuario.id, restauranteId: newRestaurante.id }, "Admin usuario created");

          // 3d. Generate session token
          const token = randomUUID();
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          await tx.insert(schema.usuariosSession).values({
            token,
            userId: newUsuario.id,
            expiresAt,
          });

          app.logger.info({ restauranteId: newRestaurante.id, tokenStart: token.substring(0, 20) }, "Session token created");

          return { restaurante: newRestaurante, usuario: newUsuario, token };
        });

        app.logger.info({ restauranteId: result.restaurante.id }, "Restaurante signup completed successfully");

        return await reply.code(201).send({
          restaurante: { id: result.restaurante.id, nome: result.restaurante.nome },
          usuario: {
            id: result.usuario.id,
            nome: result.usuario.nome,
            email: result.usuario.email,
            role: result.usuario.role,
          },
          token: result.token,
        });
      } catch (error: any) {
        // Check for unique constraint violation (PostgreSQL error code 23505)
        const isUniqueConstraintError =
          error?.code === "23505" ||
          error?.message?.toLowerCase().includes("unique") ||
          error?.message?.toLowerCase().includes("duplicate") ||
          (error?.cause && (
            error.cause.code === "23505" ||
            error.cause.message?.toLowerCase().includes("unique") ||
            error.cause.message?.toLowerCase().includes("duplicate")
          ));

        if (isUniqueConstraintError) {
          app.logger.warn({ adminEmail, err: error }, "Unique constraint violation - email already exists");
          return await reply.code(409).send({ error: "Email already exists" });
        }

        app.logger.error({ err: error, adminEmail, body: request.body }, "Failed to create restaurante signup");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
