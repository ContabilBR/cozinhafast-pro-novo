DO $$ BEGIN
  CREATE TYPE "public"."comanda_status" AS ENUM('aberta', 'fechada', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."mesa_status" AS ENUM('disponivel', 'ocupada', 'reservada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."pedido_status" AS ENUM('pendente', 'em_preparo', 'pronto', 'entregue', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categoria_pratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comandas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mesa_id" uuid NOT NULL,
	"garcom_id" text,
	"status" "comanda_status" DEFAULT 'aberta' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mesas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer NOT NULL,
	"status" "mesa_status" DEFAULT 'disponivel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mesas_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_id" uuid NOT NULL,
	"prato_id" uuid,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"preco_unitario" numeric(10, 2) NOT NULL,
	"observacao" text,
	"status" "pedido_status" DEFAULT 'pendente' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"preco" numeric(10, 2) NOT NULL,
	"categoria_id" uuid,
	"imagem_url" text,
	"disponivel" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dishes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tables" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "action_logs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "categories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "dishes" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "order_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "orders" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tables" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "profiles_user_id_idx";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'garcom';--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" DROP CONSTRAINT IF EXISTS "comandas_mesa_id_mesas_id_fk";--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_mesa_id_mesas_id_fk" FOREIGN KEY ("mesa_id") REFERENCES "public"."mesas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" DROP CONSTRAINT IF EXISTS "comandas_garcom_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_garcom_id_user_id_fk" FOREIGN KEY ("garcom_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" DROP CONSTRAINT IF EXISTS "pedidos_comanda_id_comandas_id_fk";--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" DROP CONSTRAINT IF EXISTS "pedidos_prato_id_pratos_id_fk";--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_prato_id_pratos_id_fk" FOREIGN KEY ("prato_id") REFERENCES "public"."pratos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pratos" DROP CONSTRAINT IF EXISTS "pratos_categoria_id_categoria_pratos_id_fk";--> statement-breakpoint
UPDATE "pratos" SET "categoria_id" = NULL WHERE "categoria_id" IS NOT NULL AND "categoria_id" NOT IN (SELECT "id" FROM "categoria_pratos");--> statement-breakpoint
ALTER TABLE "pratos" ADD CONSTRAINT "pratos_categoria_id_categoria_pratos_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria_pratos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."order_item_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."order_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."table_status";