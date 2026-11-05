CREATE TABLE IF NOT EXISTS "transacoes_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" bigserial NOT NULL,
	"restaurante_id" text NOT NULL,
	"comanda_id" uuid NOT NULL,
	"pagamento_id" uuid,
	"provedor" text DEFAULT 'stone_deeplink' NOT NULL,
	"tipo_transacao" text NOT NULL,
	"tipo_parcelamento" text,
	"parcelas" integer,
	"valor" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'iniciada' NOT NULL,
	"atk" text,
	"itk" text,
	"retorno_bruto" text,
	"retorno_em" timestamp with time zone,
	"iniciada_por_id" text,
	"iniciada_por_nome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transacoes_terminal_status" CHECK (status IN ('iniciada', 'confirmada', 'recusada', 'cancelada', 'sem_retorno')),
	CONSTRAINT "ck_transacoes_terminal_valor_positivo" CHECK (valor > 0),
	CONSTRAINT "ck_transacoes_terminal_parcelas" CHECK (parcelas IS NULL OR parcelas >= 1)
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transacoes_terminal_restaurante_id_restaurante_id_fk'
    AND conrelid = 'public.transacoes_terminal'::regclass
  ) THEN
    ALTER TABLE "transacoes_terminal" ADD CONSTRAINT "transacoes_terminal_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transacoes_terminal_order_id_uq" ON "transacoes_terminal" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transacoes_terminal_restaurante_atk_uq" ON "transacoes_terminal" USING btree ("restaurante_id","atk") WHERE atk IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transacoes_terminal_restaurante_comanda" ON "transacoes_terminal" USING btree ("restaurante_id","comanda_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transacoes_terminal_restaurante_status_created_at" ON "transacoes_terminal" USING btree ("restaurante_id","status","created_at");
