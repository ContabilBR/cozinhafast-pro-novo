ALTER TABLE "mesas" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DEFAULT 'disponivel'::text;--> statement-breakpoint
DROP TYPE "public"."mesa_status";--> statement-breakpoint
CREATE TYPE "public"."mesa_status" AS ENUM('disponivel', 'ocupada', 'reservada');--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DEFAULT 'disponivel'::"public"."mesa_status";--> statement-breakpoint
UPDATE "mesas" SET "status" = 'disponivel' WHERE "status" = 'livre';--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DATA TYPE "public"."mesa_status" USING "status"::"public"."mesa_status";