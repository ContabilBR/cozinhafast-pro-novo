ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "subtotal" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "gorjeta" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "subtotal" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "gorjeta" numeric(10, 2) DEFAULT '0' NOT NULL;