/**
 * Manager authorization validation for sensitive operations.
 *
 * Validates manager email and password when a waiter (garçom) requests
 * to perform an action that requires manager/admin approval.
 *
 * Uses the same rate limit as discount authorization to share quota.
 */
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import { compare } from "bcryptjs";
import { increment, getCount, resetKey } from "../utils/rate-limit.js";

export interface ManagerAuthInput {
  email: string;
  senha: string;
}

export type AuthorizacaoGerente =
  | {
      valida: true;
      id: string;
      nome: string;
      role: string;
    }
  | {
      valida: false;
      motivo: "limite_de_tentativas" | "invalida";
    };

export async function validarAutorizacaoGerente(
  db: any,
  restauranteId: string,
  sessionId: string,
  sessionEmail: string,
  autorizacao: any
): Promise<AuthorizacaoGerente> {
  // Rate limit check - shared with discount authorization
  const rateLimitKey = `desconto-auth:${restauranteId}:${sessionId}`;
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  const currentCount = getCount(rateLimitKey);
  if (currentCount >= maxAttempts) {
    return { valida: false, motivo: "limite_de_tentativas" };
  }

  // Validate autorizacao structure - must be plain object with email and senha strings
  if (!autorizacao || typeof autorizacao !== "object" || Array.isArray(autorizacao)) {
    increment(rateLimitKey, windowMs);
    return { valida: false, motivo: "invalida" };
  }

  const { email: managerEmail, senha: senhaRaw } = autorizacao;

  if (typeof managerEmail !== "string" || typeof senhaRaw !== "string") {
    increment(rateLimitKey, windowMs);
    return { valida: false, motivo: "invalida" };
  }

  // Trim email and check length; check password length (bytes)
  const emailTrimmed = managerEmail.trim();
  const passwordBytes = Buffer.byteLength(senhaRaw, "utf8");

  if (emailTrimmed.length === 0 || emailTrimmed.length > 254 || passwordBytes > 200) {
    increment(rateLimitKey, windowMs);
    return { valida: false, motivo: "invalida" };
  }

  // Normalize email and check against session email to prevent self-authorization
  const emailNormalized = emailTrimmed.toLowerCase();
  if (emailNormalized === sessionEmail.toLowerCase()) {
    increment(rateLimitKey, windowMs);
    return { valida: false, motivo: "invalida" };
  }

  // Query usuario table with normalized email (using SQL lower/trim for case-insensitive comparison)
  const managers = await db
    .select({
      id: schema.usuarios.id,
      nome: schema.usuarios.nome,
      senhaHash: schema.usuarios.senhaHash,
      role: schema.usuarios.role,
      ativo: schema.usuarios.ativo,
    })
    .from(schema.usuarios)
    .where(
      and(
        eq(schema.usuarios.restauranteId, restauranteId),
        sql`LOWER(TRIM(${schema.usuarios.email})) = ${emailNormalized}`
      )
    )
    .limit(1);

  // Always perform bcrypt compare, even if user not found (timing-safe)
  // Use a realistic dummy hash if user not found
  const manager = managers.length > 0 ? managers[0] : null;
  const hashToCompare = manager?.senhaHash || "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36DvDPyE";

  const passwordValid = await compare(senhaRaw, hashToCompare);

  // Verify manager eligibility (only if password matched, for early exit)
  if (passwordValid) {
    if (!manager || !manager.ativo || !["gerente", "administrador", "admin"].includes(manager.role?.toLowerCase() ?? "")) {
      increment(rateLimitKey, windowMs);
      return { valida: false, motivo: "invalida" };
    }

    // Reset rate limit on success
    resetKey(rateLimitKey);
    return {
      valida: true,
      id: manager.id,
      nome: manager.nome,
      role: manager.role,
    };
  }

  // Password mismatch or user not eligible
  increment(rateLimitKey, windowMs);
  return { valida: false, motivo: "invalida" };
}
