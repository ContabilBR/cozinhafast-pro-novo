ALTER TABLE "categoria_pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categorias" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comandas_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mesas" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pedidos" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "restaurante_id" SET NOT NULL;