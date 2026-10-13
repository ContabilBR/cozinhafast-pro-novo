import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql } from "drizzle-orm";
import { session as sessionTable, user as userTable } from "../db/schema/auth-schema.js";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { TEST_MODE, TEST_ADMIN_EMAIL } from "../config/test-mode.js";

export interface AuthContext {
  id: string;
  email: string;
  role: string;
  name: string;
  restauranteId: string;
}

export async function requireAuth(
  app: App,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthContext | null> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      app.logger.warn({ authHeader: authHeader?.substring(0, 20) }, "Missing or invalid authorization header");
      await reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    const token = authHeader.slice(7).trim();
    app.logger.debug({ tokenStart: token.substring(0, 20), tokenLength: token.length }, "Looking up session for token");

    // Try Better Auth session table
    let authContextOrNull: AuthContext | null = null;

    try {
      const sessions = await app.db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.token, token))
        .limit(1);

      if (sessions && sessions.length > 0) {
        const session = sessions[0];

        if (new Date(session.expiresAt) < new Date()) {
          app.logger.warn({ sessionId: session.id, expiresAt: session.expiresAt }, "Session expired");
          await reply.code(401).send({ error: "Unauthorized" });
          return null;
        }

        // Get user from user table
        const users = await app.db
          .select()
          .from(userTable)
          .where(eq(userTable.id, session.userId))
          .limit(1);

        if (users && users.length > 0) {
          const user = users[0];
          let userRole = (user as any).role ?? "garcom";

          // Get profile
          let profilesList = await app.db
            .select()
            .from(schema.profiles)
            .where(eq(schema.profiles.userId, user.id))
            .limit(1);

          if (profilesList && profilesList.length > 0) {
            userRole = profilesList[0].role;
            const rid = profilesList[0].restauranteId ? String(profilesList[0].restauranteId) : null;
            if (rid) {
              // Verificar que o restaurante referenciado existe
              const restauranteCheck = await app.db
                .select({ id: schema.restaurante.id })
                .from(schema.restaurante)
                .where(eq(schema.restaurante.id, rid))
                .limit(1);
              if (restauranteCheck.length > 0) {
                app.logger.debug({ userId: user.id, restauranteId: rid }, "User authenticated via Better Auth");
                authContextOrNull = {
                  id: user.id,
                  email: user.email,
                  role: userRole,
                  name: user.name || "",
                  restauranteId: rid,
                };
              } else {
                app.logger.warn({ userId: user.id, restauranteId: rid }, "Profile references non-existent restaurante");
                await reply.code(403).send({ error: "Usuário sem vínculo válido com um restaurante. Contate o administrador." });
                return null;
              }
            } else {
              app.logger.warn({ userId: user.id }, "Profile exists but has no restauranteId");
              await reply.code(403).send({ error: "Usuário sem vínculo válido com um restaurante. Contate o administrador." });
              return null;
            }
          } else {
            app.logger.warn({ userId: user.id }, "Better Auth user has no profile — denying access");
            await reply.code(403).send({ error: "Usuário sem vínculo com um restaurante. Contate o administrador." });
            return null;
          }
        }
      }
    } catch (betterAuthErr) {
      app.logger.debug({ err: betterAuthErr, token: token.substring(0, 20) }, "Better Auth session query error");
    }

    if (authContextOrNull) {
      return authContextOrNull;
    }

    // If Better Auth was not found, try custom auth as fallback
    try {
      const usuariosSessions = await app.db
        .select()
        .from(schema.usuariosSession)
        .where(eq(schema.usuariosSession.token, token))
        .limit(1);

      if (usuariosSessions && usuariosSessions.length > 0) {
        const usuarioSession = usuariosSessions[0];

        if (new Date(usuarioSession.expiresAt) < new Date()) {
          app.logger.warn({ sessionId: usuarioSession.id }, "Custom session expired");
          await reply.code(401).send({ error: "Unauthorized" });
          return null;
        }

        const usuarioResults = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.id, usuarioSession.userId as any))
          .limit(1);

        if (usuarioResults && usuarioResults.length > 0) {
          const usuario = usuarioResults[0];
          const rid = usuario.restauranteId ? String(usuario.restauranteId) : null;
          if (rid) {
            app.logger.debug({ usuarioId: usuario.id }, "User authenticated via custom auth");
            return {
              id: usuario.id.toString(),
              email: usuario.email,
              role: usuario.role,
              name: usuario.nome,
              restauranteId: rid,
            };
          }
        }
      }
    } catch (customAuthErr) {
      app.logger.debug({ err: customAuthErr }, "Custom auth session query failed");
    }

    app.logger.warn({ token: token.substring(0, 20) }, "No session found in either table");
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  } catch (error) {
    app.logger.error({ err: error }, "Auth validation failed");
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
}

export async function requireRole(
  authUserOrUser: AuthContext | any,
  allowedRolesOrProfile?: string[] | any,
  allowedRolesOrReply?: string[] | FastifyReply,
  reply?: FastifyReply
): Promise<boolean> {
  let userRole: string;
  let actualReply: FastifyReply;

  if (Array.isArray(allowedRolesOrProfile)) {
    userRole = authUserOrUser.role;
    actualReply = allowedRolesOrReply as FastifyReply;
    const allowedRoles = allowedRolesOrProfile as string[];
    const normalizedUserRole = userRole?.toLowerCase() ?? "";
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      await actualReply.code(403).send({ error: "Você não tem permissão para esta ação." });
      return false;
    }
  } else {
    userRole = allowedRolesOrProfile?.role || authUserOrUser?.role;
    actualReply = reply!;
    const allowedRoles = allowedRolesOrReply as string[];
    const normalizedUserRole = userRole?.toLowerCase() ?? "";
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      await actualReply.code(403).send({ error: "Você não tem permissão para esta ação." });
      return false;
    }
  }
  return true;
}

export function requireTenant(auth: AuthContext): string {
  if (!auth.restauranteId) {
    throw new Error("No tenant associated with this session");
  }
  return auth.restauranteId;
}

export function isSuperAdmin(email: string): boolean {
  const superAdminEmailsEnv = process.env.SUPERADMIN_EMAILS || '';
  const normalizedEmail = email.toLowerCase().trim();

  // Check if in static super admin emails list
  if (superAdminEmailsEnv.trim()) {
    const superAdminEmails = superAdminEmailsEnv
      .split(',')
      .map(e => e.trim().toLowerCase());
    if (superAdminEmails.includes(normalizedEmail)) {
      return true;
    }
  }

  // Check if test mode is enabled and email matches test admin
  if (TEST_MODE && normalizedEmail === TEST_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }

  return false;
}

export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const userEmail = (request as any).userEmail;

  if (!userEmail) {
    await reply.code(401).send({ error: 'Não autenticado' });
    return false;
  }

  if (!isSuperAdmin(userEmail)) {
    await reply.code(403).send({ error: 'Acesso restrito a Super Admin' });
    return false;
  }

  return true;
}
