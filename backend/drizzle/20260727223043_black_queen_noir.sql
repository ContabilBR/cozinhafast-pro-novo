ALTER TABLE "mesas" DROP CONSTRAINT "mesas_numero_unique";--> statement-breakpoint
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_email_unique";--> statement-breakpoint
ALTER TABLE "categoria_pratos" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "categorias" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "comandas" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "mesas" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "pratos" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "restaurante_id" uuid;--> statement-breakpoint
ALTER TABLE "categoria_pratos" ADD CONSTRAINT "categoria_pratos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD CONSTRAINT "comandas_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD CONSTRAINT "pedidos_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pratos" ADD CONSTRAINT "pratos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_categoria_pratos_restaurante_id" ON "categoria_pratos" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_categorias_restaurante_id" ON "categorias" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_comandas_restaurante_id" ON "comandas" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_comandas_historico_restaurante_id" ON "comandas_historico" USING btree ("restaurante_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mesas_restaurante_numero_unique" ON "mesas" USING btree ("restaurante_id","numero");--> statement-breakpoint
CREATE INDEX "idx_mesas_restaurante_id" ON "mesas" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_restaurante_id" ON "pedidos" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_historico_restaurante_id" ON "pedidos_historico" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_pratos_restaurante_id" ON "pratos" USING btree ("restaurante_id");--> statement-breakpoint
CREATE INDEX "idx_profiles_restaurante_id" ON "profiles" USING btree ("restaurante_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_restaurante_email_unique" ON "usuarios" USING btree ("restaurante_id","email");--> statement-breakpoint
CREATE INDEX "idx_usuarios_restaurante_id" ON "usuarios" USING btree ("restaurante_id");