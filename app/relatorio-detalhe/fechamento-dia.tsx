import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import {
  DetailedReportFrame, ReportCard, ReportLabel, ReportMoney, ReportNote,
  ReportNumber, ReportTitle, reportStyles, useDetailedReport,
} from '@/components/DetailedReport';
import { useColors } from '@/hooks/useColors';
import { formatCurrency } from '@/utils/helpers';
import { MOTIVOS_DESCONTO } from '@/utils/desconto';

const TIME_ZONE = 'America/Sao_Paulo';
type Canal = { comandas_fechadas: number; total_recebido: number };
type Forma = { quantidade: number; valor_entregue: number; troco: number; valor_liquido: number };
type BlocoDesconto = {
  quantidade: number; valor: number;
  por_motivo: { motivo: string; quantidade: number; valor: number }[];
  por_responsavel: { nome: string; quantidade: number; valor: number }[];
};
interface FechamentoDia {
  data: string;
  eh_hoje: boolean;
  vendas: {
    comandas_fechadas: number; faturamento_itens: number; gorjeta: number;
    taxa_entrega: number; desconto_aplicado: number; total_recebido: number; ticket_medio: number;
    por_canal: { mesa: Canal; delivery: Canal };
  };
  descontos: BlocoDesconto;
  cortesias: BlocoDesconto;
  pagamentos: {
    formas: { dinheiro: Forma; pix: Forma; cartao_debito: Forma; cartao_credito: Forma };
    total_liquido: number; dinheiro_em_caixa: number;
    conciliacao: {
      comandas_pago_menor: number; valor_faltante: number;
      comandas_pago_maior: number; valor_excedente: number;
    };
    comandas_sem_pagamento: number;
  };
  cancelamentos: { quantidade: number; valor: number; quantidade_perda: number; valor_perda: number };
  pendencias: {
    disponivel: boolean; total_comandas_abertas: number; valor_parcial_total: number;
    entregas_em_andamento: number;
    comandas_abertas: {
      comanda_id: string; tipo: 'mesa' | 'delivery'; mesa_numero: number | null;
      rotulo: string | null; aberta_em: string; subtotal_parcial: number;
    }[];
  };
}
const FORMAS = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix', label: 'Pix' },
  { key: 'cartao_debito', label: 'Cartão de débito' },
  { key: 'cartao_credito', label: 'Cartão de crédito' },
] as const;

function hojeBrasilia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// Aritmética sobre uma data civil, sem depender do fuso do aparelho.
function deslocarDia(value: string, delta: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function dataLabel(value: string) {
  return new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', {
    timeZone: TIME_ZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
function horaBrasilia(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('pt-BR', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit',
  }) : '—';
}
const contagem = (value: number, singular: string, plural: string) =>
  `${value.toLocaleString('pt-BR')} ${value === 1 ? singular : plural}`;

const motivoLabel = (motivo: string) => motivo === 'nao_informado' ? 'Não informado'
  : MOTIVOS_DESCONTO.find(item => item.value === motivo)?.label ?? motivo;

function Linha({ label, value, note, danger = false }: { label: string; value: string; note?: string; danger?: boolean }) {
  const colors = useColors();
  return <View style={[reportStyles.row, { borderBottomColor: colors.border }]}>
    <View style={styles.values}>
      <Text style={[reportStyles.label, { color: colors.text, flex: 1 }]}>{label}</Text>
      <ReportNumber style={{ fontSize: 17, flexShrink: 1, maxWidth: '55%', textAlign: 'right', color: danger ? colors.danger : colors.text }}>{value}</ReportNumber>
    </View>
    {!!note && <ReportNote>{note}</ReportNote>}
  </View>;
}

export default function FechamentoDiaScreen() {
  const colors = useColors();
  const [hoje, setHoje] = useState(hojeBrasilia);
  const [escolhida, setEscolhida] = useState(hoje);
  const selecionada = escolhida > hoje ? hoje : escolhida;
  useEffect(() => {
    const update = () => setHoje(hojeBrasilia());
    const timer = setInterval(update, 30_000);
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const validate = useCallback((value: FechamentoDia) => {
    const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    return value?.data === selecionada && typeof value.eh_hoje === 'boolean'
      && !!value.vendas && ['comandas_fechadas', 'faturamento_itens', 'gorjeta', 'taxa_entrega', 'desconto_aplicado', 'total_recebido', 'ticket_medio']
        .every(key => number(value.vendas[key as keyof Omit<FechamentoDia['vendas'], 'por_canal'>]))
      && (['mesa', 'delivery'] as const).every(key => number(value.vendas.por_canal?.[key]?.comandas_fechadas)
        && number(value.vendas.por_canal?.[key]?.total_recebido))
      && (['descontos', 'cortesias'] as const).every(key => {
        const bloco = value[key];
        return !!bloco && [bloco.quantidade, bloco.valor].every(number)
          && Array.isArray(bloco.por_motivo)
          && bloco.por_motivo.every(row => !!row && typeof row.motivo === 'string'
            && [row.quantidade, row.valor].every(number))
          && Array.isArray(bloco.por_responsavel)
          && bloco.por_responsavel.every(row => !!row && typeof row.nome === 'string'
            && [row.quantidade, row.valor].every(number));
      })
      && !!value.pagamentos && FORMAS.every(({ key }) => {
        const forma = value.pagamentos.formas?.[key];
        return !!forma && [forma.quantidade, forma.valor_liquido, forma.troco].every(number);
      })
      && [value.pagamentos.total_liquido, value.pagamentos.dinheiro_em_caixa,
        value.pagamentos.comandas_sem_pagamento, value.pagamentos.conciliacao?.comandas_pago_menor,
        value.pagamentos.conciliacao?.valor_faltante, value.pagamentos.conciliacao?.comandas_pago_maior,
        value.pagamentos.conciliacao?.valor_excedente].every(number)
      && !!value.cancelamentos && [value.cancelamentos.quantidade, value.cancelamentos.valor,
        value.cancelamentos.quantidade_perda, value.cancelamentos.valor_perda].every(number)
      && typeof value.pendencias?.disponivel === 'boolean'
      && (!value.pendencias.disponivel || ([value.pendencias.total_comandas_abertas,
        value.pendencias.valor_parcial_total, value.pendencias.entregas_em_andamento].every(number)
        && Array.isArray(value.pendencias.comandas_abertas)
        && value.pendencias.comandas_abertas.every(row => !!row && typeof row.comanda_id === 'string'
          && typeof row.aberta_em === 'string' && number(row.subtotal_parcial))));
  }, [selecionada]);
  const state = useDetailedReport<FechamentoDia>('/api/relatorios/fechamento-dia', validate, `data=${selecionada}`);
  // Nunca mostra valores do dia anterior durante a troca de data.
  const data = state.data?.data === selecionada ? state.data : null;
  const frameState = { ...state, loading: state.loading || (!!state.data && !data) };
  const mudarData = (next: string) => {
    const limite = hojeBrasilia();
    setHoje(limite);
    setEscolhida(next > limite ? limite : next);
  };
  const controls = <View style={{ gap: 12 }}>
    <ReportTitle>{dataLabel(selecionada)}</ReportTitle>
    <ReportNote>Horário de Brasília · Relatório somente de leitura</ReportNote>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {[
        { label: 'Dia anterior', disabled: false, action: () => mudarData(deslocarDia(selecionada, -1)) },
        { label: 'Próximo dia', disabled: selecionada >= hoje, action: () => mudarData(deslocarDia(selecionada, 1)) },
        { label: 'Hoje', disabled: false, action: () => mudarData(hojeBrasilia()) },
      ].map(button => <AnimatedPressable key={button.label} accessibilityRole="button"
        accessibilityLabel={button.label === 'Hoje' ? 'Selecionar o dia de hoje no horário de Brasília' : `Selecionar ${button.label.toLowerCase()}`}
        accessibilityState={{ disabled: button.disabled }} disabled={button.disabled} onPress={button.action}
        style={[reportStyles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[reportStyles.label, { fontSize: 13, color: colors.primary }]}>{button.label}</Text>
      </AnimatedPressable>)}
    </View>
  </View>;
  const conciliacao = data?.pagamentos.conciliacao;
  const conferido = !!data && !!conciliacao && [conciliacao.comandas_pago_menor, conciliacao.valor_faltante,
    conciliacao.comandas_pago_maior, conciliacao.valor_excedente, data.pagamentos.comandas_sem_pagamento].every(n => n === 0);

  return <DetailedReportFrame title="Fechamento do dia" state={frameState} controls={controls}>
    {data && <>
      <ReportCard hero>
        <ReportTitle>Vendas do dia</ReportTitle>
        {data.vendas.comandas_fechadas === 0 && <ReportNote>Nenhuma venda neste dia</ReportNote>}
        <Linha label="Comandas fechadas" value={data.vendas.comandas_fechadas.toLocaleString('pt-BR')} />
        <Linha label="Faturamento de itens" value={formatCurrency(data.vendas.faturamento_itens)} />
        <Linha label="Gorjeta" value={formatCurrency(data.vendas.gorjeta)} />
        <Linha label="Taxa de entrega" value={formatCurrency(data.vendas.taxa_entrega)} />
        {data.vendas.desconto_aplicado > 0 && <Linha label="Descontos e cortesias nas vendas"
          value={`-${formatCurrency(data.vendas.desconto_aplicado)}`} danger />}
        <ReportLabel>Total recebido</ReportLabel><ReportMoney value={data.vendas.total_recebido} large />
        <Linha label="Ticket médio" value={formatCurrency(data.vendas.ticket_medio)} />
        {(['mesa', 'delivery'] as const).map(canal => <Linha key={canal} label={canal === 'mesa' ? 'Mesa' : 'Delivery'}
          value={formatCurrency(data.vendas.por_canal[canal].total_recebido)}
          note={contagem(data.vendas.por_canal[canal].comandas_fechadas, 'comanda fechada', 'comandas fechadas')} />)}
      </ReportCard>
      {data.descontos.quantidade + data.cortesias.quantidade > 0 && <ReportCard>
        <ReportTitle>Descontos e cortesias</ReportTitle>
        <Linha label="Descontos" value={formatCurrency(data.descontos.valor)}
          note={contagem(data.descontos.quantidade, 'comanda com desconto', 'comandas com desconto')} />
        <Linha label="Cortesias" value={formatCurrency(data.cortesias.valor)}
          note={contagem(data.cortesias.quantidade, 'comanda com cortesia', 'comandas com cortesia')} />
        {[
          { titulo: 'Descontos', bloco: data.descontos },
          { titulo: 'Cortesias', bloco: data.cortesias },
        ].map(({ titulo, bloco }) => bloco.quantidade > 0 && <React.Fragment key={titulo}>
          <ReportLabel>{titulo} por motivo</ReportLabel>
          {bloco.por_motivo.map(row => <Linha key={row.motivo} label={motivoLabel(row.motivo)}
            value={formatCurrency(row.valor)} note={contagem(row.quantidade, 'comanda', 'comandas')} />)}
          <ReportLabel>{titulo} por responsável</ReportLabel>
          {bloco.por_responsavel.map(row => <Linha key={row.nome} label={row.nome}
            value={formatCurrency(row.valor)} note={contagem(row.quantidade, 'comanda', 'comandas')} />)}
        </React.Fragment>)}
        <ReportNote>Cortesias e descontos totais sem gorjeta têm total zero e não entram nas vendas; por isso o valor deste card pode ser maior que a linha de descontos do card de Vendas.</ReportNote>
      </ReportCard>}
      <ReportCard>
        <ReportTitle>Formas de pagamento</ReportTitle>
        {FORMAS.map(({ key, label }) => {
          const forma = data.pagamentos.formas[key];
          return <Linha key={key} label={label} value={formatCurrency(forma.valor_liquido)}
            note={`${contagem(forma.quantidade, 'pagamento', 'pagamentos')} · Valor líquido${key === 'dinheiro' ? ` · Troco devolvido: ${formatCurrency(forma.troco)}` : ''}`} />;
        })}
        <View style={[styles.highlight, { backgroundColor: colors.primaryMuted }]}>
          <ReportLabel>Dinheiro em caixa</ReportLabel><ReportMoney value={data.pagamentos.dinheiro_em_caixa} large />
        </View>
        <Linha label="Total líquido" value={formatCurrency(data.pagamentos.total_liquido)} />
      </ReportCard>
      <ReportCard>
        <ReportTitle>Conferência de pagamentos</ReportTitle>
        <View accessibilityRole={conferido ? undefined : 'alert'} style={[styles.highlight, {
          borderWidth: 1, borderColor: conferido ? colors.success : colors.danger,
          backgroundColor: colors.surfaceSecondary,
        }]}>
          <Ionicons name={conferido ? 'checkmark-circle-outline' : 'warning-outline'} size={24} color={conferido ? colors.success : colors.danger} />
          {conferido ? <ReportLabel>Tudo conferido: pagamentos batem com as vendas</ReportLabel> : <>
            <ReportLabel>Atenção: há divergências nos pagamentos</ReportLabel>
            <ReportNote>Confira as comandas e os valores abaixo. Este relatório não altera pagamentos.</ReportNote>
          </>}
        </View>
        <Linha label="Comandas pagas a menos" value={String(data.pagamentos.conciliacao.comandas_pago_menor)}
          note={`${contagem(data.pagamentos.conciliacao.comandas_pago_menor, 'comanda paga', 'comandas pagas')} a menos (${formatCurrency(data.pagamentos.conciliacao.valor_faltante)} faltando)`} />
        <Linha label="Comandas pagas a mais" value={String(data.pagamentos.conciliacao.comandas_pago_maior)}
          note={`${contagem(data.pagamentos.conciliacao.comandas_pago_maior, 'comanda paga', 'comandas pagas')} a mais (${formatCurrency(data.pagamentos.conciliacao.valor_excedente)} de excesso)`} />
        <Linha label="Comandas sem pagamento" value={String(data.pagamentos.comandas_sem_pagamento)}
          note="Comandas sem pagamento também entram na contagem de pagas a menos." />
      </ReportCard>
      <ReportCard>
        <ReportTitle>Cancelamentos e perdas</ReportTitle>
        <Linha label="Cancelamentos" value={formatCurrency(data.cancelamentos.valor)}
          note={contagem(data.cancelamentos.quantidade, 'item cancelado', 'itens cancelados')} />
        <Linha label="Perdas" value={formatCurrency(data.cancelamentos.valor_perda)}
          note={contagem(data.cancelamentos.quantidade_perda, 'item perdido', 'itens perdidos')} />
        <ReportNote>Perdas são itens cancelados depois que o preparo começou. Já estão incluídas no total de cancelamentos.</ReportNote>
      </ReportCard>
      {selecionada !== hoje || !data.eh_hoje ? <ReportNote>Pendências só aparecem para o dia de hoje</ReportNote>
        : data.pendencias.disponivel && <ReportCard>
          <ReportTitle>Pendências</ReportTitle>
          <Linha label="Comandas abertas" value={String(data.pendencias.total_comandas_abertas)} />
          <Linha label="Valor parcial total" value={formatCurrency(data.pendencias.valor_parcial_total)} />
          <Linha label="Entregas em andamento" value={String(data.pendencias.entregas_em_andamento)} />
          <ReportNote>Até 50 comandas abertas. Horários de abertura em Brasília.</ReportNote>
          {data.pendencias.comandas_abertas.length === 0 && <ReportNote>Nenhuma comanda aberta.</ReportNote>}
          {data.pendencias.comandas_abertas.slice(0, 50).map(row => <Linha key={row.comanda_id}
            label={row.tipo === 'mesa' && row.mesa_numero != null ? `Mesa ${row.mesa_numero}` : row.rotulo?.trim() || (row.tipo === 'delivery' ? 'Delivery' : 'Mesa sem número')}
            value={formatCurrency(row.subtotal_parcial)} note={`Aberta às ${horaBrasilia(row.aberta_em)} · Subtotal parcial`} />)}
        </ReportCard>}
    </>}
  </DetailedReportFrame>;
}
const styles = StyleSheet.create({
  values: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  highlight: { borderRadius: 12, padding: 14, gap: 8 },
});
