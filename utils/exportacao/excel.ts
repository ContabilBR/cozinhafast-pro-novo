import type ExcelJSTipos from 'exceljs';
import { CORES, LEGENDA, TIME_ZONE, linhaCompacta, linhasDoRestaurante, periodoTexto } from './definicao';
import type { ColunaDef, CorBloco, RelatorioDef, TipoColuna, Valor } from './definicao';

// Versão do navegador do exceljs (traz seus próprios polyfills; a versão "node" não roda no app).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs/dist/exceljs.min.js') as typeof ExcelJSTipos;

const FONTE = 'Calibri';
const TAMANHO = 10;
const FORMATOS: Record<TipoColuna, string | undefined> = {
  texto: undefined,
  moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  percentual: '0.00%;[Red]-0.00%',
  inteiro: '0;[Red]-0',
  data: 'dd/mm/yyyy',
  hora: 'hh:mm',
};
const argb = (hex: string) => `FF${hex}`;
const preenchimento = (hex: string): ExcelJSTipos.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const fino = (hex: string): Partial<ExcelJSTipos.Border> => ({ style: 'thin', color: { argb: argb(hex) } });

function serialData(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error('Data inválida no relatório.');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function fracaoHora(iso: string): number {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Horário inválido no relatório.');
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = (t: string) => Number(partes.find(x => x.type === t)?.value ?? 0);
  return (p('hour') * 60 + p('minute')) / 1440;
}
/** Sempre número de verdade (nunca texto) nas colunas numéricas. */
function converter(tipo: TipoColuna, valor: Valor): ExcelJSTipos.CellValue {
  if (valor == null || valor === '') return null;
  if (tipo === 'texto') return String(valor);
  if (tipo === 'data') return serialData(String(valor));
  if (tipo === 'hora') return fracaoHora(String(valor));
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error('Número inválido no relatório.');
  return tipo === 'inteiro' ? Math.round(n) : n;
}
const alinhamento = (tipo: TipoColuna, observacao?: boolean): Partial<ExcelJSTipos.Alignment> =>
  tipo === 'texto'
    ? { horizontal: 'left', vertical: observacao ? 'top' : 'middle', wrapText: !!observacao }
    : { horizontal: 'right', vertical: 'middle' };
function nomeAba(nome: string, usados: Set<string>): string {
  const base = nome.replace(/[:\\/?*\[\]]/g, '').trim().slice(0, 31) || 'Planilha';
  let final = base; let n = 2;
  while (usados.has(final.toLowerCase())) final = `${base.slice(0, 28)} ${n++}`;
  usados.add(final.toLowerCase());
  return final;
}
function larguraDe(coluna: ColunaDef, textos: string[]): number {
  const maximo = coluna.observacao ? 60 : 40;
  const maior = Math.max(coluna.titulo.length + 3, ...textos.map(t => t.length + 2));
  return Math.min(maximo, Math.max(coluna.tipo === 'texto' ? 12 : 13, maior));
}
const textoAproximado = (tipo: TipoColuna, v: Valor): string => {
  if (v == null) return '';
  if (tipo === 'moeda') return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (tipo === 'percentual') return `${(Number(v) * 100).toFixed(2)}%`;
  if (tipo === 'data') return '00/00/0000';
  if (tipo === 'hora') return '00:00';
  return String(v);
};

function configurarPagina(ws: ExcelJSTipos.Worksheet, r: RelatorioDef, paisagem: boolean, linhaTitulos?: number) {
  ws.pageSetup = {
    paperSize: 9, orientation: paisagem ? 'landscape' : 'portrait',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    ...(linhaTitulos ? { printTitlesRow: `${linhaTitulos}:${linhaTitulos}` } : {}),
  };
  ws.headerFooter = {
    oddFooter: `&L&8${LEGENDA[1]}&C&8${r.titulo} · ${periodoTexto(r.periodo)}&R&8Página &P de &N`,
  };
}

const COR_BLOCO: Record<CorBloco, string> = {
  azul: CORES.azul, verdeAgua: CORES.verdeAgua, ambar: CORES.ambar, roxo: CORES.roxo, rosa: CORES.rosa,
  verdeEscuro: CORES.verdeEscuro, neutro: CORES.neutro, positivo: CORES.positivo, negativo: CORES.negativo,
};

function montarResumo(wb: ExcelJSTipos.Workbook, r: RelatorioDef, usados: Set<string>) {
  const ws = wb.addWorksheet(nomeAba('Resumo', usados), {
    properties: { tabColor: { argb: argb(CORES.escuro) } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 56 }, { width: 24 }, { width: 62 }];
  const fonte = (extra: Partial<ExcelJSTipos.Font> = {}): Partial<ExcelJSTipos.Font> => ({ name: FONTE, size: TAMANHO, color: { argb: argb(CORES.texto) }, ...extra });
  let linha = 1;
  linhasDoRestaurante(r.contexto).forEach((texto, i) => {
    const row = ws.getRow(linha++);
    row.getCell(1).value = texto;
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      cell.fill = preenchimento(CORES.escuro);
      cell.font = fonte({ bold: i === 0, size: i === 0 ? 11 : TAMANHO, color: { argb: 'FFFFFFFF' } });
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
  });
  const info: [string, string][] = [
    ['Relatório', r.titulo], ['Período', periodoTexto(r.periodo)],
    ['Gerado em (horário de Brasília)', r.geradoEm], ['Gerado por', r.contexto.geradoPor],
  ];
  info.forEach(([rotulo, valor]) => {
    const row = ws.getRow(linha++);
    row.getCell(1).value = rotulo; row.getCell(2).value = valor;
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      cell.fill = preenchimento(CORES.claro);
      cell.font = fonte({ bold: c === 1 });
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
  });
  linha++; // linha em branco entre o cabeçalho e os indicadores
  const titulo = ws.getRow(linha++);
  titulo.getCell(1).value = r.resumoTitulo ?? 'Indicadores'; titulo.getCell(2).value = 'Valor';
  titulo.getCell(3).value = 'Observação';
  for (let c = 1; c <= 3; c++) {
    const cell = titulo.getCell(c);
    cell.fill = preenchimento(CORES.escuro);
    cell.font = fonte({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.alignment = { horizontal: c === 2 ? 'right' : 'left', vertical: 'middle' };
  }
  const posicoes = new Map<string, number>();
  r.resumo.forEach((ind, i) => posicoes.set(ind.rotulo, linha + i));
  const ref = (rotulo: string) => {
    const p = posicoes.get(rotulo);
    if (!p) throw new Error(`Indicador desconhecido: ${rotulo}`);
    return `B${p}`;
  };
  r.resumo.forEach(ind => {
    const row = ws.getRow(linha++);
    row.height = 20;
    const cor = COR_BLOCO[ind.cor ?? 'neutro'];
    const a = row.getCell(1); const b = row.getCell(2); const c = row.getCell(3);
    a.value = ind.rotulo;
    const bruto = ind.valor == null ? null : ind.tipo === 'texto' ? String(ind.valor) : converter(ind.tipo, ind.valor as Valor);
    b.value = ind.formula ? { formula: ind.formula(ref), result: bruto as ExcelJSTipos.CellFormulaValue['result'] } : bruto;
    if (FORMATOS[ind.tipo]) b.numFmt = FORMATOS[ind.tipo]!;
    c.value = ind.nota ?? null;
    [a, b, c].forEach(cell => {
      cell.fill = preenchimento(CORES.faixa);
      cell.border = { bottom: fino(CORES.borda) };
    });
    a.border = { ...a.border, left: { style: 'thick', color: { argb: argb(cor) } } };
    a.font = fonte(); a.alignment = { horizontal: 'left', vertical: 'middle' };
    const negativo = typeof ind.valor === 'number' && ind.valor < 0;
    const alerta = ind.formula && typeof ind.valor === 'number';
    const confere = ind.formula && ind.valor === 'Confere';
    b.font = fonte({ bold: true, color: { argb: argb(negativo || alerta ? CORES.negativo : confere ? CORES.positivo : CORES.texto) } });
    b.alignment = { horizontal: 'right', vertical: 'middle' };
    c.font = fonte({ color: { argb: argb(CORES.cinza) } }); c.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  linha++;
  [...LEGENDA, ...(r.pendentes?.length ? ['Não disponível neste relatório:', ...r.pendentes.map(p => `• ${p}`)] : [])].forEach(texto => {
    const cell = ws.getRow(linha++).getCell(1);
    cell.value = texto; cell.font = fonte({ color: { argb: argb(CORES.cinza) } });
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  configurarPagina(ws, r, false);
  return ws;
}

function montarTabela(wb: ExcelJSTipos.Workbook, r: RelatorioDef, tabela: RelatorioDef['tabelas'][number], usados: Set<string>) {
  const ws = wb.addWorksheet(nomeAba(tabela.nome, usados), {
    properties: { tabColor: { argb: argb(CORES.principal) } },
    views: [{ showGridLines: false }],
  });
  const { colunas, linhas } = tabela;
  const fonte = (extra: Partial<ExcelJSTipos.Font> = {}): Partial<ExcelJSTipos.Font> => ({ name: FONTE, size: TAMANHO, color: { argb: argb(CORES.texto) }, ...extra });
  const compacta = ws.getRow(1).getCell(1);
  compacta.value = linhaCompacta(r); compacta.font = fonte({ color: { argb: argb(CORES.cinza) } });
  compacta.alignment = { horizontal: 'left', vertical: 'middle' };

  const cab = ws.getRow(2);
  colunas.forEach((c, i) => {
    const cell = cab.getCell(i + 1);
    cell.value = c.titulo; cell.fill = preenchimento(CORES.escuro);
    cell.font = fonte({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.alignment = { ...alinhamento(c.tipo), wrapText: true, vertical: 'middle' };
  });
  cab.height = 22;

  linhas.forEach((dados, idx) => {
    const row = ws.getRow(3 + idx);
    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = converter(c.tipo, dados[i] ?? null);
      if (FORMATOS[c.tipo]) cell.numFmt = FORMATOS[c.tipo]!;
      cell.font = fonte(); cell.alignment = alinhamento(c.tipo, c.observacao);
      if (idx % 2 === 1) cell.fill = preenchimento(CORES.faixa);
    });
  });
  const ultima = 2 + linhas.length;
  let ultimaComTotal = ultima;
  if (linhas.length > 0 && colunas.some(c => c.somar)) {
    ultimaComTotal = ultima + 1;
    const row = ws.getRow(ultimaComTotal);
    colunas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (i === 0) cell.value = tabela.rotuloTotal ?? 'Total';
      else if (c.somar) {
        const letra = ws.getColumn(i + 1).letter;
        const soma = linhas.reduce((s, l) => s + Number(l[i] ?? 0), 0);
        cell.value = { formula: `SUM(${letra}3:${letra}${ultima})`, result: soma };
        if (FORMATOS[c.tipo]) cell.numFmt = FORMATOS[c.tipo]!;
      }
      cell.font = fonte({ bold: true });
      cell.fill = preenchimento(CORES.claro);
      cell.border = { top: { style: 'medium', color: { argb: argb(CORES.principal) } } };
      cell.alignment = alinhamento(c.tipo);
    });
  }

  colunas.forEach((c, i) => {
    const textos = linhas.map(l => textoAproximado(c.tipo, l[i] ?? null));
    ws.getColumn(i + 1).width = larguraDe(c, textos);
  });
  if (linhas.length > 0) {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: ultima, column: colunas.length } };
    colunas.forEach((c, i) => {
      if (!c.barra) return;
      const letra = ws.getColumn(i + 1).letter;
      ws.addConditionalFormatting({
        ref: `${letra}3:${letra}${ultima}`,
        rules: [{
          type: 'dataBar', gradient: false, showValue: true, minLength: 0, maxLength: 100,
          cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: argb('93C5FD') },
        } as unknown as ExcelJSTipos.ConditionalFormattingRule],
      });
    });
  }
  const larga = tabela.larga ?? colunas.length > 6;
  const congelar = tabela.congelarColunas ?? (larga ? 1 : 0);
  ws.views = [{ state: 'frozen', xSplit: congelar, ySplit: 2, showGridLines: false }];
  configurarPagina(ws, r, larga, 2);
  return ws;
}

/** Gera a pasta de trabalho (base64) a partir da definição do relatório. */
export async function gerarExcelBase64(r: RelatorioDef): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = r.contexto.geradoPor; wb.created = new Date();
  const usados = new Set<string>();
  montarResumo(wb, r, usados);
  r.tabelas.forEach(t => montarTabela(wb, r, t, usados));
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
