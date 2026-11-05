import * as XLSX from 'xlsx';

/**
 * Padrão único das planilhas Excel exportadas pelo app.
 *
 * Limite da biblioteca (SheetJS Community 0.18.5): grava formatos numéricos, fórmulas,
 * larguras, filtro automático, margens e nomes definidos, mas NÃO grava estilos de célula
 * (negrito, preenchimento, bordas, alinhamento, quebra de linha), painéis congelados,
 * orientação/ajuste de página, rodapé nem grade oculta. O padrão aplica tudo o que a
 * biblioteca grava; o restante fica documentado em PENDENTES_DA_BIBLIOTECA.
 */
export const PENDENTES_DA_BIBLIOTECA = [
  'cabeçalho escuro com texto branco em negrito, linha de total em negrito, listras e divisórias',
  'congelar a linha de cabeçalho',
  'alinhamento (valores à direita), quebra de linha em colunas de observação, fonte única',
  'ocultar linhas de grade',
  'A4, paisagem, ajuste a uma página de largura e rodapé com página e data',
] as const;

export type TipoColuna = 'texto' | 'moeda' | 'percentual' | 'inteiro' | 'data' | 'hora';
export type Valor = string | number | null;

export interface Coluna {
  titulo: string;
  tipo: TipoColuna;
  /** Soma a coluna na linha de total (fórmula SUM real). */
  somar?: boolean;
  /** Coluna de observação/motivo: recebe a largura máxima maior. */
  observacao?: boolean;
}

export interface Planilha {
  /** Nome final da aba (≤ 31 caracteres, sem caracteres proibidos). */
  nome: string;
  sheet: XLSX.WorkSheet;
  /** Linha (1-based) do cabeçalho da tabela, para repetir na impressão. */
  linhaCabecalho: number;
}

export const FORMATOS = {
  // Negativos em vermelho pelo próprio formato do Excel.
  moeda: '[$R$-416] #,##0.00;[Red]-[$R$-416] #,##0.00',
  percentual: '0.00%;[Red]-0.00%',
  inteiro: '0;[Red]-0',
  data: 'dd/mm/yyyy',
  hora: 'hh:mm',
} as const;

export const TIME_ZONE = 'America/Sao_Paulo';

export function nomeDaAba(nome: string): string {
  return nome.replace(/[:\\/?*\[\]]/g, '').trim().slice(0, 31);
}

function finito(valor: number): number {
  if (!Number.isFinite(valor)) throw new Error('Número inválido no relatório.');
  return valor;
}

/** Valores numéricos de verdade (nunca texto), com o formato do padrão. */
export const celulaMoeda = (valor: number | null): XLSX.CellObject | null =>
  valor == null ? null : { t: 'n', v: finito(valor), z: FORMATOS.moeda };
/** Recebe a fração (0,25 = 25%). */
export const celulaPercentual = (fracao: number | null): XLSX.CellObject | null =>
  fracao == null ? null : { t: 'n', v: finito(fracao), z: FORMATOS.percentual };
export const celulaInteiro = (valor: number | null): XLSX.CellObject | null =>
  valor == null ? null : { t: 'n', v: Math.round(finito(valor)), z: FORMATOS.inteiro };

/** Data civil 'AAAA-MM-DD' (ou ISO começando por ela) como data do Excel, exibida dd/mm/aaaa. */
export function celulaData(iso: string | null): XLSX.CellObject | null {
  if (iso == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error('Data inválida no relatório.');
  const dias = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
  return { t: 'n', v: dias, z: FORMATOS.data };
}

/** Instante ISO como hora do dia (hh:mm) no horário de Brasília. */
export function celulaHora(iso: string | null): XLSX.CellObject | null {
  if (iso == null) return null;
  const data = new Date(iso);
  if (!Number.isFinite(data.getTime())) throw new Error('Horário inválido no relatório.');
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(data);
  const parte = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value ?? 0);
  return { t: 'n', v: (parte('hour') * 60 + parte('minute')) / 1440, z: FORMATOS.hora };
}

/** "dd/mm/aaaa hh:mm" no horário de Brasília. */
export function dataHoraBrasil(data = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(data).replace(',', '');
}

export function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error('Data inválida no relatório.');
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function converter(tipo: TipoColuna, valor: Valor): XLSX.CellObject | string | null {
  if (valor == null || valor === '') return null;
  if (tipo === 'texto') return String(valor);
  if (tipo === 'data') return celulaData(String(valor));
  if (tipo === 'hora') return celulaHora(String(valor));
  const numero = Number(valor);
  if (tipo === 'moeda') return celulaMoeda(numero);
  if (tipo === 'percentual') return celulaPercentual(numero);
  return celulaInteiro(numero);
}

function larguras(linhas: (XLSX.CellObject | string | null)[][], colunas: Coluna[]): XLSX.ColInfo[] {
  return colunas.map((coluna, indice) => {
    const maximo = coluna.observacao ? 60 : 40;
    let largura = coluna.titulo.length + 3;
    linhas.forEach(linha => {
      const cell = linha[indice];
      if (cell == null) return;
      const texto = typeof cell === 'string' ? cell : cell.w ?? String(cell.v ?? '');
      largura = Math.max(largura, texto.length + (typeof cell === 'string' ? 2 : 6));
    });
    return { wch: Math.min(maximo, Math.max(coluna.tipo === 'texto' ? 12 : 14, largura)) };
  });
}

function aplicarImpressao(ws: XLSX.WorkSheet) {
  ws['!margins'] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
}

/**
 * Uma tabela por aba: cabeçalho na linha 1 a partir da coluna A, sem células mescladas, sem linhas
 * em branco, filtro automático e, quando alguma coluna tem `somar`, linha final de total com
 * fórmulas SUM reais (o valor calculado vai junto para leitores que não recalculam).
 */
export function montarTabela(
  nome: string,
  colunas: Coluna[],
  dados: Valor[][],
  opcoes: { rotuloTotal?: string } = {},
): Planilha {
  const corpo = dados.map(linha => colunas.map((c, i) => converter(c.tipo, linha[i] ?? null)));
  const ws = XLSX.utils.aoa_to_sheet([colunas.map(c => c.titulo), ...corpo]);
  const ultimaLinha = dados.length + 1;
  const todas = [...corpo];
  if (dados.length > 0 && colunas.some(c => c.somar)) {
    const linhaTotal = ultimaLinha + 1;
    const total: (XLSX.CellObject | string | null)[] = colunas.map((c, i) => {
      if (i === 0) return opcoes.rotuloTotal ?? 'Total';
      if (!c.somar) return null;
      const letra = XLSX.utils.encode_col(i);
      const soma = corpo.reduce((acc, linha) => {
        const cell = linha[i];
        return acc + (cell && typeof cell === 'object' && typeof cell.v === 'number' ? cell.v : 0);
      }, 0);
      return { t: 'n', v: soma, f: `SUM(${letra}2:${letra}${ultimaLinha})`, z: FORMATOS[c.tipo as keyof typeof FORMATOS] ?? FORMATOS.inteiro };
    });
    total.forEach((cell, i) => {
      const endereco = XLSX.utils.encode_cell({ r: linhaTotal - 1, c: i });
      if (cell == null) return;
      ws[endereco] = typeof cell === 'string' ? { t: 's', v: cell } : cell;
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhaTotal - 1, c: colunas.length - 1 } });
    todas.push(total);
  }
  ws['!cols'] = larguras(todas, colunas);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(ultimaLinha - 1, 0), c: colunas.length - 1 } }) };
  aplicarImpressao(ws);
  return { nome: nomeDaAba(nome), sheet: ws, linhaCabecalho: 1 };
}

export interface LinhaResumo {
  rotulo: string;
  valor: XLSX.CellObject | string | null;
}

/**
 * Aba "Resumo": bloco de cabeçalho (rótulo à esquerda, valor à direita) e, logo abaixo, a tabela
 * de indicadores. As linhas podem ser fórmulas (CellObject com `f`), por exemplo uma conferência.
 * `indicadores` recebe os números da linha onde cada um ficou, para montar fórmulas.
 */
export function montarResumo(
  nome: string,
  cabecalho: [string, string][],
  tituloIndicadores: [string, string],
  indicadores: (linhaAtual: (rotulo: string) => number) => LinhaResumo[],
): Planilha {
  const linhasCabecalho = cabecalho.map(([rotulo, valor]) => [rotulo, valor] as [string, string]);
  const inicioTabela = linhasCabecalho.length + 2; // uma linha em branco separa o cabeçalho da tabela
  const posicao = new Map<string, number>();
  // Primeiro passo só descobre as posições: os rótulos são conhecidos antes das fórmulas.
  const rotulos = indicadores(rotulo => posicao.get(rotulo) ?? 0).map(l => l.rotulo);
  rotulos.forEach((rotulo, i) => posicao.set(rotulo, inicioTabela + 1 + i));
  const itens = indicadores(rotulo => {
    const linha = posicao.get(rotulo);
    if (!linha) throw new Error(`Indicador desconhecido: ${rotulo}`);
    return linha;
  });
  const ws = XLSX.utils.aoa_to_sheet([
    ...linhasCabecalho, [], tituloIndicadores, ...itens.map(i => [i.rotulo, i.valor]),
  ]);
  const todas = [
    ...linhasCabecalho.map(l => [l[0], l[1]]),
    ...itens.map(i => [i.rotulo, i.valor]),
  ] as (XLSX.CellObject | string | null)[][];
  ws['!cols'] = larguras(todas, [
    { titulo: tituloIndicadores[0], tipo: 'texto' },
    { titulo: tituloIndicadores[1], tipo: 'texto', observacao: true },
  ]);
  aplicarImpressao(ws);
  return { nome: nomeDaAba(nome), sheet: ws, linhaCabecalho: inicioTabela };
}

/** Repete a linha de cabeçalho em cada página impressa. Chamar depois de acrescentar a aba. */
export function registrarTitulosImpressao(workbook: XLSX.WorkBook, planilha: Planilha): void {
  const indice = workbook.SheetNames.indexOf(planilha.nome);
  if (indice < 0) return;
  workbook.Workbook = workbook.Workbook ?? {};
  workbook.Workbook.Names = workbook.Workbook.Names ?? [];
  workbook.Workbook.Names.push({
    Name: '_xlnm.Print_Titles',
    Ref: `'${planilha.nome.replace(/'/g, "''")}'!$${planilha.linhaCabecalho}:$${planilha.linhaCabecalho}`,
    Sheet: indice,
  });
}
