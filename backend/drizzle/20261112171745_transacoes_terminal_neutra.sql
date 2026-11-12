ALTER TABLE "transacoes_terminal" ADD COLUMN IF NOT EXISTS "id_externo" text;--> statement-breakpoint
ALTER TABLE "transacoes_terminal" ADD COLUMN IF NOT EXISTS "dados_provedor" jsonb;--> statement-breakpoint
UPDATE "transacoes_terminal" SET "id_externo" = "atk" WHERE ("id_externo" IS NULL OR "id_externo" = '') AND "atk" IS NOT NULL AND "atk" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transacoes_terminal_restaurante_provedor_id_externo_uq" ON "transacoes_terminal" USING btree ("restaurante_id","provedor","id_externo") WHERE id_externo IS NOT NULL;
