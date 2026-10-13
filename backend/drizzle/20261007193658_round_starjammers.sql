ALTER TABLE "pedidos" ADD COLUMN "iniciado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "pronto_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN "iniciado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedidos_historico" ADD COLUMN "pronto_em" timestamp with time zone;