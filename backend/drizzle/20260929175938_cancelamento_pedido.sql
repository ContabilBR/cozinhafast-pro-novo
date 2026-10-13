ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cancelado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cancelado_por_id" text;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cancelado_por_nome" text;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cancelado_por_role" text;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" text;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "motivo_cancelamento_detalhe" text;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cancelado_apos_inicio" boolean;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "cancelado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "cancelado_por_id" text;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "cancelado_por_nome" text;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "cancelado_por_role" text;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" text;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "motivo_cancelamento_detalhe" text;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "cancelado_apos_inicio" boolean;
