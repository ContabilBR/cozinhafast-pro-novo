import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonLine } from '@/components/SkeletonLoader';
import { apiGet } from '@/utils/api';
import { formatCurrency } from '@/utils/helpers';

type Periodo = 'hoje' | '7dias' | 'mes';
interface TotaisVendas {
  comandas_fechadas: number;
  comandas_com_consumo: number;
  faturamento_itens: number;
  gorjeta: number;
  taxa_entrega: number;
  desconto_aplicado: number;
  total_recebido: number;
  ticket_medio: number;
}
interface VendasReport {
  periodo: { nome: string; inicio: string; fim: string };
  totais: TotaisVendas;
  por_canal: (TotaisVendas & { canal: 'mesa' | 'delivery' })[];
  por_dia: (TotaisVendas & { data: string })[];
  comparacao_anterior?: {
    periodo: { nome: string; inicio: string; fim: string };
    totais: TotaisVendas;
    variacao_percentual: {
      faturamento_itens: number | null;
      desconto_aplicado: number | null;
      total_recebido: number | null;
      ticket_medio: number | null;
    };
  } | null;
  comandas_inconsistentes: number;
}
const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7dias', label: '7 dias' },
  { key: 'mes', label: 'Este mês' },
];

// A data da API é uma data civil de São Paulo, não um instante UTC.
function labelDia(value: string) {
  const [ano, mes, dia] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(ano, mes - 1, dia, 12));
  if (!Number.isFinite(date.getTime())) return value;
  const semana = date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')} · ${semana}`;
}

type DiaVendas = VendasReport['por_dia'][number];
type DiasGrafico = 7 | 30 | 60 | 90;

// Datas civis: a mesma referência UTC-3 dos relatórios, independente do fuso do aparelho.
function deslocarDia(data: string, dias: number) {
  const dia = new Date(`${data}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}
function dataCurta(data: string) {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}
function validarDiasGrafico(report: VendasReport, inicio: string, quantidade: number): DiaVendas[] {
  const campos = ['comandas_fechadas', 'faturamento_itens', 'gorjeta', 'taxa_entrega', 'desconto_aplicado', 'total_recebido', 'ticket_medio'] as const;
  // Não aceitar uma série incompleta como se os dias omitidos fossem vendas zero.
  // A rota existente já preenche todos os dias, inclusive os sem movimento.
  if (!Array.isArray(report?.por_dia) || report.por_dia.length !== quantidade
    || !report.por_dia.every((dia, i) => dia?.data === deslocarDia(inicio, i)
      && campos.every(campo => typeof dia[campo] === 'number' && Number.isFinite(dia[campo]) && dia[campo] >= 0))) {
    throw new Error('Os dados diários recebidos estão incompletos. Tente novamente.');
  }
  return report.por_dia;
}

function EvolucaoRecebido({ refreshKey }: { refreshKey: number }) {
  const COLORS = useColors();
  const [dias, setDias] = useState<DiasGrafico>(30);
  const [tentativa, setTentativa] = useState(0);
  const [series, setSeries] = useState<{ atual: DiaVendas[]; anterior: DiaVendas[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro('');
    setSeries(null);
    setSelecionado(null);
    setTabela(false);
    const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inicio = deslocarDia(hoje, 1 - dias);
    const inicioAnterior = deslocarDia(inicio, -dias);
    const fimAnterior = deslocarDia(inicio, -1);
    const consultar = (de: string, ate: string) => apiGet<VendasReport>(
      `/api/relatorios/vendas?periodo=personalizado&data_inicio=${de}&data_fim=${ate}`
    );
    void Promise.all([consultar(inicio, hoje), consultar(inicioAnterior, fimAnterior)])
      .then(([atual, anterior]) => {
        if (!ativo) return;
        setSeries({ atual: validarDiasGrafico(atual, inicio, dias), anterior: validarDiasGrafico(anterior, inicioAnterior, dias) });
      })
      .catch((error: unknown) => {
        if (!ativo) return;
        const falha = error as { status?: number; message?: string };
        setErro(falha.status === 403 ? 'Este relatório está disponível apenas para gerente e administrador.'
          : falha.message || 'Não foi possível carregar a evolução. Verifique sua conexão.');
      })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [dias, refreshKey, tentativa]);

  const muted = { fontFamily: 'Outfit_400Regular', fontSize: 13, color: COLORS.textSecondary } as const;
  const text = { fontFamily: 'Outfit_600SemiBold', fontSize: 14, color: COLORS.text } as const;
  const atual = series?.atual ?? [];
  const anterior = series?.anterior ?? [];
  const temVendas = atual.some(dia => dia.total_recebido > 0);
  const indice = selecionado ?? atual.length - 1;
  const pontoAtual = atual[indice];
  const pontoAnterior = anterior[indice];
  const esquerda = 76;
  const direita = Math.max(esquerda + 1, largura - 12);
  const topo = 14;
  const base = 178;
  const maximo = Math.max(1, ...atual.map(d => d.total_recebido), ...anterior.map(d => d.total_recebido));
  const ordem = 10 ** Math.floor(Math.log10(maximo / 4));
  const teto = Math.ceil(maximo / 4 / ordem) * ordem * 4;
  const x = (i: number) => esquerda + (direita - esquerda) * i / (dias - 1);
  const y = (valor: number) => base - (base - topo) * valor / teto;
  const caminho = (valores: DiaVendas[]) => valores.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.total_recebido)}`).join(' ');
  const marcas = [0, Math.round((dias - 1) / 3), Math.round(2 * (dias - 1) / 3), dias - 1];
  const moedaEixo = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

  return (
    <View style={{ backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: COLORS.text }}>Evolução do total recebido</Text>
      <Text style={muted}>Por dia · horário de Brasília</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {([7, 30, 60, 90] as const).map(valor => <AnimatedPressable key={valor} accessibilityRole="button" accessibilityLabel={`Evolução: ${valor} dias`} accessibilityState={{ selected: dias === valor }} onPress={() => { if (dias !== valor) { setSeries(null); setSelecionado(null); setCarregando(true); setDias(valor); } }} style={{ flexGrow: 1, minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: dias === valor ? COLORS.primary : COLORS.border, backgroundColor: dias === valor ? COLORS.primaryMuted : COLORS.surface }}>
          <Text style={text}>{valor} dias</Text>
        </AnimatedPressable>)}
      </View>
      {carregando ? <View accessibilityLabel="Carregando evolução de vendas" style={{ gap: 16, paddingVertical: 20 }}><SkeletonLine width="80%" /><SkeletonLine height={180} /><SkeletonLine width="65%" /></View>
        : erro ? <View style={{ gap: 12, paddingVertical: 16 }} accessibilityRole="alert"><Text style={text}>Não foi possível carregar a evolução</Text><Text style={muted}>{erro}</Text><AnimatedPressable accessibilityRole="button" onPress={() => setTentativa(v => v + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={text}>Tentar novamente a evolução</Text></AnimatedPressable></View>
          : !temVendas ? <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}><Ionicons name="receipt-outline" size={30} color={COLORS.textSecondary} /><Text style={text}>Nenhuma venda nestes {dias} dias</Text><Text style={[muted, { textAlign: 'center' }]}>Selecione outro período ou puxe para atualizar.</Text></View>
            : <>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 24, height: 2, backgroundColor: COLORS.primary }} /><Text style={muted}>Atual · {dataCurta(atual[0].data)} a {dataCurta(atual[dias - 1].data)}</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 24, flexDirection: 'row', gap: 3 }}>{[0, 1, 2].map(i => <View key={i} style={{ width: 6, height: 2, backgroundColor: COLORS.textSecondary }} />)}</View><Text style={muted}>Anterior · {dataCurta(anterior[0].data)} a {dataCurta(anterior[dias - 1].data)}</Text></View>
              </View>
              <Text style={[muted, { fontSize: 12 }]}>Comparação alinhada pelo dia de cada período.</Text>
              <View onLayout={event => setLargura(event.nativeEvent.layout.width)}>
                <Pressable accessible={false} onPress={event => setSelecionado(Math.max(0, Math.min(dias - 1, Math.round((event.nativeEvent.locationX - esquerda) / (direita - esquerda) * (dias - 1)))))}>
                  {largura > 0 && <Svg width={largura} height={212} pointerEvents="none" accessible={false}>
                    {[0, 1, 2, 3, 4].map(i => {
                      const valor = teto * i / 4;
                      return <React.Fragment key={i}><Line x1={esquerda} x2={direita} y1={y(valor)} y2={y(valor)} stroke={COLORS.border} strokeWidth={1} /><SvgText x={esquerda - 8} y={y(valor) + 4} textAnchor="end" fill={COLORS.textSecondary} fontSize={10}>{moedaEixo.format(valor)}</SvgText></React.Fragment>;
                    })}
                    <Path d={caminho(anterior)} fill="none" stroke={COLORS.textSecondary} strokeWidth={2} strokeDasharray="5 5" strokeLinejoin="round" strokeLinecap="round" />
                    <Path d={caminho(atual)} fill="none" stroke={COLORS.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {selecionado !== null && <>
                      <Line x1={x(indice)} x2={x(indice)} y1={topo} y2={base} stroke={COLORS.textSecondary} strokeWidth={1} />
                      <Circle cx={x(indice)} cy={y(pontoAnterior.total_recebido)} r={4} fill={COLORS.textSecondary} stroke={COLORS.surface} strokeWidth={2} />
                      <Circle cx={x(indice)} cy={y(pontoAtual.total_recebido)} r={4} fill={COLORS.primary} stroke={COLORS.surface} strokeWidth={2} />
                    </>}
                    {marcas.map(i => <SvgText key={i} x={x(i)} y={base + 22} textAnchor={i === 0 ? 'start' : i === dias - 1 ? 'end' : 'middle'} fill={COLORS.textSecondary} fontSize={10}>{dataCurta(atual[i].data)}</SvgText>)}
                  </Svg>}
                </Pressable>
              </View>
              <View accessibilityLiveRegion="polite" style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 12, padding: 12, minHeight: 96, gap: 6 }}>
                {selecionado === null ? <Text style={muted}>Toque na linha para ver os valores de cada dia ou use as setas abaixo.</Text> : <>
                  <Text style={text}>Dia {indice + 1} de {dias}</Text>
                  <Text style={muted}>Atual · {dataCurta(pontoAtual.data)}/{pontoAtual.data.slice(0, 4)}: <Text style={text}>{formatCurrency(pontoAtual.total_recebido)}</Text></Text>
                  <Text style={muted}>Anterior · {dataCurta(pontoAnterior.data)}/{pontoAnterior.data.slice(0, 4)}: <Text style={text}>{formatCurrency(pontoAnterior.total_recebido)}</Text></Text>
                </>}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <AnimatedPressable accessibilityRole="button" accessibilityLabel="Dia anterior no gráfico" accessibilityState={{ disabled: selecionado === 0 }} disabled={selecionado === 0} onPress={() => setSelecionado(selecionado === null ? dias - 1 : Math.max(0, indice - 1))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: selecionado === 0 ? 0.35 : 1 }}><Ionicons name="chevron-back" size={22} color={COLORS.text} /></AnimatedPressable>
                <AnimatedPressable accessibilityRole="button" accessibilityState={{ expanded: tabela }} onPress={() => setTabela(v => !v)} style={{ minHeight: 44, flexShrink: 1, justifyContent: 'center' }}><Text style={text}>{tabela ? 'Ocultar valores diários' : 'Ver valores diários'}</Text></AnimatedPressable>
                <AnimatedPressable accessibilityRole="button" accessibilityLabel="Próximo dia no gráfico" accessibilityState={{ disabled: selecionado === dias - 1 }} disabled={selecionado === dias - 1} onPress={() => setSelecionado(selecionado === null ? 0 : Math.min(dias - 1, indice + 1))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: selecionado === dias - 1 ? 0.35 : 1 }}><Ionicons name="chevron-forward" size={22} color={COLORS.text} /></AnimatedPressable>
              </View>
              {tabela && atual.map((dia, i) => <View key={dia.data} style={{ paddingVertical: 10, gap: 4, borderTopWidth: 1, borderTopColor: COLORS.border }}><Text style={text}>Dia {i + 1}</Text><Text style={muted}>Atual · {labelDia(dia.data)}: {formatCurrency(dia.total_recebido)}</Text><Text style={muted}>Anterior · {labelDia(anterior[i].data)}: {formatCurrency(anterior[i].total_recebido)}</Text></View>)}
            </>}
    </View>
  );
}

export default function VendasDetalhadasScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ periodo?: string | string[] }>();
  const initialPeriod = Array.isArray(params.periodo) ? params.periodo[0] : params.periodo;
  const [periodo, setPeriodo] = useState<Periodo>(
    initialPeriod === '7dias' || initialPeriod === 'mes' ? initialPeriod : 'hoje'
  );
  const [data, setData] = useState<VendasReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const sequence = useRef(0);
  const allowed = user?.role === 'gerente' || user?.role === 'administrador';

  const load = useCallback(async (refresh = false) => {
    if (!allowed || authLoading) return;
    const current = ++sequence.current;
    setError('');
    setForbidden(false);
    setLoading(!refresh);
    setRefreshing(refresh);
    if (refresh) setChartRefreshKey(value => value + 1);
    if (!refresh) setData(null);
    try {
      const result = await apiGet<VendasReport>(`/api/relatorios/vendas?periodo=${periodo}`);
      if (current !== sequence.current) return;
      if (!result?.totais || !Array.isArray(result.por_canal) || !Array.isArray(result.por_dia)) {
        throw new Error('O relatório recebido está incompleto. Tente novamente.');
      }
      const hasDiscount = (row: TotaisVendas | null | undefined) =>
        typeof row?.desconto_aplicado === 'number' && Number.isFinite(row.desconto_aplicado) && row.desconto_aplicado >= 0;
      const previous = result.comparacao_anterior;
      const discountVariation = previous?.variacao_percentual?.desconto_aplicado;
      if (![result.totais, ...result.por_canal, ...result.por_dia].every(hasDiscount)
        || (previous != null && (!hasDiscount(previous.totais)
          || (discountVariation !== null && (typeof discountVariation !== 'number' || !Number.isFinite(discountVariation)))))) {
        throw new Error('O relatório recebido está incompleto. Tente novamente.');
      }
      setData(result);
    } catch (err: unknown) {
      if (current !== sequence.current) return;
      const apiError = err as { status?: number; message?: string };
      setData(null);
      if (apiError.status === 403) {
        setForbidden(true);
      } else {
        setError(apiError.message || 'Não foi possível carregar as vendas. Verifique sua conexão e tente novamente.');
      }
    } finally {
      if (current === sequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [allowed, authLoading, periodo]);

  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  const card = { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 } as const;
  const muted = { fontFamily: 'Outfit_400Regular', fontSize: 13, color: COLORS.textSecondary } as const;
  const title = { fontFamily: 'Outfit_700Bold', fontSize: 18, color: COLORS.text } as const;
  const number = { fontFamily: 'Outfit_700Bold', color: COLORS.text, fontVariant: ['tabular-nums'] as ('tabular-nums')[] };
  const restricted = !authLoading && (!allowed || forbidden);
  const empty = data && data.totais.comandas_com_consumo === 0 && data.totais.total_recebido === 0;
  const comparison = data?.comparacao_anterior;
  const variation = comparison && comparison.totais.total_recebido > 0
    ? comparison.variacao_percentual.total_recebido : null;
  const variationColor = variation == null || variation === 0 ? COLORS.textSecondary : variation > 0 ? COLORS.success : COLORS.danger;
  const channels = (['mesa', 'delivery'] as const).map(canal => ({
    canal,
    label: canal === 'mesa' ? 'Mesa' : 'Delivery',
    values: data?.por_canal.find(item => item.canal === canal),
  }));
  const channelTotal = channels.reduce((sum, item) => sum + Math.max(0, item.values?.total_recebido ?? 0), 0);
  const days = [...(data?.por_dia ?? [])].sort((a, b) => a.data.localeCompare(b.data));
  const maxDay = Math.max(0, ...days.map(day => day.total_recebido));
  const metrics: { label: string; value: string; danger?: boolean }[] = data ? [
    { label: 'Faturamento de itens', value: formatCurrency(data.totais.faturamento_itens) },
    { label: 'Gorjeta', value: formatCurrency(data.totais.gorjeta) },
    { label: 'Taxa de entrega', value: formatCurrency(data.totais.taxa_entrega) },
    ...(data.totais.desconto_aplicado > 0 ? [{ label: 'Descontos e cortesias', value: `-${formatCurrency(data.totais.desconto_aplicado)}`, danger: true }] : []),
    { label: 'Ticket médio', value: formatCurrency(data.totais.ticket_medio) },
    { label: 'Comandas fechadas', value: String(data.totais.comandas_fechadas) },
  ] : [];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: COLORS.surface }}>
        <View style={[styles.header, { borderBottomColor: COLORS.border }]}>
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/(relatorios)' as any)} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
            <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 16, color: COLORS.primary }}>Voltar</Text>
          </AnimatedPressable>
          <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: COLORS.text }}>Vendas</Text>
          <View style={{ width: 80 }} />
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical refreshControl={allowed && !forbidden ? <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={COLORS.primary} colors={[COLORS.primary]} /> : undefined}>
          {!restricted && !authLoading && <EvolucaoRecebido key={user?.id} refreshKey={chartRefreshKey} />}
          {!restricted && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {PERIODOS.map(p => (
                <AnimatedPressable key={p.key} accessibilityRole="button" accessibilityState={{ selected: periodo === p.key }} onPress={() => setPeriodo(p.key)} style={{ paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center', borderRadius: 20, backgroundColor: periodo === p.key ? COLORS.primary : COLORS.surface, borderWidth: 1, borderColor: periodo === p.key ? COLORS.primary : COLORS.border }}>
                  <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 13, color: periodo === p.key ? '#fff' : COLORS.text }}>{p.label}</Text>
                </AnimatedPressable>
              ))}
            </View>
          )}
          {restricted ? (
            <View style={[card, styles.state]} accessibilityRole="alert">
              <Ionicons name="lock-closed-outline" size={32} color={COLORS.textSecondary} />
              <Text style={title}>Acesso restrito</Text>
              <Text style={[muted, styles.center]}>Este relatório está disponível apenas para gerente e administrador.</Text>
            </View>
          ) : loading || authLoading ? (
            <View accessibilityLabel="Carregando relatório de vendas" style={{ gap: 16 }}>
              <View style={card}><SkeletonLine width="45%" /><SkeletonLine width="80%" height={38} /><SkeletonLine width="65%" /></View>
              <View style={styles.grid}>{[0, 1, 2, 3].map(i => <View key={i} style={[card, styles.tile]}><SkeletonLine width="80%" /><SkeletonLine height={26} /></View>)}</View>
              <View style={card}><SkeletonLine width="40%" height={20} /><SkeletonLine height={90} /></View>
            </View>
          ) : error ? (
            <View style={[card, styles.state]} accessibilityRole="alert">
              <Ionicons name="cloud-offline-outline" size={32} color={COLORS.textSecondary} />
              <Text style={title}>Não foi possível carregar as vendas</Text>
              <Text style={[muted, styles.center]}>{error}</Text>
              <AnimatedPressable accessibilityRole="button" onPress={() => void load()} style={{ backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 }}>
                <Text style={{ fontFamily: 'Outfit_600SemiBold', color: '#fff', fontSize: 15 }}>Tentar novamente</Text>
              </AnimatedPressable>
            </View>
          ) : data ? (
            <>
              <View style={[card, { borderTopWidth: 3, borderTopColor: COLORS.primary, gap: 12 }]}>
                <Text style={muted}>{data.periodo.nome}</Text>
                <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 16, color: COLORS.text }}>Total recebido</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[number, { fontSize: 36 }]}>{formatCurrency(data.totais.total_recebido)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={variation == null || variation === 0 ? 'remove-outline' : variation > 0 ? 'trending-up-outline' : 'trending-down-outline'} size={18} color={variationColor} />
                  <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 13, color: variationColor, flex: 1 }}>
                    {variation == null ? 'Sem base de comparação' : `${variation > 0 ? '+' : ''}${variation.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% em relação ao período anterior`}
                  </Text>
                </View>
                {comparison && <Text style={muted}>Período anterior: {comparison.periodo.nome}</Text>}
              </View>
              <Text style={[muted, { lineHeight: 20 }]}>{data.totais.desconto_aplicado > 0
                ? 'O faturamento de itens é bruto. O total recebido inclui gorjeta e taxa de entrega e já considera os descontos e cortesias.'
                : 'Total recebido é itens mais gorjeta mais taxa de entrega.'}</Text>
              {empty && <View style={[card, styles.state]}><Ionicons name="receipt-outline" size={30} color={COLORS.textSecondary} /><Text style={title}>Nenhuma venda no período</Text><Text style={[muted, styles.center]}>Selecione outro período ou puxe para atualizar.</Text></View>}
              <View style={styles.grid}>
                {metrics.map(metric => <View key={metric.label} style={[card, styles.tile]}><Text style={[muted, metric.danger && { color: COLORS.danger }]}>{metric.label}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[number, { fontSize: 22 }, metric.danger && { color: COLORS.danger }]}>{metric.value}</Text></View>)}
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Por canal</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {channels.map(channel => {
                    const share = channelTotal > 0 ? Math.max(0, channel.values?.total_recebido ?? 0) / channelTotal * 100 : 0;
                    return <View key={channel.canal} style={{ flex: 1, minWidth: 0, gap: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Ionicons name={channel.canal === 'mesa' ? 'restaurant-outline' : 'bicycle-outline'} size={18} color={COLORS.textSecondary} /><Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 15, color: COLORS.text }}>{channel.label}</Text></View>
                      <Text style={muted}>Total recebido</Text>
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[number, { fontSize: 22 }]}>{formatCurrency(channel.values?.total_recebido ?? 0)}</Text>
                      <Text style={muted}>{channel.values?.comandas_fechadas ?? 0} comandas</Text>
                      <Text style={muted}>Ticket médio</Text>
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[number, { fontSize: 17 }]}>{formatCurrency(channel.values?.ticket_medio ?? 0)}</Text>
                      <Text style={muted}>{share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do total</Text>
                    </View>;
                  })}
                </View>
                <View accessible accessibilityLabel={`Proporção do total recebido. ${channels.map(c => `${c.label}: ${channelTotal > 0 ? (Math.max(0, c.values?.total_recebido ?? 0) / channelTotal * 100).toFixed(1) : 0}%`).join('. ')}`} style={{ height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: COLORS.surfaceSecondary, flexDirection: 'row', gap: 2 }}>
                  {channelTotal > 0 && channels.map(c => (c.values?.total_recebido ?? 0) > 0 ? <View key={c.canal} style={{ flexGrow: Math.max(0, c.values?.total_recebido ?? 0), flexBasis: 0, backgroundColor: c.canal === 'mesa' ? COLORS.primary : COLORS.statusRecebido }} /> : null)}
                </View>
                <View style={{ flexDirection: 'row', gap: 16 }}>{channels.map(c => <View key={c.canal} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c.canal === 'mesa' ? COLORS.primary : COLORS.statusRecebido }} /><Text style={muted}>{c.label}</Text></View>)}</View>
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Por dia</Text>
                <Text style={muted}>Total recebido em cada dia</Text>
                {days.length === 0 ? <Text style={muted}>Nenhuma venda no período</Text> : days.map(day => <View key={day.data} style={{ paddingVertical: 10, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={[muted, { flex: 1 }]}>{labelDia(day.data)}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[number, { fontSize: 16, flexShrink: 1, maxWidth: '60%' }]}>{formatCurrency(day.total_recebido)}</Text></View>
                  <View accessible={false} style={{ height: 6, borderRadius: 3, backgroundColor: COLORS.surfaceSecondary, overflow: 'hidden' }}><View style={{ height: 6, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: COLORS.primary, width: `${maxDay > 0 ? Math.max(0, day.total_recebido) / maxDay * 100 : 0}%` }} /></View>
                </View>)}
              </View>
              {data.comandas_inconsistentes > 0 && <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 4 }}><Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} /><Text style={[muted, { flex: 1, lineHeight: 20 }]}>{data.comandas_inconsistentes} {data.comandas_inconsistentes === 1 ? 'comanda fechada apresenta' : 'comandas fechadas apresentam'} divergência de valores.</Text></View>}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  back: { width: 80, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  content: { padding: 16, paddingBottom: 32, gap: 20, flexGrow: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%', flexGrow: 1, minWidth: 120 },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 12 },
  center: { textAlign: 'center', lineHeight: 21 },
});
