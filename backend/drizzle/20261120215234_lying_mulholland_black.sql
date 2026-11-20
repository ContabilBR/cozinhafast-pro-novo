CREATE TABLE "prato_insumo_custo_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurante_id" text NOT NULL,
	"prato_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"custo" numeric(10, 2) NOT NULL,
	"vigencia_inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" text,
	"origem" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prato_insumos" ADD COLUMN "custo_unitario" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "prato_insumo_custo_historico" ADD CONSTRAINT "prato_insumo_custo_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prato_insumo_custo_historico" ADD CONSTRAINT "prato_insumo_custo_historico_prato_id_pratos_id_fk" FOREIGN KEY ("prato_id") REFERENCES "public"."pratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prato_insumo_custo_historico" ADD CONSTRAINT "prato_insumo_custo_historico_insumo_id_insumos_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prato_insumo_custo_historico_prato_insumo_vigencia" ON "prato_insumo_custo_historico" USING btree ("prato_id","insumo_id","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_prato_insumo_custo_historico_restaurante" ON "prato_insumo_custo_historico" USING btree ("restaurante_id");