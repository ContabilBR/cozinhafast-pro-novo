CREATE TABLE IF NOT EXISTS "mensagens_contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurante_id" text NOT NULL,
	"usuario_id" text,
	"usuario_nome" text NOT NULL,
	"usuario_papel" text NOT NULL,
	"restaurante_nome" text NOT NULL,
	"tipo" text NOT NULL,
	"mensagem" text NOT NULL,
	"versao_app" text,
	"plataforma" text,
	"tela_origem" text,
	"status" text DEFAULT 'recebida' NOT NULL,
	"email_aviso_enviado" boolean DEFAULT false NOT NULL,
	"email_aviso_erro" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_mensagens_contato_tipo" CHECK (tipo IN ('problema', 'sugestao', 'duvida')),
	CONSTRAINT "ck_mensagens_contato_status" CHECK (status IN ('recebida', 'em_analise', 'resolvida')),
	CONSTRAINT "ck_mensagens_contato_plataforma" CHECK (plataforma IS NULL OR plataforma IN ('android', 'ios'))
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mensagens_contato_restaurante_id_restaurante_id_fk'
    AND conrelid = 'public.mensagens_contato'::regclass
  ) THEN
    ALTER TABLE "mensagens_contato" ADD CONSTRAINT "mensagens_contato_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mensagens_contato_usuario_id_usuarios_id_fk'
    AND conrelid = 'public.mensagens_contato'::regclass
  ) THEN
    ALTER TABLE "mensagens_contato" ADD CONSTRAINT "mensagens_contato_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mensagens_contato_restaurante_created_at" ON "mensagens_contato" USING btree ("restaurante_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mensagens_contato_usuario_created_at" ON "mensagens_contato" USING btree ("usuario_id","created_at");
