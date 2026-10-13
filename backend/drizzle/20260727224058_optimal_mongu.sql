DROP INDEX "idx_categoria_pratos_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_categorias_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_comandas_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_comandas_historico_restaurante_id";--> statement-breakpoint
DROP INDEX "mesas_restaurante_numero_unique";--> statement-breakpoint
DROP INDEX "idx_mesas_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_pedidos_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_pedidos_historico_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_pratos_restaurante_id";--> statement-breakpoint
DROP INDEX "idx_profiles_restaurante_id";--> statement-breakpoint
DROP INDEX "usuarios_restaurante_email_unique";--> statement-breakpoint
DROP INDEX "idx_usuarios_restaurante_id";--> statement-breakpoint
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_numero_unique" UNIQUE("numero");