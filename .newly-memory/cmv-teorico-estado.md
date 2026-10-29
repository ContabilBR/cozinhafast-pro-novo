---
name: cmv-teorico-estado
description: Estado do relatório CMV teórico (Etapa 1 backend reescrita e revisada no código, nunca chamada de verdade; Etapa 2 tela/exportação pendente)
metadata:
  type: project
---

Endpoint GET /api/relatorios/cmv-teorico reescrito em 2 alterações Specular (commits 9537dbb e 2355410 na dev, backend/src/routes/relatorios.ts). Só gerente/administrador. Consultas simples + agregação em TypeScript; nomes seguem a Margem (cmv, margem_percentual...). Revisado só lendo o código: NUNCA chamado de verdade (login 401 no dev, usuário proibiu testes/criar usuários).
Formato: periodo{inicio,fim}; resumo{receita_total_geral, receita_coberta, cmv, cmv_percentual, cmv_percentual_coberto, margem_bruta, margem_percentual, cobertura_percentual, custo_cortesias, receita_cortesias, custo_perdas, quantidade_perdas, quantidade_itens_vendidos, total_pratos_vendidos, pratos_com_ficha, pratos_sem_ficha, pratos_custo_incompleto}; com_ficha[]; por_categoria[]; por_insumo[]; por_dia[]; sem_ficha[]; custo_incompleto[]; perdas{quantidade,custo,itens_sem_ficha_quantidade,por_prato[]}; observacao_custo.
Regra (commit 5b240f7): receita exclui o valor bruto das cortesias (só itens de comandas não-cortesia, como Vendas); CMV inclui o custo das cortesias; receita_cortesias é só informativo (hoje soma só pratos com ficha completa); quantidade_vendida inclui cortesia.
Etapa 2 (app/relatorio-detalhe/cmv-teorico.tsx, utils/exportacao/cmv.ts) NÃO começou; só em outro turno, após o usuário pedir.
**Why:** o usuário exige especificação exata e uma mudança por turno no backend.
**How to apply:** na Etapa 2, ler o formato acima no código da rota; se algo falhar na prática, nova specular_change pontual.
