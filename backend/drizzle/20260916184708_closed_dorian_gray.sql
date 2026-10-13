ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "fechado_por_id" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "fechado_por_nome" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "fechado_por_role" text;
