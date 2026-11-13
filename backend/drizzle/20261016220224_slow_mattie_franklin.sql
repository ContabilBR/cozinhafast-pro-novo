CREATE INDEX "idx_comandas_restaurante_id_status_closed_at" ON "comandas" USING btree ("restaurante_id","status","closed_at");--> statement-breakpoint
CREATE INDEX "idx_comandas_restaurante_id_created_at" ON "comandas" USING btree ("restaurante_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_comandas_historico_restaurante_id_status_closed_at" ON "comandas_historico" USING btree ("restaurante_id","status","closed_at");--> statement-breakpoint
CREATE INDEX "idx_entregas_restaurante_id_comanda_id" ON "entregas" USING btree ("restaurante_id","comanda_id");--> statement-breakpoint
CREATE INDEX "idx_pagamentos_comanda_id" ON "pagamentos" USING btree ("comanda_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_restaurante_id_comanda_id" ON "pedidos" USING btree ("restaurante_id","comanda_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_comanda_id" ON "pedidos" USING btree ("comanda_id");--> statement-breakpoint
CREATE INDEX "idx_pedidos_historico_restaurante_id_comanda_id" ON "pedidos_historico" USING btree ("restaurante_id","comanda_id");--> statement-breakpoint
CREATE INDEX "idx_pratos_restaurante_id" ON "pratos" USING btree ("restaurante_id");