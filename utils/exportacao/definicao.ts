/**
 * Definição simples de um relatório exportável. As MESMAS definições alimentam o gerador de Excel
 * (excel.ts) e o de PDF (pdf.ts): um relatório novo só precisa de uma nova definição.
 */
export type TipoColuna = 'texto' | 'moeda' | 'percentual' | 'inteiro' | 'data' | 'hora';
export type Valor = string | number | null;

/** Paleta única das exportações. Azul principal = azul dos valores do PDF atual (#3B82F6). */
export const CORES = {
  principal: '3B82F6',
  escuro: '0F3460',
  claro: 'EAF2FE',
  faixa: 'F5F9FF',
  borda: 'CBD5E1',
  texto: '1E293B',
  cinza: '64748B',
  positivo: '16A34A',
  negativo: 'DC2626',
  // Blocos do Resumo (cor fixa por indicador, igual em todos os relatórios).
  azul: '3B82F6',
  verdeAgua: '14B8A6',
  ambar: 'F59E0B',
  roxo: '8B5CF6',
  rosa: 'EC4899',
  verdeEscuro: '166534',
  neutro: '94A3B8',
} as const;
export type CorBloco = 'azul' | 'verdeAgua' | 'ambar' | 'roxo' | 'rosa' | 'verdeEscuro' | 'neutro' | 'positivo' | 'negativo';

export interface Indicador {
  rotulo: string;
  valor: number | string | null;
  tipo: TipoColuna;
  cor?: CorBloco;
  /** Explicação curta exibida ao lado do valor. */
  nota?: string;
  /** Fórmula Excel (sem "="); `ref` devolve o endereço da célula do valor de outro indicador. */
  formula?: (ref: (rotulo: string) => string) => string;
}

export interface ColunaDef {
  titulo: string;
  tipo: TipoColuna;
  /** Soma a coluna na linha de total. */
  somar?: boolean;
  /** Coluna de observação/motivo (única que quebra linha). */
  observacao?: boolean;
  /** Barra de dados (formatação condicional) em colunas de valor de rankings. */
  barra?: boolean;
}

export interface TabelaDef {
  /** Nome curto da aba (≤ 31 caracteres). */
  nome: string;
  /** Título da seção no PDF. */
  titulo: string;
  colunas: ColunaDef[];
  linhas: Valor[][];
  rotuloTotal?: string;
  /** Quantas colunas da esquerda ficam congeladas quando a tabela é larga. */
  congelarColunas?: number;
  /** Seção larga: PDF/Excel em paisagem. */
  larga?: boolean;
  /** Aviso curto abaixo do título (PDF) — ex.: dado não disponível. */
  observacao?: string;
}

export interface Contexto {
  restaurante: string;
  cnpj?: string;
  endereco?: string;
  telefone?: string;
  geradoPor: string;
}

export interface Periodo { inicio: string; fim: string } // AAAA-MM-DD, inclusivos

export interface RelatorioDef {
  titulo: string;
  periodo: Periodo;
  contexto: Contexto;
  geradoEm: string; // dd/mm/aaaa hh:mm (Brasília)
  resumoTitulo?: string;
  resumo: Indicador[];
  tabelas: TabelaDef[];
  /** Linhas "o que não foi possível trazer" exibidas no fim do Resumo/PDF. */
  pendentes?: string[];
}

export const LEGENDA = [
  'Bruto = valor dos itens antes de descontos e cortesias. Líquido = valor depois de descontos e cortesias.',
  'Gorjeta e taxa de entrega não entram no faturamento dos itens.',
];

export const TIME_ZONE = 'America/Sao_Paulo';

export function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error('Data inválida no relatório.');
  return `${m[3]}/${m[2]}/${m[1]}`;
}
export function dataHoraBrasil(data = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(data).replace(',', '');
}
export function periodoTexto(p: Periodo): string {
  return p.inicio === p.fim ? dataBR(p.inicio) : `${dataBR(p.inicio)} a ${dataBR(p.fim)}`;
}
/** Linhas do cabeçalho (restaurante, CNPJ, endereço, telefone): campos vazios são omitidos. */
export function linhasDoRestaurante(c: Contexto): string[] {
  const ok = (v?: string) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const identificacao = [ok(c.cnpj) && `CNPJ ${ok(c.cnpj)}`, ok(c.telefone) && `Tel. ${ok(c.telefone)}`].filter(Boolean).join(' · ');
  return [ok(c.restaurante) || 'Restaurante', ok(c.endereco), identificacao].filter(Boolean);
}
/** Linha compacta do topo das abas de tabela. */
export function linhaCompacta(r: RelatorioDef): string {
  return [linhasDoRestaurante(r.contexto)[0], r.titulo, `Período ${periodoTexto(r.periodo)}`,
    `Gerado em ${r.geradoEm} por ${r.contexto.geradoPor}`].join(' · ');
}

/**
 * Ranking: ordena por valor decrescente e acrescenta "Posição" (primeira coluna) e
 * "% do total" (última). A coluna de valor é indicada por índice na definição original.
 */
export function comRanking(
  colunas: ColunaDef[], linhas: Valor[][], indiceValor: number, titulos = { posicao: 'Posição', parte: '% do total' },
): { colunas: ColunaDef[]; linhas: Valor[][] } {
  const ordenadas = [...linhas].sort((a, b) => Number(b[indiceValor] ?? 0) - Number(a[indiceValor] ?? 0));
  const total = ordenadas.reduce((s, l) => s + Number(l[indiceValor] ?? 0), 0);
  return {
    colunas: [{ titulo: titulos.posicao, tipo: 'inteiro' },
      ...colunas.map((c, i) => (i === indiceValor ? { ...c, barra: true } : c)),
      { titulo: titulos.parte, tipo: 'percentual', somar: true }],
    linhas: ordenadas.map((l, i) => [i + 1, ...l, total > 0 ? Number(l[indiceValor] ?? 0) / total : 0]),
  };
}
