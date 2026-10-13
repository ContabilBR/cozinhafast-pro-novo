-- Converte o id do restaurante (e toda coluna restaurante_id) de uuid para texto, para que o id seja o CNPJ.
-- Idempotente: se o banco já estiver convertido, não faz nada. O mesmo bloco roda no boot do backend
-- (src/db/ensure-restaurante-id.ts), porque as migrações não rodam sozinhas no deploy.
DO $$
DECLARE
  fks jsonb;
  item jsonb;
  coluna record;
BEGIN
  -- Já convertido (ou banco novo sem a coluna uuid): não faz nada. Pode rodar quantas vezes quiser.
  IF COALESCE((
    SELECT data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'restaurante' AND column_name = 'id'
  ), 'text') <> 'uuid' THEN
    RETURN;
  END IF;

  -- 1) Guarda a definição de TODAS as chaves estrangeiras que apontam para restaurante(id) e solta cada uma.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'tabela', c.conrelid::regclass::text,
           'nome', c.conname,
           'definicao', pg_get_constraintdef(c.oid)
         )), '[]'::jsonb)
    INTO fks
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.confrelid = 'restaurante'::regclass;

  FOR item IN SELECT * FROM jsonb_array_elements(fks) LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item->>'tabela', item->>'nome');
  END LOOP;

  -- 2) Converte o id do restaurante e toda coluna restaurante_id de uuid para texto (valores viram texto, nada se perde).
  ALTER TABLE restaurante ALTER COLUMN id DROP DEFAULT;
  ALTER TABLE restaurante ALTER COLUMN id TYPE text USING id::text;

  FOR coluna IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'restaurante_id' AND data_type = 'uuid'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN restaurante_id TYPE text USING restaurante_id::text', coluna.table_name);
  END LOOP;

  -- 3) Recria as chaves estrangeiras exatamente como eram.
  FOR item IN SELECT * FROM jsonb_array_elements(fks) LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item->>'tabela', item->>'nome', item->>'definicao');
  END LOOP;
END
$$;
