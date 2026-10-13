ALTER TABLE "pratos" DROP CONSTRAINT IF EXISTS "pratos_categoria_id_categoria_pratos_id_fk";
--> statement-breakpoint
UPDATE "pratos" SET "categoria_id" = NULL WHERE "categoria_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "categorias" WHERE "categorias"."id" = "pratos"."categoria_id");
--> statement-breakpoint
ALTER TABLE "pratos" DROP CONSTRAINT IF EXISTS "pratos_categoria_id_categorias_id_fk";
--> statement-breakpoint
ALTER TABLE "pratos" ADD CONSTRAINT "pratos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE set null ON UPDATE no action;