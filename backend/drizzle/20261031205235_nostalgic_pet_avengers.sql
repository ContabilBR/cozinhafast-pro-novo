ALTER TABLE "reservas" ADD COLUMN IF NOT EXISTS "grupo_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reservas_restaurante_grupo_id" ON "reservas" USING btree ("restaurante_id","grupo_id");
