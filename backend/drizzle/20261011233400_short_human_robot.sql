DO $$ BEGIN CREATE TYPE "public"."modo_comanda" AS ENUM('mesa', 'individual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "rotulo" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "rotulo" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN IF NOT EXISTS "modo_comanda" "modo_comanda" DEFAULT 'mesa' NOT NULL;
