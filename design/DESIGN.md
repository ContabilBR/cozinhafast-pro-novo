# CozinhaFast Pro — tela de abertura

Escopo: somente a abertura; preservar navegação, login, dependências, backend e nome do aplicativo.

- Assunto: gestão de restaurantes.
- Público: equipe e gestores do restaurante.
- Ação principal desta tela: aguardar a inicialização e seguir automaticamente ao destino existente.
- Momento de uso: abrir o aplicativo antes do atendimento.

## Direção

1. Arte integral enviada, centralizada e sem cortes, com fundo laranja — escolhida porque respeita exatamente a imagem pedida.
2. Apenas símbolo recortado — descartada porque perderia o texto da arte.
3. Arte em um cartão sobre fundo escuro — descartada porque acrescentaria uma moldura desnecessária.

Cores da abertura: laranja #FF4713, branco quente #FAF9F4. São cores locais da arte, não uma alteração do tema do restante do app. Tipografia e textura são as da imagem fornecida; não recriar seus textos. A arte diz “Cozinha Fácil”, mas o aplicativo continua “CozinhaFast Pro”. Nenhuma fotografia nova.

```
┌─────────────────────┐
│ fundo laranja       │
│                     │
│ imagem integral     │
│ símbolo + título    │
│ subtítulo original  │
│                     │
└─────────────────────┘
       ↓ ao carregar
 login ou tela já existente
```

Alternativa de enquadramento: preencher cortando bordas. Preferir conter a imagem inteira para não perder palavras em tablets ou telas estreitas. Não há botões, novas rotas ou atraso artificial. A imagem permanece durante a leitura inicial de sessão/configuração. A identidade memorável é o contraste laranja e branco do símbolo de serviço rápido. A imagem fornecida, não um template, determina a abertura.

Verificação: conferir imagem sem distorção/corte e transição automática para login. Validar builds iOS e Android separadamente; limitações de splash nativa em clientes de desenvolvimento devem ser informadas.
