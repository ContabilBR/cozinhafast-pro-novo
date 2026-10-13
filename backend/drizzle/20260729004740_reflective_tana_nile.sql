CREATE TYPE "public"."entrega_status" AS ENUM('pendente', 'preparando', 'saiu_entrega', 'entregue', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_comanda" AS ENUM('mesa', 'delivery', 'balcao');--> statement-breakpoint
CREATE TABLE "entregas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_id" uuid NOT NULL,
	"status" "entrega_status" DEFAULT 'pendente' NOT NULL,
	"cliente_nome" text NOT NULL,
	"cliente_telefone" text NOT NULL,
	"endereco" text NOT NULL,
	"complemento" text,
	"bairro" text,
	"cidade" text,
	"cep" text,
	"referencia" text,
	"taxa_entrega" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tempo_estimado" integer,
	"entregador_nome" text,
	"entregador_telefone" text,
	"observacao" text,
	"saiu_em" timestamp with time zone,
	"entregue_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comandas" ALTER COLUMN "mesa_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "tipo" "tipo_comanda" DEFAULT 'mesa' NOT NULL;--> statement-breakpoint
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;