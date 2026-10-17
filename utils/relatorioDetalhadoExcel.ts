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

interface FechamentoDia {
  data: string;
  vendas: {
    comandas_fechadas: number; faturamento_itens: number; gorjeta: number;
    taxa_entrega: number; total_recebido: number; ticket_medio: number;
    por_canal: Record<'mesa' | 'delivery', { comandas_fechadas: number; total_recebido: number }>;
  };
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
  assertNumbers(data.vendas, ['comandas_fechadas', 'faturamento_itens', 'gorjeta', 'taxa_entrega', 'total_recebido', 'ticket_medio']);
  for (const canal of ['mesa', 'delivery'] as const) {
    assertNumbers(data.vendas?.por_canal?.[canal], ['comandas_fechadas', 'total_recebido']);
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
function fechamentoSheets(data: FechamentoDia): Sheet[] {
  assertFechamento(data);
  const { vendas, pagamentos, cancelamentos, pendencias } = data;
  const conciliacao = pagamentos.conciliacao;
  const conferido = [conciliacao.comandas_pago_menor, conciliacao.valor_faltante,
    conciliacao.comandas_pago_maior, conciliacao.valor_excedente, pagamentos.comandas_sem_pagamento].every(value => value === 0);
  const rows: Rows = [
    ['Fechamento do dia'], ['Data', dateBR(data.data)], ['Horário de Brasília. Relatório somente de leitura.'],
    [], ['VENDAS'],
    ['Comandas fechadas', count(vendas.comandas_fechadas)],
    ['Faturamento de itens', money(vendas.faturamento_itens)],
    ['Gorjeta', money(vendas.gorjeta)], ['Taxa de entrega', money(vendas.taxa_entrega)],
    ['Total recebido', money(vendas.total_recebido)], ['Ticket médio', money(vendas.ticket_medio)],
    ['Canal', 'Comandas fechadas', 'Total recebido'],
    ...(['mesa', 'delivery'] as const).map(canal => [channel(canal), count(vendas.por_canal[canal].comandas_fechadas), money(vendas.por_canal[canal].total_recebido)]),
    [], ['FORMAS DE PAGAMENTO'], ['Forma', 'Quantidade', 'Valor entregue', 'Troco', 'Valor líquido'],
    ...PAYMENT_FORMS.map(({ key, label }) => {
      const forma = pagamentos.formas[key];
      return [label, count(forma.quantidade), money(forma.valor_entregue), money(forma.troco), money(forma.valor_liquido)];
    }),
    ['Total líquido', null, null, null, money(pagamentos.total_liquido)],
    ['Dinheiro em caixa', null, null, null, money(pagamentos.dinheiro_em_caixa)],
    [], ['CONFERÊNCIA DE PAGAMENTOS'], ['Conferência', 'Comandas', 'Valor'],
    ['Comandas pagas a menos / valor faltante', count(conciliacao.comandas_pago_menor), money(conciliacao.valor_faltante)],
    ['Comandas pagas a mais / valor excedente', count(conciliacao.comandas_pago_maior), money(conciliacao.valor_excedente)],
    ['Comandas sem pagamento', count(pagamentos.comandas_sem_pagamento)],
    ['Situação', conferido ? 'Tudo conferido' : 'Há divergências nos pagamentos'],
    ['Observação: comandas sem pagamento também contam como pagas a menos.'],
    [], ['CANCELAMENTOS E PERDAS'], ['Classificação', 'Quantidade', 'Valor'],
    ['Cancelamentos', count(cancelamentos.quantidade), money(cancelamentos.valor)],
    ['Perdas', count(cancelamentos.quantidade_perda), money(cancelamentos.valor_perda)],
    ['Observação: perdas são itens cancelados depois que o preparo começou e já estão incluídos nos cancelamentos.'],
  ];
  if (pendencias.disponivel) {
    rows.push([], ['PENDÊNCIAS'],
      ['Total de comandas abertas', count(pendencias.total_comandas_abertas)],
      ['Valor parcial total', money(pendencias.valor_parcial_total)],
      ['Entregas em andamento', count(pendencias.entregas_em_andamento)],
      ['Comanda', 'Tipo', 'Aberta às', 'Subtotal parcial']);
    if (pendencias.comandas_abertas.length === 0) rows.push(['Nenhuma comanda aberta']);
    pendencias.comandas_abertas.slice(0, 50).forEach(row => {
      const label = row.tipo === 'mesa' && row.mesa_numero !== null
        ? `Mesa ${row.mesa_numero}` : row.rotulo?.trim() || (row.tipo === 'delivery' ? 'Delivery' : 'Mesa sem número');
      const hora = new Date(row.aberta_em).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      });
      rows.push([label, channel(row.tipo), hora, money(row.subtotal_parcial)]);
    });
    rows.push(['Observação: lista limitada a 50 comandas. Horários de abertura no horário de Brasília.']);
  }
  return [sheet('Fechamento do dia', rows)];
}

/** Acrescenta apenas as abas novas. Não altera nenhuma célula ou formato das abas existentes. */
export async function appendDetailedReportSheets(workbook: XLSX.WorkBook, periodo: string): Promise<void> {
  const query = `?periodo=${encodeURIComponent(periodo)}`;
  const sections = [
    ...(periodo === 'hoje' ? [{
      name: 'Fechamento do dia',
      load: async () => fechamentoSheets(await apiGet<FechamentoDia>('/api/relatorios/fechamento-dia')),
    }] : []),
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
