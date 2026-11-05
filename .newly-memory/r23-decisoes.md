---
name: r23-decisoes
description: "Decisões aprovadas de descontos/cortesias e limites de escopo da R2.3, informados em 2026-10-18."
metadata:
  node_type: memory
  type: project
  originSessionId: 25f268c1-d6fc-4919-bf49-a31b20d76d71
  modified: 2026-10-19T13:30:49.136Z
---

O usuário consolidou a R2.3 em 2026-10-18: garçom pode aplicar/remover desconto em reais, percentual ou cortesia mediante autorização pontual de gerente por e-mail e senha; isso substitui a decisão anterior de permitir somente gerentes. Gerente, administrador e admin aplicam diretamente. PIN é evolução futura.

Gorjeta é calculada sobre o subtotal bruto, antes do desconto. A responsabilidade dos relatórios é de quem autorizou, não de quem operou a aplicação. Identidade esperada: faturamento de itens bruto + gorjeta + taxa de entrega − desconto aplicado = total recebido.

NFC-e permanece explicitamente fora do escopo por decisão do usuário; delivery NFC-e é etapa própria. Não incluir implementação fiscal em ajustes de descontos/cortesias.

O usuário ainda considera pendente a validação em Android/aparelho real dos fluxos de autorização, descontos/cortesias, remoção, pagamento, fechamento/divisão e relatórios/Excel; a prévia iOS branca não comprova funcionamento desses fluxos. Também continuam pendentes ficha técnica, importação e margem da R2.1.

**Why:** preservar as decisões de produto e não confundir implementação/aprovação dos commits com validação funcional concluída.
**How to apply:** manter cálculo bruto da gorjeta e autorização de gerente para garçom; não reabrir essas escolhas nem incluir NFC-e sem novo pedido. Tratar validação real como pendente até o usuário confirmar. Consultar código e remoto para estado de implementação, sem usar esta memória como evidência de testes.
