CREATE TABLE IF NOT EXISTS "comandas_historico" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mesa_id" uuid,
	"mesa_numero" integer,
	"garcom_id" text,
	"status" text NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pedidos_historico" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comanda_id" uuid NOT NULL,
	"prato_id" uuid,
	"prato_nome" text,
	"quantidade" integer NOT NULL,
	"preco_unitario" numeric(10, 2) NOT NULL,
	"observacao" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
