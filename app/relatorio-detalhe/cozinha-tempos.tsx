import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import {
  useDetailedReport, DetailedReportFrame, ReportCard, ReportTitle, ReportLabel, ReportNote,
  ReportNumber, ReportTime, ReportBar, ReportEmpty, formatReportTime, reportPercent, reportStyles,
} from '@/components/DetailedReport';

interface CozinhaReport {
  totais: {
    itens_medidos: number; itens_sem_medicao: number; comandas_medidas: number;
    tempo_medio_item_min: number; mediana_item_min: number | null; p90_item_min: number | null;
    tempo_medio_pedido_min: number; mediana_pedido_min: number | null; p90_pedido_min: number | null;
  };
  por_prato: {
    prato_id: string | null; nome: string; categoria: string | null; itens_medidos: number;
    tempo_medio_min: number; p90_min: number | null; meta_min: number | null; percentual_dentro_meta: number | null;
  }[];
  por_hora: { hora: number; itens_medidos: number; tempo_medio_min: number }[];
}
const validate = (value: CozinhaReport) => !!value?.totais && Array.isArray(value.por_prato) && Array.isArray(value.por_hora);

function TimingTrio({ media, mediana, p90 }: { media: number; mediana: number | null; p90: number | null }) {
  return <View style={reportStyles.columns}>
    <View style={[reportStyles.column, { flex: 1.2 }]}><ReportLabel>Tempo médio</ReportLabel><ReportTime value={media} large /></View>
    <View style={reportStyles.column}><ReportNote>Mediana</ReportNote><ReportTime value={mediana} /></View>
    <View style={reportStyles.column}><ReportNote>P90</ReportNote><ReportTime value={p90} /></View>
  </View>;
}

export default function CozinhaTemposScreen() {
  const colors = useColors();
  const report = useDetailedReport<CozinhaReport>('/api/relatorios/cozinha-tempos', validate);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [report.periodo]);
  const data = report.data;
  const maxTime = Math.max(0, ...(data?.por_hora.map(row => row.tempo_medio_min) ?? []));
  const empty = data && data.totais.itens_medidos === 0 && data.totais.itens_sem_medicao === 0;

  return <DetailedReportFrame title="Cozinha" state={report}>
    {data && <>
      <ReportCard hero>
        <ReportNote>{report.periodLabel}</ReportNote>
        <ReportTitle>Preparo por item</ReportTitle>
        <TimingTrio media={data.totais.tempo_medio_item_min} mediana={data.totais.mediana_item_min} p90={data.totais.p90_item_min} />
        <ReportNote>O p90 é o tempo dentro do qual 9 em cada 10 itens ficam prontos.</ReportNote>
      </ReportCard>
      <ReportCard>
        <ReportTitle>Preparo do pedido</ReportTitle>
        <TimingTrio media={data.totais.tempo_medio_pedido_min} mediana={data.totais.mediana_pedido_min} p90={data.totais.p90_pedido_min} />
        <ReportNote>O tempo do pedido é o maior tempo de preparo entre os pratos da mesma comanda.</ReportNote>
      </ReportCard>
      <ReportCard>
        <View style={reportStyles.columns}>
          <View style={reportStyles.column}><ReportNumber>{data.totais.itens_medidos.toLocaleString('pt-BR')}</ReportNumber><ReportNote>Itens medidos</ReportNote></View>
          <View style={reportStyles.column}><ReportNumber>{data.totais.comandas_medidas.toLocaleString('pt-BR')}</ReportNumber><ReportNote>Comandas medidas</ReportNote></View>
          <View style={reportStyles.column}><ReportNumber>{data.totais.itens_sem_medicao.toLocaleString('pt-BR')}</ReportNumber><ReportNote>Itens sem medição</ReportNote></View>
        </View>
        <ReportNote>Itens sem medição não entram nas médias: preparo não iniciado ou sem registro de pronto.</ReportNote>
      </ReportCard>
      {empty ? <ReportEmpty>Nenhum dado de cozinha no período</ReportEmpty> : <>
        <ReportCard>
          <ReportTitle>Por prato</ReportTitle>
          <ReportNote>Do mais lento para o mais rápido, na ordem do relatório. {expanded ? data.por_prato.length : Math.min(15, data.por_prato.length)} de {data.por_prato.length} pratos.</ReportNote>
          {data.por_prato.length === 0 && <ReportNote>Não há medições suficientes para detalhar os pratos.</ReportNote>}
          {(expanded ? data.por_prato : data.por_prato.slice(0, 15)).map((row, i) => {
            const metaColor = row.percentual_dentro_meta === null ? colors.textSecondary
              : row.percentual_dentro_meta > 80 ? colors.success : row.percentual_dentro_meta >= 50 ? colors.warning : colors.danger;
            return <View key={`${row.prato_id ?? row.nome}-${i}`} style={[reportStyles.row, { borderBottomColor: colors.border }]}>
              <ReportLabel>{row.nome}</ReportLabel><ReportNote>{row.categoria || 'Sem categoria'}</ReportNote>
              {row.prato_id === null && <ReportNote>prato removido do cardápio</ReportNote>}
              <ReportNote>{row.itens_medidos.toLocaleString('pt-BR')} itens medidos</ReportNote>
              <View style={reportStyles.columns}>
                <View style={reportStyles.column}><ReportNote>Tempo médio</ReportNote><ReportTime value={row.tempo_medio_min} /></View>
                <View style={reportStyles.column}><ReportNote>P90</ReportNote><ReportTime value={row.p90_min} /></View>
              </View>
              {row.meta_min === null ? <ReportNote>Sem meta cadastrada</ReportNote> : <>
                <ReportNote>Meta cadastrada</ReportNote><ReportTime value={row.meta_min} />
                {row.percentual_dentro_meta === null ? <><ReportNumber>—</ReportNumber><ReportNote>Não há medições suficientes para avaliar a meta.</ReportNote></> : <>
                  <ReportLabel>{reportPercent(row.percentual_dentro_meta)} dos itens dentro da meta</ReportLabel>
                  <ReportBar value={row.percentual_dentro_meta} color={metaColor}
                    label={`${row.nome}: ${reportPercent(row.percentual_dentro_meta)} dos itens dentro da meta de ${formatReportTime(row.meta_min)}. Escala de 0 a 100%.`} />
                </>}
              </>}
            </View>;
          })}
          {data.por_prato.length > 15 && <AnimatedPressable accessibilityRole="button"
            accessibilityLabel={expanded ? 'Mostrar os primeiros 15 pratos' : 'Ver todos os pratos'} accessibilityState={{ expanded }}
            onPress={() => setExpanded(value => !value)} style={[reportStyles.action, { borderWidth: 1, borderColor: colors.primary }]}>
            <ReportLabel>{expanded ? 'Ver menos' : 'Ver todos'}</ReportLabel>
          </AnimatedPressable>}
        </ReportCard>
        <ReportCard>
          <ReportTitle>Por hora do dia</ReportTitle>
          <ReportNote>Barras proporcionais ao maior tempo médio entre as horas recebidas.</ReportNote>
          {data.por_hora.length === 0 && <ReportNote>Não há medições suficientes por hora.</ReportNote>}
          {data.por_hora.map(row => <View key={row.hora} style={[reportStyles.row, { borderBottomColor: colors.border }]}>
            <ReportLabel>{row.hora}h</ReportLabel><ReportNote>{row.itens_medidos.toLocaleString('pt-BR')} itens medidos</ReportNote>
            <ReportNote>Tempo médio</ReportNote><ReportTime value={row.tempo_medio_min} />
            <ReportBar value={maxTime > 0 ? row.tempo_medio_min / maxTime * 100 : 0}
              label={`${row.hora}h: tempo médio ${formatReportTime(row.tempo_medio_min)}, ${row.itens_medidos} itens medidos. Maior tempo médio: ${formatReportTime(maxTime)}.`} />
          </View>)}
        </ReportCard>
      </>}
    </>}
  </DetailedReportFrame>;
}
