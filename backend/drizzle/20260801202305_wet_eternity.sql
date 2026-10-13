CREATE TYPE "public"."movimentacao_tipo" AS ENUM('entrada', 'saida', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."unidade_medida" AS ENUM('kg', 'g', 'l', 'ml', 'un', 'cx', 'pct', 'dz');--> statement-breakpoint
CREATE TABLE "insumos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"unidade" "unidade_medida" NOT NULL,
	"estoque_atual" numeric(10, 3) DEFAULT '0' NOT NULL,
	"estoque_minimo" numeric(10, 3) DEFAULT '0' NOT NULL,
	"custo_unitario" numeric(10, 2) DEFAULT '0' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimentacoes_estoque" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insumo_id" uuid NOT NULL,
	"tipo" "movimentacao_tipo" NOT NULL,
	"quantidade" numeric(10, 3) NOT NULL,
	"estoque_anterior" numeric(10, 3) NOT NULL,
	"estoque_novo" numeric(10, 3) NOT NULL,
	"motivo" text,
	"usuario_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prato_insumos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prato_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"quantidade_usada" numeric(10, 3) NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_insumo_id_insumos_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prato_insumos" ADD CONSTRAINT "prato_insumos_prato_id_pratos_id_fk" FOREIGN KEY ("prato_id") REFERENCES "public"."pratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prato_insumos" ADD CONSTRAINT "prato_insumos_insumo_id_insumos_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prato_insumos" ADD CONSTRAINT "prato_insumos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;