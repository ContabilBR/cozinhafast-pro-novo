import { eq, inArray, or } from "drizzle-orm";
import { user as userTable } from "../db/schema/auth-schema.js";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";

/**
 * Condição SQL: a conta da tabela `user` (Better Auth) pertence ao restaurante.
 *
 * A tabela `user` não tem restaurante_id. O vínculo vem de:
 *  - `usuarios`, espelho gravado junto no cadastro do garçom (ligado pelo e-mail), ou
 *  - `profiles`, para contas antigas criadas pelo Better Auth (ligado pelo id).
 *
 * Use em listagens, edição e exclusão de garçons para que um restaurante nunca
 * enxergue nem altere garçons de outro.
 */
export function contaDoRestaurante(app: App, restauranteId: string) {
  const db = app.db as any;
  return or(
    inArray(
      userTable.email,
      db
        .select({ email: schema.usuarios.email })
        .from(schema.usuarios)
        .where(eq(schema.usuarios.restauranteId, restauranteId))
    ),
    inArray(
      userTable.id,
      db
        .select({ id: schema.profiles.userId })
        .from(schema.profiles)
        .where(eq(schema.profiles.restauranteId, restauranteId))
    )
  )!;
}
