-- Add desconto_aplicado_por_nome column to comandas
ALTER TABLE comandas ADD COLUMN IF NOT EXISTS desconto_aplicado_por_nome text;

-- Add desconto_aplicado_por_nome column to comandas_historico
ALTER TABLE comandas_historico ADD COLUMN IF NOT EXISTS desconto_aplicado_por_nome text;
