DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'public') THEN
    CREATE SCHEMA public;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nfce_status') THEN
    CREATE TYPE "public"."nfce_status" AS ENUM('pendente', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'erro');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notas_fiscais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_historico_id" uuid,
	"referencia_focus" text NOT NULL,
	"status" "nfce_status" DEFAULT 'pendente' NOT NULL,
	"chave_acesso" text,
	"numero_nota" integer,
	"serie" integer,
	"xml_url" text,
	"danfe_url" text,
	"protocolo" text,
	"mensagem_sefaz" text,
	"motivo_cancelamento" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'notas_fiscais'
    AND constraint_name = 'notas_fiscais_restaurante_id_restaurante_id_fk'
  ) THEN
    ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;