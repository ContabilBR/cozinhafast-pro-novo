import { sql } from "drizzle-orm";

export async function up(db: any): Promise<void> {
  // Add discount fields to comandas table
  await db.execute(
    sql`ALTER TABLE comandas
      ADD COLUMN IF NOT EXISTS desconto_valor numeric(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS desconto_tipo text,
      ADD COLUMN IF NOT EXISTS desconto_motivo text,
      ADD COLUMN IF NOT EXISTS desconto_motivo_detalhe text,
      ADD COLUMN IF NOT EXISTS desconto_por_id text,
      ADD COLUMN IF NOT EXISTS desconto_por_nome text,
      ADD COLUMN IF NOT EXISTS desconto_em timestamp with time zone`
  );

  // Add discount fields to comandas_historico table
  await db.execute(
    sql`ALTER TABLE comandas_historico
      ADD COLUMN IF NOT EXISTS desconto_valor numeric(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS desconto_tipo text,
      ADD COLUMN IF NOT EXISTS desconto_motivo text,
      ADD COLUMN IF NOT EXISTS desconto_motivo_detalhe text,
      ADD COLUMN IF NOT EXISTS desconto_por_id text,
      ADD COLUMN IF NOT EXISTS desconto_por_nome text,
      ADD COLUMN IF NOT EXISTS desconto_em timestamp with time zone`
  );
}

export async function down(db: any): Promise<void> {
  // Remove discount fields from comandas table
  await db.execute(
    sql`ALTER TABLE comandas
      DROP COLUMN IF EXISTS desconto_valor,
      DROP COLUMN IF EXISTS desconto_tipo,
      DROP COLUMN IF EXISTS desconto_motivo,
      DROP COLUMN IF EXISTS desconto_motivo_detalhe,
      DROP COLUMN IF EXISTS desconto_por_id,
      DROP COLUMN IF EXISTS desconto_por_nome,
      DROP COLUMN IF EXISTS desconto_em`
  );

  // Remove discount fields from comandas_historico table
  await db.execute(
    sql`ALTER TABLE comandas_historico
      DROP COLUMN IF EXISTS desconto_valor,
      DROP COLUMN IF EXISTS desconto_tipo,
      DROP COLUMN IF EXISTS desconto_motivo,
      DROP COLUMN IF EXISTS desconto_motivo_detalhe,
      DROP COLUMN IF EXISTS desconto_por_id,
      DROP COLUMN IF EXISTS desconto_por_nome,
      DROP COLUMN IF EXISTS desconto_em`
  );
}
