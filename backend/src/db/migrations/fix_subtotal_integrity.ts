import { sql } from "drizzle-orm";

export async function up(db: any): Promise<void> {
  // Fix comandas table: where subtotal = 0 but total > 0, set subtotal = total
  await db.execute(
    sql`UPDATE comandas SET subtotal = total WHERE subtotal = 0 AND total > 0`
  );

  // Fix comandas_historico table: where subtotal = 0 but total > 0, set subtotal = total
  await db.execute(
    sql`UPDATE comandas_historico SET subtotal = total WHERE subtotal = 0 AND total > 0`
  );
}

export async function down(db: any): Promise<void> {
  // No down migration - this is a data integrity fix that should not be reverted
}
