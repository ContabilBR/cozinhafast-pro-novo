---
name: fuso-horario-estado
description: Decisão e estado das etapas do fuso horário por restaurante (06/11/2026)
metadata:
  type: project
---

Restaurante é a fonte do fuso (restaurante.fuso_horario, 16 fusos do Brasil). Exibição de horários no app continua no fuso do aparelho.
Etapa 1 (colunas + PUT /api/restaurante/fuso-horario): commit 0b7f879. Etapa 2a (utils/fuso.ts + períodos do relatorios.ts): d701b5f. Etapa 2b (15 AT TIME ZONE do relatorios.ts): 9e518855. Etapa 3 (comandas-dia, reservas, estorno do delivery): a079f6c5; correção do fuso lido antes da transação no cancelamento do delivery: 8076430a. Todas na dev, NÃO aplicadas: specular_refresh falha com "Cannot refresh branch without a running sandbox".
Pendentes: 4 e 5 (app), 6 (fiscal, adiado), 7 (web).
**Why:** com fuso padrão nada pode mudar nas respostas.
**How to apply:** antes de seguir, tentar specular_refresh de novo e confirmar com specular_schema.
