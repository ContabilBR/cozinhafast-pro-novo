ALTER TABLE "categoria_pratos" DROP CONSTRAINT "categoria_pratos_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "categorias" DROP CONSTRAINT "categorias_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "comandas" DROP CONSTRAINT "comandas_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "comandas_historico" DROP CONSTRAINT "comandas_historico_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "mesas" DROP CONSTRAINT "mesas_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "pedidos" DROP CONSTRAINT "pedidos_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "pedidos_historico" DROP CONSTRAINT "pedidos_historico_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "pratos" DROP CONSTRAINT "pratos_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_restaurante_id_restaurante_id_fk";
--> statement-breakpoint
ALTER TABLE "categoria_pratos" ADD CONSTRAINT "categoria_pratos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comandas_historico" ADD CONSTRAINT "comandas_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD CONSTRAINT "pedidos_historico_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pratos" ADD CONSTRAINT "pratos_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_restaurante_id_restaurante_id_fk" FOREIGN KEY ("restaurante_id") REFERENCES "public"."restaurante"("id") ON DELETE cascade ON UPDATE no action;