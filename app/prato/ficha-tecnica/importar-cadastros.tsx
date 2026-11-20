import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Clipboard, Keyboard, Platform, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { TelaComTeclado } from '@/components/TelaComTeclado';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BACKEND_URL } from '@/utils/api';
import { gerarModeloCadastrosBase64 } from '@/utils/modeloCadastros';

type LinhaPrato = { prato: string; categoria: string; preco: string; descricao: string; tempo_preparo: string };
type LinhaInsumo = { insumo: string; unidade: string; custo_unitario: string; estoque_minimo: string };
type LinhaFicha = { prato: string; insumo: string; quantidade: string };
type Lida<T> = { planilha: number; aba: string; dados: T };
type Lido = { pratos: Lida<LinhaPrato>[]; insumos: Lida<LinhaInsumo>[]; fichas: Lida<LinhaFicha>[] };
type Aba = 'pratos' | 'insumos' | 'fichas';
type Status = 'nova' | 'ja_existe' | 'atualiza' | 'sem_alteracao' | 'erro';
type Resultado = { linha: number; status: Status; mensagem?: string; quantidade_atual?: string | number; quantidade_solicitada?: string | number };
type Secao = { resumo: Record<string, number>; resultados: Resultado[] };
type Resposta = {
  resumo: { total: number; com_erro: number; pratos_novos: number; insumos_novos: number; categorias_novas: number; fichas_novas: number; fichas_atualizadas: number };
  categorias: string[];
  pratos: Secao; insumos: Secao; fichas: Secao;
};
type Previa = { lido: Lido; resposta: Resposta };
type Criados = { categorias: number; pratos: number; insumos: number; fichas: number };
type Sucesso = { criados: Criados; atualizados: Criados };

const endpoint = '/api/estoque/cadastros/importar';
const MAX_ARQUIVO = 5 * 1024 * 1024;
const MAX_LINHAS = 500;
const msgLeitura = 'Não foi possível ler o arquivo. Confira se é uma planilha Excel válida.';
const msgSemAba = 'Nenhuma aba do modelo foi encontrada. Use o modelo baixado nesta tela.';
const msgAntigo = 'Este arquivo é do modelo da tela Importar fichas técnicas. Use o modelo baixado nesta tela.';
const msgMudou = 'Os dados mudaram desde a conferência. Confira novamente antes de importar.';
const msgInsumoFalta = 'Insumo não encontrado.';
const msgPratoFalta = 'Prato não encontrado.';
const nomesAba: Record<Aba, string> = { pratos: 'Pratos', insumos: 'Insumos', fichas: 'Ficha técnica' };
const labels: Record<Status, string> = { nova: 'Nova', ja_existe: 'Já existe', atualiza: 'Vai atualizar', sem_alteracao: 'Sem alteração', erro: 'Erro' };
const statusPorAba: Record<Aba, Status[]> = {
  pratos: ['nova', 'ja_existe', 'erro'],
  insumos: ['nova', 'ja_existe', 'erro'],
  fichas: ['nova', 'atualiza', 'sem_alteracao', 'erro'],
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const normaliza = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const texto = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// Número real da célula (nunca o texto formatado), com vírgula decimal, sem separador de milhar e sem zeros à direita.
function numerico(n: number, casas: number): string | null {
  if (!Number.isFinite(n)) return null;
  const fixo = n.toFixed(casas).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return (fixo === '-0' ? '0' : fixo).replace('.', ',');
}

type Leitura = { erro: string } | { lido: Lido; abas: string[]; antigo: boolean };
function lerArquivo(workbook: XLSX.WorkBook): Leitura {
  const lido: Lido = { pratos: [], insumos: [], fichas: [] };
  const abas: string[] = [];
  let antigo = false;
  for (const nome of workbook.SheetNames) {
    const sheet = workbook.Sheets[nome];
    if (!sheet || !sheet['!ref']) continue;
    const primeiraLinha = XLSX.utils.decode_range(sheet['!ref']).s.r;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    const brutas = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    const inicio = rows.findIndex(row => row.some(c => texto(c) !== ''));
    if (inicio < 0) continue;
    const nomes = rows[inicio].map(normaliza);
    const col = (...opcoes: string[]) => nomes.findIndex(n => opcoes.includes(n));
    const iPrato = col('prato'), iInsumo = col('insumo'), iPreco = col('preco'), iUnidade = col('unidade'), iQtd = col('quantidade');
    // Prato, Insumo, Quantidade e Unidade juntos: é o modelo antigo da tela Importar fichas técnicas.
    if (iPrato >= 0 && iInsumo >= 0 && iQtd >= 0 && iUnidade >= 0) { antigo = true; continue; }
    let tipo: Aba | null = null;
    if (iPrato >= 0 && iPreco >= 0) tipo = 'pratos';
    else if (iInsumo >= 0 && iUnidade >= 0 && iQtd < 0) tipo = 'insumos';
    else if (iPrato >= 0 && iInsumo >= 0 && iQtd >= 0 && iUnidade < 0) tipo = 'fichas';
    if (!tipo) continue;
    const iCategoria = col('categoria'), iDescricao = col('descricao'), iTempo = col('tempo de preparo (min)', 'tempo de preparo');
    const iCusto = col('custo unitario'), iMinimo = col('estoque minimo');
    const txt = (row: unknown[], i: number) => (i < 0 ? '' : texto(row[i]));
    const num = (row: unknown[], bruta: unknown[] | undefined, i: number, casas: number) => {
      if (i < 0) return '';
      const b = bruta?.[i];
      if (typeof b === 'number') return numerico(b, casas) ?? texto(row[i]);
      return texto(b ?? row[i]);
    };
    for (let r = inicio + 1; r < rows.length; r++) {
      const row = rows[r], bruta = brutas[r];
      const planilha = primeiraLinha + r + 1;
      if (tipo === 'pratos') {
        const dados: LinhaPrato = {
          prato: txt(row, iPrato), categoria: txt(row, iCategoria), preco: num(row, bruta, iPreco, 2),
          descricao: txt(row, iDescricao), tempo_preparo: num(row, bruta, iTempo, 3),
        };
        if (Object.values(dados).every(v => v === '')) continue;
        lido.pratos.push({ planilha, aba: nome, dados });
      } else if (tipo === 'insumos') {
        const dados: LinhaInsumo = {
          insumo: txt(row, iInsumo), unidade: txt(row, iUnidade),
          custo_unitario: num(row, bruta, iCusto, 2), estoque_minimo: num(row, bruta, iMinimo, 3),
        };
        if (Object.values(dados).every(v => v === '')) continue;
        lido.insumos.push({ planilha, aba: nome, dados });
      } else {
        const dados: LinhaFicha = { prato: txt(row, iPrato), insumo: txt(row, iInsumo), quantidade: num(row, bruta, iQtd, 3) };
        if (Object.values(dados).every(v => v === '')) continue;
        lido.fichas.push({ planilha, aba: nome, dados });
      }
    }
    abas.push(nome);
  }
  if (!abas.length) return { erro: antigo ? msgAntigo : msgSemAba };
  for (const k of ['pratos', 'insumos', 'fichas'] as Aba[]) {
    if (lido[k].length > MAX_LINHAS) return { erro: `A aba ${nomesAba[k]} tem ${lido[k].length} linhas de dados. O máximo é ${MAX_LINHAS} por aba. Divida o arquivo em lotes menores.` };
  }
  return { lido, abas, antigo };
}

class RequestError extends Error {
  constructor(public status: number, public body: unknown, message: string) { super(message); }
}

function lerSecao(raw: unknown, count: number, aba: Aba): Secao {
  if (!object(raw) || !object(raw.resumo) || !Array.isArray(raw.resultados)) throw new Error('Resposta inválida. Confira novamente antes de importar.');
  const seen = new Set<number>();
  const resultados = raw.resultados.map(row => {
    if (!object(row) || !Number.isInteger(row.linha) || (row.linha as number) < 1 || (row.linha as number) > count || seen.has(row.linha as number)
      || typeof row.status !== 'string' || !statusPorAba[aba].includes(row.status as Status)) throw new Error('Linhas inválidas. Confira novamente antes de importar.');
    seen.add(row.linha as number);
    return {
      linha: row.linha as number, status: row.status as Status,
      mensagem: typeof row.mensagem === 'string' ? row.mensagem : undefined,
      quantidade_atual: typeof row.quantidade_atual === 'string' || typeof row.quantidade_atual === 'number' ? row.quantidade_atual : undefined,
      quantidade_solicitada: typeof row.quantidade_solicitada === 'string' || typeof row.quantidade_solicitada === 'number' ? row.quantidade_solicitada : undefined,
    };
  });
  if (seen.size !== count) throw new Error('Resumo inconsistente. Confira novamente antes de importar.');
  const resumo: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.resumo)) resumo[k] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return { resumo, resultados };
}
function lerResposta(raw: unknown, lido: Lido): Resposta {
  if (!object(raw) || !object(raw.resumo) || !object(raw.categorias)) throw new Error('Resposta inválida. Confira novamente antes de importar.');
  const n = (k: string) => (typeof (raw.resumo as Record<string, unknown>)[k] === 'number' ? ((raw.resumo as Record<string, unknown>)[k] as number) : 0);
  const nomes = Array.isArray(raw.categorias.nomes) ? raw.categorias.nomes.filter((v): v is string => typeof v === 'string') : [];
  return {
    resumo: { total: n('total'), com_erro: n('com_erro'), pratos_novos: n('pratos_novos'), insumos_novos: n('insumos_novos'), categorias_novas: n('categorias_novas'), fichas_novas: n('fichas_novas'), fichas_atualizadas: n('fichas_atualizadas') },
    categorias: nomes,
    pratos: lerSecao(raw.pratos, lido.pratos.length, 'pratos'),
    insumos: lerSecao(raw.insumos, lido.insumos.length, 'insumos'),
    fichas: lerSecao(raw.fichas, lido.fichas.length, 'fichas'),
  };
}
const contagem = (raw: unknown): Criados => {
  const o = object(raw) ? raw : {};
  const g = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  return { categorias: g('categorias'), pratos: g('pratos'), insumos: g('insumos'), fichas: g('fichas') };
};
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export default function ImportarCadastrosScreen() {
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
  // Uma nova sessão autenticada começa com tudo limpo.
  return <Importar key={`${user.id}:${user.role}:${token}`} token={token} />;
}

function Importar({ token }: { token: string }) {
  const colors = useColors();
  const router = useRouter();
  const [lido, setLido] = useState<Lido | null>(null);
  const [preview, setPreview] = useState<Previa | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [abertas, setAbertas] = useState<Record<Aba, boolean>>({ pratos: false, insumos: false, fichas: false });
  const [ignorar, setIgnorar] = useState(false);
  const [busy, setBusy] = useState<'modelo' | 'conferir' | 'importar' | 'arquivo' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [success, setSuccess] = useState<Sucesso | null>(null);
  const [dialog, setDialog] = useState<{ preview: Previa; ignore: boolean } | null>(null);
  const active = useRef(false);
  const version = useRef(0);
  const lock = useRef(false);
  const currentPreview = useRef<Previa | null>(null);
  const controllers = useRef(new Set<AbortController>());
  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => {
      active.current = false;
      version.current++;
      controllers.current.forEach(controller => controller.abort());
      controllers.current.clear();
      currentPreview.current = null;
      setPreview(null); setDialog(null); setLido(null); setSuccess(null); setError(''); setNotice(''); setBusy(null); setIgnorar(false);
    };
  }, []));
  // A autorização fica presa à sessão desta tela. Não registrar corpos nem mensagens em log: podem ter dados do restaurante.
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
      if (!response.ok) throw new RequestError(response.status, raw, object(raw) && typeof raw.message === 'string' ? raw.message : object(raw) && typeof raw.mensagem === 'string' ? raw.mensagem : object(raw) && typeof raw.error === 'string' ? raw.error : 'Não foi possível completar a solicitação. Tente novamente.');
      return raw;
    } finally { controllers.current.delete(controller); }
  };
  const valid = (id: number) => active.current && version.current === id;
  const publishPreview = (value: Previa | null) => {
    currentPreview.current = value; setPreview(value); setIgnorar(false);
    setAbertas(value ? { pratos: value.resposta.pratos.resumo.com_erro > 0, insumos: value.resposta.insumos.resumo.com_erro > 0, fichas: value.resposta.fichas.resumo.com_erro > 0 } : { pratos: false, insumos: false, fichas: false });
  };
  const trocarArquivo = (value: Lido | null) => {
    version.current++;
    setLido(value); publishPreview(null); setDialog(null); setSuccess(null); setError(''); setNotice('');
  };
  const check = async () => {
    if (lock.current || !active.current || !lido) return;
    Keyboard.dismiss(); setError(''); setSuccess(null); publishPreview(null);
    const snapshot = lido;
    const id = ++version.current;
    lock.current = true; setBusy('conferir');
    try {
      const raw = await request(endpoint, corpo(snapshot, false, false));
      if (valid(id)) { publishPreview({ lido: snapshot, resposta: lerResposta(raw, snapshot) }); setOnlyErrors(false); }
    } catch (e) { if (valid(id)) setError(e instanceof RequestError ? e.message : 'Não foi possível conferir o arquivo. Verifique a conexão e tente novamente.'); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  };
  const model = async () => {
    if (lock.current || !active.current) return;
    lock.current = true; setBusy('modelo'); setError(''); setNotice('');
    const id = version.current;
    let uri: string | null = null;
    try {
      let pratosNomes: string[] = [];
      let insumosAtivos: { nome: string; unidade: string }[] = [];
      let categoriasNomes: string[] = [];
      let warning = false;
      try {
        const [p, i, c] = await Promise.all([request('/api/pratos'), request('/api/insumos'), request('/api/categorias')]);
        if (!valid(id)) return;
        const pl = Array.isArray(p) ? p : object(p) ? p.pratos : null;
        const il = Array.isArray(i) ? i : object(i) ? i.insumos : null;
        const cl = Array.isArray(c) ? c : object(c) ? c.categorias : null;
        if (!Array.isArray(pl) || !Array.isArray(il) || !Array.isArray(cl)
          || pl.some(v => !object(v) || typeof v.nome !== 'string')
          || il.some(v => !object(v) || typeof v.nome !== 'string' || typeof v.unidade !== 'string' || typeof v.ativo !== 'boolean')
          || cl.some(v => !object(v) || typeof v.nome !== 'string')) throw new Error();
        pratosNomes = pl.map(v => v.nome as string);
        insumosAtivos = il.filter(v => v.ativo).map(v => ({ nome: v.nome as string, unidade: v.unidade as string }));
        categoriasNomes = cl.map(v => v.nome as string);
      } catch { warning = true; pratosNomes = []; insumosAtivos = []; categoriasNomes = []; }
      if (!valid(id)) return;
      if (warning) setNotice('Não foi possível carregar os catálogos. O modelo foi gerado sem as listas de pratos, insumos e categorias; consulte os nomes e unidades no app.');
      const base64 = await gerarModeloCadastrosBase64(pratosNomes, insumosAtivos, categoriasNomes);
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (Platform.OS === 'web') {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        uri = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (!valid(id)) return;
        const link = document.createElement('a'); link.href = uri; link.download = 'modelo-cadastros.xlsx'; link.click();
      } else {
        if (!FileSystem.cacheDirectory) throw new Error();
        if (!await Sharing.isAvailableAsync()) throw new Error();
        if (!valid(id)) return;
        uri = `${FileSystem.cacheDirectory}modelo-cadastros-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`;
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
  const pickFile = async () => {
    if (lock.current || !active.current) return;
    lock.current = true; setBusy('arquivo'); setError(''); setNotice('');
    const id = version.current;
    let uri: string | null = null;
    // Não registrar em log o nome nem o conteúdo do arquivo: podem ter dados do restaurante.
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.ms-excel.sheet.macroEnabled.12', '.xlsx', '.xls'],
        copyToCacheDirectory: true, multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      if (Platform.OS !== 'web') uri = asset.uri;
      if (!valid(id)) return;
      let size = asset.size;
      if (typeof size !== 'number' && Platform.OS !== 'web') {
        const info = await FileSystem.getInfoAsync(asset.uri).catch(() => null);
        size = info && info.exists ? info.size : undefined;
      }
      if (typeof size === 'number' && size > MAX_ARQUIVO) { setError('O arquivo é grande demais. Use um arquivo de até 5 MB.'); return; }
      let workbook: XLSX.WorkBook;
      try {
        if (Platform.OS === 'web') {
          const buffer = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
          if (buffer.byteLength > MAX_ARQUIVO) { if (valid(id)) setError('O arquivo é grande demais. Use um arquivo de até 5 MB.'); return; }
          workbook = XLSX.read(buffer, { type: 'array' });
        } else {
          const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
          workbook = XLSX.read(base64, { type: 'base64' });
        }
      } catch { if (valid(id)) setError(msgLeitura); return; }
      if (!valid(id)) return;
      const resultado = lerArquivo(workbook);
      if ('erro' in resultado) { setError(resultado.erro); return; }
      trocarArquivo(resultado.lido);
      setNotice(`Arquivo lido: ${plural(resultado.lido.pratos.length, 'prato', 'pratos')}, ${plural(resultado.lido.insumos.length, 'insumo', 'insumos')} e ${plural(resultado.lido.fichas.length, 'linha', 'linhas')} de ficha. Toque em Conferir para revisar.${resultado.antigo ? ` ${msgAntigo}` : ''}`);
    } catch { if (valid(id)) setError(msgLeitura); }
    finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
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
      const raw = await request(endpoint, corpo(snapshot.lido, true, pending.ignore));
      if (!valid(id)) return;
      const o = object(raw) ? raw : {};
      setSuccess({ criados: contagem(o.criados), atualizados: contagem(o.atualizados) });
      setLido(null); publishPreview(null); setNotice('');
    } catch (e) {
      if (!valid(id)) return;
      if (e instanceof RequestError && e.status === 409) {
        const mensagem = object(e.body) && typeof e.body.mensagem === 'string' ? e.body.mensagem : '';
        if (mensagem === msgMudou) { publishPreview(null); setError(msgMudou); return; }
        try { publishPreview({ lido: snapshot.lido, resposta: lerResposta(e.body, snapshot.lido) }); setError(mensagem || 'Há linhas com erro. Revise a conferência atual antes de importar.'); }
        catch { publishPreview(null); setError('A conferência mudou. Nada foi importado. Confira novamente antes de importar.'); }
      } else setError(e instanceof RequestError && e.status < 500 ? e.message : 'Não foi possível concluir a importação. Verifique a conexão e tente novamente; o arquivo lido foi mantido e nada foi gravado pela metade.');
    } finally { lock.current = false; if (active.current) setBusy(null); }
  };

  const r = preview?.resposta;
  const erros = r?.resumo.com_erro ?? 0;
  const gravacoes = r ? r.resumo.pratos_novos + r.resumo.insumos_novos + r.resumo.categorias_novas + r.resumo.fichas_novas + r.resumo.fichas_atualizadas : 0;
  const porLinha = (aba: Aba) => new Map((r?.[aba].resultados ?? []).map(x => [x.linha, x]));
  const mapas = { pratos: porLinha('pratos'), insumos: porLinha('insumos'), fichas: porLinha('fichas') };
  const semMensagem = 'Não foi possível validar esta linha. Corrija e confira novamente.';
  // Resumo dos erros por mensagem e aba, só da prévia atual.
  const resumoErros = (() => {
    const mapa = new Map<string, { mensagem: string; aba: Aba; quantidade: number }>();
    if (!preview) return [];
    (['pratos', 'insumos', 'fichas'] as Aba[]).forEach(aba => {
      preview.resposta[aba].resultados.forEach(x => {
        if (x.status !== 'erro') return;
        const mensagem = x.mensagem || semMensagem;
        const chave = `${aba}|${mensagem}`;
        const atual = mapa.get(chave);
        if (atual) atual.quantidade++; else mapa.set(chave, { mensagem, aba, quantidade: 1 });
      });
    });
    return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
  })();
  const faltantes = (mensagem: string, campo: 'insumo' | 'prato') => {
    const vistos = new Map<string, string>();
    if (preview) preview.lido.fichas.forEach((linha, idx) => {
      const x = mapas.fichas.get(idx + 1);
      if (x?.status !== 'erro' || x.mensagem !== mensagem) return;
      const nome = linha.dados[campo].trim();
      const chave = normaliza(nome);
      if (nome && !vistos.has(chave)) vistos.set(chave, nome);
    });
    return [...vistos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([, v]) => v);
  };
  const insumosFaltam = faltantes(msgInsumoFalta, 'insumo');
  const pratosFaltam = faltantes(msgPratoFalta, 'prato');
  const compartilharLista = async (titulo: string, itens: string[]) => {
    const mensagem = [titulo, ...itens].join('\n');
    try {
      await Share.share({ message: mensagem });
    } catch {
      if (Platform.OS === 'web') { try { Clipboard.setString(mensagem); } catch { /* sem área de transferência */ } }
    }
  };
  const bodyStyle = [styles.body, { color: colors.text }];
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!busy || disabled }} disabled={!!busy || disabled} onPress={action} style={[styles.button, { backgroundColor: secondary ? colors.primaryMuted : colors.primary, opacity: disabled ? 0.5 : 1 }]}><Text style={[styles.bold, { color: secondary ? colors.primary : '#fff' }]}>{label}</Text></AnimatedPressable>;
  const cartao = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const resumoLinha = (aba: Aba, linha: { dados: unknown }) => {
    if (aba === 'pratos') { const d = linha.dados as LinhaPrato; return [d.prato, d.categoria, d.preco && `R$ ${d.preco}`].filter(Boolean).join(' · ') || '(linha sem nome)'; }
    if (aba === 'insumos') { const d = linha.dados as LinhaInsumo; return [d.insumo, d.unidade].filter(Boolean).join(' · ') || '(linha sem nome)'; }
    const d = linha.dados as LinhaFicha; return [d.prato, d.insumo, d.quantidade].filter(Boolean).join(' · ') || '(linha sem dados)';
  };
  const bloco = (aba: Aba) => {
    if (!preview) return null;
    const secao = preview.resposta[aba];
    const lista = preview.lido[aba] as { planilha: number; dados: unknown }[];
    if (!lista.length) return null;
    const s = secao.resumo;
    const partes = aba === 'fichas'
      ? [`${s.novas ?? 0} novas`, `${s.atualizam ?? 0} atualizam`, `${s.sem_alteracao ?? 0} sem alteração`, `${s.com_erro ?? 0} com erro`]
      : [`${s.novas ?? 0} novas`, `${s.ja_existem ?? 0} já existem`, `${s.com_erro ?? 0} com erro`];
    const aberto = abertas[aba];
    const itens = lista.map((linha, idx) => ({ linha, idx, x: mapas[aba].get(idx + 1) })).filter(i => !onlyErrors || i.x?.status === 'erro');
    return <View key={aba} style={cartao}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel={`${nomesAba[aba]}: ${partes.join(', ')}. ${aberto ? 'Recolher' : 'Expandir'}`} accessibilityState={{ expanded: aberto }} onPress={() => setAbertas(v => ({ ...v, [aba]: !v[aba] }))} style={[styles.row, { minHeight: 44 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.heading, { color: colors.text }]}>{nomesAba[aba]} ({lista.length})</Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>{partes.join(' · ')}</Text>
        </View>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={22} color={colors.primary} />
      </AnimatedPressable>
      {aberto && (itens.length === 0 ? <Text style={bodyStyle}>Nenhuma linha com erro.</Text> : itens.map(({ linha, idx, x }) => {
        const status = x?.status ?? 'erro';
        return <View key={idx} style={[styles.linha, { borderTopColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={[styles.bold, { color: colors.text, flexShrink: 1 }]}>Linha {idx + 1} · planilha, linha {linha.planilha}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{status === 'erro' && <Ionicons name="warning-outline" size={20} color={colors.warning} />}<Text style={[styles.bold, { color: status === 'erro' ? colors.text : colors.primary }]}>{labels[status]}</Text></View>
          </View>
          <Text selectable style={bodyStyle}>{resumoLinha(aba, linha)}</Text>
          {status === 'atualiza' && x?.quantidade_atual != null && x.quantidade_solicitada != null && <Text style={bodyStyle}>de {x.quantidade_atual} para {x.quantidade_solicitada}</Text>}
          {(status === 'erro' || (aba !== 'fichas' && status === 'ja_existe')) && <Text style={bodyStyle}>{status === 'erro' ? x?.mensagem || semMensagem : 'Já existe no sistema; não será alterado.'}</Text>}
        </View>;
      }))}
    </View>;
  };
  const tentarImportar = () => { Keyboard.dismiss(); if (preview) setDialog({ preview, ignore: erros > 0 && ignorar }); };
  const mensagemDialogo = r ? `Vai criar ${plural(r.resumo.pratos_novos, 'prato', 'pratos')}, ${plural(r.resumo.insumos_novos, 'insumo', 'insumos')} e ${plural(r.resumo.categorias_novas, 'categoria', 'categorias')}, e ligar ou atualizar ${plural(r.resumo.fichas_novas + r.resumo.fichas_atualizadas, 'item de ficha', 'itens de ficha')}. Nada será apagado. O que já existe não é alterado.${erros > 0 ? ` As linhas com erro (${erros}) e as que dependem delas não serão gravadas.` : ''}` : '';

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel="Voltar" disabled={!!busy} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={26} color={colors.primary} /></AnimatedPressable>
      <Text style={[styles.title, { color: colors.text }]}>Importar cadastros e fichas</Text>
    </View>
    <View style={{ flex: 1 }}>
      <TelaComTeclado contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 32 }}>
        <View style={{ gap: 10 }}>
          <Text style={[styles.heading, { color: colors.text }]}>1. Baixe o modelo</Text>
          <Text style={bodyStyle}>O modelo tem as abas Insumos, Pratos e Ficha técnica, com instruções. Cadastra insumos, pratos e categorias novos e liga tudo na ficha técnica. A importação nunca apaga nem altera o que já existe.</Text>
          {button('Baixar modelo Excel', () => { void model(); }, true)}
          {!!notice && !lido && <Text accessibilityRole="alert" style={[styles.body, { color: colors.textSecondary }]}>{notice}</Text>}
        </View>
        {success ? <View style={cartao}>
          <Ionicons name="checkmark-circle-outline" size={36} color={colors.success} />
          <Text accessibilityLiveRegion="polite" style={[styles.heading, { color: colors.text }]}>Importação concluída</Text>
          <Text style={bodyStyle}>Criados: {plural(success.criados.pratos, 'prato', 'pratos')}, {plural(success.criados.insumos, 'insumo', 'insumos')}, {plural(success.criados.categorias, 'categoria', 'categorias')} e {plural(success.criados.fichas, 'item de ficha', 'itens de ficha')}.</Text>
          <Text style={bodyStyle}>Atualizados: {plural(success.atualizados.fichas, 'item de ficha', 'itens de ficha')}.</Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>Os insumos novos têm estoque zero: lance o saldo no Estoque. Preencha o NCM dos pratos novos antes de emitir nota fiscal.</Text>
          {button('Importar outro arquivo', () => { trocarArquivo(null); })}
          {button('Abrir lista de pratos', () => router.replace('/(tabs)/(gestao)/pratos' as any), true)}
        </View> : <>
          <View style={{ gap: 10 }}>
            <Text style={[styles.heading, { color: colors.text }]}>2. Escolha o arquivo</Text>
            {button('Escolher arquivo Excel', () => { void pickFile(); }, true)}
            {!!notice && !!lido && <Text accessibilityRole="alert" style={[styles.body, { color: colors.textSecondary }]}>{notice}</Text>}
            <Text style={[styles.note, { color: colors.textSecondary }]}>Até 500 linhas por aba, em arquivo de até 5 MB. As abas são reconhecidas pelos cabeçalhos do modelo.</Text>
          </View>
          <View style={{ gap: 10 }}>
            <Text style={[styles.heading, { color: colors.text }]}>3. Confira e importe</Text>
            {button('Conferir', () => { void check(); }, false, !lido)}
            {!lido && <Text style={[styles.note, { color: colors.textSecondary }]}>Escolha um arquivo na etapa 2 para conferir.</Text>}
          </View>
          {!!preview && !!r && <View style={{ gap: 12 }}>
            <View style={styles.grid}>
              {([['Pratos novos', r.resumo.pratos_novos], ['Insumos novos', r.resumo.insumos_novos], ['Categorias novas', r.resumo.categorias_novas], ['Fichas a ligar ou atualizar', r.resumo.fichas_novas + r.resumo.fichas_atualizadas], ['Com erro', erros]] as const).map(([label, value]) => <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.heading, { color: colors.text }]}>{value}</Text><Text style={bodyStyle}>{label}</Text></View>)}
            </View>
            {r.categorias.length > 0 && <View style={cartao}>
              <Text style={[styles.heading, { color: colors.text }]}>Categorias que serão criadas</Text>
              {r.categorias.map(nome => <Text key={nome} selectable style={bodyStyle}>{nome}</Text>)}
            </View>}
            {resumoErros.length > 0 && <View style={cartao}>
              <Text style={[styles.heading, { color: colors.text }]}>Resumo dos erros</Text>
              {resumoErros.map(item => <View key={`${item.aba}|${item.mensagem}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Ionicons name="warning-outline" size={20} color={colors.warning} />
                <Text accessibilityLabel={`${item.mensagem} ${plural(item.quantidade, 'linha', 'linhas')}, aba ${nomesAba[item.aba]}`} style={[bodyStyle, { flex: 1 }]}>{item.mensagem} · {plural(item.quantidade, 'linha', 'linhas')} · aba {nomesAba[item.aba]}</Text>
              </View>)}
            </View>}
            {insumosFaltam.length > 0 && <View style={cartao}>
              <Text style={[styles.heading, { color: colors.text }]}>Insumos para listar ({insumosFaltam.length})</Text>
              <Text style={bodyStyle}>Estes insumos não estão na aba Insumos do arquivo nem no sistema. Liste cada um na aba Insumos do modelo, com a unidade (kg, g, l, ml, un, cx, pct ou dz), e confira de novo.</Text>
              {insumosFaltam.map(nome => <Text key={nome} selectable style={bodyStyle}>{nome}</Text>)}
              <AnimatedPressable accessibilityRole="button" accessibilityLabel="Compartilhar lista" onPress={() => { void compartilharLista('Insumos para listar na aba Insumos', insumosFaltam); }} style={[styles.button, { backgroundColor: colors.primaryMuted }]}><Text style={[styles.bold, { color: colors.primary }]}>Compartilhar lista</Text></AnimatedPressable>
            </View>}
            {pratosFaltam.length > 0 && <View style={cartao}>
              <Text style={[styles.heading, { color: colors.text }]}>Pratos para listar ({pratosFaltam.length})</Text>
              <Text style={bodyStyle}>Estes pratos não estão na aba Pratos do arquivo nem no sistema. Liste cada um na aba Pratos do modelo, com o preço, e confira de novo.</Text>
              {pratosFaltam.map(nome => <Text key={nome} selectable style={bodyStyle}>{nome}</Text>)}
              <AnimatedPressable accessibilityRole="button" accessibilityLabel="Compartilhar lista" onPress={() => { void compartilharLista('Pratos para listar na aba Pratos', pratosFaltam); }} style={[styles.button, { backgroundColor: colors.primaryMuted }]}><Text style={[styles.bold, { color: colors.primary }]}>Compartilhar lista</Text></AnimatedPressable>
            </View>}
            <View style={styles.row}><Text style={bodyStyle}>Mostrar só erros</Text><Switch accessibilityLabel="Mostrar só erros" value={onlyErrors} onValueChange={setOnlyErrors} trackColor={{ true: colors.primary }} /></View>
            {(['pratos', 'insumos', 'fichas'] as Aba[]).map(bloco)}
            {gravacoes === 0 && <Text style={[styles.bold, { color: colors.text }]}>{erros > 0 ? 'Nada para importar. Corrija os erros e confira de novo.' : 'Nada para importar'}</Text>}
            {gravacoes > 0 && <>
              {erros > 0 && <View style={cartao}>
                <Text style={[styles.heading, { color: colors.text }]}>Há linhas com erro</Text>
                <Text style={bodyStyle}>As linhas com erro e as que dependem delas não serão gravadas. O restante será importado.</Text>
                <View style={styles.row}><Text style={[bodyStyle, { flex: 1 }]}>Ignorar as linhas com erro</Text><Switch accessibilityLabel="Ignorar as linhas com erro" value={ignorar} onValueChange={setIgnorar} trackColor={{ true: colors.primary }} /></View>
              </View>}
              {button('Importar', tentarImportar, false, erros > 0 && !ignorar)}
            </>}
          </View>}
        </>}
        {!!busy && <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={bodyStyle}>{busy === 'modelo' ? 'Preparando modelo...' : busy === 'arquivo' ? 'Lendo arquivo...' : busy === 'conferir' ? 'Conferindo arquivo...' : 'Importando cadastros e fichas...'}</Text></View>}
        {!!error && <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{error}</Text>}
      </TelaComTeclado>
    </View>
    <ConfirmDialog visible={!!dialog} title="Confirmar importação?" message={mensagemDialogo} confirmLabel="Importar" cancelLabel="Cancelar" onConfirm={() => { void importRows(); }} onCancel={() => setDialog(null)} />
  </SafeAreaView>;
}

// Corpo da chamada ao servidor: os nomes de campo são os que a rota entende.
function corpo(lido: Lido, confirmar: boolean, ignorarErros: boolean) {
  return {
    pratos: lido.pratos.map(l => ({ prato: l.dados.prato, categoria: l.dados.categoria, preco: l.dados.preco, descricao: l.dados.descricao, tempo_preparo: l.dados.tempo_preparo })),
    insumos: lido.insumos.map(l => ({ insumo: l.dados.insumo, unidade: l.dados.unidade, custo_unitario: l.dados.custo_unitario, estoque_minimo: l.dados.estoque_minimo })),
    fichas: lido.fichas.map(l => ({ prato: l.dados.prato, insumo: l.dados.insumo, quantidade: l.dados.quantidade })),
    confirmar,
    ...(confirmar ? { ignorar_erros: ignorarErros } : {}),
  };
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
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  linha: { borderTopWidth: 1, paddingTop: 10, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '47%', flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
});
