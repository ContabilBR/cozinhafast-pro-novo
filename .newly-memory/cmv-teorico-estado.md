---
name: cmv-teorico-estado
description: Estado do relatório CMV teórico (Etapa 1 backend feita com defeitos; Etapa 2 tela/exportação pendente)
metadata:
  type: project
---

Endpoint GET /api/relatorios/cmv-teorico criado pelo Specular (commit ee35277 na dev, relatorios.ts ~linhas 4742-5227), mas FORA da especificação. Precisa de UMA nova specular_change corretiva (antes da tela):
- ainda filtra `total > 0` (cortesias fora) e custo_cortesias fixo em 0;
- por_prato inclui pratos sem ficha com CMV 0 (margem 100%); faturamento_coberto == faturamento_itens, cobertura sempre ~100%;
- sem_ficha só cobre "sem ficha", não "custo incompleto"; sem motivo/insumos_sem_custo;
- perdas exigem comanda fechada e não usam cancelado_em; custo de perda multiplica por join em prato_id;
- por_dia sem generate_series (dias sem venda faltam); por_insumo limitado a 50, sem participação; sem participacao_cmv, cmv_percentual por prato/categoria;
- nomes de campos diferem do pedido (cmv_teorico em vez de cmv, margem_percentual, etc.); observacao_custo diferente do texto pedido;
- json_agg(...) FROM x ORDER BY col provavelmente é SQL inválido (erro 500).
Nunca verificado com requisição real (login demo 401 no dev). Etapa 2 (tela app/relatorio-detalhe/cmv-teorico.tsx, utils/exportacao/cmv.ts) ainda não começou.
**Why:** o usuário exige especificação exata e uma mudança por turno no backend.
**How to apply:** próximo turno: specular_schema -> specular_change corretiva completa -> só então a tela.
