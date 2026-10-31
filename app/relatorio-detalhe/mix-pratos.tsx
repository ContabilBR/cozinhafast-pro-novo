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
interface MixPratosReport {
  totais: { pratos_distintos: number; quantidade_vendida: number; faturamento_itens: number };
  pratos: {
    posicao: number; prato_id: string | null; nome: string; categoria: string;
    quantidade_vendida: number; faturamento: number; preco_medio: number;
    percentual_faturamento: number; percentual_acumulado: number; classe_abc: string;
  }[];
  resumo_abc: { classe: string; quantidade_pratos: number; faturamento: number; percentual_faturamento: number }[];
  por_categoria: { categoria: string; quantidade_vendida: number; faturamento: number; percentual_faturamento: number }[];
  mais_vendidos_quantidade: { nome: string; categoria: string; quantidade_vendida: number; faturamento: number }[];
  sem_vendas: { prato_id: string; nome: string; categoria: string }[];
}
const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoje', label: 'Hoje' }, { key: '7dias', label: '7 dias' }, { key: 'mes', label: 'Este mês' },
];
const CLASSES = ['A', 'B', 'C'] as const;
const percent = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const quantidade = (value: number) => `${value.toLocaleString('pt-BR')} ${value === 1 ? 'unidade vendida' : 'unidades vendidas'}`;
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function Money({ value, large = false }: { value: number; large?: boolean }) {
  const colors = useColors();
  return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45}
    style={[styles.number, { color: colors.text, fontSize: large ? 36 : 21 }]}>{formatCurrency(value)}</Text>;
}
function classColor(classe: string, colors: ReturnType<typeof useColors>) {
  return classe === 'A' ? colors.primary : classe === 'B' ? colors.statusRecebido : colors.statusPronto;
}
// A cor verde do tema recebe relevo no fundo escuro; letras e valores nunca dependem só da cor.
function classOpacity(classe: string, colors: ReturnType<typeof useColors>) {
  return classe === 'C' && colors.surface === colors.darkSurface ? 0.8 : 1;
}
function ClassBadge({ classe }: { classe: string }) {
  const colors = useColors();
  return <View accessible accessibilityLabel={`Classe ${classe}`}
    style={[styles.badge, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: classColor(classe, colors), opacity: classOpacity(classe, colors) }} />
    <Text style={[styles.label, { color: colors.text }]}>Classe {classe}</Text>
  </View>;
}

export default function MixPratosScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ periodo?: string | string[] }>();
  const initial = Array.isArray(params.periodo) ? params.periodo[0] : params.periodo;
  const [periodo, setPeriodo] = useState<Periodo>(initial === '7dias' || initial === 'mes' ? initial : 'hoje');
  const [data, setData] = useState<MixPratosReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    if (!refresh) { setData(null); setExpanded(false); }
    try {
      const result = await apiGet<MixPratosReport>(`/api/relatorios/mix-pratos?periodo=${periodo}`);
      if (current !== sequence.current) return;
      if (!result?.totais || !Array.isArray(result.pratos) || !Array.isArray(result.resumo_abc)
        || !Array.isArray(result.por_categoria) || !Array.isArray(result.mais_vendidos_quantidade)
        || !Array.isArray(result.sem_vendas)) {
        throw new Error('O relatório recebido está incompleto. Tente novamente.');
      }
      setData(result);
    } catch (err: unknown) {
      if (current !== sequence.current) return;
      const apiError = err as { status?: number; message?: string };
      setData(null);
      if (apiError.status === 403) setForbidden(true);
      else setError(apiError.message || 'Não foi possível carregar o mix de pratos. Verifique sua conexão e tente novamente.');
    } finally {
      if (current === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [allowed, authLoading, periodo]);

  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const muted = [styles.muted, { color: colors.textSecondary }];
  const title = [styles.title, { color: colors.text }];
  const label = [styles.label, { color: colors.text }];
  const abc = CLASSES.map(classe => data?.resumo_abc.find(row => row.classe === classe)
    ?? { classe, quantidade_pratos: 0, faturamento: 0, percentual_faturamento: 0 });
  const empty = data?.totais.quantidade_vendida === 0;

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerShown: false }} />
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: colors.surface }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" style={styles.back}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/relatorio-detalhe' as any)}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
          <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 16, color: colors.primary }}>Voltar</Text>
        </AnimatedPressable>
        <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
          style={[styles.title, { flex: 1, textAlign: 'center', fontSize: 17, color: colors.text }]}>Mix de pratos</Text>
        <View style={{ width: 80 }} />
      </View>
    </SafeAreaView>
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} alwaysBounceVertical
        refreshControl={allowed && !forbidden ? <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}>
        {!restricted && <View style={styles.chips}>{PERIODOS.map(p => <AnimatedPressable key={p.key}
          accessibilityRole="button" accessibilityLabel={`Período: ${p.label}`} accessibilityState={{ selected: periodo === p.key }}
          onPress={() => { if (p.key !== periodo) { sequence.current += 1; setData(null); setLoading(true); setExpanded(false); setPeriodo(p.key); } }}
          style={[styles.chip, { backgroundColor: periodo === p.key ? colors.primary : colors.surface, borderColor: periodo === p.key ? colors.primary : colors.border }]}>
          <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 13, color: periodo === p.key ? '#fff' : colors.text }}>{p.label}</Text>
        </AnimatedPressable>)}</View>}
        {restricted ? <View style={[card, styles.state]} accessibilityRole="alert">
          <Ionicons name="lock-closed-outline" size={32} color={colors.textSecondary} />
          <Text style={title}>Acesso restrito</Text>
          <Text style={[muted, styles.center]}>Este relatório está disponível apenas para gerente e administrador.</Text>
        </View> : loading || authLoading ? <View accessibilityLabel="Carregando relatório de mix de pratos" style={{ gap: 16 }}>
          <View style={card}><SkeletonLine width="50%" /><SkeletonLine width="85%" height={38} /><SkeletonLine width="70%" /></View>
          <View style={card}><SkeletonLine width="40%" height={20} />{[0, 1, 2].map(i => <SkeletonLine key={i} height={50} />)}</View>
        </View> : error ? <View style={[card, styles.state]} accessibilityRole="alert">
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
          <Text style={[title, styles.center]}>Não foi possível carregar o mix de pratos</Text>
          <Text style={[muted, styles.center]}>{error}</Text>
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={() => void load()}
            style={[styles.action, { backgroundColor: colors.primary }]}>
            <Text style={{ fontFamily: 'Outfit_600SemiBold', color: '#fff', fontSize: 15 }}>Tentar novamente</Text>
          </AnimatedPressable>
        </View> : data ? <>
          <View style={[card, { borderTopWidth: 3, borderTopColor: colors.primary, gap: 12 }]}>
            <Text style={muted}>{PERIODOS.find(p => p.key === periodo)?.label}</Text>
            <Text style={label}>Faturamento de itens</Text>
            <Money value={data.totais.faturamento_itens} large />
            <View style={styles.columns}>
              <View style={styles.column}><Text style={[styles.number, { fontSize: 23, color: colors.text }]}>{data.totais.quantidade_vendida.toLocaleString('pt-BR')}</Text><Text style={muted}>Unidades vendidas</Text></View>
              <View style={styles.column}><Text style={[styles.number, { fontSize: 23, color: colors.text }]}>{data.totais.pratos_distintos.toLocaleString('pt-BR')}</Text><Text style={muted}>Pratos distintos</Text></View>
            </View>
            <Text style={muted}>Somente o faturamento dos itens, sem gorjeta nem taxa de entrega. Itens cancelados não contam como venda.</Text>
          </View>
          {empty ? <View style={[card, styles.state]}>
            <Ionicons name="restaurant-outline" size={32} color={colors.textSecondary} />
            <Text style={[title, styles.center]}>Nenhuma venda de pratos no período</Text>
            <Text style={[muted, styles.center]}>Selecione outro período ou puxe para atualizar.</Text>
          </View> : <>
            <View style={card}>
              <Text accessibilityRole="header" style={title}>Curva ABC</Text>
              <Text style={muted}>A forma os primeiros 80% do faturamento; B, a faixa seguinte até 95%; C, o restante. As classes seguem o cálculo da API.</Text>
              {abc.map(row => <View key={row.classe} style={[styles.classCard, { borderColor: colors.border }]}>
                <View style={styles.between}><ClassBadge classe={row.classe} /><Text style={muted}>{row.quantidade_pratos.toLocaleString('pt-BR')} {row.quantidade_pratos === 1 ? 'prato' : 'pratos'}</Text></View>
                <Money value={row.faturamento} />
                <Text style={muted}>{percent(row.percentual_faturamento)} do faturamento</Text>
              </View>)}
              <View accessible accessibilityRole="image" accessibilityLabel={`Proporção do faturamento por classe. ${abc.map(row => `Classe ${row.classe}: ${percent(row.percentual_faturamento)}, ${formatCurrency(row.faturamento)}`).join('. ')}`}
                style={[styles.stacked, { backgroundColor: colors.surface }]}>
                {abc.map(row => row.percentual_faturamento > 0 ? <View key={row.classe} style={{ flexGrow: row.percentual_faturamento, flexBasis: 0, height: 14, backgroundColor: classColor(row.classe, colors), opacity: classOpacity(row.classe, colors) }} /> : null)}
              </View>
              <View style={[styles.columns, { flexWrap: 'wrap' }]}>{abc.map(row => <Text key={row.classe} style={muted}>{row.classe} · {percent(row.percentual_faturamento)}</Text>)}</View>
            </View>
            <View style={card}>
              <Text accessibilityRole="header" style={title}>Ranking de pratos</Text>
              <Text style={muted}>Ordenação recebida do relatório · {expanded ? data.pratos.length : Math.min(15, data.pratos.length)} de {data.pratos.length} pratos</Text>
              {(expanded ? data.pratos : data.pratos.slice(0, 15)).map((row, i) => <View key={`${row.prato_id ?? row.nome}-${i}`} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={styles.between}><Text style={[label, { flex: 1 }]}>{row.posicao}. {row.nome}</Text><ClassBadge classe={row.classe_abc} /></View>
                <Text style={muted}>{row.categoria}</Text>
                {row.prato_id === null && <Text style={[muted, { fontSize: 12 }]}>prato removido do cardápio</Text>}
                <Text style={muted}>{quantidade(row.quantidade_vendida)}</Text>
                <Text style={muted}>Faturamento</Text><Money value={row.faturamento} />
                <Text style={muted}>Preço médio</Text><Money value={row.preco_medio} />
                <Text style={muted}>{percent(row.percentual_faturamento)} do faturamento · {percent(row.percentual_acumulado)} acumulado</Text>
              </View>)}
              {data.pratos.length > 15 && <AnimatedPressable accessibilityRole="button" accessibilityLabel={expanded ? 'Mostrar os primeiros 15 pratos' : 'Ver todos os pratos'} accessibilityState={{ expanded }}
                onPress={() => setExpanded(value => !value)} style={[styles.action, { borderWidth: 1, borderColor: colors.primary }]}>
                <Text style={[label, { textAlign: 'center', color: colors.primary }]}>{expanded ? 'Ver menos' : 'Ver todos'}</Text>
              </AnimatedPressable>}
            </View>
            <View style={card}>
              <Text accessibilityRole="header" style={title}>Por categoria</Text>
              {data.por_categoria.map((row, i) => <View key={`${row.categoria}-${i}`} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={label}>{row.categoria}</Text>
                <Text style={muted}>{quantidade(row.quantidade_vendida)}</Text>
                <Money value={row.faturamento} />
                <Text style={muted}>{percent(row.percentual_faturamento)} do faturamento</Text>
                <View accessible accessibilityRole="image" accessibilityLabel={`${row.categoria}: ${percent(row.percentual_faturamento)} do faturamento, ${formatCurrency(row.faturamento)}`}
                  style={[styles.track, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={{ height: 6, width: `${clamp(row.percentual_faturamento)}%`, backgroundColor: colors.primary }} />
                </View>
              </View>)}
            </View>
            <View style={card}>
              <Text accessibilityRole="header" style={title}>Mais vendidos em quantidade</Text>
              <Text style={muted}>Até 10 pratos, na ordem recebida do relatório.</Text>
              {data.mais_vendidos_quantidade.slice(0, 10).map((row, i) => <View key={`${row.nome}-${i}`} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={label}>{i + 1}. {row.nome}</Text><Text style={muted}>{row.categoria}</Text>
                <Text style={muted}>{quantidade(row.quantidade_vendida)}</Text><Money value={row.faturamento} />
              </View>)}
            </View>
            {data.sem_vendas.length > 0 && <View style={card}>
              <Text accessibilityRole="header" style={title}>Pratos sem venda no período</Text>
              <Text style={muted}>Pratos disponíveis no cardápio que não tiveram vendas no período selecionado. Exibição limitada a 50 pratos.</Text>
              {data.sem_vendas.slice(0, 50).map(row => <View key={row.prato_id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={label}>{row.nome}</Text><Text style={muted}>{row.categoria}</Text>
              </View>)}
            </View>}
          </>}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  back: { width: 80, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  content: { padding: 16, paddingBottom: 32, gap: 20, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  classCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  title: { fontFamily: 'Outfit_700Bold', fontSize: 18 },
  label: { fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  muted: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20 },
  number: { fontFamily: 'Outfit_700Bold', fontVariant: ['tabular-nums'] },
  columns: { flexDirection: 'row', gap: 16 },
  column: { flex: 1, minWidth: 0, gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  stacked: { flexDirection: 'row', height: 14, gap: 3, overflow: 'hidden', borderRadius: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  row: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  track: { height: 6, overflow: 'hidden', borderRadius: 3 },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 12 },
  center: { textAlign: 'center', lineHeight: 22 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
});
