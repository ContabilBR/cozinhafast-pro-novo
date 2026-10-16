import * as XLSX from 'xlsx';
import { apiGet } from '@/utils/api';

type NullableNumber = number | null;
interface PeriodoAPI { nome: string; inicio: string; fim: string }
interface TotaisVendas {
  comandas_fechadas: number; comandas_com_consumo: number; faturamento_itens: number;
  gorjeta: number; taxa_entrega: number; total_recebido: number; ticket_medio: number;
}
interface Vendas {
  periodo: PeriodoAPI; totais: TotaisVendas;
  por_canal: (TotaisVendas & { canal: string })[];
  por_dia: (TotaisVendas & { data: string })[];
  comparacao_anterior?: { periodo: PeriodoAPI; totais: TotaisVendas;
    variacao_percentual: { faturamento_itens: NullableNumber; total_recebido: NullableNumber; ticket_medio: NullableNumber } } | null;
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

type Cell = string | number | null | XLSX.CellObject;
type Rows = Cell[][];
type Sheet = { name: string; sheet: XLSX.WorkSheet };
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
const salesHeaders = ['Comandas fechadas', 'Comandas com consumo', 'Faturamento de itens', 'Gorjeta', 'Taxa de entrega', 'Total recebido', 'Ticket médio'];
function salesRow(value: TotaisVendas): Cell[] {
  return [count(value.comandas_fechadas), count(value.comandas_com_consumo), money(value.faturamento_itens),
    money(value.gorjeta), money(value.taxa_entrega), money(value.total_recebido), money(value.ticket_medio)];
}
function vendasSheets(data: Vendas): Sheet[] {
  assertReport(data, ['por_canal', 'por_dia']);
  const rows: Rows = [['VENDAS'], ...periodRows(data.periodo), [], ['TOTAIS'], salesHeaders, salesRow(data.totais),
    [], ['POR CANAL'], ['Canal', ...salesHeaders], ...data.por_canal.map(row => [channel(row.canal), ...salesRow(row)]),
    [], ['Comandas inconsistentes', count(data.comandas_inconsistentes)]];
  if (data.comparacao_anterior) {
    const previous = data.comparacao_anterior;
    rows.push([], ['COMPARAÇÃO COM O PERÍODO ANTERIOR'], ...periodRows(previous.periodo), salesHeaders, salesRow(previous.totais),
      [], ['Métrica', 'Variação em relação ao período anterior'],
      ['Faturamento de itens', percentage(previous.variacao_percentual.faturamento_itens)],
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

/** Acrescenta apenas as abas novas. Não altera nenhuma célula ou formato das abas existentes. */
export async function appendDetailedReportSheets(workbook: XLSX.WorkBook, periodo: string): Promise<void> {
  const query = `?periodo=${encodeURIComponent(periodo)}`;
  const sections = [
    { name: 'Vendas e Vendas por dia', load: async () => vendasSheets(await apiGet<Vendas>(`/api/relatorios/vendas${query}`)) },
    { name: 'Cancelamentos', load: async () => cancelamentosSheets(await apiGet<Cancelamentos>(`/api/relatorios/cancelamentos${query}`)) },
    { name: 'Mix de pratos', load: async () => mixSheets(await apiGet<Mix>(`/api/relatorios/mix-pratos${query}`)) },
    { name: 'Cozinha', load: async () => cozinhaSheets(await apiGet<Cozinha>(`/api/relatorios/cozinha-tempos${query}`)) },
    { name: 'Delivery por bairro', load: async () => deliverySheets(await apiGet<Delivery>(`/api/relatorios/delivery-bairros${query}`)) },
  ];
  // Construção de cada seção também fica isolada: uma resposta incompleta não bloqueia as demais.
  const results = await Promise.allSettled(sections.map(section => section.load()));
  const warnings: Rows = [['Seção não carregada', 'Aviso']];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      result.value.forEach(value => XLSX.utils.book_append_sheet(workbook, value.sheet, value.name));
    } else {
      warnings.push([sections[index].name, 'Não foi possível carregar esta seção para o período selecionado.']);
    }
  });
  if (warnings.length > 1) {
    const warningSheet = sheet('Avisos', warnings);
    XLSX.utils.book_append_sheet(workbook, warningSheet.sheet, warningSheet.name);
  }
}
