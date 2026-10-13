ALTER TABLE "notas_fiscais" ADD COLUMN IF NOT EXISTS "qrcode_url" text;--> statement-breakpoint
ALTER TABLE "notas_fiscais" ADD COLUMN IF NOT EXISTS "url_consulta" text;