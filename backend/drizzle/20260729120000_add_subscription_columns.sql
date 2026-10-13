DO $$ BEGIN CREATE TYPE plano AS ENUM ('trial', 'basico', 'profissional', 'enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE assinatura_status AS ENUM ('trial', 'ativa', 'inadimplente', 'cancelada', 'expirada'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE restaurante ADD COLUMN IF NOT EXISTS plano plano NOT NULL DEFAULT 'trial';
--> statement-breakpoint
ALTER TABLE restaurante ADD COLUMN IF NOT EXISTS assinatura_status assinatura_status NOT NULL DEFAULT 'trial';
--> statement-breakpoint
ALTER TABLE restaurante ADD COLUMN IF NOT EXISTS assinatura_asaas_id TEXT;
--> statement-breakpoint
ALTER TABLE restaurante ADD COLUMN IF NOT EXISTS trial_expira_em TIMESTAMPTZ;
