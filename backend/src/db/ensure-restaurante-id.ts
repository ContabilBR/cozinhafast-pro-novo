/**
 * Converte o id do restaurante de uuid para texto (o id passa a ser o CNPJ).
 *
 * Por que existe: as migrações do Drizzle não rodam sozinhas no deploy e o Database Viewer
 * não aceita comandos de estrutura. Então a conversão roda na inicialização do backend.
 *
 * O que faz: se `restaurante.id` ainda for uuid, guarda as chaves estrangeiras que apontam
 * para `restaurante`, remove-as, troca `restaurante.id` e todas as colunas `restaurante_id`
 * para texto (os valores uuid antigos são preservados como texto) e recria as chaves.
 * É idempotente: com o banco já em texto, só faz uma consulta de leitura e sai.
 * É o mesmo comando da migração 20261009142522_restaurante_id_cnpj.
 *
 * Deve rodar ANTES de qualquer outra consulta ao banco.
 */
import { sql } from "drizzle-orm";
import type { App } from "../index.js";

const CONVERSAO = `
DO $$
DECLARE fks jsonb; item jsonb; coluna record;
BEGIN
  IF COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'restaurante' AND column_name = 'id'), 'text') <> 'uuid' THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tabela', c.conrelid::regclass::text,'nome', c.conname,'definicao', pg_get_constraintdef(c.oid))), '[]'::jsonb) INTO fks FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'restaurante'::regclass;
  FOR item IN SELECT * FROM jsonb_array_elements(fks) LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item->>'tabela', item->>'nome'); END LOOP;
  ALTER TABLE restaurante ALTER COLUMN id DROP DEFAULT;
  ALTER TABLE restaurante ALTER COLUMN id TYPE text USING id::text;
  FOR coluna IN SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'restaurante_id' AND data_type = 'uuid' LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN restaurante_id TYPE text USING restaurante_id::text', coluna.table_name); END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(fks) LOOP EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item->>'tabela', item->>'nome', item->>'definicao'); END LOOP;
END
$$;
`;

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

/** Devolve true se a conversão foi aplicada nesta inicialização. */
export async function garantirRestauranteIdTexto(app: App): Promise<boolean> {
  const db = app.db as any;
  const atual = linhasDe(
    await db.execute(sql`SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'restaurante' AND column_name = 'id'`)
  );
  if (atual.length === 0 || atual[0].data_type !== "uuid") return false;

  app.logger.warn("restaurante.id ainda é uuid: convertendo para texto (id = CNPJ)");
  await db.execute(sql.raw(CONVERSAO));
  app.logger.info("restaurante.id convertido para texto");
  return true;
}
