import { apiGet } from '@/utils/api';
import { dataHoraBrasil } from './definicao';
import type { Contexto, Indicador, Periodo, RelatorioDef, TabelaDef, Valor } from './definicao';

/** Percentuais chegam do servidor em unidades de percentual (25 = 25%) e podem ser null. */
type Pct = number | null;

export interface CmvPrato {
  posicao: number; id: string | null; nome: string; categoria: string;
  quantidade_vendida: number; quantidade_cortesia: number; receita: number;
  custo_unitario_ficha: number; cmv: number; cmv_percentual: Pct;
  margem: number; margem_percentual: Pct; participacao_cmv_percentual: Pct;
}
export interface CmvCategoria {
  categoria: string; quantidade_vendida: number; receita: number; cmv: number; cmv_percentual: Pct;
  margem: number; margem_percentual: Pct; participacao_cmv_percentual: Pct;
}
export interface CmvInsumo {
  id: string | null; nome: string; unidade: string; consumo: number; custo_unitario: number | null;
  custo: number; participacao_percentual: Pct;
}
export interface CmvDia { data: string; receita: number; receita_coberta: number; cmv: number; cmv_percentual: Pct }
export interface CmvSemFicha { id: string | null; nome: string; categoria: string; quantidade_vendida: number; receita: number }
export interface CmvIncompleto extends CmvSemFicha { insumos_sem_custo: string[] }
export interface CmvResumo {
  receita_total_geral: number; receita_coberta: number; cmv: number; cmv_percentual: Pct;
  cmv_percentual_coberto: Pct; margem_bruta: number; margem_percentual: Pct; cobertura_percentual: Pct;
  custo_cortesias: number; receita_cortesias: number; custo_perdas: number; quantidade_perdas: number;
  quantidade_itens_vendidos: number; total_pratos_vendidos: number; pratos_com_ficha: number;
  pratos_sem_ficha: number; pratos_custo_incompleto: number;
}
export interface CmvTeorico {
  periodo: Periodo;
  resumo: CmvResumo;
  com_ficha: CmvPrato[];
  por_categoria: CmvCategoria[];
  por_insumo: CmvInsumo[];
  por_dia: CmvDia[];
  sem_ficha: CmvSemFicha[];
  custo_incompleto: CmvIncompleto[];
  perdas: {
    quantidade: number; custo: number; itens_sem_ficha_quantidade: number;
    por_prato: { id: string | null; nome: string; quantidade: number; custo: number }[];
  };
  observacao_custo: string;
}

export const LIMITE_COBERTURA = 90;
export const LEGENDA_CMV = 'Comandas de cortesia não entram na receita; o custo delas entra no CMV. O valor de cardápio das cortesias é só informativo e considera apenas pratos com ficha completa. Se uma cortesia tiver gorjeta, o relatório de Vendas a considera e este não, podendo haver pequena diferença.';
export const AVISO_COBERTURA = 'O CMV está subestimado: alguns pratos vendidos não têm ficha técnica ou têm custo incompleto, e por isso não entraram no cálculo.';

export const consultaCmv = (p: Periodo) => `periodo=personalizado&dataInicio=${p.inicio}&dataFim=${p.fim}`;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validarCmv(v: unknown): v is CmvTeorico {
  if (!isObj(v) || !isObj(v.periodo) || !isObj(v.resumo) || !isObj(v.perdas)) return false;
  return typeof v.periodo.inicio === 'string' && typeof v.periodo.fim === 'string'
    && typeof v.resumo.cmv === 'number' && typeof v.resumo.receita_total_geral === 'number'
    && Array.isArray(v.com_ficha) && Array.isArray(v.por_categoria) && Array.isArray(v.por_insumo)
    && Array.isArray(v.por_dia) && Array.isArray(v.sem_ficha) && Array.isArray(v.custo_incompleto)
    && Array.isArray(v.perdas.por_prato) && typeof v.observacao_custo === 'string';
}

export async function carregarCmv(periodo: Periodo): Promise<CmvTeorico> {
  const r = await apiGet<CmvTeorico>(`/api/relatorios/cmv-teorico?${consultaCmv(periodo)}`);
  if (!validarCmv(r)) throw new Error('O relatório recebido está incompleto. Tente novamente.');
  return r;
}

/** Percentual do servidor (0–100) para fração do Excel/PDF; null continua null (célula vazia). */
const f = (p: Pct | undefined): number | null => (typeof p === 'number' && Number.isFinite(p) ? p / 100 : null);

export function montarCmv(d: CmvTeorico, periodo: Periodo, contexto: Contexto): RelatorioDef {
  const r = d.resumo;
  const cobertura = r.cobertura_percentual;
  const baixa = cobertura !== null && cobertura < LIMITE_COBERTURA;
  const resumo: Indicador[] = [
    { rotulo: 'Receita', valor: r.receita_total_geral, tipo: 'moeda', cor: 'azul', nota: 'Sem cortesias, gorjeta e taxa de entrega' },
    { rotulo: 'CMV (R$)', valor: r.cmv, tipo: 'moeda', cor: 'ambar', nota: 'Inclui o custo das cortesias' },
    { rotulo: 'CMV (% da receita)', valor: f(r.cmv_percentual), tipo: 'percentual', cor: 'ambar', nota: 'CMV ÷ receita total' },
    { rotulo: 'CMV sobre a receita coberta', valor: f(r.cmv_percentual_coberto), tipo: 'percentual', cor: 'neutro', nota: 'CMV ÷ receita dos pratos com ficha' },
    { rotulo: 'Margem bruta (R$)', valor: r.margem_bruta, tipo: 'moeda', cor: 'verdeEscuro', nota: 'Receita coberta − CMV' },
    { rotulo: 'Margem bruta (%)', valor: f(r.margem_percentual), tipo: 'percentual', cor: 'verdeEscuro' },
    { rotulo: 'Cobertura da ficha técnica', valor: f(cobertura), tipo: 'percentual', cor: baixa ? 'negativo' : 'verdeAgua', nota: 'Parte da receita com ficha completa' },
    { rotulo: 'Custo das cortesias', valor: r.custo_cortesias, tipo: 'moeda', cor: 'rosa', nota: 'Só pratos com ficha completa' },
    { rotulo: 'Valor de cardápio das cortesias', valor: r.receita_cortesias, tipo: 'moeda', cor: 'neutro', nota: 'Só informativo' },
    { rotulo: 'Custo das perdas', valor: r.custo_perdas, tipo: 'moeda', cor: 'roxo', nota: `${r.quantidade_perdas.toLocaleString('pt-BR')} item(ns) perdido(s)` },
    { rotulo: 'Itens vendidos', valor: r.quantidade_itens_vendidos, tipo: 'inteiro', cor: 'neutro' },
    { rotulo: 'Pratos com ficha', valor: r.pratos_com_ficha, tipo: 'inteiro', cor: 'neutro', nota: `de ${r.total_pratos_vendidos} vendidos` },
    { rotulo: 'Pratos sem ficha', valor: r.pratos_sem_ficha, tipo: 'inteiro', cor: 'neutro', nota: 'Não entram no CMV' },
    { rotulo: 'Pratos com custo incompleto', valor: r.pratos_custo_incompleto, tipo: 'inteiro', cor: 'neutro', nota: 'Não entram no CMV' },
  ];
  const pendentes = [d.observacao_custo];
  if (baixa) pendentes.unshift(AVISO_COBERTURA);

  const tabelas: TabelaDef[] = [];
  tabelas.push({
    nome: 'Por prato', titulo: 'CMV por prato (do maior para o menor CMV)', larga: true, rotuloTotal: 'Total', congelarColunas: 3,
    colunas: [
      { titulo: 'Posição', tipo: 'inteiro' }, { titulo: 'Prato', tipo: 'texto' }, { titulo: 'Categoria', tipo: 'texto' },
      { titulo: 'Qtd. vendida', tipo: 'inteiro', somar: true }, { titulo: 'Qtd. cortesia', tipo: 'inteiro', somar: true },
      { titulo: 'Receita', tipo: 'moeda', somar: true }, { titulo: 'Custo unitário (ficha)', tipo: 'moeda' },
      { titulo: 'CMV', tipo: 'moeda', somar: true, barra: true }, { titulo: 'CMV %', tipo: 'percentual' },
      { titulo: 'Margem', tipo: 'moeda', somar: true }, { titulo: 'Margem %', tipo: 'percentual' },
      { titulo: '% do CMV total', tipo: 'percentual' },
    ],
    linhas: [...d.com_ficha].sort((a, b) => b.cmv - a.cmv).map((p, i) => [
      i + 1, p.nome, p.categoria, p.quantidade_vendida, p.quantidade_cortesia, p.receita, p.custo_unitario_ficha,
      p.cmv, f(p.cmv_percentual), p.margem, f(p.margem_percentual), f(p.participacao_cmv_percentual)] as Valor[]),
  });
  tabelas.push({
    nome: 'Por categoria', titulo: 'CMV por categoria', larga: true, rotuloTotal: 'Total',
    colunas: [
      { titulo: 'Categoria', tipo: 'texto' }, { titulo: 'Qtd. vendida', tipo: 'inteiro', somar: true },
      { titulo: 'Receita', tipo: 'moeda', somar: true }, { titulo: 'CMV', tipo: 'moeda', somar: true, barra: true },
      { titulo: 'CMV %', tipo: 'percentual' }, { titulo: 'Margem', tipo: 'moeda', somar: true },
      { titulo: 'Margem %', tipo: 'percentual' }, { titulo: '% do CMV total', tipo: 'percentual' },
    ],
    linhas: [...d.por_categoria].sort((a, b) => b.cmv - a.cmv).map(c => [c.categoria, c.quantidade_vendida, c.receita, c.cmv,
      f(c.cmv_percentual), c.margem, f(c.margem_percentual), f(c.participacao_cmv_percentual)] as Valor[]),
  });
  tabelas.push({
    nome: 'Por insumo', titulo: 'Consumo teórico por insumo (do maior para o menor custo)',
    rotuloTotal: 'Total',
    colunas: [
      { titulo: 'Insumo', tipo: 'texto' }, { titulo: 'Unidade', tipo: 'texto' }, { titulo: 'Consumo', tipo: 'texto' },
      { titulo: 'Custo unitário', tipo: 'moeda' }, { titulo: 'Custo', tipo: 'moeda', somar: true, barra: true },
      { titulo: '% do custo', tipo: 'percentual' },
    ],
    linhas: [...d.por_insumo].sort((a, b) => b.custo - a.custo).map(i => [i.nome, i.unidade,
      i.consumo.toLocaleString('pt-BR', { maximumFractionDigits: 3 }), i.custo_unitario, i.custo, f(i.participacao_percentual)] as Valor[]),
  });
  tabelas.push({
    nome: 'Dia a dia', titulo: 'CMV dia a dia', rotuloTotal: 'Total',
    colunas: [
      { titulo: 'Data', tipo: 'data' }, { titulo: 'Receita', tipo: 'moeda', somar: true },
      { titulo: 'Receita coberta', tipo: 'moeda', somar: true }, { titulo: 'CMV', tipo: 'moeda', somar: true },
      { titulo: 'CMV %', tipo: 'percentual' },
    ],
    linhas: [...d.por_dia].sort((a, b) => a.data.localeCompare(b.data))
      .map(x => [x.data, x.receita, x.receita_coberta, x.cmv, f(x.cmv_percentual)] as Valor[]),
  });
  const naoEntram: Valor[][] = [
    ...d.sem_ficha.map(p => ['Sem ficha técnica', p.nome, p.categoria, p.quantidade_vendida, p.receita, null] as Valor[]),
    ...d.custo_incompleto.map(p => ['Custo incompleto', p.nome, p.categoria, p.quantidade_vendida, p.receita,
      `Insumos sem custo: ${p.insumos_sem_custo.join(', ')}`] as Valor[]),
  ];
  tabelas.push({
    nome: 'Sem ficha técnica', titulo: 'Pratos fora do CMV: sem ficha técnica e com custo incompleto',
    observacao: 'Estes pratos não entraram no cálculo do CMV.', larga: true,
    colunas: [
      { titulo: 'Situação', tipo: 'texto' }, { titulo: 'Prato', tipo: 'texto' }, { titulo: 'Categoria', tipo: 'texto' },
      { titulo: 'Qtd. vendida', tipo: 'inteiro', somar: true }, { titulo: 'Receita', tipo: 'moeda', somar: true },
      { titulo: 'Observação', tipo: 'texto', observacao: true },
    ],
    rotuloTotal: 'Total',
    linhas: naoEntram.length ? naoEntram : [['Nenhum prato nesta situação', null, null, null, null, null]],
  });
  const perdas: Valor[][] = [...d.perdas.por_prato].sort((a, b) => b.custo - a.custo).map(p => [p.nome, p.quantidade, p.custo] as Valor[]);
  if (d.perdas.itens_sem_ficha_quantidade > 0) perdas.push(['Itens sem ficha técnica (custo não calculado)', d.perdas.itens_sem_ficha_quantidade, null]);
  tabelas.push({
    nome: 'Perdas', titulo: 'Perdas', rotuloTotal: 'Total',
    colunas: [{ titulo: 'Prato', tipo: 'texto' }, { titulo: 'Quantidade', tipo: 'inteiro', somar: true }, { titulo: 'Custo', tipo: 'moeda', somar: true }],
    linhas: perdas.length ? perdas : [['Nenhuma perda no período', null, null]],
  });

  return {
    titulo: 'CMV teórico', periodo, contexto, geradoEm: dataHoraBrasil(),
    resumoTitulo: 'Resumo do período', resumo, tabelas, pendentes, pendentesTitulo: 'Avisos e observações:', legenda: [LEGENDA_CMV],
  };
}
