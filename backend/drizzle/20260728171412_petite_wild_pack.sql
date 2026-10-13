CREATE TYPE "public"."forma_pagamento" AS ENUM('pix', 'dinheiro', 'cartao_credito', 'cartao_debito');--> statement-breakpoint
CREATE TYPE "public"."pagamento_status" AS ENUM('pendente', 'confirmado', 'cancelado');--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comanda_id" uuid NOT NULL,
	"forma_pagamento" "forma_pagamento" NOT NULL,
	"status" "pagamento_status" DEFAULT 'pendente' NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"troco" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pix_tx_id" text,
	"pix_qr_code" text,
	"pix_qr_code_base64" text,
	"referencia" text,
	"confirmado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagamentos_historico" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comanda_id" uuid NOT NULL,
	"forma_pagamento" text NOT NULL,
	"status" text NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"troco" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pix_tx_id" text,
	"referencia" text,
	"confirmado_em" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurante_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_comanda_id_comandas_id_fk" FOREIGN KEY ("comanda_id") REFERENCES "public"."comandas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos_historico" ADD CONSTRAINT "pagamentos_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;