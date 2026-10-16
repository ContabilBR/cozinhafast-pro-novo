import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonLine } from '@/components/SkeletonLoader';
import { apiGet } from '@/utils/api';
import { formatCurrency } from '@/utils/helpers';

export type ReportPeriod = 'hoje' | '7dias' | 'mes';
const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'hoje', label: 'Hoje' }, { key: '7dias', label: '7 dias' }, { key: 'mes', label: 'Este mês' },
];
export function useDetailedReport<T>(endpoint: string, validate: (value: T) => boolean) {
  const { user, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ periodo?: string | string[] }>();
  const initial = Array.isArray(params.periodo) ? params.periodo[0] : params.periodo;
  const [periodo, setPeriodo] = useState<ReportPeriod>(initial === '7dias' || initial === 'mes' ? initial : 'hoje');
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const sequence = useRef(0);
  const allowed = user?.role === 'gerente' || user?.role === 'administrador';
  const restricted = !authLoading && (!allowed || forbidden);
  const load = useCallback(async (refresh = false) => {
    if (!allowed || authLoading) return;
    const request = ++sequence.current;
    setLoading(!refresh); setRefreshing(refresh); setError(''); setForbidden(false);
    if (!refresh) setData(null);
    try {
      const result = await apiGet<T>(`${endpoint}?periodo=${periodo}`);
      if (request !== sequence.current) return;
      if (!validate(result)) throw new Error('O relatório recebido está incompleto. Tente novamente.');
      setData(result);
    } catch (err: unknown) {
      if (request !== sequence.current) return;
      const apiError = err as { status?: number; message?: string };
      setData(null);
      if (apiError.status === 403) setForbidden(true);
      else setError(apiError.message || 'Não foi possível carregar o relatório. Verifique sua conexão e tente novamente.');
    } finally {
      if (request === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [allowed, authLoading, endpoint, periodo, validate]);
  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]);
  const changePeriod = (next: ReportPeriod) => {
    if (next === periodo) return;
    sequence.current += 1;
    setData(null); setLoading(true); setRefreshing(false); setError(''); setPeriodo(next);
  };
  return { data, periodo, periodLabel: PERIODS.find(p => p.key === periodo)?.label,
    loading: loading || authLoading, refreshing, error, restricted, allowed, load, changePeriod };
}

type FrameState = Omit<ReturnType<typeof useDetailedReport>, 'data' | 'periodLabel'>;
export function DetailedReportFrame({ title, state, children }: { title: string; state: FrameState; children: React.ReactNode }) {
  const colors = useColors();
  const router = useRouter();
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerShown: false }} />
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1 }}>
      <View style={[reportStyles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" style={reportStyles.back}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/relatorio-detalhe' as any)}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
          <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 16, color: colors.primary }}>Voltar</Text>
        </AnimatedPressable>
        <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}
          style={[reportStyles.title, { color: colors.text, flex: 1, fontSize: 17, textAlign: 'center' }]}>{title}</Text>
        <View style={{ width: 80 }} />
      </View>
      <ScrollView contentContainerStyle={reportStyles.content} alwaysBounceVertical
        refreshControl={state.allowed && !state.restricted ? <RefreshControl refreshing={state.refreshing}
          onRefresh={() => void state.load(true)} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
        {!state.restricted && <View style={{ flexDirection: 'row', gap: 8 }}>{PERIODS.map(p => <AnimatedPressable key={p.key}
          accessibilityRole="button" accessibilityLabel={`Período: ${p.label}`} accessibilityState={{ selected: state.periodo === p.key }}
          onPress={() => state.changePeriod(p.key)}
          style={[reportStyles.chip, { backgroundColor: state.periodo === p.key ? colors.primary : colors.surface, borderColor: state.periodo === p.key ? colors.primary : colors.border }]}>
          <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 13, color: state.periodo === p.key ? '#fff' : colors.text }}>{p.label}</Text>
        </AnimatedPressable>)}</View>}
        {state.restricted ? <ReportCard><View accessibilityRole="alert" style={reportStyles.state}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} />
          <ReportTitle>Acesso restrito</ReportTitle><ReportNote center>Este relatório está disponível apenas para gerente e administrador.</ReportNote>
        </View></ReportCard> : state.loading ? <View accessibilityLabel={`Carregando relatório de ${title}`} style={{ gap: 16 }}>
          <ReportCard><SkeletonLine width="50%" /><SkeletonLine width="85%" height={38} /><SkeletonLine width="70%" /></ReportCard>
          <ReportCard>{[0, 1, 2].map(i => <SkeletonLine key={i} height={50} />)}</ReportCard>
        </View> : state.error ? <ReportCard><View accessibilityRole="alert" style={reportStyles.state}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
          <ReportTitle>Não foi possível carregar o relatório</ReportTitle><ReportNote center>{state.error}</ReportNote>
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={() => void state.load()}
            style={[reportStyles.action, { backgroundColor: colors.primary }]}>
            <Text style={{ fontFamily: 'Outfit_600SemiBold', color: '#fff', fontSize: 15 }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View></ReportCard> : children}
      </ScrollView>
    </SafeAreaView>
  </View>;
}
export function ReportCard({ children, hero = false }: { children: React.ReactNode; hero?: boolean }) {
  const colors = useColors();
  return <View style={[reportStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }, hero && { borderTopWidth: 3, borderTopColor: colors.primary }]}>{children}</View>;
}
export function ReportTitle({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text accessibilityRole="header" style={[reportStyles.title, { color: colors.text }]}>{children}</Text>;
}
export function ReportLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text style={[reportStyles.label, { color: colors.text }]}>{children}</Text>;
}
export function ReportNote({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  const colors = useColors();
  return <Text style={[reportStyles.note, { color: colors.textSecondary }, center && { textAlign: 'center' }]}>{children}</Text>;
}
export function ReportNumber({ children, large = false, style }: { children: React.ReactNode; large?: boolean; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45}
    style={[reportStyles.number, { color: colors.text, fontSize: large ? 36 : 21 }, style]}>{children}</Text>;
}
export function ReportMoney({ value, large = false }: { value: number; large?: boolean }) {
  return <ReportNumber large={large}>{formatCurrency(value)}</ReportNumber>;
}
export function formatReportTime(value: number | null) {
  if (value === null) return '—';
  if (value < 60) return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
  const minutes = Math.round(value);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
export function ReportTime({ value, large = false }: { value: number | null; large?: boolean }) {
  return <View style={{ gap: 4 }}><ReportNumber large={large}>{formatReportTime(value)}</ReportNumber>
    {value === null && <ReportNote>Não há medições suficientes.</ReportNote>}
  </View>;
}
export const reportPercent = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export function ReportBar({ value, label, color }: { value: number; label: string; color?: string }) {
  const colors = useColors();
  const width = Math.min(100, Math.max(0, value));
  return <View accessible accessibilityRole="image" accessibilityLabel={label}
    style={{ height: 6, backgroundColor: colors.surfaceSecondary, borderRadius: 3, overflow: 'hidden' }}>
    <View style={{ height: 6, width: `${width}%`, backgroundColor: color ?? colors.primary }} />
  </View>;
}
export function ReportEmpty({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <ReportCard><View style={reportStyles.state}>
    <Ionicons name="stats-chart-outline" size={32} color={colors.textSecondary} />
    <ReportTitle>{children}</ReportTitle><ReportNote center>Selecione outro período ou puxe para atualizar.</ReportNote>
  </View></ReportCard>;
}
export const reportStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  back: { width: 80, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  content: { padding: 16, paddingBottom: 32, gap: 20, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  title: { fontFamily: 'Outfit_700Bold', fontSize: 18 },
  label: { fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  note: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20 },
  number: { fontFamily: 'Outfit_700Bold', fontVariant: ['tabular-nums'] },
  columns: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0, gap: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  row: { paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 12 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
});
