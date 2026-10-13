-- Add restaurante_id column to 10 tables with backfill
-- Phase 1: Ensure default restaurante exists
INSERT INTO "restaurante" ("id", "nome", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'Restaurante Padrão', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Phase 2: Add restaurante_id as nullable to all tables (if not already present)
ALTER TABLE "mesas" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "categorias" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "categoria_pratos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "pratos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "comandas" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE SET NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "comandas_historico" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;
ALTER TABLE "pedidos_historico" ADD COLUMN IF NOT EXISTS "restaurante_id" uuid REFERENCES "restaurante"("id") ON DELETE CASCADE;

-- Phase 3: Backfill with default restaurante for rows with NULL restaurante_id
UPDATE "mesas" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "categorias" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "categoria_pratos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "pratos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "comandas" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "pedidos" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "profiles" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "usuarios" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "comandas_historico" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;
UPDATE "pedidos_historico" SET "restaurante_id" = '00000000-0000-0000-0000-000000000001' WHERE "restaurante_id" IS NULL;

-- Phase 4: Set restaurante_id to NOT NULL (profiles can remain nullable but we backfilled it anyway)
ALTER TABLE "mesas" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "categorias" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "categoria_pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "pratos" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "comandas" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "pedidos" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "usuarios" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "comandas_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;
ALTER TABLE "pedidos_historico" ALTER COLUMN "restaurante_id" SET NOT NULL;
