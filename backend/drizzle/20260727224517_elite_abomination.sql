ALTER TABLE "profiles" DROP CONSTRAINT "profiles_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE set null ON UPDATE no action;