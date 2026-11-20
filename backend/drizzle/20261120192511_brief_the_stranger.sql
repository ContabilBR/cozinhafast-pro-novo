CREATE TABLE "insumo_custo_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurante_id" text NOT NULL,
	"insumo_id" uuid NOT NULL,
	"custo" numeric(10, 2) NOT NULL,
	"vigencia_inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" text,
	"origem" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insumo_custo_historico" ADD CONSTRAINT "insumo_custo_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insumo_custo_historico" ADD CONSTRAINT "insumo_custo_historico_insumo_id_insumos_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_insumo_custo_historico_insumo_vigencia" ON "insumo_custo_historico" USING btree ("insumo_id","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_insumo_custo_historico_restaurante" ON "insumo_custo_historico" USING btree ("restaurante_id");