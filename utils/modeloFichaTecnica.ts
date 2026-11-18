import type ExcelJSTipos from 'exceljs';
import { CORES } from './exportacao/definicao';
import { carregarExcelJS } from './exportacao/excel';

export type InsumoModelo = { nome: string; unidade: string };

const FONTE = 'Calibri';
const TAMANHO = 10;
const BRANCO = 'FFFFFFFF';
const argb = (hex: string) => `FF${hex}`;
const preenchimento = (hex: string): ExcelJSTipos.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const fino = (hex: string): Partial<ExcelJSTipos.Border> => ({ style: 'thin', color: { argb: argb(hex) } });
const fonte = (extra: Partial<ExcelJSTipos.Font> = {}): Partial<ExcelJSTipos.Font> =>
  ({ name: FONTE, size: TAMANHO, color: { argb: argb(CORES.texto) }, ...extra });

const LARGURAS_INSTRUCOES = [5, 20, 44, 20, 46];
const LINHAS_DADOS = 501;

/** Altura aproximada para um texto com quebra de linha numa largura (em caracteres). */
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
    ws.mergeCells(linha, 1, linha, 5);
    for (let c = 1; c <= 5; c++) {
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
    linha++; // linha em branco
    const row = ws.getRow(linha);
    ws.mergeCells(linha, 1, linha, 5);
    for (let c = 1; c <= 5; c++) {
      const cell = row.getCell(c);
      cell.font = fonte({ bold: true, size: 12, color: { argb: argb(CORES.escuro) } });
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: argb(CORES.principal) } } };
    }
    row.getCell(1).value = titulo;
    row.height = 22;
    linha++;
  };

  faixa('Cozinha Fast Pro  ·  Importação da ficha técnica', { fundo: CORES.escuro, fonte: { bold: true, size: 15, color: { argb: BRANCO } }, altura: 34 });
  faixa('Preencha a aba Ficha técnica e envie o arquivo pelo app.', { fundo: CORES.claro, fonte: { color: { argb: argb(CORES.escuro) } }, altura: 22 });

  // O que é
  secao('O que é a ficha técnica');
  {
    const texto = 'A ficha técnica diz quais insumos cada prato usa e em que quantidade, por porção. É ela que permite ao app calcular o custo e a margem de cada prato.';
    const row = ws.getRow(linha);
    ws.mergeCells(linha, 2, linha, 5);
    const cell = row.getCell(2);
    cell.value = texto; cell.font = fonte();
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row.height = alturaTexto(texto, larguraDe(2, 5));
    linha++;
  }

  // Passo a passo
  secao('Passo a passo');
  [
    'Abra a aba Ficha técnica e preencha uma linha para cada insumo de cada prato.',
    'Se um prato usa três insumos, escreva o nome do prato nas três linhas.',
    'Salve o arquivo, volte ao app, toque em Escolher arquivo Excel e depois em Conferir.',
    'Revise a prévia (o que será criado, atualizado ou recusado) e confirme a importação.',
  ].forEach((texto, i) => {
    const row = ws.getRow(linha);
    const num = row.getCell(1);
    num.value = i + 1; num.fill = preenchimento(CORES.principal);
    num.font = fonte({ bold: true, color: { argb: BRANCO } });
    num.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(linha, 2, linha, 5);
    for (let c = 2; c <= 5; c++) row.getCell(c).fill = preenchimento(CORES.faixa);
    const cell = row.getCell(2);
    cell.value = texto; cell.font = fonte();
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    row.height = alturaTexto(texto, larguraDe(2, 5) - 2, 22);
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
    cab.height = 22;
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

  secao('As 4 colunas da aba Ficha técnica');
  tabela(['Coluna', 'O que escrever', 'Exemplo', 'Atenção'], [
    ['Prato', 'Nome do prato, igual ao cadastrado no app.', 'Feijoada', 'Maiúsculas e acentos não fazem diferença.'],
    ['Insumo', 'Nome do insumo, igual ao cadastrado no Estoque.', 'Feijão preto', 'O insumo precisa existir. A importação não cria insumos.'],
    ['Quantidade', 'Quanto do insumo vai em UMA porção do prato.', '0,25', 'Número maior que zero, com até 3 casas decimais. Não escreva a unidade aqui.'],
    ['Unidade', 'A mesma unidade do insumo no Estoque.', 'kg', 'A importação não converte unidades (g não vira kg).'],
  ], {});

  secao('Exemplo de ficha preenchida (somente ilustração, não será importado)');
  tabela(['Prato (exemplo)', 'Insumo (exemplo)', 'Quantidade (exemplo)', 'Unidade (exemplo)'], [
    ['Feijoada', 'Feijão preto', '0,25', 'kg'],
    ['Feijoada', 'Linguiça', '0,15', 'kg'],
    ['Moqueca de peixe', 'Filé de tilápia', '0,20', 'kg'],
    ['Moqueca de peixe', 'Leite de coco', '0,10', 'l'],
  ], { exemplo: true });

  secao('Regras importantes');
  const regras: [string, string][] = [
    ['Cadastre antes:', ' pratos e insumos precisam estar cadastrados antes. As abas Pratos (consulta) e Insumos (consulta) listam os nomes e unidades de hoje.'],
    ['Importar nunca apaga:', ' se o prato já tem o insumo na ficha, a quantidade é atualizada. Se não tem, o insumo é adicionado. Nada é apagado.'],
    ['Limite:', ' cada arquivo aceita até 500 linhas de dados.'],
    ['Cabeçalhos:', ' não apague nem renomeie os cabeçalhos da aba Ficha técnica. A aba Instruções e as abas de consulta são ignoradas na importação.'],
    ['Dica:', ' você pode usar várias abas de ficha (por exemplo, uma por categoria), desde que cada uma tenha as colunas Prato, Insumo, Quantidade e Unidade na primeira linha.'],
  ];
  regras.forEach(([destaque, resto], i) => {
    const row = ws.getRow(linha);
    const ultima = i === regras.length - 1;
    const marca = row.getCell(1);
    marca.value = ultima ? 'i' : '!';
    marca.fill = preenchimento(ultima ? CORES.principal : CORES.ambar);
    marca.font = fonte({ bold: true, color: { argb: BRANCO } });
    marca.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(linha, 2, linha, 5);
    for (let c = 2; c <= 5; c++) row.getCell(c).fill = preenchimento(CORES.faixa);
    const cell = row.getCell(2);
    cell.value = { richText: [{ text: destaque, font: fonte({ bold: true }) }, { text: resto, font: fonte() }] };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    row.height = alturaTexto(destaque + resto, larguraDe(2, 5) - 2, 22);
    linha++;
  });
  return ws;
}

function montarFicha(wb: ExcelJSTipos.Workbook, pratos: string[], insumos: InsumoModelo[], unidades: string[]) {
  const ws = wb.addWorksheet('Ficha técnica', {
    properties: { tabColor: { argb: argb(CORES.principal) } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  ws.columns = [{ width: 34 }, { width: 34 }, { width: 14 }, { width: 12 }];
  const cab = ws.getRow(1);
  ['Prato', 'Insumo', 'Quantidade', 'Unidade'].forEach((t, i) => {
    const cell = cab.getCell(i + 1);
    cell.value = t; cell.fill = preenchimento(CORES.escuro);
    cell.font = fonte({ bold: true, size: 11, color: { argb: BRANCO } });
    cell.alignment = { horizontal: i === 2 ? 'right' : 'left', vertical: 'middle' };
  });
  cab.height = 24;
  // Estilo por coluna: vale para as linhas de dados sem criar células vazias no arquivo.
  ws.getColumn(1).style = { font: fonte(), alignment: { horizontal: 'left', vertical: 'middle' } };
  ws.getColumn(2).style = { font: fonte(), alignment: { horizontal: 'left', vertical: 'middle' } };
  ws.getColumn(3).style = { font: fonte(), numFmt: '0.###', alignment: { horizontal: 'right', vertical: 'middle' } };
  ws.getColumn(4).style = { font: fonte(), alignment: { horizontal: 'left', vertical: 'middle' } };
  // O estilo de coluna não pode sobrescrever o cabeçalho já formatado.
  ['Prato', 'Insumo', 'Quantidade', 'Unidade'].forEach((_, i) => {
    const cell = cab.getCell(i + 1);
    cell.fill = preenchimento(CORES.escuro);
    cell.font = fonte({ bold: true, size: 11, color: { argb: BRANCO } });
    cell.alignment = { horizontal: i === 2 ? 'right' : 'left', vertical: 'middle' };
    cell.numFmt = 'General';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  // O exceljs aceita validação por intervalo (chave "A2:A501"), mas os tipos não declaram dataValidations.
  const regras = (ws as unknown as { dataValidations: { model: Record<string, Record<string, unknown>> } }).dataValidations.model;
  if (pratos.length > 0) {
    regras[`A2:A${LINHAS_DADOS}`] = {
      type: 'list', allowBlank: true,
      formulae: [`'Pratos (consulta)'!$A$2:$A$${pratos.length + 1}`],
      showErrorMessage: true, errorStyle: 'warning',
      errorTitle: 'Prato não cadastrado', error: 'Esse nome não está na lista de pratos. Confira antes de importar.',
      showInputMessage: true, promptTitle: 'Prato', prompt: 'Escolha na lista ou digite o nome igual ao cadastrado. Repita o prato em cada insumo.',
    };
  }
  if (insumos.length > 0) {
    regras[`B2:B${LINHAS_DADOS}`] = {
      type: 'list', allowBlank: true,
      formulae: [`'Insumos (consulta)'!$A$2:$A$${insumos.length + 1}`],
      showErrorMessage: true, errorStyle: 'warning',
      errorTitle: 'Insumo não cadastrado', error: 'Esse nome não está na lista de insumos. Cadastre-o no Estoque antes.',
      showInputMessage: true, promptTitle: 'Insumo', prompt: 'Escolha na lista ou digite o nome igual ao cadastrado no Estoque.',
    };
  }
  regras[`C2:C${LINHAS_DADOS}`] = {
    type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Quantidade inválida', error: 'Use um número maior que zero (até 3 casas decimais), sem a unidade.',
    showInputMessage: true, promptTitle: 'Quantidade por porção', prompt: 'Quanto do insumo vai em UMA porção. Exemplo: 0,25',
  };
  const listaUnidades = unidades.join(',');
  const unidadesSeguras = unidades.length > 0 && listaUnidades.length <= 250 && !unidades.some(u => /[,"]/.test(u));
  if (unidadesSeguras) {
    regras[`D2:D${LINHAS_DADOS}`] = {
      type: 'list', allowBlank: true,
      formulae: [`"${listaUnidades}"`],
      showErrorMessage: true, errorStyle: 'warning',
      errorTitle: 'Confira a unidade', error: 'A unidade deve ser a mesma do insumo no Estoque.',
      showInputMessage: true, promptTitle: 'Unidade', prompt: 'A mesma unidade do insumo no Estoque (kg, l, un...).',
    };
  }
  return ws;
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

/** Gera o modelo de importação da ficha técnica (.xlsx) em base64. */
export async function gerarModeloFichaTecnicaBase64(pratosNomes: string[], insumosLista: InsumoModelo[]): Promise<string> {
  const ExcelJS = carregarExcelJS();
  const pratos = limparLista(pratosNomes);
  const vistosInsumos = new Set<string>();
  const insumos: InsumoModelo[] = [];
  for (const i of insumosLista) {
    const nome = typeof i?.nome === 'string' ? i.nome.trim() : '';
    if (!nome || vistosInsumos.has(nome)) continue;
    vistosInsumos.add(nome);
    insumos.push({ nome, unidade: typeof i.unidade === 'string' ? i.unidade.trim() : '' });
  }
  const unidades = limparLista(insumos.map(i => i.unidade));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cozinha Fast Pro'; wb.created = new Date();
  montarInstrucoes(wb);
  montarFicha(wb, pratos, insumos, unidades);
  montarConsulta(wb, 'Pratos (consulta)', [['Prato', 34]], pratos.map(p => [p]));
  montarConsulta(wb, 'Insumos (consulta)', [['Insumo', 34], ['Unidade', 12]], insumos.map(i => [i.nome, i.unidade]));

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
