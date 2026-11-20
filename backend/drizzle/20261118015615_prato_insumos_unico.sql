DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'prato_insumos' AND indexname = 'prato_insumos_prato_insumo_uq'
  ) AND NOT EXISTS (
    SELECT 1 FROM "prato_insumos" GROUP BY "prato_id", "insumo_id" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "prato_insumos_prato_insumo_uq" ON "prato_insumos" USING btree ("prato_id","insumo_id");
  END IF;
END $$;
