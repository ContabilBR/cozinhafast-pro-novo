ALTER TABLE "mesas" ADD COLUMN "qr_token" text;--> statement-breakpoint
CREATE INDEX "mesas_qr_token_unique" ON "mesas" USING btree ("qr_token");