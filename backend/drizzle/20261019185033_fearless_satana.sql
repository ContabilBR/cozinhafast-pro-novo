DROP INDEX "mesas_qr_token_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "mesas_qr_token_uq" ON "mesas" USING btree ("qr_token");