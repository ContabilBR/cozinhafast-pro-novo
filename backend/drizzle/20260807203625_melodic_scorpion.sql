CREATE TYPE "public"."regime_tributario" AS ENUM('simples_nacional', 'simples_excesso', 'regime_normal', 'mei');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento_fiscal" AS ENUM('nfce', 'nfe', 'nfse');--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "tipo_documento" "tipo_documento_fiscal" DEFAULT 'nfse' NOT NULL;--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "modelo" text;--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "ambiente" integer;--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "destinatario_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "valor_total" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN "emitida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "ncm" text;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "cfop" text DEFAULT '5102' NOT NULL;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "cest" text;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "unidade_comercial" text DEFAULT 'UN' NOT NULL;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "origem_mercadoria" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "csosn" text;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "cst_icms" text;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "aliquota_icms" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "inscricao_estadual" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "inscricao_municipal" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "regime_tributario" "regime_tributario";--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "cnae_principal" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "csc_token" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "csc_id" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "ambiente_focus" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "ncm_padrao" text DEFAULT '21069090' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "cep" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "logradouro" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "numero_endereco" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "complemento" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "bairro" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "codigo_municipio_ibge" integer;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "telefone" text;--> statement-breakpoint
ALTER TABLE "restaurante" ADD COLUMN "email" text;--> statement-breakpoint
CREATE INDEX "idx_notas_fiscais_restaurante_tipo" ON "notas_fiscais" USING btree ("restaurante_id","tipo_documento");--> statement-breakpoint
CREATE INDEX "idx_notas_fiscais_referencia_focus" ON "notas_fiscais" USING btree ("referencia_focus");--> statement-breakpoint
CREATE INDEX "idx_notas_fiscais_restaurante_status" ON "notas_fiscais" USING btree ("restaurante_id","status");