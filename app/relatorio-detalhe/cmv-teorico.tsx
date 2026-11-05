import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DetailedReportFrame, ReportBar, ReportCard, ReportLabel, ReportMoney, ReportNote, ReportNumber,
  ReportTitle, reportStyles, useDetailedReport,
} from '@/components/DetailedReport';
import { SeletorPeriodo, periodoDoEstado, periodoInicial } from '@/components/SeletorPeriodo';
import { BotoesExportar } from '@/components/BotoesExportar';
import { useColors } from '@/hooks/useColors';
import { formatCurrency } from '@/utils/helpers';
import { carregarContexto } from '@/utils/exportacao/exportar';
import {
  AVISO_COBERTURA, LEGENDA_CMV, LIMITE_COBERTURA, carregarCmv, consultaCmv, montarCmv, validarCmv,
} from '@/utils/exportacao/cmv';
import type { CmvTeorico } from '@/utils/exportacao/cmv';

/** Percentual do servidor (0–100). Null (denominador zero) aparece como traço, nunca como zero. */
const pct = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v)
  ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Bloco({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota?: string; cor: string }) {
  const colors = useColors();
  return <View style={{ flexBasis: '47%', flexGrow: 1, borderLeftWidth: 4, borderLeftColor: cor, backgroundColor: colors.surface,
    borderRadius: 10, padding: 12, gap: 2, borderWidth: 1, borderColor: colors.border }}>
    <Text style={[reportStyles.note, { color: colors.textSecondary }]}>{rotulo}</Text>
    <ReportNumber>{valor}</ReportNumber>
    {!!nota && <Text style={[reportStyles.note, { color: colors.textSecondary, fontSize: 11 }]}>{nota}</Text>}
  </View>;
}
function Linha({ titulo, nota, valor, extra }: { titulo: string; nota?: string; valor: string; extra?: string }) {
  const colors = useColors();
  return <View style={[reportStyles.row, { borderBottomColor: colors.border }]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[reportStyles.label, { color: colors.text, flex: 1 }]}>{titulo}</Text>
      <Text style={[reportStyles.label, { color: colors.text }]}>{valor}</Text>
    </View>
    {!!nota && <ReportNote>{nota}</ReportNote>}
    {!!extra && <ReportNote>{extra}</ReportNote>}
  </View>;
}

export default function CmvTeoricoScreen() {
  const colors = useColors();
  const [estado, setEstado] = useState(periodoInicial);
  const periodo = periodoDoEstado(estado);
  const query = consultaCmv(periodo);
  const state = useDetailedReport<CmvTeorico>('/api/relatorios/cmv-teorico', validarCmv as (v: CmvTeorico) => boolean, query);
  const data = state.data;
  const [busca, setBusca] = useState('');
  const pratos = useMemo(() => {
    if (!data) return [];
    const termo = semAcento(busca.trim());
    return [...data.com_ficha].sort((a, b) => b.cmv - a.cmv)
      .filter(p => !termo || semAcento(`${p.nome} ${p.categoria}`).includes(termo));
  }, [data, busca]);
  const gerar = async () => {
    const [contexto, dados] = await Promise.all([carregarContexto(), carregarCmv(periodo)]);
    return montarCmv(dados, periodo, contexto);
  };
  const controls = <View style={{ gap: 12 }}>
    <SeletorPeriodo value={estado} onChange={setEstado} />
    <BotoesExportar gerar={gerar} />
  </View>;
  const r = data?.resumo;
  const cobertura = r?.cobertura_percentual ?? null;
  const baixa = cobertura !== null && cobertura < LIMITE_COBERTURA;
  const maxDia = data ? Math.max(1, ...data.por_dia.map(x => Math.max(x.receita, x.cmv))) : 1;
  const maxCat = data ? Math.max(1, ...data.por_categoria.map(x => x.cmv)) : 1;
  const vazio = !!data && data.com_ficha.length + data.sem_ficha.length + data.custo_incompleto.length === 0;

  return <DetailedReportFrame title="CMV teórico" state={state} controls={controls}>
    {data && r && <>
      {baixa && <View accessibilityRole="alert" style={{ borderLeftWidth: 4, borderLeftColor: colors.warning, backgroundColor: colors.surface,
        borderRadius: 10, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border, flexDirection: 'row' }}>
        <Ionicons name="warning-outline" size={22} color={colors.warning} />
        <View style={{ flex: 1, gap: 4 }}>
          <ReportLabel>Cobertura da ficha técnica: {pct(cobertura)}</ReportLabel>
          <ReportNote>{AVISO_COBERTURA}</ReportNote>
        </View>
      </View>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Bloco rotulo="Receita" valor={formatCurrency(r.receita_total_geral)} cor="#3B82F6" nota="Sem cortesias" />
        <Bloco rotulo="CMV (R$)" valor={formatCurrency(r.cmv)} cor="#F59E0B" nota="Inclui custo das cortesias" />
        <Bloco rotulo="CMV (%)" valor={pct(r.cmv_percentual)} cor="#F59E0B" nota={`Sobre a receita coberta: ${pct(r.cmv_percentual_coberto)}`} />
        <Bloco rotulo="Margem bruta (R$)" valor={formatCurrency(r.margem_bruta)} cor="#166534" />
        <Bloco rotulo="Margem bruta (%)" valor={pct(r.margem_percentual)} cor="#166534" />
        <Bloco rotulo="Cobertura da ficha" valor={pct(cobertura)} cor={baixa ? '#DC2626' : '#14B8A6'}
          nota={`${r.pratos_com_ficha} de ${r.total_pratos_vendidos} pratos`} />
        <Bloco rotulo="Custo das cortesias" valor={formatCurrency(r.custo_cortesias)} cor="#EC4899" />
        <Bloco rotulo="Custo das perdas" valor={formatCurrency(r.custo_perdas)} cor="#8B5CF6"
          nota={`${r.quantidade_perdas.toLocaleString('pt-BR')} item(ns)`} />
      </View>
      {vazio && <ReportCard><ReportNote>Nenhuma venda no período.</ReportNote></ReportCard>}

      <View style={{ gap: 12 }}>
        <ReportTitle>Pratos por CMV</ReportTitle>
        <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar prato ou categoria" accessibilityLabel="Buscar prato"
          placeholderTextColor={colors.textSecondary} autoCorrect={false}
          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12,
            color: colors.text, backgroundColor: colors.surface }} />
        {data.com_ficha.length === 0 && <ReportNote>Nenhum prato com ficha completa no período.</ReportNote>}
        {data.com_ficha.length > 0 && pratos.length === 0 && <ReportNote>Nenhum prato encontrado para a busca.</ReportNote>}
        {pratos.map(p => <ReportCard key={`${p.id ?? 'removido'}-${p.nome}`}>
          <ReportTitle>{p.posicao}º · {p.nome}</ReportTitle>
          <ReportNote>{p.categoria} · {p.quantidade_vendida.toLocaleString('pt-BR')} vendidos
            {p.quantidade_cortesia > 0 ? ` (${p.quantidade_cortesia.toLocaleString('pt-BR')} cortesia)` : ''}</ReportNote>
          <View style={reportStyles.columns}>
            <View style={reportStyles.column}><ReportLabel>CMV</ReportLabel><ReportMoney value={p.cmv} />
              <ReportNote>{pct(p.cmv_percentual)} da receita · {pct(p.participacao_cmv_percentual)} do CMV total</ReportNote></View>
            <View style={reportStyles.column}><ReportLabel>Margem</ReportLabel>
              <ReportNumber style={{ color: p.margem < 0 ? colors.danger : colors.text }}>{formatCurrency(p.margem)}</ReportNumber>
              <ReportNote>{pct(p.margem_percentual)}</ReportNote></View>
          </View>
          <ReportNote>Receita {formatCurrency(p.receita)} · Custo unitário {formatCurrency(p.custo_unitario_ficha)}</ReportNote>
        </ReportCard>)}
      </View>

      <ReportCard>
        <ReportTitle>CMV por categoria</ReportTitle>
        {data.por_categoria.length === 0 && <ReportNote>Sem dados no período.</ReportNote>}
        {[...data.por_categoria].sort((a, b) => b.cmv - a.cmv).map(c => <View key={c.categoria} style={{ gap: 6 }}>
          <Linha titulo={c.categoria} valor={formatCurrency(c.cmv)}
            nota={`CMV ${pct(c.cmv_percentual)} · Margem ${formatCurrency(c.margem)} (${pct(c.margem_percentual)}) · ${pct(c.participacao_cmv_percentual)} do CMV`} />
          <ReportBar value={(c.cmv / maxCat) * 100} label={`CMV de ${c.categoria}`} color="#F59E0B" />
        </View>)}
      </ReportCard>

      <ReportCard>
        <ReportTitle>Insumos</ReportTitle>
        {data.por_insumo.length === 0 && <ReportNote>Sem consumo no período.</ReportNote>}
        {[...data.por_insumo].sort((a, b) => b.custo - a.custo).map((i, idx) => <Linha key={`${i.id ?? i.nome}-${idx}`}
          titulo={i.nome} valor={formatCurrency(i.custo)}
          nota={`${i.consumo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.unidade} · ${i.custo_unitario === null ? '—' : formatCurrency(i.custo_unitario)} por unidade · ${pct(i.participacao_percentual)} do custo`} />)}
      </ReportCard>

      <ReportCard>
        <ReportTitle>Dia a dia</ReportTitle>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Text style={[reportStyles.note, { color: '#3B82F6' }]}>■ Receita</Text>
          <Text style={[reportStyles.note, { color: '#F59E0B' }]}>■ CMV</Text>
        </View>
        {data.por_dia.length <= 14 ? <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 }}>
          {data.por_dia.map(x => <View key={x.data} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1, flex: 1 }}>
              <View style={{ width: 8, height: Math.max(2, (x.receita / maxDia) * 90), backgroundColor: '#3B82F6' }} />
              <View style={{ width: 8, height: Math.max(2, (x.cmv / maxDia) * 90), backgroundColor: '#F59E0B' }} />
            </View>
            <Text style={{ fontSize: 9, color: colors.textSecondary }}>{dataCurta(x.data)}</Text>
          </View>)}
        </View> : <ReportNote>Período longo: veja os valores dia a dia abaixo ou na exportação.</ReportNote>}
        {data.por_dia.map(x => <Linha key={x.data} titulo={`${dataCurta(x.data)}`} valor={formatCurrency(x.cmv)}
          nota={`Receita ${formatCurrency(x.receita)} · CMV ${pct(x.cmv_percentual)}`} />)}
      </ReportCard>

      {(data.sem_ficha.length > 0 || data.custo_incompleto.length > 0) && <View style={{ gap: 12 }}>
        <ReportTitle>Fora do CMV</ReportTitle>
        <ReportNote>Os pratos abaixo não entraram no cálculo do CMV.</ReportNote>
        {data.sem_ficha.length > 0 && <ReportCard>
          <ReportLabel>Sem ficha técnica</ReportLabel>
          {data.sem_ficha.map((p, i) => <Linha key={`sf-${p.id ?? i}-${i}`} titulo={p.nome} valor={formatCurrency(p.receita)}
            nota={`${p.categoria} · ${p.quantidade_vendida.toLocaleString('pt-BR')} vendidos`} />)}
        </ReportCard>}
        {data.custo_incompleto.length > 0 && <ReportCard>
          <ReportLabel>Custo incompleto</ReportLabel>
          {data.custo_incompleto.map((p, i) => <Linha key={`ci-${p.id ?? i}-${i}`} titulo={p.nome} valor={formatCurrency(p.receita)}
            nota={`${p.categoria} · ${p.quantidade_vendida.toLocaleString('pt-BR')} vendidos`}
            extra={`Insumos sem custo: ${p.insumos_sem_custo.join(', ')}`} />)}
        </ReportCard>}
      </View>}

      <ReportNote>{data.observacao_custo}</ReportNote>
      <ReportNote>{LEGENDA_CMV}</ReportNote>
    </>}
  </DetailedReportFrame>;
}
