DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'reserva_status'
    AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."reserva_status" AS ENUM('confirmada', 'sentada', 'cancelada', 'nao_compareceu');
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurante_id" text NOT NULL,
	"mesa_id" uuid,
	"nome_pessoa" text NOT NULL,
	"telefone" text,
	"data_hora" timestamp with time zone NOT NULL,
	"numero_pessoas" integer NOT NULL,
	"observacao" text,
	"status" "reserva_status" DEFAULT 'confirmada' NOT NULL,
	"duracao" integer DEFAULT 120 NOT NULL,
	"comanda_id" uuid,
	"criado_por" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_restaurante_id_restaurante_id_fk'
    AND conrelid = 'public.reservas'::regclass
  ) THEN
    ALTER TABLE "reservas" ADD CONSTRAINT "reservas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_mesa_id_mesas_id_fk'
    AND conrelid = 'public.reservas'::regclass
  ) THEN
    ALTER TABLE "reservas" ADD CONSTRAINT "reservas_mesa_id_mesas_id_fk" FOREIGN KEY ("mesa_id") REFERENCES "public"."mesas"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_comanda_id_comandas_id_fk'
    AND conrelid = 'public.reservas'::regclass
  ) THEN
    ALTER TABLE "reservas" ADD CONSTRAINT "reservas_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reservas_restaurante_data_hora" ON "reservas" USING btree ("restaurante_id","data_hora");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reservas_mesa_data_hora" ON "reservas" USING btree ("mesa_id","data_hora");
