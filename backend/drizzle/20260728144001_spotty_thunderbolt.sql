ALTER TABLE "mesas" DROP CONSTRAINT "mesas_numero_unique";--> statement-breakpoint
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_numero_restaurante_id_unique" UNIQUE("numero","restaurante_id");