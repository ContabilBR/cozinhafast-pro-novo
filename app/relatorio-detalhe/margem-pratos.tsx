import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import {
  useDetailedReport, DetailedReportFrame, ReportCard, ReportTitle, ReportLabel,
  ReportNote, ReportNumber, ReportMoney, ReportBar, ReportEmpty, reportPercent, reportStyles,
} from '@/components/DetailedReport';
import { formatCurrency } from '@/utils/helpers';

interface VendaPrato {
  id: string | null;
  nome: string;
  quantidade_vendida: number;
  receita: number;
}
interface PratoComFicha extends VendaPrato {
  custo_unitario_ficha: number;
  custo_total: number;
  margem: number;
  margem_percentual: number | null;
}
interface PratoCustoIncompleto extends VendaPrato {
  insumos_sem_custo: string[];
}
interface MargemPratosReport {
  periodo: { inicio: string; fim: string };
  resumo: {
    total_pratos_vendidos: number;
    pratos_com_ficha: number;
    pratos_sem_ficha: number;
    pratos_custo_incompleto: number;
    receita_total_geral: number;
    receita_coberta: number;
    custo_total: number;
    margem_total: number;
    margem_percentual: number | null;
    cobertura_percentual: number | null;
  };
  com_ficha: PratoComFicha[];
  sem_ficha: VendaPrato[];
  custo_incompleto: PratoCustoIncompleto[];
  observacao_custo: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function validVenda(value: unknown): value is VendaPrato {
  return object(value) && (value.id === null || text(value.id)) && text(value.nome)
    && finite(value.quantidade_vendida) && finite(value.receita);
}
function validateReport(value: unknown): value is MargemPratosReport {
  if (!object(value) || !object(value.periodo) || !text(value.periodo.inicio) || !text(value.periodo.fim)
    || !object(value.resumo) || !text(value.observacao_custo)) return false;
  const resumo = value.resumo;
  if (!['total_pratos_vendidos', 'pratos_com_ficha', 'pratos_sem_ficha', 'pratos_custo_incompleto']
    .every(key => finite(resumo[key]) && Number.isInteger(resumo[key]) && (resumo[key] as number) >= 0)
    || !['receita_total_geral', 'receita_coberta', 'custo_total', 'margem_total'].every(key => finite(resumo[key]))
    || !nullableNumber(resumo.margem_percentual) || !nullableNumber(resumo.cobertura_percentual)) return false;
  if (!Array.isArray(value.com_ficha) || !Array.isArray(value.sem_ficha) || !Array.isArray(value.custo_incompleto)) return false;
  // Validate the entire response before displaying anything; never drop malformed rows.
  return value.com_ficha.every((row: unknown) => validVenda(row) && object(row)
    && finite(row.custo_unitario_ficha) && finite(row.custo_total) && finite(row.margem)
    && nullableNumber(row.margem_percentual))
    && value.sem_ficha.every(validVenda)
    && value.custo_incompleto.every((row: unknown) => validVenda(row) && object(row)
      && Array.isArray(row.insumos_sem_custo) && row.insumos_sem_custo.every(text))
    && resumo.pratos_com_ficha === value.com_ficha.length
    && resumo.pratos_sem_ficha === value.sem_ficha.length
    && resumo.pratos_custo_incompleto === value.custo_incompleto.length
    && resumo.total_pratos_vendidos === value.com_ficha.length + value.sem_ficha.length + value.custo_incompleto.length;
}
const percent = (value: number | null) => value === null ? '—' : reportPercent(value);
const quantidade = (value: number) => `${value.toLocaleString('pt-BR')} ${value === 1 ? 'unidade vendida' : 'unidades vendidas'}`;

function VendaInfo({ prato }: { prato: VendaPrato }) {
  return <>
    <ReportTitle>{prato.nome}</ReportTitle>
    <ReportNote>{quantidade(prato.quantidade_vendida)}</ReportNote>
    <View style={{ gap: 4 }}><ReportLabel>Receita</ReportLabel><ReportMoney value={prato.receita} /></View>
  </>;
}
function FichaCard({ prato, allowed, children }: { prato: VendaPrato; allowed: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const content = <ReportCard><VendaInfo prato={prato} />{children}
    {prato.id && allowed && <ReportNote>Abrir ficha técnica ›</ReportNote>}
  </ReportCard>;
  if (!prato.id || !allowed) return content;
  return <AnimatedPressable accessibilityRole="button"
    accessibilityLabel={`Abrir ficha técnica de ${prato.nome}. ${quantidade(prato.quantidade_vendida)}. Receita ${formatCurrency(prato.receita)}`}
    accessibilityHint="Abre a ficha técnica para consultar e ajustar os ingredientes do prato."
    style={{ minHeight: 44 }}
    onPress={() => router.push({ pathname: '/prato/ficha-tecnica/[id]', params: { id: prato.id! } } as any)}>
    {content}
  </AnimatedPressable>;
}

export default function MargemPratosScreen() {
  const colors = useColors();
  const state = useDetailedReport<MargemPratosReport>('/api/relatorios/margem-pratos', validateReport);
  const data = state.data;
  const empty = data && data.com_ficha.length === 0 && data.sem_ficha.length === 0 && data.custo_incompleto.length === 0;
  return <DetailedReportFrame title="Margem por prato" state={state}>
    {data && <>
      {empty ? <ReportEmpty>Nenhuma venda no período.</ReportEmpty> : <>
        <ReportCard hero>
          <ReportLabel>Margem total</ReportLabel>
          <ReportMoney value={data.resumo.margem_total} large />
          <ReportNumber>{percent(data.resumo.margem_percentual)}</ReportNumber>
          <ReportNote>Receita coberta: {formatCurrency(data.resumo.receita_coberta)} · Custo total: {formatCurrency(data.resumo.custo_total)}</ReportNote>
        </ReportCard>
        <ReportCard>
          <ReportLabel>Pratos com ficha técnica: {data.resumo.pratos_com_ficha} de {data.resumo.total_pratos_vendidos} vendidos</ReportLabel>
          {data.resumo.cobertura_percentual === null ? <ReportNote>Sem vendas no período</ReportNote> : <>
            <ReportNote>Ficha cobre {reportPercent(data.resumo.cobertura_percentual)} da receita vendida</ReportNote>
            <ReportBar value={data.resumo.cobertura_percentual}
              label={`Ficha cobre ${reportPercent(data.resumo.cobertura_percentual)} da receita vendida`} />
            {data.resumo.cobertura_percentual < 100 && <View style={{ borderLeftWidth: 3, borderLeftColor: colors.warning, paddingLeft: 12, gap: 4 }}>
              <ReportLabel>Atenção</ReportLabel>
              <ReportNote>Os totais consideram só os pratos com ficha completa.</ReportNote>
            </View>}
          </>}
        </ReportCard>
        <View style={{ gap: 12 }}>
          <ReportTitle>Pratos com ficha</ReportTitle>
          {data.com_ficha.length === 0 && <ReportNote>Nenhum prato com ficha completa no período.</ReportNote>}
          {data.com_ficha.map((prato, index) => <ReportCard key={`${prato.id ?? 'removido'}-${index}`}>
            <VendaInfo prato={prato} />
            <View style={reportStyles.columns}>
              <View style={reportStyles.column}><ReportLabel>Custo total</ReportLabel><ReportMoney value={prato.custo_total} /></View>
              <View style={reportStyles.column}><ReportLabel>Margem</ReportLabel>
                <ReportNumber style={{ color: prato.margem > 0 ? colors.success : prato.margem < 0 ? colors.danger : colors.text }}>{formatCurrency(prato.margem)}</ReportNumber>
                <Text style={[reportStyles.note, { color: prato.margem > 0 ? colors.success : prato.margem < 0 ? colors.danger : colors.textSecondary }]}>
                  {percent(prato.margem_percentual)}
                </Text>
              </View>
            </View>
          </ReportCard>)}
        </View>
        {data.sem_ficha.length > 0 && <View style={{ gap: 12 }}>
          <ReportTitle>Sem ficha técnica</ReportTitle>
          {data.sem_ficha.map((prato, index) => <FichaCard key={`${prato.id ?? 'removido'}-${index}`} prato={prato} allowed={state.allowed}>
            <ReportNote>Sem ficha: não entra na margem</ReportNote>
          </FichaCard>)}
        </View>}
        {data.custo_incompleto.length > 0 && <View style={{ gap: 12 }}>
          <ReportTitle>Custo incompleto</ReportTitle>
          <ReportNote>Informe o custo dos insumos no Estoque para incluir estes pratos na margem.</ReportNote>
          {data.custo_incompleto.map((prato, index) => <FichaCard key={`${prato.id ?? 'removido'}-${index}`} prato={prato} allowed={state.allowed}>
            <ReportNote>Insumos sem custo: {prato.insumos_sem_custo.join(', ')}</ReportNote>
          </FichaCard>)}
        </View>}
      </>}
      <ReportNote>{data.observacao_custo}</ReportNote>
    </>}
  </DetailedReportFrame>;
}
