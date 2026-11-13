DROP INDEX IF EXISTS "mesas_qr_token_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mesas_qr_token_uq" ON "mesas" USING btree ("qr_token");