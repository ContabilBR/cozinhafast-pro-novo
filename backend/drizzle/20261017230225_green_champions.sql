ALTER TABLE "comandas" ADD COLUMN "desconto_valor" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_tipo" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_motivo" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_motivo_detalhe" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_por_id" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_por_nome" text;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "desconto_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_valor" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_tipo" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_motivo" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_motivo_detalhe" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_por_id" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_por_nome" text;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "desconto_em" timestamp with time zone;