import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
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
    if (!refresh) setData(null);
    try {
      const result = await apiGet<VendasReport>(`/api/relatorios/vendas?periodo=${periodo}`);
      if (current !== sequence.current) return;
      if (!result?.totais || !Array.isArray(result.por_canal) || !Array.isArray(result.por_dia)) {
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
  const metrics = data ? [
    { label: 'Faturamento de itens', value: formatCurrency(data.totais.faturamento_itens) },
    { label: 'Gorjeta', value: formatCurrency(data.totais.gorjeta) },
    { label: 'Taxa de entrega', value: formatCurrency(data.totais.taxa_entrega) },
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
              <Text style={[muted, { lineHeight: 20 }]}>Total recebido é itens mais gorjeta mais taxa de entrega.</Text>
              {empty && <View style={[card, styles.state]}><Ionicons name="receipt-outline" size={30} color={COLORS.textSecondary} /><Text style={title}>Nenhuma venda no período</Text><Text style={[muted, styles.center]}>Selecione outro período ou puxe para atualizar.</Text></View>}
              <View style={styles.grid}>
                {metrics.map(metric => <View key={metric.label} style={[card, styles.tile]}><Text style={muted}>{metric.label}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45} style={[number, { fontSize: 22 }]}>{metric.value}</Text></View>)}
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
