import * as XLSX from 'xlsx';
import { apiGet } from '@/utils/api';
import { MOTIVOS_DESCONTO } from '@/utils/desconto';
import {
  FORMATOS, Planilha, Valor, celulaInteiro, celulaMoeda, dataBR, dataHoraBrasil,
  montarResumo, montarTabela, registrarTitulosImpressao,
} from '@/utils/planilhaPadrao';

type NullableNumber = number | null;
interface PeriodoAPI { nome: string; inicio: string; fim: string }
interface TotaisVendas {
  comandas_fechadas: number; comandas_com_consumo: number; faturamento_itens: number;
  gorjeta: number; taxa_entrega: number; desconto_aplicado: number; total_recebido: number; ticket_medio: number;
}
interface Vendas {
  periodo: PeriodoAPI; totais: TotaisVendas;
  por_canal: (TotaisVendas & { canal: string })[];
  por_dia: (TotaisVendas & { data: string })[];
  comparacao_anterior?: { periodo: PeriodoAPI; totais: TotaisVendas;
    variacao_percentual: { faturamento_itens: NullableNumber; desconto_aplicado: NullableNumber; total_recebido: NullableNumber; ticket_medio: NullableNumber } } | null;
  comandas_inconsistentes: number;
}
interface ValorCancelado { quantidade: number; valor: number; valor_perda: number }
interface Cancelamentos {
  totais: { quantidade_cancelada: number; valor_cancelado: number; quantidade_antes_preparo: number;
    valor_antes_preparo: number; quantidade_perda: number; valor_perda: number; percentual_cancelamento: number };
  por_motivo: (ValorCancelado & { codigo: string; nome: string })[];
  por_responsavel: (ValorCancelado & { responsavel_id: string | null; nome: string | null; role: string | null })[];
  pratos_mais_cancelados: (ValorCancelado & { nome: string })[];
  por_canal: (ValorCancelado & { canal: string })[];
  por_dia: (ValorCancelado & { data: string })[];
}
interface Mix {
  totais: { pratos_distintos: number; quantidade_vendida: number; faturamento_itens: number };
  pratos: { posicao: number; prato_id: string | null; nome: string; categoria: string; quantidade_vendida: number;
    faturamento: number; preco_medio: number; percentual_faturamento: number; percentual_acumulado: number; classe_abc: string }[];
  resumo_abc: { classe: string; quantidade_pratos: number; faturamento: number; percentual_faturamento: number }[];
  por_categoria: { categoria: string; quantidade_vendida: number; faturamento: number; percentual_faturamento: number }[];
  sem_vendas: { prato_id: string; nome: string; categoria: string }[];
}
interface MargemVenda {
  id: string | null; nome: string; quantidade_vendida: number; receita: number;
}
interface MargemPratos {
  periodo: { inicio: string; fim: string };
  resumo: {
    total_pratos_vendidos: number; pratos_com_ficha: number; pratos_sem_ficha: number;
    pratos_custo_incompleto: number; receita_total_geral: number; receita_coberta: number;
    custo_total: number; margem_total: number; margem_percentual: NullableNumber;
    cobertura_percentual: NullableNumber;
  };
  com_ficha: (MargemVenda & { custo_unitario_ficha: number; custo_total: number;
    margem: number; margem_percentual: NullableNumber })[];
  sem_ficha: MargemVenda[];
  custo_incompleto: (MargemVenda & { insumos_sem_custo: string[] })[];
  observacao_custo: string;
}
interface Cozinha {
  totais: { itens_medidos: number; itens_sem_medicao: number; comandas_medidas: number;
    tempo_medio_item_min: number; mediana_item_min: NullableNumber; p90_item_min: NullableNumber;
    tempo_medio_pedido_min: number; mediana_pedido_min: NullableNumber; p90_pedido_min: NullableNumber };
  por_prato: { prato_id: string | null; nome: string; categoria: string | null; itens_medidos: number;
    tempo_medio_min: number; p90_min: NullableNumber; meta_min: NullableNumber; percentual_dentro_meta: NullableNumber }[];
  por_hora: { hora: number; itens_medidos: number; tempo_medio_min: number }[];
}
interface Delivery {
  totais: { pedidos: number; faturamento_itens: number; taxa_entrega: number; total_recebido: number;
    ticket_medio: number; tempo_medio_entrega_min: NullableNumber; pedidos_com_tempo: number };
  por_bairro: { bairro: string; pedidos: number; faturamento_itens: number; taxa_entrega: number;
    total_recebido: number; ticket_medio: number; taxa_media: number; tempo_medio_entrega_min: NullableNumber;
    tempo_estimado_medio_min: NullableNumber; percentual_pedidos: number; percentual_total_recebido: number }[];
}

interface FechamentoDia {
  data: string;
  vendas: {
    comandas_fechadas: number; faturamento_itens: number; gorjeta: number;
    taxa_entrega: number; desconto_aplicado: number; total_recebido: number; ticket_medio: number;
    por_canal: Record<'mesa' | 'delivery', { comandas_fechadas: number; total_recebido: number }>;
  };
  descontos: {
    quantidade: number; valor: number;
    por_motivo: { motivo: string; quantidade: number; valor: number }[];
    por_responsavel: { nome: string; quantidade: number; valor: number }[];
  };
  cortesias: FechamentoDia['descontos'];
  pagamentos: {
    formas: Record<'dinheiro' | 'pix' | 'cartao_debito' | 'cartao_credito', {
      quantidade: number; valor_entregue: number; troco: number; valor_liquido: number;
    }>;
    total_liquido: number; dinheiro_em_caixa: number; comandas_sem_pagamento: number;
    conciliacao: {
      comandas_pago_menor: number; valor_faltante: number;
      comandas_pago_maior: number; valor_excedente: number;
    };
  };
  cancelamentos: { quantidade: number; valor: number; quantidade_perda: number; valor_perda: number };
  pendencias: {
    disponivel: boolean; total_comandas_abertas: number; valor_parcial_total: number; entregas_em_andamento: number;
    comandas_abertas: {
      comanda_id: string; tipo: 'mesa' | 'delivery'; mesa_numero: number | null; rotulo: string | null;
      aberta_em: string; subtotal_parcial: number;
    }[];
  };
}

const PAYMENT_FORMS = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix', label: 'Pix' },
  { key: 'cartao_debito', label: 'Cartão de débito' },
  { key: 'cartao_credito', label: 'Cartão de crédito' },
] as const;

type Cell = string | number | null | XLSX.CellObject;
type Rows = Cell[][];
type Sheet = { name: string; sheet: XLSX.WorkSheet; linhaCabecalho?: number };
// SheetJS Community preserva formatos numéricos; não oferece gravação de fontes em negrito.
const CURRENCY = '[$R$-416] #,##0.00';
function numeric(value: number | null | undefined, format: string, divisor = 1): XLSX.CellObject | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Número inválido no relatório.');
  return { t: 'n', v: value / divisor, z: format };
}
const money = (value: number | null | undefined) => numeric(value, CURRENCY);
const percentage = (value: number | null | undefined) => numeric(value, '0.00%', 100);
const minutes = (value: number | null | undefined) => numeric(value, '0.0');
const count = (value: number | null | undefined) => numeric(value, '0');
function dateBR(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error('Data inválida no relatório.');
  return `${match[3]}/${match[2]}/${match[1]}`;
}
const channel = (value: string) => value === 'mesa' ? 'Mesa' : value === 'delivery' ? 'Delivery' : value;
const ROLES: Record<string, string> = {
  administrador: 'Administrador', admin: 'Administrador', gerente: 'Gerente', garcom: 'Garçom',
  cozinha: 'Cozinha', cozinheiro: 'Cozinha', entregador: 'Entregador', superadmin: 'Superadministrador', cliente: 'Cliente',
};
function role(value: string | null) { return value == null ? 'Não identificado' : ROLES[value.toLowerCase()] ?? value; }
function assertReport<T extends { totais: object }>(value: T, arrays: (keyof T)[]) {
  if (!value?.totais || arrays.some(key => !Array.isArray(value[key]))) throw new Error('Resposta incompleta do relatório.');
}
function sheet(name: string, rows: Rows): Sheet {
  const result = XLSX.utils.aoa_to_sheet(rows);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths = Array<number>(columnCount).fill(18);
  rows.forEach(row => row.forEach((cell, column) => {
    if (cell == null) return;
    const value = typeof cell === 'object' ? cell.v : cell;
    widths[column] = Math.min(60, Math.max(widths[column], String(value ?? '').length + (typeof cell === 'object' ? 8 : 2)));
  }));
  result['!cols'] = widths.map(wch => ({ wch }));
  return { name: name.replace(/[:\\/?*\[\]]/g, '').slice(0, 31), sheet: result };
}
function periodRows(value: PeriodoAPI): Rows {
  return [['Período', value.nome], ['Início', dateBR(value.inicio)], ['Fim (exclusivo)', dateBR(value.fim)]];
}
const salesHeaders = ['Comandas fechadas', 'Comandas com consumo', 'Faturamento de itens', 'Gorjeta', 'Taxa de entrega', 'Descontos e cortesias', 'Total recebido', 'Ticket médio'];
function salesRow(value: TotaisVendas): Cell[] {
  return [count(value.comandas_fechadas), count(value.comandas_com_consumo), money(value.faturamento_itens),
    money(value.gorjeta), money(value.taxa_entrega), money(value.desconto_aplicado), money(value.total_recebido), money(value.ticket_medio)];
}
function vendasSheets(data: Vendas): Sheet[] {
  assertReport(data, ['por_canal', 'por_dia']);
  const hasDiscount = (row: TotaisVendas | null | undefined) =>
    typeof row?.desconto_aplicado === 'number' && Number.isFinite(row.desconto_aplicado) && row.desconto_aplicado >= 0;
  const previousDiscount = data.comparacao_anterior?.variacao_percentual?.desconto_aplicado;
  if (![data.totais, ...data.por_canal, ...data.por_dia].every(hasDiscount)
    || (data.comparacao_anterior != null && (!hasDiscount(data.comparacao_anterior.totais)
      || (previousDiscount !== null && (typeof previousDiscount !== 'number' || !Number.isFinite(previousDiscount)))))) {
    throw new Error('Resposta incompleta do relatório de vendas.');
  }
  const rows: Rows = [['VENDAS'], ...periodRows(data.periodo), [], ['TOTAIS'], salesHeaders, salesRow(data.totais),
    [], ['POR CANAL'], ['Canal', ...salesHeaders], ...data.por_canal.map(row => [channel(row.canal), ...salesRow(row)]),
    [], ['Comandas inconsistentes', count(data.comandas_inconsistentes)]];
  if (data.comparacao_anterior) {
    const previous = data.comparacao_anterior;
    rows.push([], ['COMPARAÇÃO COM O PERÍODO ANTERIOR'], ...periodRows(previous.periodo), salesHeaders, salesRow(previous.totais),
      [], ['Métrica', 'Variação em relação ao período anterior'],
      ['Faturamento de itens', percentage(previous.variacao_percentual.faturamento_itens)],
      ['Descontos e cortesias', percentage(previous.variacao_percentual.desconto_aplicado)],
      ['Total recebido', percentage(previous.variacao_percentual.total_recebido)],
      ['Ticket médio', percentage(previous.variacao_percentual.ticket_medio)]);
  }
  return [sheet('Vendas', rows), sheet('Vendas por dia', [
    ['Data', ...salesHeaders], ...data.por_dia.map(row => [dateBR(row.data), ...salesRow(row)]),
  ])];
}
const cancelHeaders = ['Quantidade cancelada', 'Valor cancelado', 'Valor da perda'];
function cancelledRow(value: ValorCancelado): Cell[] { return [count(value.quantidade), money(value.valor), money(value.valor_perda)]; }
function cancelamentosSheets(data: Cancelamentos): Sheet[] {
  assertReport(data, ['por_motivo', 'por_responsavel', 'pratos_mais_cancelados', 'por_canal', 'por_dia']);
  const totals = data.totais;
  return [sheet('Cancelamentos', [
    ['CANCELAMENTOS — TOTAIS'], ['Classificação', ...cancelHeaders, 'Percentual de cancelamento'],
    ['Total (comum + perda)', count(totals.quantidade_cancelada), money(totals.valor_cancelado), money(totals.valor_perda), percentage(totals.percentual_cancelamento)],
    ['Cancelamento comum (antes do preparo)', count(totals.quantidade_antes_preparo), money(totals.valor_antes_preparo), null, null],
    ['Perda (após iniciar preparo)', count(totals.quantidade_perda), money(totals.valor_perda), money(totals.valor_perda), null],
    [], ['MOTIVOS'], ['Código', 'Motivo', ...cancelHeaders], ...data.por_motivo.map(row => [row.codigo, row.nome, ...cancelledRow(row)]),
    [], ['RESPONSÁVEIS'], ['Nome', 'Perfil', ...cancelHeaders],
    ...data.por_responsavel.map(row => [row.nome?.trim() || 'Não identificado', role(row.role), ...cancelledRow(row)]),
    [], ['PRATOS MAIS CANCELADOS'], ['Prato', ...cancelHeaders], ...data.pratos_mais_cancelados.map(row => [row.nome, ...cancelledRow(row)]),
    [], ['POR CANAL'], ['Canal', ...cancelHeaders], ...data.por_canal.map(row => [channel(row.canal), ...cancelledRow(row)]),
    [], ['POR DIA'], ['Data', ...cancelHeaders], ...data.por_dia.map(row => [dateBR(row.data), ...cancelledRow(row)]),
  ])];
}
function mixSheets(data: Mix): Sheet[] {
  assertReport(data, ['pratos', 'resumo_abc', 'por_categoria', 'sem_vendas']);
  return [sheet('Mix de pratos', [
    ['RANKING COMPLETO'], ['Posição', 'Prato', 'Categoria', 'Quantidade vendida', 'Faturamento', 'Preço médio', 'Participação no faturamento', 'Percentual acumulado', 'Classe ABC'],
    ...data.pratos.map(row => [count(row.posicao), row.nome, row.categoria, count(row.quantidade_vendida), money(row.faturamento), money(row.preco_medio), percentage(row.percentual_faturamento), percentage(row.percentual_acumulado), row.classe_abc]),
    [], ['RESUMO POR CLASSE'], ['Classe', 'Quantidade de pratos', 'Faturamento', 'Participação no faturamento'],
    ...data.resumo_abc.map(row => [row.classe, count(row.quantidade_pratos), money(row.faturamento), percentage(row.percentual_faturamento)]),
    [], ['POR CATEGORIA'], ['Categoria', 'Quantidade vendida', 'Faturamento', 'Participação no faturamento'],
    ...data.por_categoria.map(row => [row.categoria, count(row.quantidade_vendida), money(row.faturamento), percentage(row.percentual_faturamento)]),
    [], ['PRATOS SEM VENDA'], ['Prato', 'Categoria'], ...data.sem_vendas.map(row => [row.nome, row.categoria]),
  ])];
}
function assertMargemPratos(value: unknown): asserts value is MargemPratos {
  const invalid = () => { throw new Error('Resposta incompleta do relatório de margem por prato.'); };
  const isObject = (data: unknown): data is Record<string, unknown> =>
    data !== null && typeof data === 'object' && !Array.isArray(data);
  const isText = (data: unknown): data is string => typeof data === 'string' && data.trim().length > 0;
  const nullableFinite = (data: unknown) => data === null || (typeof data === 'number' && Number.isFinite(data));
  if (!isObject(value) || !isObject(value.periodo) || !isObject(value.resumo)) return invalid();
  for (const date of [value.periodo.inicio, value.periodo.fim]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid();
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return invalid();
  }
  const resumo = value.resumo;
  const counts = ['total_pratos_vendidos', 'pratos_com_ficha', 'pratos_sem_ficha', 'pratos_custo_incompleto'];
  assertNumbers(resumo, [...counts, 'receita_total_geral', 'receita_coberta', 'custo_total', 'margem_total']);
  if (counts.some(key => !Number.isInteger(resumo[key]) || (resumo[key] as number) < 0)
    || !nullableFinite(resumo.margem_percentual) || !nullableFinite(resumo.cobertura_percentual)
    || !isText(value.observacao_custo)
    || !Array.isArray(value.com_ficha) || !Array.isArray(value.sem_ficha) || !Array.isArray(value.custo_incompleto)) return invalid();
  const assertVenda = (row: unknown): void => {
    if (!isObject(row) || (row.id !== null && !isText(row.id)) || !isText(row.nome)) return invalid();
    assertNumbers(row, ['quantidade_vendida', 'receita']);
  };
  for (const row of value.com_ficha) {
    // A seção só será montada depois de todas as linhas e contagens serem validadas.
    if (!isObject(row)) return invalid();
    assertVenda(row);
    assertNumbers(row, ['custo_unitario_ficha', 'custo_total', 'margem']);
    if (!nullableFinite(row.margem_percentual)) return invalid();
  }
  for (const row of value.sem_ficha) assertVenda(row);
  for (const row of value.custo_incompleto) {
    if (!isObject(row)) return invalid();
    assertVenda(row);
    if (!Array.isArray(row.insumos_sem_custo) || row.insumos_sem_custo.some(name => !isText(name))) return invalid();
  }
  if (resumo.pratos_com_ficha !== value.com_ficha.length || resumo.pratos_sem_ficha !== value.sem_ficha.length
    || resumo.pratos_custo_incompleto !== value.custo_incompleto.length
    || resumo.total_pratos_vendidos !== value.com_ficha.length + value.sem_ficha.length + value.custo_incompleto.length) return invalid();
}
function margemPratosSheets(data: unknown): Sheet[] {
  assertMargemPratos(data);
  const resumo = data.resumo;
  return [sheet('Margem por prato', [
    ['RESUMO'],
    ['Margem total', money(resumo.margem_total)],
    ['Margem percentual', percentage(resumo.margem_percentual)],
    ['Receita coberta', money(resumo.receita_coberta)],
    ['Custo total', money(resumo.custo_total)],
    ['Receita total geral', money(resumo.receita_total_geral)],
    ['Cobertura da receita', percentage(resumo.cobertura_percentual)],
    ['Pratos com ficha', count(resumo.pratos_com_ficha)],
    ['Pratos sem ficha', count(resumo.pratos_sem_ficha)],
    ['Pratos com custo incompleto', count(resumo.pratos_custo_incompleto)],
    [], ['PRATOS COM FICHA'],
    ['Prato', 'Quantidade vendida', 'Receita', 'Custo unitário da ficha', 'Custo total', 'Margem', 'Margem percentual'],
    ...data.com_ficha.map(row => [row.nome, count(row.quantidade_vendida), money(row.receita),
      money(row.custo_unitario_ficha), money(row.custo_total), money(row.margem), percentage(row.margem_percentual)]),
    [], ['SEM FICHA TÉCNICA'], ['Prato', 'Quantidade vendida', 'Receita'],
    ...data.sem_ficha.map(row => [row.nome, count(row.quantidade_vendida), money(row.receita)]),
    [], ['CUSTO INCOMPLETO'], ['Prato', 'Quantidade vendida', 'Receita', 'Insumos sem custo'],
    ...data.custo_incompleto.map(row => [row.nome, count(row.quantidade_vendida), money(row.receita), row.insumos_sem_custo.join(', ')]),
    [], ['Observação', data.observacao_custo],
  ])];
}
function cozinhaSheets(data: Cozinha): Sheet[] {
  assertReport(data, ['por_prato', 'por_hora']);
  const totals = data.totais;
  return [sheet('Cozinha', [
    ['TOTAIS DE TEMPO'], ['Medição', 'Média (min)', 'Mediana (min)', 'P90 (min)'],
    ['Item', minutes(totals.tempo_medio_item_min), minutes(totals.mediana_item_min), minutes(totals.p90_item_min)],
    ['Pedido', minutes(totals.tempo_medio_pedido_min), minutes(totals.mediana_pedido_min), minutes(totals.p90_pedido_min)],
    [], ['CONTAGENS'], ['Itens medidos', 'Comandas medidas', 'Itens sem medição'],
    [count(totals.itens_medidos), count(totals.comandas_medidas), count(totals.itens_sem_medicao)],
    [], ['POR PRATO'], ['Prato', 'Categoria', 'Itens medidos', 'Tempo médio (min)', 'P90 (min)', 'Meta (min)', 'Itens dentro da meta'],
    ...data.por_prato.map(row => [row.nome, row.categoria, count(row.itens_medidos), minutes(row.tempo_medio_min), minutes(row.p90_min), minutes(row.meta_min), percentage(row.percentual_dentro_meta)]),
    [], ['POR HORA'], ['Hora do dia', 'Itens medidos', 'Tempo médio (min)'],
    ...data.por_hora.map(row => [count(row.hora), count(row.itens_medidos), minutes(row.tempo_medio_min)]),
  ])];
}
function deliverySheets(data: Delivery): Sheet[] {
  assertReport(data, ['por_bairro']);
  const totals = data.totais;
  return [sheet('Delivery por bairro', [
    ['DELIVERY — TOTAIS'], ['Pedidos', 'Faturamento de itens', 'Taxa de entrega', 'Total recebido', 'Ticket médio', 'Tempo médio de entrega (min)', 'Pedidos com medição'],
    [count(totals.pedidos), money(totals.faturamento_itens), money(totals.taxa_entrega), money(totals.total_recebido), money(totals.ticket_medio), minutes(totals.tempo_medio_entrega_min), count(totals.pedidos_com_tempo)],
    [], ['POR BAIRRO'], ['Bairro', 'Pedidos', 'Faturamento de itens', 'Taxa de entrega', 'Total recebido', 'Ticket médio', 'Taxa média', 'Tempo médio de entrega (min)', 'Tempo estimado médio (min)', 'Participação nos pedidos', 'Participação no total recebido'],
    ...data.por_bairro.map(row => [row.bairro, count(row.pedidos), money(row.faturamento_itens), money(row.taxa_entrega), money(row.total_recebido), money(row.ticket_medio), money(row.taxa_media), minutes(row.tempo_medio_entrega_min), minutes(row.tempo_estimado_medio_min), percentage(row.percentual_pedidos), percentage(row.percentual_total_recebido)]),
  ])];
}

function assertNumbers(value: unknown, keys: string[]): void {
  if (!value || typeof value !== 'object' || keys.some(key => {
    const number = (value as Record<string, unknown>)[key];
    return typeof number !== 'number' || !Number.isFinite(number);
  })) throw new Error('Resposta incompleta do fechamento do dia.');
}
function assertFechamento(data: FechamentoDia): void {
  if (!data || typeof data.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.data)) {
    throw new Error('Data inválida no fechamento do dia.');
  }
  const date = new Date(`${data.data}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.data) {
    throw new Error('Data inválida no fechamento do dia.');
  }
  assertNumbers(data.vendas, ['comandas_fechadas', 'faturamento_itens', 'gorjeta', 'taxa_entrega', 'desconto_aplicado', 'total_recebido', 'ticket_medio']);
  for (const canal of ['mesa', 'delivery'] as const) {
    assertNumbers(data.vendas?.por_canal?.[canal], ['comandas_fechadas', 'total_recebido']);
  }
  for (const bloco of [data.descontos, data.cortesias]) {
    assertNumbers(bloco, ['quantidade', 'valor']);
    if (!Array.isArray(bloco.por_motivo) || !Array.isArray(bloco.por_responsavel)) {
      throw new Error('Resposta incompleta do fechamento do dia.');
    }
    bloco.por_motivo.forEach(row => {
      assertNumbers(row, ['quantidade', 'valor']);
      if (typeof row.motivo !== 'string') throw new Error('Resposta incompleta do fechamento do dia.');
    });
    bloco.por_responsavel.forEach(row => {
      assertNumbers(row, ['quantidade', 'valor']);
      if (typeof row.nome !== 'string') throw new Error('Resposta incompleta do fechamento do dia.');
    });
  }
  assertNumbers(data.pagamentos, ['total_liquido', 'dinheiro_em_caixa', 'comandas_sem_pagamento']);
  PAYMENT_FORMS.forEach(({ key }) => {
    assertNumbers(data.pagamentos?.formas?.[key], ['quantidade', 'valor_entregue', 'troco', 'valor_liquido']);
  });
  assertNumbers(data.pagamentos?.conciliacao, ['comandas_pago_menor', 'valor_faltante', 'comandas_pago_maior', 'valor_excedente']);
  assertNumbers(data.cancelamentos, ['quantidade', 'valor', 'quantidade_perda', 'valor_perda']);
  const pendencias = data.pendencias;
  assertNumbers(pendencias, ['total_comandas_abertas', 'valor_parcial_total', 'entregas_em_andamento']);
  if (typeof pendencias?.disponivel !== 'boolean' || !Array.isArray(pendencias.comandas_abertas)) {
    throw new Error('Resposta incompleta das pendências do fechamento do dia.');
  }
  pendencias.comandas_abertas.forEach(row => {
    assertNumbers(row, ['subtotal_parcial']);
    if ((row.tipo !== 'mesa' && row.tipo !== 'delivery')
      || (row.mesa_numero !== null && (typeof row.mesa_numero !== 'number' || !Number.isFinite(row.mesa_numero)))
      || (row.rotulo !== null && typeof row.rotulo !== 'string')
      || typeof row.aberta_em !== 'string' || !Number.isFinite(new Date(row.aberta_em).getTime())) {
      throw new Error('Comanda inválida nas pendências do fechamento do dia.');
    }
  });
}
interface ContextoExportacao { restaurante: string; cnpj: string; geradoPor: string }
async function contextoExportacao(): Promise<ContextoExportacao> {
  const [restaurante, usuario] = await Promise.allSettled([
    apiGet<any>('/api/restaurante'), apiGet<any>('/api/me'),
  ]);
  const r = restaurante.status === 'fulfilled' ? (restaurante.value?.restaurante ?? restaurante.value) : null;
  const u = usuario.status === 'fulfilled' ? (usuario.value?.user ?? usuario.value?.usuario ?? usuario.value) : null;
  const texto = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : 'Não informado';
  return { restaurante: texto(r?.nome), cnpj: texto(r?.cnpj), geradoPor: texto(u?.nome ?? u?.email) };
}
function fechamentoSheets(data: FechamentoDia, contexto: ContextoExportacao): Sheet[] {
  assertFechamento(data);
  const { vendas, pagamentos, cancelamentos, descontos, cortesias, pendencias } = data;
  const conciliacao = pagamentos.conciliacao;
  const motivoLabel = (motivo: string) => motivo === 'nao_informado' ? 'Não informado'
    : MOTIVOS_DESCONTO.find(item => item.value === motivo)?.label ?? motivo;
  const dia = dataBR(data.data);
  const planilhas: Planilha[] = [];

  planilhas.push(montarResumo('Resumo do dia', [
    ['Restaurante', contexto.restaurante], ['CNPJ', contexto.cnpj],
    ['Relatório', 'Fechamento do dia'], ['Período', dia],
    ['Gerado em (horário de Brasília)', dataHoraBrasil()], ['Gerado por', contexto.geradoPor],
  ], ['Indicador', 'Valor'], linha => {
    const f = (rotulo: string) => `B${linha(rotulo)}`;
    const ITENS = 'Faturamento dos itens (bruto, sem gorjeta e taxa)';
    const GORJETA = 'Gorjeta (separada do faturamento)';
    const TAXA = 'Taxa de entrega (separada do faturamento)';
    const APLICADO = 'Descontos e cortesias aplicados nas vendas';
    const TOTAL = 'Total recebido (líquido dos descontos)';
    const diferenca = Math.round((vendas.faturamento_itens + vendas.gorjeta + vendas.taxa_entrega
      - vendas.desconto_aplicado - vendas.total_recebido) * 100) / 100;
    const formula = () => {
      const soma = `${f(ITENS)}+${f(GORJETA)}+${f(TAXA)}-${f(APLICADO)}-${f(TOTAL)}`;
      return `IF(ROUND(${soma},2)=0,"Confere",ROUND(${soma},2))`;
    };
    let confere: XLSX.CellObject;
    try { confere = { t: diferenca === 0 ? 's' : 'n', v: diferenca === 0 ? 'Confere' : diferenca, f: formula(), z: FORMATOS.moeda }; }
    catch { confere = { t: 's', v: '' }; }
    return [
      { rotulo: ITENS, valor: celulaMoeda(vendas.faturamento_itens) },
      { rotulo: GORJETA, valor: celulaMoeda(vendas.gorjeta) },
      { rotulo: TAXA, valor: celulaMoeda(vendas.taxa_entrega) },
      { rotulo: 'Descontos', valor: celulaMoeda(descontos.valor) },
      { rotulo: 'Cortesias', valor: celulaMoeda(cortesias.valor) },
      { rotulo: APLICADO, valor: celulaMoeda(vendas.desconto_aplicado) },
      { rotulo: TOTAL, valor: celulaMoeda(vendas.total_recebido) },
      { rotulo: 'Comandas fechadas', valor: celulaInteiro(vendas.comandas_fechadas) },
      { rotulo: 'Ticket médio por comanda', valor: celulaMoeda(vendas.ticket_medio) },
      { rotulo: 'Conferência: itens + gorjeta + taxa de entrega − descontos = total recebido', valor: confere },
    ];
  }));

  planilhas.push(montarTabela('Pagamentos', [
    { titulo: 'Forma de pagamento', tipo: 'texto' },
    { titulo: 'Quantidade', tipo: 'inteiro', somar: true },
    { titulo: 'Valor entregue', tipo: 'moeda', somar: true },
    { titulo: 'Troco', tipo: 'moeda', somar: true },
    { titulo: 'Valor líquido', tipo: 'moeda', somar: true },
  ], PAYMENT_FORMS.map(({ key, label }) => {
    const forma = pagamentos.formas[key];
    return [label, forma.quantidade, forma.valor_entregue, forma.troco, forma.valor_liquido];
  })));

  planilhas.push(montarTabela('Conferência', [
    { titulo: 'Item', tipo: 'texto' },
    { titulo: 'Comandas', tipo: 'inteiro' },
    { titulo: 'Valor', tipo: 'moeda' },
    { titulo: 'Observação', tipo: 'texto', observacao: true },
  ], [
    ['Pagas a menos (valor faltante)', conciliacao.comandas_pago_menor, conciliacao.valor_faltante, 'Inclui as comandas sem pagamento'],
    ['Pagas a mais (valor excedente)', conciliacao.comandas_pago_maior, conciliacao.valor_excedente, null],
    ['Sem pagamento', pagamentos.comandas_sem_pagamento, null, null],
    ['Dinheiro em caixa', null, pagamentos.dinheiro_em_caixa, null],
  ]));

  planilhas.push(montarTabela('Cancelamentos e perdas', [
    { titulo: 'Classificação', tipo: 'texto' },
    { titulo: 'Quantidade de itens', tipo: 'inteiro' },
    { titulo: 'Valor', tipo: 'moeda' },
    { titulo: 'Observação', tipo: 'texto', observacao: true },
  ], [
    ['Cancelamentos', cancelamentos.quantidade, cancelamentos.valor, null],
    ['Perdas', cancelamentos.quantidade_perda, cancelamentos.valor_perda, 'Itens cancelados depois do início do preparo; já incluídos em Cancelamentos'],
  ]));

  if (descontos.quantidade + cortesias.quantidade > 0) {
    const blocos = [{ tipo: 'Desconto', bloco: descontos }, { tipo: 'Cortesia', bloco: cortesias }];
    const porMotivo = blocos.flatMap(({ tipo, bloco }) => bloco.por_motivo.map(row =>
      [tipo, motivoLabel(row.motivo), row.quantidade, row.valor] as Valor[]));
    if (porMotivo.length > 0) {
      planilhas.push(montarTabela('Descontos por motivo', [
        { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Motivo', tipo: 'texto', observacao: true },
        { titulo: 'Comandas', tipo: 'inteiro', somar: true }, { titulo: 'Valor', tipo: 'moeda', somar: true },
      ], porMotivo));
    }
    const porResponsavel = blocos.flatMap(({ tipo, bloco }) => bloco.por_responsavel.map(row =>
      [tipo, row.nome, row.quantidade, row.valor] as Valor[]));
    if (porResponsavel.length > 0) {
      planilhas.push(montarTabela('Descontos por responsável', [
        { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Responsável', tipo: 'texto' },
        { titulo: 'Comandas', tipo: 'inteiro', somar: true }, { titulo: 'Valor', tipo: 'moeda', somar: true },
      ], porResponsavel));
    }
  }

  if (pendencias.disponivel) {
    const abertas = pendencias.comandas_abertas.slice(0, 50).map(row => [
      row.tipo === 'mesa' && row.mesa_numero !== null
        ? `Mesa ${row.mesa_numero}` : row.rotulo?.trim() || (row.tipo === 'delivery' ? 'Delivery' : 'Mesa sem número'),
      channel(row.tipo), row.aberta_em, row.subtotal_parcial,
    ] as Valor[]);
    planilhas.push(montarTabela('Hoje', [
      { titulo: 'Comanda aberta', tipo: 'texto' }, { titulo: 'Tipo', tipo: 'texto' },
      { titulo: 'Aberta às', tipo: 'hora' }, { titulo: 'Subtotal parcial', tipo: 'moeda', somar: true },
    ], abertas.length > 0 ? abertas : [['Nenhuma comanda aberta', null, null, null]], { rotuloTotal: 'Total listado' }));
  }
  return planilhas.map(p => ({ name: p.nome, sheet: p.sheet, linhaCabecalho: p.linhaCabecalho }));
}

/** Acrescenta apenas as abas novas. Não altera nenhuma célula ou formato das abas existentes. */
export async function appendDetailedReportSheets(workbook: XLSX.WorkBook, periodo: string): Promise<void> {
  const query = `?periodo=${encodeURIComponent(periodo)}`;
  const sections = [
    ...(periodo === 'hoje' ? [{
      name: 'Fechamento do dia',
      load: async () => {
        const [fechamento, contexto] = await Promise.all([apiGet<FechamentoDia>('/api/relatorios/fechamento-dia'), contextoExportacao()]);
        return fechamentoSheets(fechamento, contexto);
      },
    }] : []),
    { name: 'Vendas e Vendas por dia', load: async () => vendasSheets(await apiGet<Vendas>(`/api/relatorios/vendas${query}`)) },
    { name: 'Cancelamentos', load: async () => cancelamentosSheets(await apiGet<Cancelamentos>(`/api/relatorios/cancelamentos${query}`)) },
    { name: 'Mix de pratos', load: async () => mixSheets(await apiGet<Mix>(`/api/relatorios/mix-pratos${query}`)) },
    { name: 'Margem por prato', load: async () => margemPratosSheets(await apiGet<unknown>(`/api/relatorios/margem-pratos${query}`)) },
    { name: 'Cozinha', load: async () => cozinhaSheets(await apiGet<Cozinha>(`/api/relatorios/cozinha-tempos${query}`)) },
    { name: 'Delivery por bairro', load: async () => deliverySheets(await apiGet<Delivery>(`/api/relatorios/delivery-bairros${query}`)) },
  ];
  // Construção de cada seção também fica isolada: uma resposta incompleta não bloqueia as demais.
  const results = await Promise.allSettled(sections.map(section => section.load()));
  const warnings: Rows = [['Seção não carregada', 'Aviso']];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      result.value.forEach(value => {
        XLSX.utils.book_append_sheet(workbook, value.sheet, value.name);
        if (value.linhaCabecalho) registrarTitulosImpressao(workbook, { nome: value.name, sheet: value.sheet, linhaCabecalho: value.linhaCabecalho });
      });
    } else {
      warnings.push([sections[index].name, 'Não foi possível carregar esta seção para o período selecionado.']);
    }
  });
  if (warnings.length > 1) {
    const warningSheet = sheet('Avisos', warnings);
    XLSX.utils.book_append_sheet(workbook, warningSheet.sheet, warningSheet.name);
  }
}
