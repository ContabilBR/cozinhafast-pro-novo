DO $$ BEGIN CREATE TYPE "public"."assinatura_status" AS ENUM('trial', 'ativa', 'inadimplente', 'cancelada', 'expirada'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."plano" AS ENUM('trial', 'basico', 'profissional', 'enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN IF NOT EXISTS "plano" "plano" DEFAULT 'trial' NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN IF NOT EXISTS "assinatura_status" "assinatura_status" DEFAULT 'trial' NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN IF NOT EXISTS "assinatura_asaas_id" text;
--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN IF NOT EXISTS "trial_expira_em" timestamp with time zone;