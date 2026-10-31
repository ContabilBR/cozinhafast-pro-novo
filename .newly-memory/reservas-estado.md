---
name: reservas-estado
description: Reserva de mesas (etapa 1, backend): gerada na dev com defeitos conhecidos; correção pendente; app não iniciado
metadata:
  type: project
---

Etapa 1 gerada via specular_change (tabela reservas, backend/src/routes/reservas.ts, services/sentar-reserva.ts, acréscimo em routes/tables.ts). Não validada em execução.

Defeitos encontrados na leitura do código (corrigir com UMA specular_change, a pedido do usuário):
1. Sem CHECK no banco (pessoas 1–50, duração > 0); a migração drizzle e o ensure-schema não os criam.
2. Trava da mesa: `tx.execute("SELECT ... FOR UPDATE", [id])` com string e parâmetros, não funciona no drizzle; usar sql`...`.
3. Conflito: usa janela fixa de 120 min com gte, então reservas coladas (fim == início) dão 409 indevido; ids/duração fixos.
4. proxima_reserva em tables.ts inclui status sentada (deve ser só confirmada) e busca todas as reservas do restaurante sem filtro de horário.
5. sentar: não relê/trava a reserva dentro da transação; erro interno vira "mesa_nao_encontrada".
6. ensure-schema usa `CREATE TYPE IF NOT EXISTS` (inválido no Postgres) e sai cedo se a tabela existe.
Também: a chamada da specular_change deu "API connection failed", mas a mudança entrou mesmo assim; conferir com status/schema antes de repetir.
