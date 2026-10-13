import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";

/**
 * Unified garcom_id resolution logic.
 * Resolves the garcom_id by looking up the usuarios table by email.
 * Returns either the usuarios UUID (as text) or the authenticated user's ID (as text).
 */
export async function resolveGarcomId(
  app: App,
  authUserEmail: string,
  authUserId: string
): Promise<{ garcomId: string; usuarioId: string | null }> {
  // Look up the usuarios table to get the UUID if this user was created via custom auth
  const usuarioRecords = await app.db
    .select()
    .from(schema.usuarios)
    .where(eq(schema.usuarios.email, authUserEmail))
    .limit(1);

  const usuarioId = usuarioRecords.length > 0 ? usuarioRecords[0].id : null;
  const resolvedGarcomId = usuarioId || authUserId;

  // Log with all details as specified
  app.logger.info(
    {
      garcom_id_resolution: {
        auth_user_id: authUserId,
        auth_user_email: authUserEmail,
        usuarios_id: usuarioId || null,
        resolved_garcom_id: resolvedGarcomId,
      },
    },
    "[garcom_id resolution]"
  );

  return {
    garcomId: resolvedGarcomId,
    usuarioId,
  };
}
