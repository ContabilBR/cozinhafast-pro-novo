import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { SkeletonLine } from '@/components/SkeletonLoader';
import { apiGet } from '@/utils/api';
import { formatCurrency } from '@/utils/helpers';

type Periodo = 'hoje' | '7dias' | 'mes';
interface ValoresCancelados {
  quantidade: number;
  valor: number;
  valor_perda: number;
}
interface CancelamentosReport {
  totais: {
    quantidade_cancelada: number;
    valor_cancelado: number;
    quantidade_antes_preparo: number;
    valor_antes_preparo: number;
    quantidade_perda: number;
    valor_perda: number;
    percentual_cancelamento: number;
  };
  por_motivo: (ValoresCancelados & { codigo: string; nome: string })[];
  por_responsavel: (ValoresCancelados & { responsavel_id: string | null; nome: string; role: string | null })[];
  pratos_mais_cancelados: (ValoresCancelados & { nome: string })[];
  por_canal: (ValoresCancelados & { canal: 'mesa' | 'delivery' })[];
  por_dia: (ValoresCancelados & { data: string })[];
}
const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7dias', label: '7 dias' },
  { key: 'mes', label: 'Este mês' },
];
const PERFIS: Record<string, string> = {
  garcom: 'Garçom', gerente: 'Gerente', administrador: 'Administrador',
  admin: 'Administrador', cozinha: 'Cozinha', cozinheiro: 'Cozinha',
};
function perfil(role: string | null) {
  return role ? PERFIS[role.toLowerCase()] ?? role : 'Não identificado';
}
function diaLabel(value: string) {
  const [ano, mes, dia] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(ano, mes - 1, dia, 12));
  if (!Number.isFinite(date.getTime())) return value;
  const semana = date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')} · ${semana}`;
}
function itens(value: number) {
  return `${value.toLocaleString('pt-BR')} ${value === 1 ? 'item' : 'itens'}`;
}

// Componentes exclusivos do relatório novo; Vendas permanece intacta.
function Money({ value, large = false }: { value: number; large?: boolean }) {
  const colors = useColors();
  return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45}
    style={[styles.number, { color: colors.text, fontSize: large ? 36 : 21 }]}>{formatCurrency(value)}</Text>;
}
function ProportionBar({ value, max, label }: { value: number; max: number; label: string }) {
  const colors = useColors();
  const percentage = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return (
    <View accessible accessibilityRole="image"
      accessibilityLabel={`${label}. Valor cancelado: ${formatCurrency(value)}. ${percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do maior valor desta seção.`}
      style={[styles.track, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.fill, { width: `${percentage}%`, backgroundColor: colors.primary }]} />
    </View>
  );
}
function DetailRow({ name, subtitle, values, max }: {
  name: string; subtitle?: string; values: ValoresCancelados; max?: number;
}) {
  const colors = useColors();
  return (
    <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowName, { color: colors.text }]}>{name}</Text>
      {!!subtitle && <Text style={[styles.muted, { color: colors.textSecondary }]}>{subtitle}</Text>}
      <View style={styles.rowValues}>
        <Text style={[styles.muted, { flex: 1, color: colors.textSecondary }]}>{itens(values.quantidade)}</Text>
        <View style={{ flexShrink: 1, maxWidth: '65%', alignItems: 'flex-end' }}>
          <Text style={[styles.muted, { color: colors.textSecondary }]}>Valor cancelado</Text>
          <Money value={values.valor} />
        </View>
      </View>
      <View style={styles.rowValues}>
        <Text style={[styles.muted, { color: colors.textSecondary }]}>Do total, perda</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
          style={[styles.number, { fontSize: 15, flexShrink: 1, color: colors.text }]}>{formatCurrency(values.valor_perda)}</Text>
      </View>
      {max !== undefined && <ProportionBar value={values.valor} max={max} label={name} />}
    </View>
  );
}

export default function CancelamentosDetalhadosScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ periodo?: string | string[] }>();
  const initial = Array.isArray(params.periodo) ? params.periodo[0] : params.periodo;
  const [periodo, setPeriodo] = useState<Periodo>(initial === '7dias' || initial === 'mes' ? initial : 'hoje');
  const [data, setData] = useState<CancelamentosReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const sequence = useRef(0);
  const allowed = user?.role === 'gerente' || user?.role === 'administrador';
  const restricted = !authLoading && (!allowed || forbidden);

  const load = useCallback(async (refresh = false) => {
    if (!allowed || authLoading) return;
    const current = ++sequence.current;
    setLoading(!refresh);
    setRefreshing(refresh);
    setError('');
    setForbidden(false);
    if (!refresh) setData(null);
    try {
      const result = await apiGet<CancelamentosReport>(`/api/relatorios/cancelamentos?periodo=${periodo}`);
      if (current !== sequence.current) return;
      if (!result?.totais || !Array.isArray(result.por_motivo) || !Array.isArray(result.por_responsavel)
        || !Array.isArray(result.pratos_mais_cancelados) || !Array.isArray(result.por_canal) || !Array.isArray(result.por_dia)) {
        throw new Error('O relatório recebido está incompleto. Tente novamente.');
      }
      setData(result);
    } catch (err: unknown) {
      if (current !== sequence.current) return;
      const apiError = err as { status?: number; message?: string };
      setData(null);
      if (apiError.status === 403) setForbidden(true);
      else setError(apiError.message || 'Não foi possível carregar os cancelamentos. Verifique sua conexão e tente novamente.');
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

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const muted = [styles.muted, { color: colors.textSecondary }];
  const title = [styles.sectionTitle, { color: colors.text }];
  const selectedLabel = PERIODOS.find(p => p.key === periodo)?.label;
  const maxReason = Math.max(0, ...(data?.por_motivo.map(row => row.valor) ?? []));
  const days = [...(data?.por_dia ?? [])].sort((a, b) => a.data.localeCompare(b.data));
  const maxDay = Math.max(0, ...days.map(row => row.valor));
  const maxChannel = Math.max(0, ...(data?.por_canal.map(row => row.valor) ?? []));
  const empty = data?.totais.quantidade_cancelada === 0;
  const hasLoss = !!data && (data.totais.quantidade_perda > 0 || data.totais.valor_perda > 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: colors.surface }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/relatorio-detalhe' as any)} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
            <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 16, color: colors.primary }}>Voltar</Text>
          </AnimatedPressable>
          <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
            style={{ flex: 1, textAlign: 'center', fontFamily: 'Outfit_700Bold', fontSize: 17, color: colors.text }}>Cancelamentos</Text>
          <View style={{ width: 80 }} />
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical
          refreshControl={allowed && !forbidden ? <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
          {!restricted && <View style={styles.chips}>
            {PERIODOS.map(p => <AnimatedPressable key={p.key} accessibilityRole="button"
              accessibilityLabel={`Período: ${p.label}`} accessibilityState={{ selected: periodo === p.key }}
              onPress={() => { if (p.key !== periodo) { sequence.current += 1; setPeriodo(p.key); } }}
              style={[styles.chip, { backgroundColor: periodo === p.key ? colors.primary : colors.surface, borderColor: periodo === p.key ? colors.primary : colors.border }]}>
              <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 13, color: periodo === p.key ? '#fff' : colors.text }}>{p.label}</Text>
            </AnimatedPressable>)}
          </View>}

          {restricted ? <View style={[card, styles.state]} accessibilityRole="alert">
            <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} />
            <Text style={title}>Acesso restrito</Text>
            <Text style={[muted, styles.center]}>Este relatório está disponível apenas para gerente e administrador.</Text>
          </View> : loading || authLoading ? <View accessibilityLabel="Carregando relatório de cancelamentos" style={{ gap: 16 }}>
            <View style={card}><SkeletonLine width="50%" /><SkeletonLine width="85%" height={38} /><SkeletonLine width="70%" /></View>
            <View style={styles.twoColumns}>{[0, 1].map(i => <View key={i} style={[card, styles.column]}><SkeletonLine /><SkeletonLine height={26} /></View>)}</View>
            <View style={card}><SkeletonLine width="40%" height={20} />{[0, 1, 2].map(i => <SkeletonLine key={i} height={42} />)}</View>
          </View> : error ? <View style={[card, styles.state]} accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
            <Text style={[title, styles.center]}>Não foi possível carregar os cancelamentos</Text>
            <Text style={[muted, styles.center]}>{error}</Text>
            <AnimatedPressable accessibilityRole="button" accessibilityLabel="Tentar novamente"
              onPress={() => void load()} style={[styles.retry, { backgroundColor: colors.primary }]}>
              <Text style={{ fontFamily: 'Outfit_600SemiBold', color: '#fff', fontSize: 15 }}>Tentar novamente</Text>
            </AnimatedPressable>
          </View> : data ? <>
            <View style={[card, { borderTopWidth: 3, borderTopColor: colors.primary, gap: 12 }]}>
              <Text style={muted}>{selectedLabel}</Text>
              <Text style={[styles.rowName, { color: colors.text }]}>Valor total cancelado</Text>
              <Money value={data.totais.valor_cancelado} large />
              <Text style={[styles.rowName, { color: colors.text }]}>{itens(data.totais.quantidade_cancelada)} {data.totais.quantidade_cancelada === 1 ? 'cancelado' : 'cancelados'}</Text>
              <Text style={[styles.number, { color: colors.text, fontSize: 20 }]}>{data.totais.percentual_cancelamento.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de cancelamento</Text>
              <Text style={muted}>Valor cancelado ÷ (valor cancelado + subtotal das comandas fechadas no período). Não inclui gorjeta nem taxa de entrega nessa base.</Text>
              <Text style={muted}>O total cancelado soma cancelamentos comuns e perdas, separados abaixo. Item cancelado não conta como venda.</Text>
            </View>

            <View style={styles.twoColumns}>
              <View style={[card, styles.column]}>
                <Text style={[styles.rowName, { color: colors.text }]}>Antes do preparo</Text>
                <Text style={muted}>{itens(data.totais.quantidade_antes_preparo)}</Text>
                <Money value={data.totais.valor_antes_preparo} />
                <Text style={muted}>Cancelamento comum</Text>
              </View>
              <View style={[card, styles.column, hasLoss && { borderColor: colors.danger, borderWidth: 2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5 }}>
                  {hasLoss && <Ionicons name="warning-outline" size={18} color={colors.danger} />}
                  <Text style={[styles.rowName, { flex: 1, color: hasLoss ? colors.danger : colors.text }]}>Perda (após iniciar)</Text>
                </View>
                <Text style={muted}>{itens(data.totais.quantidade_perda)}</Text>
                <Money value={data.totais.valor_perda} />
              </View>
            </View>
            <Text style={muted}>Perda é item cancelado depois de iniciado o preparo, inclusive quando já está pronto. Item pendente cancelado é cancelamento comum.</Text>

            {empty ? <View style={[card, styles.state]}>
              <Ionicons name="checkmark-circle-outline" size={32} color={colors.textSecondary} />
              <Text style={[title, styles.center]}>Nenhum cancelamento no período</Text>
              <Text style={[muted, styles.center]}>Selecione outro período ou puxe para atualizar.</Text>
            </View> : <>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Motivos</Text>
                <Text style={muted}>Valores cancelados; a perda já está incluída em cada total.</Text>
                {data.por_motivo.length === 0 ? <Text style={muted}>Nenhum motivo informado</Text> : data.por_motivo.map((row, i) => <DetailRow key={`${row.codigo}-${i}`} name={row.nome} values={row} max={maxReason} />)}
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Quem cancelou</Text>
                {data.por_responsavel.length === 0 ? <Text style={muted}>Nenhum responsável informado</Text> : data.por_responsavel.map((row, i) => <DetailRow key={`${row.responsavel_id ?? 'nao-identificado'}-${i}`} name={row.nome?.trim() || 'Não identificado'} subtitle={perfil(row.role)} values={row} />)}
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Pratos mais cancelados</Text>
                {data.pratos_mais_cancelados.length === 0 ? <Text style={muted}>Nenhum prato informado</Text> : data.pratos_mais_cancelados.map((row, i) => <DetailRow key={`${row.nome}-${i}`} name={row.nome} values={row} />)}
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Por canal</Text>
                <Text style={muted}>Valor cancelado e parcela que foi perda</Text>
                <View style={styles.twoColumns}>
                  {(['mesa', 'delivery'] as const).map(canal => {
                    const row = data.por_canal.find(item => item.canal === canal) ?? { quantidade: 0, valor: 0, valor_perda: 0 };
                    const label = canal === 'mesa' ? 'Mesa' : 'Delivery';
                    return <View key={canal} style={[styles.column, { gap: 9 }]}>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Ionicons name={canal === 'mesa' ? 'restaurant-outline' : 'bicycle-outline'} size={18} color={colors.textSecondary} /><Text style={[styles.rowName, { color: colors.text }]}>{label}</Text></View>
                      <Text style={muted}>{itens(row.quantidade)}</Text>
                      <Money value={row.valor} />
                      <Text style={muted}>Do total, perda</Text>
                      <Money value={row.valor_perda} />
                      <ProportionBar value={row.valor} max={maxChannel} label={label} />
                    </View>;
                  })}
                </View>
              </View>
              <View style={card}>
                <Text accessibilityRole="header" style={title}>Por dia</Text>
                <Text style={muted}>Valor cancelado no dia do cancelamento</Text>
                {days.length === 0 ? <Text style={muted}>Nenhum dia informado</Text> : days.map(row => <DetailRow key={row.data} name={diaLabel(row.data)} values={row} max={maxDay} />)}
              </View>
            </>}
          </> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  back: { width: 80, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  content: { padding: 16, paddingBottom: 32, gap: 20, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle: { fontFamily: 'Outfit_700Bold', fontSize: 18 },
  rowName: { fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  muted: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20 },
  number: { fontFamily: 'Outfit_700Bold', fontVariant: ['tabular-nums'] },
  twoColumns: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  column: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 12 },
  center: { textAlign: 'center', lineHeight: 22 },
  retry: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  detailRow: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowValues: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
});
