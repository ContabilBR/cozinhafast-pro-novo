---
name: reservas-verificacao-pendente
description: Verificação em aparelho das reservas e do CMV aguarda o usuário avisar que o login da dev funciona
metadata:
  type: project
---

Login de demonstração falha na dev por configuração (secrets do seed); o usuário ajusta no painel. Não criar usuários nem dados e não repetir o teste de login até ele avisar.

**Why:** o usuário proibiu criar dados; a causa é do ambiente.
**How to apply:** quando ele avisar que o login funciona, rodar check-app no udid do turno: entrar como garçom, abrir reservas, criar uma reserva, tentar outra no mesmo horário e mesa (esperado 409), listar o dia, sentar o cliente. Relatar só o que aparece na tela, sem alterar código. Backend de reservas está no commit 79a3909 (item 4 ainda com brecha: última atualização da reserva dentro da transação vira 500, não 409).
