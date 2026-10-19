import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 16; // 32 hex chars
const TOKEN_LENGTH = TOKEN_BYTES * 2;
const TOKEN_REGEX = /^[0-9a-f]{32}$/i;
const MAX_COLLISION_RETRIES = 3;

/**
 * Generate a cryptographically secure QR token (32 hex characters).
 * No collision retry here - retry at the DB layer based on UNIQUE constraint.
 */
export function generateQrToken(): string {
  const bytes = randomBytes(TOKEN_BYTES);
  return bytes.toString("hex");
}

/**
 * Validate token format: exactly 32 hex characters.
 */
export function isValidQrTokenFormat(token: unknown): boolean {
  if (typeof token !== "string") return false;
  return TOKEN_REGEX.test(token);
}

/**
 * Timing-safe comparison of two tokens.
 * Returns true if both tokens are valid strings and match.
 */
export function compareQrTokens(provided: unknown, stored: unknown): boolean {
  // Both must be strings
  if (typeof provided !== "string" || typeof stored !== "string") {
    return false;
  }

  // Both must have correct length
  if (provided.length !== TOKEN_LENGTH || stored.length !== TOKEN_LENGTH) {
    return false;
  }

  // Timing-safe comparison
  try {
    const providedBuf = Buffer.from(provided, "utf-8");
    const storedBuf = Buffer.from(stored, "utf-8");
    return timingSafeEqual(providedBuf, storedBuf);
  } catch {
    // If conversion fails, tokens don't match
    return false;
  }
}

/**
 * Check if an error is due to UNIQUE constraint violation on qr_token.
 * PostgreSQL unique constraint violations have error code 23505.
 */
export function isQrTokenCollisionError(error: any): boolean {
  // Check Drizzle ORM wrapped errors
  if (error?.cause?.code === "23505") {
    const msg = String(error?.cause?.message || "");
    return msg.includes("qr_token") || msg.includes("mesas_qr_token");
  }
  // Direct PostgreSQL error
  if (error?.code === "23505") {
    const msg = String(error?.message || "");
    return msg.includes("qr_token") || msg.includes("mesas_qr_token");
  }
  return false;
}

export const MAX_RETRIES = MAX_COLLISION_RETRIES;
