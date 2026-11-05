import { MOTIVOS_DESCONTO } from '@/utils/desconto';
import { apiGet } from '@/utils/api';
import { comRanking, dataHoraBrasil, dataBR } from './definicao';
import type { Contexto, Indicador, Periodo, RelatorioDef, TabelaDef, Valor } from './definicao';
import { diasDoPeriodo, hojeBrasilia } from './periodo';

type Forma = { quantidade: number; valor_entregue: number; troco: number; valor_liquido: number };
type Bloco = {
  quantidade: number; valor: number;
  por_motivo: { motivo: string; quantidade: number; valor: number }[];
  por_responsavel: { nome: string; quantidade: number; valor: number }[];
};
export interface FechamentoDia {
  data: string;
  vendas: {
    comandas_fechadas: number; faturamento_itens: number; gorjeta: number; taxa_entrega: number;
    desconto_aplicado: number; total_recebido: number; ticket_medio: number;
    por_canal: { mesa: { comandas_fechadas: number; total_recebido: number }; delivery: { comandas_fechadas: number; total_recebido: number } };
  };
  descontos: Bloco; cortesias: Bloco;
  pagamentos: {
    formas: Record<'dinheiro' | 'pix' | 'cartao_debito' | 'cartao_credito', Forma>;
    dinheiro_em_caixa: number; comandas_sem_pagamento: number;
    conciliacao: { comandas_pago_menor: number; valor_faltante: number; comandas_pago_maior: number; valor_excedente: number };
  };
  cancelamentos: { quantidade: number; valor: number; quantidade_perda: number; valor_perda: number };
  pendencias: {
    disponivel: boolean;
    comandas_abertas: { tipo: 'mesa' | 'delivery'; mesa_numero: number | null; rotulo: string | null; aberta_em: string; subtotal_parcial: number }[];
  };
}
const FORMAS = [
  ['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['cartao_debito', 'Cartão de débito'], ['cartao_credito', 'Cartão de crédito'],
] as const;
const soma = <T,>(lista: T[], f: (x: T) => number) => lista.reduce((s, x) => s + f(x), 0);
const arred = (n: number) => Math.round(n * 100) / 100;
const motivoLabel = (m: string) => m === 'nao_informado' ? 'Não informado' : MOTIVOS_DESCONTO.find(i => i.value === m)?.label ?? m;

/** Um dia por chamada: o endpoint existente só aceita `data`. Dias em sequência, nunca em paralelo demais. */
export async function carregarFechamentos(periodo: Periodo): Promise<FechamentoDia[]> {
  const resultado: FechamentoDia[] = [];
  const dias = diasDoPeriodo(periodo);
  for (let i = 0; i < dias.length; i += 4) {
    const lote = await Promise.all(dias.slice(i, i + 4).map(d => apiGet<FechamentoDia>(`/api/relatorios/fechamento-dia?data=${d}`)));
    lote.forEach((dia, j) => {
      if (!dia?.vendas || !dia.pagamentos || !dia.cancelamentos || !dia.descontos || !dia.cortesias) {
        throw new Error(`Fechamento de ${dataBR(dias[i + j])} incompleto.`);
      }
      resultado.push({ ...dia, data: dia.data ?? dias[i + j] });
    });
  }
  return resultado.sort((a, b) => a.data.localeCompare(b.data));
}

function juntar<T extends { quantidade: number; valor: number }>(listas: T[][], chave: (x: T) => string, novo: (x: T) => T): T[] {
  const mapa = new Map<string, T>();
  listas.flat().forEach(item => {
    const atual = mapa.get(chave(item));
    if (atual) { atual.quantidade += item.quantidade; atual.valor = arred(atual.valor + item.valor); }
    else mapa.set(chave(item), novo(item));
  });
  return [...mapa.values()];
}

export function montarFechamento(dias: FechamentoDia[], periodo: Periodo, contexto: Contexto): RelatorioDef {
  const v = (f: (d: FechamentoDia) => number) => arred(soma(dias, f));
  const itens = v(d => d.vendas.faturamento_itens), gorjeta = v(d => d.vendas.gorjeta), taxa = v(d => d.vendas.taxa_entrega);
  const descontos = v(d => d.descontos.valor), cortesias = v(d => d.cortesias.valor);
  const aplicado = v(d => d.vendas.desconto_aplicado), total = v(d => d.vendas.total_recebido);
  const comandas = v(d => d.vendas.comandas_fechadas);
  const diferenca = arred(itens + gorjeta + taxa - aplicado - total);
  const R = {
    itens: 'Faturamento dos itens (bruto)', gorjeta: 'Gorjeta', taxa: 'Taxa de entrega', descontos: 'Descontos',
    cortesias: 'Cortesias', aplicado: 'Descontos e cortesias aplicados', total: 'Total recebido (líquido)',
  };
  const resumo: Indicador[] = [
    { rotulo: R.itens, valor: itens, tipo: 'moeda', cor: 'azul', nota: 'Sem gorjeta e sem taxa de entrega' },
    { rotulo: R.gorjeta, valor: gorjeta, tipo: 'moeda', cor: 'verdeAgua', nota: 'Separada do faturamento' },
    { rotulo: R.taxa, valor: taxa, tipo: 'moeda', cor: 'ambar', nota: 'Separada do faturamento' },
    { rotulo: R.descontos, valor: descontos, tipo: 'moeda', cor: 'roxo' },
    { rotulo: R.cortesias, valor: cortesias, tipo: 'moeda', cor: 'rosa' },
    { rotulo: R.aplicado, valor: aplicado, tipo: 'moeda', cor: 'neutro', nota: 'Descontos + cortesias aplicados nas vendas' },
    { rotulo: R.total, valor: total, tipo: 'moeda', cor: 'verdeEscuro' },
    { rotulo: 'Comandas fechadas', valor: comandas, tipo: 'inteiro', cor: 'neutro' },
    { rotulo: 'Ticket médio por comanda', valor: comandas > 0 ? arred(total / comandas) : 0, tipo: 'moeda', cor: 'neutro' },
    {
      rotulo: 'Conferência', valor: diferenca === 0 ? 'Confere' : diferenca, tipo: diferenca === 0 ? 'texto' : 'moeda',
      cor: diferenca === 0 ? 'positivo' : 'negativo', nota: 'Itens + gorjeta + taxa − descontos e cortesias = total recebido',
      formula: ref => {
        const s = `${ref(R.itens)}+${ref(R.gorjeta)}+${ref(R.taxa)}-${ref(R.aplicado)}-${ref(R.total)}`;
        return `IF(ROUND(${s},2)=0,"Confere",ROUND(${s},2))`;
      },
    },
  ];

  const tabelas: TabelaDef[] = [];
  if (dias.length > 1) {
    tabelas.push({
      nome: 'Dia a dia', titulo: 'Dia a dia', rotuloTotal: 'Total', larga: true,
      colunas: [
        { titulo: 'Data', tipo: 'data' }, { titulo: 'Comandas', tipo: 'inteiro', somar: true },
        { titulo: 'Faturamento dos itens', tipo: 'moeda', somar: true }, { titulo: 'Gorjeta', tipo: 'moeda', somar: true },
        { titulo: 'Taxa de entrega', tipo: 'moeda', somar: true }, { titulo: 'Descontos e cortesias', tipo: 'moeda', somar: true },
        { titulo: 'Total recebido', tipo: 'moeda', somar: true }, { titulo: 'Ticket médio', tipo: 'moeda' },
      ],
      linhas: dias.map(d => [d.data, d.vendas.comandas_fechadas, d.vendas.faturamento_itens, d.vendas.gorjeta, d.vendas.taxa_entrega,
        d.vendas.desconto_aplicado, d.vendas.total_recebido, d.vendas.comandas_fechadas > 0 ? arred(d.vendas.total_recebido / d.vendas.comandas_fechadas) : 0]),
    });
  }
  const formas = FORMAS.map(([k, rotulo]) => [rotulo, ...(['quantidade', 'valor_entregue', 'troco', 'valor_liquido'] as const).map(c => v(d => d.pagamentos.formas[k][c]))] as Valor[]);
  const pg = comRanking([
    { titulo: 'Forma de pagamento', tipo: 'texto' }, { titulo: 'Quantidade', tipo: 'inteiro', somar: true },
    { titulo: 'Valor entregue', tipo: 'moeda', somar: true }, { titulo: 'Troco', tipo: 'moeda', somar: true },
    { titulo: 'Valor líquido', tipo: 'moeda', somar: true },
  ], formas, 4);
  tabelas.push({ nome: 'Formas de pagamento', titulo: 'Formas de pagamento', ...pg });
  const canais = comRanking([
    { titulo: 'Canal', tipo: 'texto' }, { titulo: 'Comandas', tipo: 'inteiro', somar: true }, { titulo: 'Total recebido', tipo: 'moeda', somar: true },
  ], [
    ['Mesa', v(d => d.vendas.por_canal.mesa.comandas_fechadas), v(d => d.vendas.por_canal.mesa.total_recebido)],
    ['Delivery', v(d => d.vendas.por_canal.delivery.comandas_fechadas), v(d => d.vendas.por_canal.delivery.total_recebido)],
  ], 2);
  tabelas.push({ nome: 'Canais', titulo: 'Vendas por canal', ...canais });

  const blocos = [['Desconto', 'descontos'], ['Cortesia', 'cortesias']] as const;
  const motivos = blocos.flatMap(([tipo, k]) => juntar(dias.map(d => d[k].por_motivo), x => x.motivo, x => ({ ...x }))
    .map(m => [tipo, motivoLabel(m.motivo), m.quantidade, m.valor] as Valor[]));
  if (motivos.length > 0) {
    const r = comRanking([
      { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Motivo', tipo: 'texto', observacao: true },
      { titulo: 'Comandas', tipo: 'inteiro', somar: true }, { titulo: 'Valor', tipo: 'moeda', somar: true },
    ], motivos, 3);
    tabelas.push({ nome: 'Descontos por motivo', titulo: 'Descontos e cortesias por motivo', ...r });
  }
  const resp = blocos.flatMap(([tipo, k]) => juntar(dias.map(d => d[k].por_responsavel), x => x.nome, x => ({ ...x }))
    .map(m => [tipo, m.nome, m.quantidade, m.valor] as Valor[]));
  if (resp.length > 0) {
    const r = comRanking([
      { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Responsável', tipo: 'texto' },
      { titulo: 'Comandas', tipo: 'inteiro', somar: true }, { titulo: 'Valor', tipo: 'moeda', somar: true },
    ], resp, 3);
    tabelas.push({ nome: 'Descontos por responsável', titulo: 'Descontos e cortesias por responsável', ...r });
  }
  tabelas.push({
    nome: 'Cancelamentos e perdas', titulo: 'Cancelamentos e perdas',
    colunas: [{ titulo: 'Classificação', tipo: 'texto' }, { titulo: 'Itens', tipo: 'inteiro' }, { titulo: 'Valor', tipo: 'moeda' },
      { titulo: 'Observação', tipo: 'texto', observacao: true }],
    linhas: [
      ['Cancelamentos', v(d => d.cancelamentos.quantidade), v(d => d.cancelamentos.valor), null],
      ['Perdas', v(d => d.cancelamentos.quantidade_perda), v(d => d.cancelamentos.valor_perda), 'Cancelados depois do início do preparo; já incluídos em Cancelamentos'],
    ],
  });
  tabelas.push({
    nome: 'Conferência', titulo: 'Conferência de pagamentos',
    colunas: [{ titulo: 'Item', tipo: 'texto' }, { titulo: 'Comandas', tipo: 'inteiro' }, { titulo: 'Valor', tipo: 'moeda' },
      { titulo: 'Observação', tipo: 'texto', observacao: true }],
    linhas: [
      ['Pagas a menos (valor faltante)', v(d => d.pagamentos.conciliacao.comandas_pago_menor), v(d => d.pagamentos.conciliacao.valor_faltante), 'Inclui comandas sem pagamento'],
      ['Pagas a mais (valor excedente)', v(d => d.pagamentos.conciliacao.comandas_pago_maior), v(d => d.pagamentos.conciliacao.valor_excedente), null],
      ['Sem pagamento', v(d => d.pagamentos.comandas_sem_pagamento), null, null],
      ['Dinheiro em caixa', null, v(d => d.pagamentos.dinheiro_em_caixa), null],
    ],
  });
  const hoje = hojeBrasilia();
  const dHoje = dias.find(d => d.data === hoje);
  if (dHoje?.pendencias?.disponivel) {
    const abertas = [...dHoje.pendencias.comandas_abertas].sort((a, b) => a.aberta_em.localeCompare(b.aberta_em)).slice(0, 50)
      .map(c => [c.tipo === 'mesa' && c.mesa_numero != null ? `Mesa ${c.mesa_numero}` : c.rotulo?.trim() || (c.tipo === 'delivery' ? 'Delivery' : 'Mesa'),
        c.tipo === 'delivery' ? 'Delivery' : 'Mesa', c.aberta_em, c.subtotal_parcial] as Valor[]);
    tabelas.push({
      nome: 'Hoje', titulo: 'Hoje: comandas abertas (da mais antiga para a mais nova)', rotuloTotal: 'Total listado',
      colunas: [{ titulo: 'Comanda', tipo: 'texto' }, { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Aberta às', tipo: 'hora' },
        { titulo: 'Subtotal parcial', tipo: 'moeda', somar: true }],
      linhas: abertas.length ? abertas : [['Nenhuma comanda aberta', null, null, null]],
    });
  }
  return {
    titulo: 'Fechamento do dia', periodo, contexto, geradoEm: dataHoraBrasil(),
    resumoTitulo: dias.length > 1 ? 'Resumo do período (soma dos dias)' : 'Resumo do dia', resumo, tabelas,
    pendentes: [
      'Divisão por salão, delivery e QR: o relatório só informa Mesa e Delivery (aba Canais).',
      'Lista completa das comandas do dia: o relatório só traz as comandas abertas agora, e apenas para hoje.',
    ],
  };
}
