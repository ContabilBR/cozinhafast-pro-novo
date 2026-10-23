import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BACKEND_URL } from '@/utils/api';

type Linha = { prato: string; insumo: string; quantidade: string; unidade: string };
type Origem = { numero: number; original: string; dados: Linha | null };
type Status = 'nova' | 'atualiza' | 'sem_alteracao' | 'erro';
type Resultado = { linha: number; status: Status; mensagem?: string; quantidade_atual?: string | number; quantidade_solicitada?: string | number };
type Resumo = { total: number; novas: number; atualizam: number; sem_alteracao: number; com_erro: number };
type Resposta = { resumo: Resumo; resultados: Resultado[] };
type Previa = { origens: Origem[]; enviadas: Origem[]; linhas: Linha[]; resposta: Resposta };
const endpoint = '/api/estoque/ficha-tecnica/importar';
const columnError = 'A linha precisa ter 4 colunas: Prato, Insumo, Quantidade, Unidade';
const labels: Record<Status, string> = { nova: 'Nova', atualiza: 'Vai atualizar', sem_alteracao: 'Sem alteração', erro: 'Erro' };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cell = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1).replace(/""/g, '"').trim() : trimmed;
};
function parse(text: string): Origem[] {
  let first = true;
  const rows: Origem[] = [];
  text.split(/\r\n|\n|\r/).forEach((original, index) => {
    if (!original.trim()) return;
    const cells = original.split(original.includes('\t') ? '\t' : ';').map(cell);
    if (first) {
      first = false;
      if (/^prato/i.test(cells[0]) && cells.some(value => /insumo/i.test(value))) return;
    }
    const [prato, insumo, quantidade, unidade] = cells;
    rows.push({ numero: index + 1, original, dados: cells.length === 4 ? { prato, insumo, quantidade, unidade } : null });
  });
  return rows;
}
function readResponse(raw: unknown, count: number): Resposta {
  if (!object(raw) || !object(raw.resumo) || !Array.isArray(raw.resultados)) throw new Error('Resposta inválida. Confira novamente antes de importar.');
  const summary = raw.resumo;
  for (const key of ['total', 'novas', 'atualizam', 'sem_alteracao', 'com_erro']) {
    if (!Number.isInteger(summary[key]) || (summary[key] as number) < 0) throw new Error('Resumo inválido. Confira novamente antes de importar.');
  }
  const seen = new Set<number>();
  const totals = { nova: 0, atualiza: 0, sem_alteracao: 0, erro: 0 };
  const resultados = raw.resultados.map(row => {
    if (!object(row) || !Number.isInteger(row.linha) || (row.linha as number) < 1 || (row.linha as number) > count || seen.has(row.linha as number) || typeof row.status !== 'string' || !Object.prototype.hasOwnProperty.call(labels, row.status)) throw new Error('Linhas inválidas. Confira novamente antes de importar.');
    seen.add(row.linha as number);
    totals[row.status as Status]++;
    return {
      linha: row.linha as number, status: row.status as Status,
      mensagem: typeof row.mensagem === 'string' ? row.mensagem : undefined,
      quantidade_atual: typeof row.quantidade_atual === 'string' || typeof row.quantidade_atual === 'number' ? row.quantidade_atual : undefined,
      quantidade_solicitada: typeof row.quantidade_solicitada === 'string' || typeof row.quantidade_solicitada === 'number' ? row.quantidade_solicitada : undefined,
    };
  });
  if (seen.size !== count || summary.total !== count || summary.novas !== totals.nova || summary.atualizam !== totals.atualiza || summary.sem_alteracao !== totals.sem_alteracao || summary.com_erro !== totals.erro) throw new Error('Resumo inconsistente. Confira novamente antes de importar.');
  return { resumo: summary as Resumo, resultados };
}
class RequestError extends Error {
  constructor(public status: number, public body: unknown, message: string) { super(message); }
}

export default function ImportarFichaScreen() {
  const { user, token, loading } = useAuth();
  const colors = useColors();
  const router = useRouter();
  if (loading) return <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  if (!token || (user?.role !== 'gerente' && user?.role !== 'administrador')) return <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
    <Ionicons name="lock-closed-outline" size={40} color={colors.textSecondary} />
    <Text style={[styles.title, { color: colors.text }]}>Acesso restrito</Text>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Disponível apenas para gerente e administrador.</Text>
    <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} style={styles.button}><Text style={{ color: colors.primary }}>Voltar</Text></AnimatedPressable>
  </SafeAreaView>;
  // A new authenticated session gets entirely new text, catalogs and snapshots.
  return <Importar key={`${user.id}:${user.role}:${token}`} token={token} />;
}

function Importar({ token }: { token: string }) {
  const colors = useColors();
  const router = useRouter();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Previa | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState<'modelo' | 'conferir' | 'importar' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [success, setSuccess] = useState<Resumo | null>(null);
  const [dialog, setDialog] = useState<{ preview: Previa; ignore: boolean } | null>(null);
  const active = useRef(false);
  const version = useRef(0);
  const lock = useRef(false);
  const currentPreview = useRef<Previa | null>(null);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const inputTop = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => {
      active.current = false;
      version.current++;
      controllers.current.forEach(controller => controller.abort());
      controllers.current.clear();
      currentPreview.current = null;
      setPreview(null); setDialog(null); setText(''); setSuccess(null); setError(''); setNotice(''); setBusy(null);
    };
  }, []));
  // Bind authorization to this screen's session, never to a later global token.
  // Do not log bodies or error messages: they may contain pasted restaurant names.
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    if (!active.current) throw new Error('Sessão encerrada.');
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await fetch(`${BACKEND_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new RequestError(response.status, raw, object(raw) && typeof raw.message === 'string' ? raw.message : object(raw) && typeof raw.error === 'string' ? raw.error : 'Não foi possível completar a solicitação. Tente novamente.');
      return raw;
    } finally { controllers.current.delete(controller); }
  };
  const valid = (id: number) => active.current && version.current === id;
  const publishPreview = (value: Previa | null) => { currentPreview.current = value; setPreview(value); };
  const changeText = (value: string) => {
    version.current++;
    setText(value); publishPreview(null); setDialog(null); setSuccess(null); setError(''); setNotice('');
  };
  const check = async () => {
    if (lock.current || !active.current) return;
    Keyboard.dismiss(); setError(''); setNotice(''); setSuccess(null); publishPreview(null);
    const origens = parse(text);
    if (!origens.length) { setError('Cole pelo menos uma linha de dados para conferir.'); return; }
    if (origens.length > 500) { setError('Divida a planilha em lotes de no máximo 500 linhas de dados e confira cada lote separadamente.'); return; }
    const enviadas = origens.filter(row => row.dados !== null);
    const linhas = enviadas.map(row => ({ ...row.dados! }));
    const id = ++version.current;
    lock.current = true; setBusy('conferir');
    try {
      const resposta = linhas.length ? readResponse(await request(endpoint, { linhas, confirmar: false }), linhas.length)
        : { resumo: { total: 0, novas: 0, atualizam: 0, sem_alteracao: 0, com_erro: 0 }, resultados: [] };
      if (valid(id)) { publishPreview({ origens, enviadas, linhas, resposta }); setOnlyErrors(false); }
    } catch (e) { if (valid(id)) setError(e instanceof RequestError ? e.message : 'Não foi possível conferir as linhas. Tente novamente.'); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const model = async () => {
    if (lock.current || !active.current) return;
    lock.current = true; setBusy('modelo'); setError(''); setNotice('');
    const id = version.current;
    let uri: string | null = null;
    try {
      let pratos: string[][] = [['Prato']];
      let insumos: string[][] = [['Insumo', 'Unidade']];
      let warning = false;
      try {
        const [p, i] = await Promise.all([request('/api/pratos'), request('/api/insumos')]);
        if (!valid(id)) return;
        const pl = Array.isArray(p) ? p : object(p) ? p.pratos : null;
        const il = Array.isArray(i) ? i : object(i) ? i.insumos : null;
        if (!Array.isArray(pl) || !Array.isArray(il) || pl.some(v => !object(v) || typeof v.nome !== 'string') || il.some(v => !object(v) || typeof v.nome !== 'string' || typeof v.unidade !== 'string' || typeof v.ativo !== 'boolean')) throw new Error();
        pratos = [...pratos, ...pl.map(v => [v.nome as string])];
        insumos = [...insumos, ...il.filter(v => v.ativo).map(v => [v.nome as string, v.unidade as string])];
      } catch { warning = true; }
      if (!valid(id)) return;
      if (warning) setNotice('Não foi possível carregar os catálogos. O modelo contém apenas os cabeçalhos; consulte os nomes e unidades no app.');
      const workbook = XLSX.utils.book_new();
      for (const [name, rows] of [['Ficha técnica', [['Prato', 'Insumo', 'Quantidade', 'Unidade']]], ['Pratos', pratos], ['Insumos', insumos]] as [string, string[][]][]) {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        sheet['!cols'] = rows[0].map(() => ({ wch: 28 }));
        XLSX.utils.book_append_sheet(workbook, sheet, name);
      }
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (Platform.OS === 'web') {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        uri = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (!valid(id)) return;
        const link = document.createElement('a'); link.href = uri; link.download = 'modelo-ficha-tecnica.xlsx'; link.click();
      } else {
        if (!FileSystem.cacheDirectory) throw new Error();
        if (!await Sharing.isAvailableAsync()) throw new Error();
        if (!valid(id)) return;
        uri = `${FileSystem.cacheDirectory}modelo-ficha-tecnica-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        if (!valid(id)) return;
        await Sharing.shareAsync(uri, { mimeType: mime, UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: 'Compartilhar modelo em Excel' });
      }
    } catch { if (valid(id)) setError('Não foi possível compartilhar o modelo em Excel. Verifique se o compartilhamento está disponível e tente novamente.'); }
    finally {
      if (uri) {
        if (Platform.OS === 'web') URL.revokeObjectURL(uri);
        else await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      lock.current = false; if (active.current) setBusy(null);
    }
  };
  const importRows = async () => {
    const pending = dialog;
    setDialog(null);
    if (lock.current || !active.current || !pending || currentPreview.current !== pending.preview) return;
    const snapshot = pending.preview;
    const id = version.current;
    lock.current = true; setBusy('importar'); setError('');
    try {
      const resposta = readResponse(await request(endpoint, { linhas: snapshot.linhas, confirmar: true, ignorar_erros: pending.ignore }), snapshot.linhas.length);
      if (!valid(id)) return;
      if (resposta.resumo.com_erro > 0 && !pending.ignore) {
        publishPreview({ ...snapshot, resposta });
        setError('A conferência mudou. Revise os resultados atuais antes de confirmar novamente.'); return;
      }
      setSuccess(resposta.resumo); setText(''); publishPreview(null); setNotice('');
    } catch (e) {
      if (!valid(id)) return;
      if (e instanceof RequestError && e.status === 409) {
        try { publishPreview({ ...snapshot, resposta: readResponse(e.body, snapshot.linhas.length) }); }
        catch { publishPreview(null); }
        setError('A conferência mudou. Nada foi importado. Revise os resultados atuais ou confira novamente.');
      } else setError(e instanceof RequestError && e.status < 500 ? e.message : 'Não foi possível concluir a importação. Nada foi gravado pela metade.');
    } finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const localErrors = preview?.origens.filter(row => !row.dados).length ?? 0;
  const errors = (preview?.resposta.resumo.com_erro ?? 0) + localErrors;
  const writes = (preview?.resposta.resumo.novas ?? 0) + (preview?.resposta.resumo.atualizam ?? 0);
  const resultMap = new Map(preview?.resposta.resultados.map(row => [preview.enviadas[row.linha - 1].numero, row]));
  const bodyStyle = [styles.body, { color: colors.text }];
  const button = (label: string, action: () => void, secondary = false) => <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} disabled={!!busy} onPress={action} style={[styles.button, { backgroundColor: secondary ? colors.primaryMuted : colors.primary }]}><Text style={[styles.bold, { color: secondary ? colors.primary : '#fff' }]}>{label}</Text></AnimatedPressable>;
  const correct = () => { setDialog(null); publishPreview(null); input.current?.focus(); scroll.current?.scrollTo({ y: inputTop.current, animated: true }); };
  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" disabled={!!busy} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={26} color={colors.primary} /></AnimatedPressable>
      <Text style={[styles.title, { color: colors.text }]}>Importar fichas técnicas</Text>
    </View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 32 }}>
        <View style={{ gap: 10 }}>
          <Text style={[styles.heading, { color: colors.text }]}>1. Prepare a planilha</Text>
          <Text style={bodyStyle}>Use uma linha por insumo, com as colunas Prato, Insumo, Quantidade e Unidade. Os nomes precisam corresponder aos cadastros; maiúsculas e acentos não fazem diferença.</Text>
          <Text style={bodyStyle}>A unidade deve ser a mesma do insumo no Estoque, por exemplo, kg. A importação nunca apaga: apenas adiciona insumos às fichas ou atualiza quantidades.</Text>
          {button('Baixar modelo em Excel', () => { void model(); }, true)}
          {!!notice && <Text accessibilityRole="alert" style={[styles.body, { color: colors.textSecondary }]}>{notice}</Text>}
        </View>
        {success ? <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="checkmark-circle-outline" size={36} color={colors.success} />
          <Text accessibilityLiveRegion="polite" style={[styles.heading, { color: colors.text }]}>Importação concluída: {success.novas} criados, {success.atualizam} atualizados</Text>
          {button('Abrir lista de pratos', () => router.replace('/(tabs)/(gestao)/pratos' as any))}
        </View> : <>
          <View onLayout={event => { inputTop.current = event.nativeEvent.layout.y; }} style={{ gap: 10 }}>
            <Text style={[styles.heading, { color: colors.text }]}>2. Cole e confira</Text>
            <Text style={bodyStyle}>Cole aqui as linhas copiadas da planilha (colunas: Prato, Insumo, Quantidade, Unidade)</Text>
            <TextInput ref={input} accessibilityLabel="Cole aqui as linhas copiadas da planilha (colunas: Prato, Insumo, Quantidade, Unidade)" multiline scrollEnabled textAlignVertical="top" editable={!busy} value={text} onChangeText={changeText} autoCorrect={false} autoCapitalize="none" placeholder="Cole as linhas da planilha aqui" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]} />
            <Text style={[styles.note, { color: colors.textSecondary }]}>Até 500 linhas por lote. Aceita tabulações ou ponto e vírgula. A vírgula é mantida nas quantidades decimais.</Text>
            {button('Conferir', () => { void check(); })}
          </View>
          {!!preview && <View style={{ gap: 12 }}>
            <Text style={[styles.heading, { color: colors.text }]}>3. Revise antes de importar</Text>
            <View style={styles.grid}>
              {([['Novas', preview.resposta.resumo.novas], ['Atualizam', preview.resposta.resumo.atualizam], ['Sem alteração', preview.resposta.resumo.sem_alteracao], ['Com erro', errors]] as const).map(([label, value]) => <View key={label} style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.heading, { color: colors.text }]}>{value}</Text><Text style={bodyStyle}>{label}</Text></View>)}
            </View>
            <View style={styles.row}><Text style={bodyStyle}>Mostrar só erros</Text><Switch accessibilityLabel="Mostrar só erros" value={onlyErrors} onValueChange={setOnlyErrors} trackColor={{ true: colors.primary }} /></View>
            {preview.origens.filter(row => !onlyErrors || !row.dados || resultMap.get(row.numero)?.status === 'erro').map(row => {
              const result = resultMap.get(row.numero);
              const status = result?.status ?? 'erro';
              return <View key={row.numero} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.row}><Text style={[styles.bold, { color: colors.text }]}>Linha {row.numero}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{status === 'erro' && <Ionicons name="warning-outline" size={20} color={colors.warning} />}<Text style={[styles.bold, { color: status === 'erro' ? colors.text : colors.primary }]}>{labels[status]}</Text></View></View>
                <Text selectable style={bodyStyle}>{row.dados ? `${row.dados.prato} · ${row.dados.insumo} · ${row.dados.quantidade} ${row.dados.unidade}` : row.original}</Text>
                {status === 'atualiza' && result?.quantidade_atual != null && result.quantidade_solicitada != null && <Text style={bodyStyle}>de {result.quantidade_atual} para {result.quantidade_solicitada} {row.dados?.unidade}</Text>}
                {status === 'erro' && <Text style={bodyStyle}>{row.dados ? result?.mensagem || 'Não foi possível validar esta linha. Corrija e confira novamente.' : columnError}</Text>}
              </View>;
            })}
            {onlyErrors && errors === 0 && <Text style={bodyStyle}>Nenhuma linha com erro.</Text>}
            {writes === 0 ? <Text style={[styles.bold, { color: colors.text }]}>Nada para importar</Text> : errors > 0 ? <>
              {button('Corrigir e conferir de novo', correct, true)}
              {button('Importar só as linhas válidas', () => { Keyboard.dismiss(); setDialog({ preview, ignore: true }); })}
            </> : button('Confirmar importação', () => { Keyboard.dismiss(); setDialog({ preview, ignore: false }); })}
            {writes === 0 && errors > 0 && button('Corrigir e conferir de novo', correct, true)}
          </View>}
        </>}
        {!!busy && <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={bodyStyle}>{busy === 'modelo' ? 'Preparando modelo...' : busy === 'conferir' ? 'Conferindo linhas...' : 'Importando fichas técnicas...'}</Text></View>}
        {!!error && <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
    <ConfirmDialog visible={!!dialog} title="Confirmar importação?" message={`Vai criar ${dialog?.preview.resposta.resumo.novas ?? 0} e atualizar ${dialog?.preview.resposta.resumo.atualizam ?? 0} itens de ficha técnica. Nada será apagado.${errors > 0 ? ` As linhas com erro (${errors}) não serão importadas.` : ''}`} confirmLabel="Importar" cancelLabel="Cancelar" onConfirm={() => { void importRows(); }} onCancel={() => setDialog(null)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 60, borderBottomWidth: 1 },
  back: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Outfit_700Bold', fontSize: 21, flexShrink: 1 },
  heading: { fontFamily: 'Outfit_700Bold', fontSize: 18 },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21 },
  bold: { fontFamily: 'Outfit_600SemiBold', fontSize: 15 },
  note: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18 },
  button: { minHeight: 48, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  input: { height: 210, borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: 'Outfit_400Regular', fontSize: 14 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '47%', flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
});
