import React from 'react';
import { View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  useDetailedReport, DetailedReportFrame, ReportCard, ReportTitle, ReportNote, ReportLabel,
  ReportNumber, ReportMoney, ReportTime, ReportBar, ReportEmpty, reportPercent, reportStyles,
} from '@/components/DetailedReport';

interface DeliveryReport {
  totais: {
    pedidos: number; faturamento_itens: number; taxa_entrega: number; total_recebido: number;
    ticket_medio: number; tempo_medio_entrega_min: number | null; pedidos_com_tempo: number;
  };
  por_bairro: {
    bairro: string; pedidos: number; faturamento_itens: number; taxa_entrega: number; total_recebido: number;
    ticket_medio: number; taxa_media: number; tempo_medio_entrega_min: number | null;
    tempo_estimado_medio_min: number | null; percentual_pedidos: number; percentual_total_recebido: number;
  }[];
}
const validate = (value: DeliveryReport) => !!value?.totais && Array.isArray(value.por_bairro);

export default function DeliveryBairrosScreen() {
  const colors = useColors();
  const report = useDetailedReport<DeliveryReport>('/api/relatorios/delivery-bairros', validate);
  const data = report.data;
  return <DetailedReportFrame title="Delivery por bairro" state={report}>
    {data && <>
      <ReportCard hero>
        <ReportNote>{report.periodLabel}</ReportNote><ReportLabel>Total recebido do delivery</ReportLabel>
        <ReportMoney value={data.totais.total_recebido} large />
        <ReportNumber>{data.totais.pedidos.toLocaleString('pt-BR')} {data.totais.pedidos === 1 ? 'pedido' : 'pedidos'}</ReportNumber>
      </ReportCard>
      <ReportCard>
        <View style={reportStyles.columns}>
          <View style={reportStyles.column}><ReportNote>Faturamento de itens</ReportNote><ReportMoney value={data.totais.faturamento_itens} /></View>
          <View style={reportStyles.column}><ReportNote>Taxa de entrega</ReportNote><ReportMoney value={data.totais.taxa_entrega} /></View>
        </View>
        <ReportNote>Ticket médio</ReportNote><ReportMoney value={data.totais.ticket_medio} />
        <ReportNote>Tempo médio de entrega</ReportNote><ReportTime value={data.totais.tempo_medio_entrega_min} />
        <ReportNote>{data.totais.pedidos_com_tempo.toLocaleString('pt-BR')} {data.totais.pedidos_com_tempo === 1 ? 'pedido com medição' : 'pedidos com medição'}</ReportNote>
        <ReportNote>O tempo de entrega vai da saída do pedido até a entrega registrada.</ReportNote>
      </ReportCard>
      {data.totais.pedidos === 0 ? <ReportEmpty>Nenhum pedido de delivery no período</ReportEmpty> : <ReportCard>
        <ReportTitle>Por bairro</ReportTitle>
        <ReportNote>Participação no total recebido, na ordem recebida do relatório.</ReportNote>
        {data.por_bairro.slice(0, 50).map((row, i) => <View key={`${row.bairro}-${i}`} style={[reportStyles.row, { borderBottomColor: colors.border }]}>
          <ReportLabel>{row.bairro}</ReportLabel>
          {row.bairro === 'Sem bairro' && <ReportNote>Endereço sem bairro informado.</ReportNote>}
          {row.bairro === 'Sem dados de entrega' && <ReportNote>Comandas de delivery sem registro de entrega.</ReportNote>}
          <ReportNote>{row.pedidos.toLocaleString('pt-BR')} {row.pedidos === 1 ? 'pedido' : 'pedidos'}</ReportNote>
          <ReportNote>Total recebido</ReportNote><ReportMoney value={row.total_recebido} />
          <View style={reportStyles.columns}>
            <View style={reportStyles.column}><ReportNote>Ticket médio</ReportNote><ReportMoney value={row.ticket_medio} /></View>
            <View style={reportStyles.column}><ReportNote>Taxa média</ReportNote><ReportMoney value={row.taxa_media} /></View>
          </View>
          <View style={reportStyles.columns}>
            <View style={reportStyles.column}><ReportNote>Tempo médio de entrega</ReportNote><ReportTime value={row.tempo_medio_entrega_min} /></View>
            {row.tempo_estimado_medio_min !== null && <View style={reportStyles.column}><ReportNote>Tempo estimado médio</ReportNote><ReportTime value={row.tempo_estimado_medio_min} /></View>}
          </View>
          <ReportNote>{reportPercent(row.percentual_pedidos)} dos pedidos · {reportPercent(row.percentual_total_recebido)} do total recebido</ReportNote>
          <ReportBar value={row.percentual_total_recebido}
            label={`${row.bairro}: ${reportPercent(row.percentual_total_recebido)} do total recebido e ${reportPercent(row.percentual_pedidos)} dos pedidos. Escala de 0 a 100%.`} />
        </View>)}
        {data.por_bairro.length === 50 && <ReportNote>O relatório retorna no máximo 50 bairros ou grupos. Esta lista atingiu o limite.</ReportNote>}
      </ReportCard>}
    </>}
  </DetailedReportFrame>;
}
