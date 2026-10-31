import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { apiDelete, apiGet, apiPost, apiPut } from '@/utils/api';
import { formatCurrency } from '@/utils/helpers';

type Prato = { id: string; nome: string; preco: number };
type Insumo = { id: string; nome: string; unidade: string; custo: number | null; ativo: boolean };
type Vinculo = { id: string; insumoId: string; insumoNome: string; insumoUnidade: string; quantidade: number };
type Dados = { prato: Prato; itens: Vinculo[]; insumos: Insumo[]; aviso: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function numero(v: unknown): number | null {
  if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v.trim()))) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function quantidadeTexto(texto: string): string | null {
  const normalized = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? String(n) : null;
}
function lerPrato(raw: unknown, id: string): Prato {
  const p = object(raw) && object(raw.prato) ? raw.prato : raw;
  if (!object(p) || p.id !== id || typeof p.nome !== 'string' || numero(p.preco) === null) throw new Error('Dados do prato inválidos.');
  return { id, nome: p.nome, preco: numero(p.preco)! };
}
function lerFicha(raw: unknown): Vinculo[] {
  const list = Array.isArray(raw) ? raw : object(raw) ? raw.insumos : null;
  if (!Array.isArray(list)) throw new Error('Ficha técnica inválida.');
  const ids = new Set<string>();
  return list.map(row => {
    if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.insumoId !== 'string' || !row.insumoId || typeof row.insumoNome !== 'string' || typeof row.insumoUnidade !== 'string' || numero(row.quantidadeUsada) === null) throw new Error('Ficha técnica inválida.');
    ids.add(row.id);
    return { id: row.id, insumoId: row.insumoId, insumoNome: row.insumoNome, insumoUnidade: row.insumoUnidade, quantidade: numero(row.quantidadeUsada)! };
  });
}
function lerInsumos(raw: unknown): Insumo[] {
  const list = Array.isArray(raw) ? raw : object(raw) ? raw.insumos : null;
  if (!Array.isArray(list)) throw new Error('Lista de insumos inválida.');
  const ids = new Set<string>();
  return list.map(row => {
    if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.nome !== 'string' || typeof row.unidade !== 'string' || typeof row.ativo !== 'boolean') throw new Error('Lista de insumos inválida.');
    ids.add(row.id);
    return { id: row.id, nome: row.nome, unidade: row.unidade, ativo: row.ativo, custo: numero(row.custoUnitario) };
  });
}
const erroApi = (e: unknown, fallback: string) => e instanceof Error && 'status' in e && typeof e.status === 'number' && e.message.trim() ? e.message : fallback;
const buscaNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function FichaTecnicaScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const { user, loading } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const allowed = user?.role === 'gerente' || user?.role === 'administrador';
  const pratoId = typeof id === 'string' ? id : '';
  if (loading) return <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  if (!allowed) return <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
    <Ionicons name="lock-closed-outline" size={40} color={colors.textSecondary} />
    <Text style={[styles.title, { color: colors.text }]}>Acesso restrito</Text>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Disponível apenas para gerente e administrador.</Text>
    <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.button}><Text style={{ color: colors.primary }}>Voltar</Text></AnimatedPressable>
  </SafeAreaView>;
  return <Ficha key={`${pratoId}:${user?.id}`} id={pratoId} />;
}

function Ficha({ id }: { id: string }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<{ item: Vinculo | null } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [qtd, setQtd] = useState('');
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remover, setRemover] = useState<Vinculo | null>(null);
  const [feedback, setFeedback] = useState('');
  const active = useRef(false);
  const version = useRef(0);
  const mutation = useRef(false);
  const endpoint = `/api/pratos/${encodeURIComponent(id)}/insumos`;
  const load = useCallback(async () => {
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      if (!id) throw new Error('Prato não informado.');
      const [prato, ficha, insumos] = await Promise.allSettled([
        apiGet<unknown>(`/api/pratos/${encodeURIComponent(id)}`), apiGet<unknown>(endpoint), apiGet<unknown>('/api/insumos'),
      ]);
      if (!active.current || request !== version.current) return;
      if (prato.status !== 'fulfilled' || ficha.status !== 'fulfilled') throw new Error('Não foi possível carregar a ficha técnica.');
      const next: Dados = { prato: lerPrato(prato.value, id), itens: lerFicha(ficha.value), insumos: [], aviso: '' };
      try {
        if (insumos.status !== 'fulfilled') throw new Error();
        next.insumos = lerInsumos(insumos.value);
      } catch { next.aviso = 'Não foi possível carregar os insumos do estoque. Custos e margem indisponíveis. Tente atualizar.'; }
      setDados(next);
    } catch {
      if (active.current && request === version.current) { setDados(null); setError('Não foi possível carregar a ficha técnica. Tente novamente.'); }
    } finally { if (active.current && request === version.current) setLoading(false); }
  }, [id, endpoint]);
  useFocusEffect(useCallback(() => {
    active.current = true; void load();
    return () => { active.current = false; version.current++; setPanel(null); setRemover(null); };
  }, [load]));

  const map = new Map(dados?.insumos.map(i => [i.id, i]));
  const used = new Set(dados?.itens.map(i => i.insumoId));
  const available = dados?.insumos.filter(i => i.ativo && !used.has(i.id)) ?? [];
  const selected = panel?.item ? { id: panel.item.insumoId, nome: panel.item.insumoNome, unidade: panel.item.insumoUnidade } : available.find(i => i.id === selectedId);
  const missing = dados?.itens.some(i => map.get(i.insumoId)?.custo == null) ?? false;
  const zero = dados?.itens.filter(i => map.get(i.insumoId)?.custo === 0).length ?? 0;
  const total = dados?.itens.reduce((sum, i) => sum + i.quantidade * (map.get(i.insumoId)?.custo ?? 0), 0) ?? 0;
  const hasItems = !!dados?.itens.length;
  const costKnown = !dados?.aviso && !missing;
  const margin = dados ? dados.prato.preco - total : 0;
  const openPanel = (item: Vinculo | null) => {
    if (mutation.current || loading) return;
    setPanel({ item }); setQtd(item ? String(item.quantidade).replace('.', ',') : '');
    setSelectedId(item?.insumoId ?? ''); setSearch(''); setFormError(''); setFeedback('');
  };
  const save = async () => {
    if (mutation.current || !panel || !selected) return;
    const quantity = quantidadeTexto(qtd);
    if (!quantity) { setFormError('Informe uma quantidade maior que zero, até 1.000.000, com no máximo 3 casas decimais.'); return; }
    mutation.current = true; setBusy(true); setFormError('');
    try {
      if (panel.item) await apiPut(`${endpoint}/${encodeURIComponent(panel.item.id)}`, { quantidade: quantity });
      else await apiPost(endpoint, { insumo_id: selected.id, quantidade: quantity });
      if (active.current) { setPanel(null); setFeedback('Ficha técnica salva.'); await load(); }
    } catch (e) { if (active.current) setFormError(erroApi(e, 'Não foi possível salvar o insumo.')); }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  };
  const remove = async () => {
    if (mutation.current || !remover) return;
    const item = remover;
    mutation.current = true; setBusy(true); setRemover(null);
    try {
      await apiDelete(`${endpoint}/${encodeURIComponent(item.id)}`);
      if (active.current) { setFeedback('Insumo removido da ficha técnica.'); await load(); }
    } catch (e) { if (active.current) Alert.alert('Erro ao remover', erroApi(e, 'Não foi possível remover o insumo.')); }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  };
  const text = [styles.body, { color: colors.text }];
  const muted = [styles.body, { color: colors.textSecondary }];
  const input = [styles.input, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.text }];
  const button = (label: string, action: () => void, disabled = false) => <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={[styles.bold, { color: '#fff' }]}>{label}</Text></AnimatedPressable>;

  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
    <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={26} color={colors.primary} /></AnimatedPressable>
      <Text style={[styles.title, { color: colors.text }]}>Ficha técnica</Text>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }} refreshControl={<RefreshControl refreshing={loading && !!dados} onRefresh={() => { if (!mutation.current) void load(); }} tintColor={colors.primary} />}>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={muted}>Carregando ficha técnica...</Text></View> : error ? <View style={styles.center}><Text accessibilityRole="alert" style={text}>{error}</Text>{button('Tentar novamente', () => { void load(); })}</View> : dados && <>
        <View style={{ gap: 4 }}><Text style={[styles.title, { color: colors.text }]}>{dados.prato.nome}</Text><Text style={muted}>Preço de venda · {formatCurrency(dados.prato.preco)}</Text></View>
        {!!feedback && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.success }]}>{feedback}</Text>}
        {!!dados.aviso && <Text accessibilityRole="alert" style={[styles.body, { color: colors.warning }]}>{dados.aviso}</Text>}
        {!hasItems && <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={text}>Este prato ainda não tem ficha técnica.</Text></View>}
        {dados.itens.map(item => {
          const cost = map.get(item.insumoId)?.custo;
          return <View key={item.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Alterar quantidade de ${item.insumoNome}`} disabled={busy} onPress={() => openPanel(item)} style={{ gap: 6, paddingVertical: 4 }}>
              <Text style={[styles.bold, { color: colors.text }]}>{item.insumoNome}</Text>
              <Text style={text}>{item.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} {item.insumoUnidade}</Text>
              <Text style={muted}>{cost == null ? 'Custo unitário indisponível' : `${formatCurrency(cost)} por ${item.insumoUnidade}`}</Text>
              <View style={styles.row}><Text style={muted}>Custo da linha</Text><Text style={[styles.bold, { color: colors.text }]}>{cost == null ? '—' : formatCurrency(item.quantidade * cost)}</Text></View>
              <Text style={[styles.body, { color: colors.primary }]}>Alterar quantidade</Text>
            </AnimatedPressable>
            <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Remover ${item.insumoNome} da ficha técnica`} disabled={busy} onPress={() => setRemover(item)} style={[styles.remove, { borderTopColor: colors.border }]}><Ionicons name="trash-outline" size={18} color={colors.danger} /><Text style={[styles.body, { color: colors.danger }]}>Remover insumo</Text></AnimatedPressable>
          </View>;
        })}
        {busy && <ActivityIndicator color={colors.primary} />}
        {button('Adicionar insumo', () => openPanel(null), busy)}
      </>}
    </ScrollView>
    {dados && !loading && !error && <View style={[styles.summary, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.row}><Text style={muted}>Custo total da ficha</Text><Text style={[styles.bold, { color: colors.text }]}>{costKnown ? formatCurrency(total) : 'Indisponível'}</Text></View>
      <View style={styles.row}><Text style={muted}>Preço de venda</Text><Text style={text}>{formatCurrency(dados.prato.preco)}</Text></View>
      <View style={styles.row}><Text style={[styles.bold, { color: colors.text }]}>Margem</Text><Text style={[styles.bold, { color: colors.text, flexShrink: 1, textAlign: 'right' }]}>{!hasItems ? 'Sem custo calculado' : !costKnown ? 'Indisponível' : `${formatCurrency(margin)} · ${dados.prato.preco === 0 ? '—' : `${(margin / dados.prato.preco * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}`}</Text></View>
      {zero > 0 && <Text accessibilityRole="alert" style={[styles.note, { color: colors.warning }]}>{zero} insumo(s) sem custo cadastrado. A margem pode estar maior do que a real.</Text>}
      {missing && !dados.aviso && <Text style={[styles.note, { color: colors.warning }]}>Há insumos com custo indisponível. Atualize o cadastro no Estoque.</Text>}
      <Text style={[styles.note, { color: colors.textSecondary }]}>Custo calculado com o custo atual dos insumos. Não guarda histórico.</Text>
    </View>}
    <Modal visible={!!panel} transparent animationType="slide" onRequestClose={() => { if (!busy) setPanel(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.row}><Text style={[styles.title, { color: colors.text }]}>{panel?.item ? 'Alterar quantidade' : 'Adicionar insumo'}</Text><AnimatedPressable accessibilityRole="button" accessibilityLabel="Fechar painel" disabled={busy} onPress={() => setPanel(null)} style={styles.back}><Ionicons name="close" size={24} color={colors.text} /></AnimatedPressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            {panel?.item ? <Text style={[styles.bold, { color: colors.text }]}>{panel.item.insumoNome} · {panel.item.insumoUnidade}</Text> : dados?.aviso ? <><Text style={muted}>{dados.aviso}</Text>{button('Tentar novamente', () => { setPanel(null); void load(); })}</> : available.length === 0 ? <><Text style={text}>Não há insumos ativos disponíveis para adicionar. Cadastre ou ative um insumo na tela Estoque.</Text>{button('Abrir Estoque', () => { setPanel(null); router.push('/(tabs)/(gestao)/estoque' as any); })}</> : <>
              <TextInput accessibilityLabel="Buscar insumo por nome" placeholder="Buscar insumo..." placeholderTextColor={colors.textSecondary} value={search} onChangeText={setSearch} style={input} editable={!busy} />
              <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                {available.filter(i => buscaNome(i.nome).includes(buscaNome(search))).map(i => <AnimatedPressable key={i.id} accessibilityRole="radio" accessibilityState={{ checked: selectedId === i.id }} accessibilityLabel={`${i.nome}, ${i.unidade}`} disabled={busy} onPress={() => { setSelectedId(i.id); setFormError(''); }} style={[styles.option, { borderColor: colors.border, backgroundColor: selectedId === i.id ? colors.primaryMuted : colors.surface }]}><Text style={text}>{i.nome} · {i.unidade}</Text>{selectedId === i.id && <Ionicons name="checkmark" size={20} color={colors.primary} />}</AnimatedPressable>)}
                {!available.some(i => buscaNome(i.nome).includes(buscaNome(search))) && <Text style={muted}>Nenhum insumo encontrado.</Text>}
              </ScrollView>
            </>}
            {selected && <><Text style={[styles.bold, { color: colors.text }]}>Quantidade</Text><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><TextInput accessibilityLabel={`Quantidade em ${selected.unidade}`} value={qtd} onChangeText={setQtd} keyboardType="decimal-pad" placeholder="0,000" placeholderTextColor={colors.textSecondary} style={[input, { flex: 1 }]} editable={!busy} maxLength={30} /><Text style={text}>{selected.unidade}</Text></View><Text style={muted}>Quantidade na mesma unidade do insumo (por exemplo, {selected.unidade})</Text></>}
            {!!formError && <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{formError}</Text>}
          </ScrollView>
          {busy ? <ActivityIndicator color={colors.primary} /> : button('Salvar', () => { void save(); }, !selected)}
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Cancelar" disabled={busy} onPress={() => setPanel(null)} style={styles.button}><Text style={muted}>Cancelar</Text></AnimatedPressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <ConfirmDialog destructive visible={!!remover} title="Remover insumo da ficha técnica?" message={`Remover ${remover?.insumoNome ?? ''} da ficha técnica de ${dados?.prato.nome ?? ''}? O insumo continua cadastrado no estoque.`} confirmLabel="Remover" cancelLabel="Cancelar" onConfirm={() => { void remove(); }} onCancel={() => setRemover(null)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56, borderBottomWidth: 1, gap: 8 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Outfit_700Bold', fontSize: 21, flexShrink: 1 },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 14 },
  bold: { fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  note: { fontFamily: 'Outfit_400Regular', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  remove: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderTopWidth: 1, paddingTop: 8 },
  button: { minHeight: 48, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  summary: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  panel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, maxHeight: '90%' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: 'Outfit_400Regular', fontSize: 15 },
  option: { minHeight: 48, padding: 12, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
