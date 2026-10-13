BEGIN;

-- Backfill restaurante_id with default restaurante for all existing records
DO $$
DECLARE
  default_id UUID;
BEGIN
  -- Get or create default restaurante
  SELECT id INTO default_id FROM restaurante ORDER BY created_at ASC LIMIT 1;
  IF default_id IS NULL THEN
    INSERT INTO restaurante (id, nome, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Restaurante Padrão', NOW(), NOW())
    RETURNING id INTO default_id;
  END IF;

  -- Backfill all tables
  UPDATE mesas SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE categorias SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE categoria_pratos SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE pratos SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE comandas SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE pedidos SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE profiles SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE usuarios SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE comandas_historico SET restaurante_id = default_id WHERE restaurante_id IS NULL;
  UPDATE pedidos_historico SET restaurante_id = default_id WHERE restaurante_id IS NULL;
END$$;

-- Set NOT NULL constraints
ALTER TABLE mesas ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE categorias ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE categoria_pratos ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE pratos ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE comandas ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE pedidos ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE usuarios ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE comandas_historico ALTER COLUMN restaurante_id SET NOT NULL;
ALTER TABLE pedidos_historico ALTER COLUMN restaurante_id SET NOT NULL;

-- Add FK constraints
ALTER TABLE mesas DROP CONSTRAINT IF EXISTS mesas_restaurante_id_fkey;
ALTER TABLE mesas ADD CONSTRAINT mesas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE categorias DROP CONSTRAINT IF EXISTS categorias_restaurante_id_fkey;
ALTER TABLE categorias ADD CONSTRAINT categorias_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE categoria_pratos DROP CONSTRAINT IF EXISTS categoria_pratos_restaurante_id_fkey;
ALTER TABLE categoria_pratos ADD CONSTRAINT categoria_pratos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE pratos DROP CONSTRAINT IF EXISTS pratos_restaurante_id_fkey;
ALTER TABLE pratos ADD CONSTRAINT pratos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE comandas DROP CONSTRAINT IF EXISTS comandas_restaurante_id_fkey;
ALTER TABLE comandas ADD CONSTRAINT comandas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_restaurante_id_fkey;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_restaurante_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_restaurante_id_fkey;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE comandas_historico DROP CONSTRAINT IF EXISTS comandas_historico_restaurante_id_fkey;
ALTER TABLE comandas_historico ADD CONSTRAINT comandas_historico_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

ALTER TABLE pedidos_historico DROP CONSTRAINT IF EXISTS pedidos_historico_restaurante_id_fkey;
ALTER TABLE pedidos_historico ADD CONSTRAINT pedidos_historico_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurante(id) ON DELETE RESTRICT;

-- Drop old UNIQUE constraints and add per-tenant ones
ALTER TABLE mesas DROP CONSTRAINT IF EXISTS mesas_numero_unique;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesas_restaurante_numero_unique') THEN
    ALTER TABLE mesas ADD CONSTRAINT mesas_restaurante_numero_unique UNIQUE (restaurante_id, numero);
  END IF;
END$$;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_email_unique;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_restaurante_email_unique') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_restaurante_email_unique UNIQUE (restaurante_id, email);
  END IF;
END$$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_mesas_restaurante_id ON mesas(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_categorias_restaurante_id ON categorias(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_categoria_pratos_restaurante_id ON categoria_pratos(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_pratos_restaurante_id ON pratos(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_comandas_restaurante_id ON comandas(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_restaurante_id ON pedidos(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_profiles_restaurante_id ON profiles(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_restaurante_id ON usuarios(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_comandas_historico_restaurante_id ON comandas_historico(restaurante_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_historico_restaurante_id ON pedidos_historico(restaurante_id);

COMMIT;
