import type ExcelJSTipos from 'exceljs';
import { CORES } from './exportacao/definicao';
import { carregarExcelJS } from './exportacao/excel';
import type { InsumoModelo } from './modeloFichaTecnica';

// Modelo Excel da importação de cadastros (pratos, insumos, categorias e ficha técnica).
// O estilo é uma cópia do usado em modeloFichaTecnica.ts, que não foi alterado.

const FONTE = 'Calibri';
const TAMANHO = 10;
const BRANCO = 'FFFFFFFF';
const argb = (hex: string) => `FF${hex}`;
const preenchimento = (hex: string): ExcelJSTipos.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const fino = (hex: string): Partial<ExcelJSTipos.Border> => ({ style: 'thin', color: { argb: argb(hex) } });
const fonte = (extra: Partial<ExcelJSTipos.Font> = {}): Partial<ExcelJSTipos.Font> =>
  ({ name: FONTE, size: TAMANHO, color: { argb: argb(CORES.texto) }, ...extra });

// Coluna 1 é o marcador; colunas 2 a 6 recebem texto e tabelas.
const LARGURAS_INSTRUCOES = [5, 22, 34, 16, 24, 34];
const COLUNAS_INSTRUCOES = LARGURAS_INSTRUCOES.length;
const LINHAS_DADOS = 501;
const UNIDADES = ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct', 'dz'];

const ABA_PRATOS = 'Pratos';
const ABA_INSUMOS = 'Insumos';
const ABA_FICHA = 'Ficha técnica';
const ABA_LISTAS = 'Listas';
const ABA_CONSULTA_PRATOS = 'Pratos cadastrados (consulta)';
const ABA_CONSULTA_INSUMOS = 'Insumos cadastrados (consulta)';
// O Excel limita o nome da aba a 31 caracteres; "Categorias cadastradas (consulta)" teria 33.
const ABA_CONSULTA_CATEGORIAS = 'Categorias (consulta)';

function alturaTexto(texto: string, largura: number, minima = 20): number {
  const linhas = texto.split('\n').reduce((s, parte) => s + Math.max(1, Math.ceil(parte.length / Math.max(1, largura * 1.0))), 0);
  return Math.max(minima, linhas * 13.5 + 6);
}

function limparLista(valores: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const v of valores) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t || vistos.has(t)) continue;
    vistos.add(t); saida.push(t);
  }
  return saida;
}

function montarInstrucoes(wb: ExcelJSTipos.Workbook) {
  const ws = wb.addWorksheet('Instruções', {
    properties: { tabColor: { argb: argb(CORES.escuro) } },
    views: [{ showGridLines: false }],
  });
  ws.columns = LARGURAS_INSTRUCOES.map(width => ({ width }));
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
  const larguraDe = (de: number, ate: number) => LARGURAS_INSTRUCOES.slice(de - 1, ate).reduce((a, b) => a + b, 0);
  let linha = 1;

  const faixa = (texto: string, estilo: { fundo: string; fonte: Partial<ExcelJSTipos.Font>; altura: number }) => {
    const row = ws.getRow(linha);
    ws.mergeCells(linha, 1, linha, COLUNAS_INSTRUCOES);
    for (let c = 1; c <= COLUNAS_INSTRUCOES; c++) {
      const cell = row.getCell(c);
      cell.fill = preenchimento(estilo.fundo);
      cell.font = fonte(estilo.fonte);
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    }
    row.getCell(1).value = texto;
    row.height = estilo.altura;
    linha++;
  };
  const secao = (titulo: string) => {
    linha++;
    const row = ws.getRow(linha);
    ws.mergeCells(linha, 1, linha, COLUNAS_INSTRUCOES);
    for (let c = 1; c <= COLUNAS_INSTRUCOES; c++) {
      const cell = row.getCell(c);
      cell.font = fonte({ bold: true, size: 12, color: { argb: argb(CORES.escuro) } });
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: argb(CORES.principal) } } };
    }
    row.getCell(1).value = titulo;
    row.height = 22;
    linha++;
  };
  const paragrafo = (texto: string) => {
    const row = ws.getRow(linha);
    ws.mergeCells(linha, 2, linha, COLUNAS_INSTRUCOES);
    const cell = row.getCell(2);
    cell.value = texto; cell.font = fonte();
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.height = alturaTexto(texto, larguraDe(2, COLUNAS_INSTRUCOES));
    linha++;
  };

  faixa('Cozinha Fast Pro  ·  Importação de cadastros', { fundo: CORES.escuro, fonte: { bold: true, size: 15, color: { argb: BRANCO } }, altura: 34 });
  faixa('Preencha as abas Insumos, Pratos e Ficha técnica e envie o arquivo pelo app.', { fundo: CORES.claro, fonte: { color: { argb: argb(CORES.escuro) } }, altura: 22 });

  secao('O que esta importação faz');
  paragrafo('Cria os insumos, os pratos e as categorias que ainda não existem no sistema e liga tudo na ficha técnica, em uma única importação.');

  secao('Passo a passo');
  [
    'Primeiro, na aba Insumos, liste cada insumo novo, com a unidade.',
    'Depois, na aba Pratos, liste cada prato novo, com o preço.',
    'Por fim, na aba Ficha técnica, escolha em cada linha o prato e o insumo nas listas e informe a quantidade que o prato usa daquele insumo, na unidade do insumo.',
    'Salve o arquivo, volte ao app, escolha o arquivo e toque em Conferir. Revise a prévia e confirme.',
  ].forEach((texto, i) => {
    const row = ws.getRow(linha);
    const num = row.getCell(1);
    num.value = i + 1; num.fill = preenchimento(CORES.principal);
    num.font = fonte({ bold: true, color: { argb: BRANCO } });
    num.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(linha, 2, linha, COLUNAS_INSTRUCOES);
    for (let c = 2; c <= COLUNAS_INSTRUCOES; c++) row.getCell(c).fill = preenchimento(CORES.faixa);
    const cell = row.getCell(2);
    cell.value = texto; cell.font = fonte();
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    row.height = alturaTexto(texto, larguraDe(2, COLUNAS_INSTRUCOES) - 2, 22);
    linha++;
  });

  const tabela = (cabecalhos: string[], dados: string[][], opcoes: { exemplo?: boolean }) => {
    const cab = ws.getRow(linha);
    cabecalhos.forEach((t, i) => {
      const cell = cab.getCell(i + 2);
      cell.value = t; cell.fill = preenchimento(CORES.escuro);
      cell.font = fonte({ bold: true, color: { argb: BRANCO } });
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cell.border = { top: fino(CORES.borda), left: fino(CORES.borda), bottom: fino(CORES.borda), right: fino(CORES.borda) };
    });
    cab.height = Math.max(22, ...cabecalhos.map((t, i) => alturaTexto(t, LARGURAS_INSTRUCOES[i + 1] - 1)));
    linha++;
    dados.forEach((valores, idx) => {
      const row = ws.getRow(linha);
      let altura = 20;
      valores.forEach((t, i) => {
        const cell = row.getCell(i + 2);
        cell.value = t;
        cell.fill = preenchimento(idx % 2 === 0 ? 'FFFFFF' : CORES.faixa);
        cell.font = opcoes.exemplo
          ? fonte({ italic: true, color: { argb: argb(CORES.cinza) } })
          : fonte({ bold: i === 0 });
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cell.border = { top: fino(CORES.borda), left: fino(CORES.borda), bottom: fino(CORES.borda), right: fino(CORES.borda) };
        altura = Math.max(altura, alturaTexto(t, LARGURAS_INSTRUCOES[i + 1] - 1));
      });
      row.height = altura;
      linha++;
    });
  };

  const CAB_COLUNAS = ['Coluna', 'O que escrever', 'Obrigatória?', 'Exemplo', 'Atenção'];

  secao('Aba Insumos');
  tabela(CAB_COLUNAS, [
    ['Insumo', 'Nome do insumo novo.', 'Sim', 'Feijão preto', 'Até 120 caracteres. Não repita o mesmo nome na aba.'],
    ['Unidade', 'Unidade em que o insumo é controlado.', 'Sim', 'kg', 'Aceitas: kg, g, l, ml, un, cx, pct e dz.'],
    ['Custo unitário', 'Custo de uma unidade do insumo, em reais.', 'Não', '8,50', 'Zero ou mais, até 2 casas decimais.'],
    ['Estoque mínimo', 'Quantidade mínima que deve haver em estoque.', 'Não', '2', 'Zero ou mais, até 3 casas decimais.'],
  ], {});

  secao('Aba Pratos');
  tabela(CAB_COLUNAS, [
    ['Prato', 'Nome do prato novo.', 'Sim', 'Feijoada', 'Até 120 caracteres. Não repita o mesmo nome na aba.'],
    ['Categoria', 'Categoria do prato.', 'Não', 'Pratos principais', 'Se não existir, será criada automaticamente. Sem categoria, o prato fica sem categoria.'],
    ['Preço', 'Preço de venda, em reais.', 'Sim', '42,90', 'Maior que zero, até 2 casas decimais.'],
    ['Descrição', 'Texto curto sobre o prato.', 'Não', 'Acompanha arroz e couve', ''],
    ['Tempo de preparo (min)', 'Minutos para preparar.', 'Não', '25', 'Número inteiro de 1 a 600.'],
  ], {});

  secao('Aba Ficha técnica');
  tabela(CAB_COLUNAS, [
    ['Prato', 'Nome do prato, da aba Pratos ou já cadastrado.', 'Sim', 'Feijoada', 'Escolha na lista. Repita o prato em cada insumo que ele usa.'],
    ['Insumo', 'Nome do insumo, da aba Insumos ou já cadastrado.', 'Sim', 'Feijão preto', 'Escolha na lista.'],
    ['Quantidade', 'Quanto do insumo vai em UMA porção do prato.', 'Sim', '0,25', 'Maior que zero, até 3 casas decimais, na unidade do insumo. Não escreva a unidade.'],
  ], {});

  secao('Exemplo da aba Insumos (somente ilustração, não será importado)');
  tabela(['Insumo (exemplo)', 'Unidade (exemplo)', 'Custo unitário (exemplo)', 'Estoque mínimo (exemplo)'], [
    ['Feijão preto', 'kg', '8,50', '2'],
    ['Linguiça', 'kg', '28,00', '1,5'],
  ], { exemplo: true });

  secao('Exemplo da aba Pratos (somente ilustração, não será importado)');
  tabela(['Prato (exemplo)', 'Categoria (exemplo)', 'Preço (exemplo)', 'Descrição (exemplo)', 'Tempo de preparo (min) (exemplo)'], [
    ['Feijoada', 'Pratos principais', '42,90', 'Acompanha arroz e couve', '25'],
    ['Pudim', 'Sobremesas', '12,00', '', '5'],
  ], { exemplo: true });

  secao('Exemplo da aba Ficha técnica (somente ilustração, não será importado)');
  tabela(['Prato (exemplo)', 'Insumo (exemplo)', 'Quantidade (exemplo)'], [
    ['Feijoada', 'Feijão preto', '0,25'],
    ['Feijoada', 'Linguiça', '0,15'],
  ], { exemplo: true });

  secao('Regras importantes');
  const regras: [string, string][] = [
    ['Ordem:', ' a ordem das abas não importa para o app, mas preencher nesta ordem (Insumos, Pratos, Ficha técnica) faz as listas da Ficha técnica funcionarem.'],
    ['Nomes iguais:', ' o nome precisa ser igual nas três abas. Maiúsculas, acentos e espaços repetidos não fazem diferença.'],
    ['Números:', ' use vírgula ou ponto como separador decimal e nunca separador de milhar (escreva 1250,50, não 1.250,50).'],
    ['Unidades aceitas:', ' kg, g, l, ml, un, cx, pct e dz. A importação não converte unidades.'],
    ['Limite:', ' no máximo 500 linhas em cada aba de preenchimento.'],
    ['O que já existe:', ' prato ou insumo que já existe no sistema com o mesmo nome não é alterado, apenas usado. Categoria nova é criada automaticamente.'],
    ['Estoque:', ' os insumos novos nascem com estoque zero. O saldo se lança depois, no Estoque.'],
    ['Nota fiscal:', ' os pratos novos nascem sem NCM. Preencha o NCM no cadastro do prato antes de emitir nota fiscal.'],
    ['Nada é apagado:', ' se o prato já tem o insumo na ficha, só a quantidade é atualizada. Nenhum vínculo é removido.'],
    ['Cabeçalhos:', ' não apague nem renomeie os cabeçalhos. A aba Instruções e as abas de consulta são ignoradas na importação.'],
  ];
  regras.forEach(([destaque, resto], i) => {
    const row = ws.getRow(linha);
    const ultima = i === regras.length - 1;
    const marca = row.getCell(1);
    marca.value = ultima ? 'i' : '!';
    marca.fill = preenchimento(ultima ? CORES.principal : CORES.ambar);
    marca.font = fonte({ bold: true, color: { argb: BRANCO } });
    marca.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(linha, 2, linha, COLUNAS_INSTRUCOES);
    for (let c = 2; c <= COLUNAS_INSTRUCOES; c++) row.getCell(c).fill = preenchimento(CORES.faixa);
    const cell = row.getCell(2);
    cell.value = { richText: [{ text: destaque, font: fonte({ bold: true }) }, { text: resto, font: fonte() }] };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    row.height = alturaTexto(destaque + resto, larguraDe(2, COLUNAS_INSTRUCOES) - 2, 22);
    linha++;
  });

  secao('Erros comuns');
  tabela(['Mensagem na prévia', 'Causa', 'Aba', 'Correção'], [
    ['Prato não encontrado.', 'O nome do prato na Ficha técnica não existe na aba Pratos nem no sistema.', 'Ficha técnica', 'Corrija o nome ou cadastre o prato na aba Pratos.'],
    ['Insumo não encontrado.', 'O nome do insumo na Ficha técnica não existe na aba Insumos nem no sistema.', 'Ficha técnica', 'Corrija o nome ou liste o insumo na aba Insumos.'],
    ['Depende de uma linha com erro.', 'O prato ou o insumo da ficha está em uma linha com erro nas outras abas.', 'Ficha técnica', 'Corrija primeiro a linha com erro do prato ou do insumo.'],
    ['Unidade diferente da cadastrada: X.', 'O insumo já existe no sistema com outra unidade.', 'Insumos', 'Use a unidade que o sistema mostra na mensagem.'],
    ['Insumo inativo.', 'O insumo existe, mas está desativado no Estoque.', 'Insumos', 'Reative o insumo no Estoque ou use outro nome.'],
    ['Nome repetido; primeira ocorrência na linha N.', 'O mesmo nome aparece mais de uma vez na aba.', 'Pratos ou Insumos', 'Apague a repetição e deixe só a linha N.'],
    ['Repetida no arquivo', 'O mesmo prato e insumo aparecem em mais de uma linha.', 'Ficha técnica', 'Deixe uma linha só para cada par prato e insumo.'],
    ['Preço inválido.', 'Preço vazio, zero, negativo ou com separador de milhar.', 'Pratos', 'Use um número maior que zero, como 42,90.'],
    ['Unidade inválida.', 'A unidade não é uma das aceitas.', 'Insumos', 'Use kg, g, l, ml, un, cx, pct ou dz.'],
    ['Quantidade inválida.', 'Quantidade vazia, zero ou com mais de 3 casas decimais.', 'Ficha técnica', 'Use um número maior que zero, como 0,25.'],
  ], {});
  return ws;
}

type Coluna = { titulo: string; largura: number; alinhar?: 'left' | 'right'; formato?: string };

function montarPreenchimento(wb: ExcelJSTipos.Workbook, nome: string, cor: string, colunas: Coluna[]) {
  const ws = wb.addWorksheet(nome, {
    properties: { tabColor: { argb: argb(cor) } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  ws.columns = colunas.map(c => ({ width: c.largura }));
  colunas.forEach((c, i) => {
    ws.getColumn(i + 1).style = {
      font: fonte(),
      alignment: { horizontal: c.alinhar ?? 'left', vertical: 'middle' },
      ...(c.formato ? { numFmt: c.formato } : {}),
    };
  });
  const cab = ws.getRow(1);
  colunas.forEach((c, i) => {
    const cell = cab.getCell(i + 1);
    cell.value = c.titulo; cell.fill = preenchimento(CORES.escuro);
    cell.font = fonte({ bold: true, size: 11, color: { argb: BRANCO } });
    cell.alignment = { horizontal: c.alinhar ?? 'left', vertical: 'middle' };
    cell.numFmt = 'General';
  });
  cab.height = 24;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  // O exceljs aceita validação por intervalo (chave "A2:A501"), mas os tipos não declaram dataValidations.
  const regras = (ws as unknown as { dataValidations: { model: Record<string, Record<string, unknown>> } }).dataValidations.model;
  return regras;
}

function montarPratos(wb: ExcelJSTipos.Workbook, categorias: string[]) {
  const regras = montarPreenchimento(wb, ABA_PRATOS, CORES.principal, [
    { titulo: 'Prato', largura: 34 },
    { titulo: 'Categoria', largura: 26 },
    { titulo: 'Preço', largura: 14, alinhar: 'right', formato: '0.00' },
    { titulo: 'Descrição', largura: 40 },
    { titulo: 'Tempo de preparo (min)', largura: 22, alinhar: 'right', formato: '0' },
  ]);
  if (categorias.length > 0) {
    regras[`B2:B${LINHAS_DADOS}`] = {
      type: 'list', allowBlank: true,
      formulae: [`'${ABA_CONSULTA_CATEGORIAS}'!$A$2:$A$${categorias.length + 1}`],
      showErrorMessage: true, errorStyle: 'warning',
      errorTitle: 'Categoria nova', error: 'Essa categoria ainda não existe. Se você continuar, ela será criada na importação.',
      showInputMessage: true, promptTitle: 'Categoria', prompt: 'Escolha na lista ou digite uma categoria nova (opcional).',
    };
  }
  regras[`C2:C${LINHAS_DADOS}`] = {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Preço inválido', error: 'Use um número maior que zero, com até 2 casas decimais e sem separador de milhar.',
    showInputMessage: true, promptTitle: 'Preço', prompt: 'Obrigatório. Exemplo: 42,90',
  };
  regras[`E2:E${LINHAS_DADOS}`] = {
    type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 600],
    showErrorMessage: true,
    errorTitle: 'Tempo inválido', error: 'Use um número inteiro de 1 a 600 minutos.',
    showInputMessage: true, promptTitle: 'Tempo de preparo', prompt: 'Opcional. Minutos, de 1 a 600.',
  };
}

function montarInsumos(wb: ExcelJSTipos.Workbook) {
  const regras = montarPreenchimento(wb, ABA_INSUMOS, CORES.ambar, [
    { titulo: 'Insumo', largura: 34 },
    { titulo: 'Unidade', largura: 12 },
    { titulo: 'Custo unitário', largura: 16, alinhar: 'right', formato: '0.00' },
    { titulo: 'Estoque mínimo', largura: 16, alinhar: 'right', formato: '0.###' },
  ]);
  regras[`B2:B${LINHAS_DADOS}`] = {
    type: 'list', allowBlank: true,
    formulae: [`"${UNIDADES.join(',')}"`],
    showErrorMessage: true, errorStyle: 'stop',
    errorTitle: 'Unidade inválida', error: 'Escolha uma unidade da lista: kg, g, l, ml, un, cx, pct ou dz.',
    showInputMessage: true, promptTitle: 'Unidade', prompt: 'Obrigatória. Escolha na lista.',
  };
  regras[`C2:C${LINHAS_DADOS}`] = {
    type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Custo inválido', error: 'Use zero ou um número maior, com até 2 casas decimais e sem separador de milhar.',
    showInputMessage: true, promptTitle: 'Custo unitário', prompt: 'Opcional. Exemplo: 8,50',
  };
  regras[`D2:D${LINHAS_DADOS}`] = {
    type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Estoque mínimo inválido', error: 'Use zero ou um número maior, com até 3 casas decimais e sem separador de milhar.',
    showInputMessage: true, promptTitle: 'Estoque mínimo', prompt: 'Opcional. Exemplo: 2',
  };
}

/**
 * Aba oculta com as listas usadas na Ficha técnica: primeiro os nomes já cadastrados (valores fixos),
 * depois fórmulas que trazem o que for digitado nas abas Pratos e Insumos (vazio quando a origem está vazia).
 */
function montarListas(wb: ExcelJSTipos.Workbook, pratos: string[], insumos: InsumoModelo[]) {
  const ws = wb.addWorksheet(ABA_LISTAS, {
    state: 'hidden',
    properties: { tabColor: { argb: argb(CORES.cinza) } },
  });
  ws.columns = [{ width: 34 }, { width: 34 }];
  ws.getRow(1).getCell(1).value = 'Pratos para a lista';
  ws.getRow(1).getCell(2).value = 'Insumos para a lista';
  pratos.forEach((p, i) => { ws.getRow(i + 2).getCell(1).value = p; });
  insumos.forEach((ins, i) => { ws.getRow(i + 2).getCell(2).value = ins.nome; });
  for (let r = 2; r <= LINHAS_DADOS; r++) {
    ws.getRow(pratos.length + r).getCell(1).value = {
      formula: `IF('${ABA_PRATOS}'!A${r}="","",'${ABA_PRATOS}'!A${r})`, result: '',
    };
    ws.getRow(insumos.length + r).getCell(2).value = {
      formula: `IF('${ABA_INSUMOS}'!A${r}="","",'${ABA_INSUMOS}'!A${r})`, result: '',
    };
  }
  return ws;
}

function montarFicha(wb: ExcelJSTipos.Workbook, qtdPratos: number, qtdInsumos: number) {
  const regras = montarPreenchimento(wb, ABA_FICHA, CORES.escuro, [
    { titulo: 'Prato', largura: 34 },
    { titulo: 'Insumo', largura: 34 },
    { titulo: 'Quantidade', largura: 14, alinhar: 'right', formato: '0.###' },
  ]);
  regras[`A2:A${LINHAS_DADOS}`] = {
    type: 'list', allowBlank: true,
    formulae: [`${ABA_LISTAS}!$A$2:$A$${qtdPratos + LINHAS_DADOS}`],
    showErrorMessage: true, errorStyle: 'warning',
    errorTitle: 'Prato fora da lista', error: 'Esse nome não está na aba Pratos nem no sistema. O app vai avisar se não existir.',
    showInputMessage: true, promptTitle: 'Prato', prompt: 'Escolha na lista. Repita o prato em cada insumo que ele usa.',
  };
  regras[`B2:B${LINHAS_DADOS}`] = {
    type: 'list', allowBlank: true,
    formulae: [`${ABA_LISTAS}!$B$2:$B$${qtdInsumos + LINHAS_DADOS}`],
    showErrorMessage: true, errorStyle: 'warning',
    errorTitle: 'Insumo fora da lista', error: 'Esse nome não está na aba Insumos nem no sistema. O app vai avisar se não existir.',
    showInputMessage: true, promptTitle: 'Insumo', prompt: 'Escolha na lista.',
  };
  regras[`C2:C${LINHAS_DADOS}`] = {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Quantidade inválida', error: 'Use um número maior que zero (até 3 casas decimais), sem a unidade.',
    showInputMessage: true, promptTitle: 'Quantidade por porção', prompt: 'Quanto do insumo vai em UMA porção, na unidade do insumo. Exemplo: 0,25',
  };
}

function montarConsulta(wb: ExcelJSTipos.Workbook, nome: string, cabecalhos: [string, number][], linhas: string[][]) {
  const ws = wb.addWorksheet(nome, {
    properties: { tabColor: { argb: argb(CORES.cinza) } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  const colunaNota = cabecalhos.length + 1;
  ws.columns = [...cabecalhos.map(([, width]) => ({ width })), { width: 70 }];
  const cab = ws.getRow(1);
  cabecalhos.forEach(([t], i) => {
    const cell = cab.getCell(i + 1);
    cell.value = t; cell.fill = preenchimento(CORES.cinza);
    cell.font = fonte({ bold: true, color: { argb: BRANCO } });
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  const nota = cab.getCell(colunaNota);
  nota.value = 'Somente consulta. Não preencha aqui: a lista é atualizada a cada vez que o modelo é baixado.';
  nota.font = fonte({ italic: true, color: { argb: argb(CORES.cinza) } });
  nota.alignment = { horizontal: 'left', vertical: 'middle' };
  cab.height = 22;
  linhas.forEach((valores, idx) => {
    const rowNumero = idx + 2;
    const row = ws.getRow(rowNumero);
    valores.forEach((t, i) => {
      const cell = row.getCell(i + 1);
      cell.value = t; cell.font = fonte();
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      if (rowNumero % 2 === 0) cell.fill = preenchimento(CORES.faixa);
    });
  });
  return ws;
}

/**
 * Gera o modelo de importação de cadastros (.xlsx) em base64.
 * @param pratosNomes nomes dos pratos já cadastrados
 * @param insumosLista insumos já cadastrados, com nome e unidade
 * @param categoriasNomes nomes das categorias já cadastradas
 */
export async function gerarModeloCadastrosBase64(
  pratosNomes: string[],
  insumosLista: InsumoModelo[],
  categoriasNomes: string[],
): Promise<string> {
  const ExcelJS = carregarExcelJS();
  const pratos = limparLista(pratosNomes);
  const categorias = limparLista(categoriasNomes);
  const vistosInsumos = new Set<string>();
  const insumos: InsumoModelo[] = [];
  for (const i of insumosLista) {
    const nome = typeof i?.nome === 'string' ? i.nome.trim() : '';
    if (!nome || vistosInsumos.has(nome)) continue;
    vistosInsumos.add(nome);
    insumos.push({ nome, unidade: typeof i.unidade === 'string' ? i.unidade.trim() : '' });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cozinha Fast Pro'; wb.created = new Date();
  montarInstrucoes(wb);
  montarPratos(wb, categorias);
  montarInsumos(wb);
  montarFicha(wb, pratos.length, insumos.length);
  montarConsulta(wb, ABA_CONSULTA_PRATOS, [['Prato cadastrado', 34]], pratos.map(p => [p]));
  montarConsulta(wb, ABA_CONSULTA_INSUMOS, [['Insumo cadastrado', 34], ['Unidade cadastrada', 20]], insumos.map(i => [i.nome, i.unidade]));
  montarConsulta(wb, ABA_CONSULTA_CATEGORIAS, [['Categoria cadastrada', 34]], categorias.map(c => [c]));
  montarListas(wb, pratos, insumos);

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
