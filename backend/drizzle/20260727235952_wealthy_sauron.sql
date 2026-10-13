ALTER TABLE "profiles" DROP CONSTRAINT "profiles_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
UPDATE "profiles" SET "restaurante_id" = (SELECT id FROM "restaurante" LIMIT 1) WHERE "restaurante_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;