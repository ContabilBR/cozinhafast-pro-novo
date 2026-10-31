ALTER TABLE "reservas" ADD COLUMN "grupo_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_reservas_restaurante_grupo_id" ON "reservas" USING btree ("restaurante_id","grupo_id");