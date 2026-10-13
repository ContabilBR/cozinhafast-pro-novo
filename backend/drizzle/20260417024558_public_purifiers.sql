CREATE TABLE IF NOT EXISTS "categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text,
	"role" text DEFAULT 'garcom' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DEFAULT 'livre'::text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."mesa_status";--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."mesa_status" AS ENUM('livre', 'ocupada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DEFAULT 'livre'::"public"."mesa_status";--> statement-breakpoint
UPDATE "mesas" SET "status" = 'livre' WHERE "status" = 'disponivel';--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "status" SET DATA TYPE "public"."mesa_status" USING "status"::"public"."mesa_status";--> statement-breakpoint
ALTER TABLE "mesas" ADD COLUMN IF NOT EXISTS "capacidade" integer DEFAULT 4 NOT NULL;