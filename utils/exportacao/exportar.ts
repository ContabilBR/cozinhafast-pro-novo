import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { apiGet } from '@/utils/api';
import { gerarExcelBase64 } from './excel';
import { gerarHtmlPdf } from './pdf';
import type { Contexto, RelatorioDef } from './definicao';

/** Dados do cabeçalho: cadastro em Gestão > Restaurante e o usuário que gera. Campos vazios ficam vazios. */
export async function carregarContexto(): Promise<Contexto> {
  const [rest, user] = await Promise.allSettled([apiGet<any>('/api/restaurante'), apiGet<any>('/api/me')]);
  const r = rest.status === 'fulfilled' ? (rest.value?.restaurante ?? rest.value) : null;
  const u = user.status === 'fulfilled' ? (user.value?.user ?? user.value?.usuario ?? user.value) : null;
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const rua = [t(r?.logradouro), t(r?.numero_endereco)].filter(Boolean).join(', ');
  const endereco = t(r?.endereco) || [rua, t(r?.bairro), t(r?.cidade), t(r?.uf), t(r?.cep)].filter(Boolean).join(' - ');
  return {
    restaurante: t(r?.nome), cnpj: t(r?.cnpj), endereco, telefone: t(r?.telefone),
    geradoPor: t(u?.nome) || t(u?.email) || 'Não informado',
  };
}

const nomeArquivo = (r: RelatorioDef, ext: string) =>
  `${r.titulo}-${r.periodo.inicio}${r.periodo.fim !== r.periodo.inicio ? `_a_${r.periodo.fim}` : ''}.${ext}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-');

/** Erro com o nome da etapa que falhou (a mensagem já diz a etapa e o texto original do erro). */
export class ErroExportacao extends Error {
  constructor(public etapa: string, mensagem: string) { super(mensagem); this.name = 'ErroExportacao'; }
}

/** Roda uma etapa; se falhar, registra nome do erro e primeiras linhas da pilha e relança com a etapa na mensagem. */
export async function executarEtapa<T>(falha: string, fn: () => Promise<T> | T, diagnostico?: () => string): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    if (e instanceof ErroExportacao) throw e;
    const err = e as { name?: string; message?: string; stack?: string } | null;
    const texto = err?.message || String(e);
    const pilha = (err?.stack || '').split('\n').slice(0, 4).join('\n');
    console.log(`[Exportar] ${falha} | ${err?.name || 'Error'}: ${texto}\n${pilha}`);
    let extra = '';
    try { extra = diagnostico ? ` [${diagnostico()}]` : ''; } catch { /* diagnóstico nunca atrapalha */ }
    throw new ErroExportacao(falha, `${falha}: ${texto}${extra}`);
  }
}

const tipo = (v: unknown) => (typeof v === 'function' ? 'ok' : v === undefined ? 'undefined' : typeof v);

// Etapa (c): confere o que o código usa do módulo de arquivos antes de gravar
function diagArquivos(): string {
  const fs = FileSystem as unknown as Record<string, unknown>;
  const r = `writeAsStringAsync=${tipo(fs?.writeAsStringAsync)}, moveAsync=${tipo(fs?.moveAsync)}, cacheDirectory=${fs?.cacheDirectory ? 'definida' : 'indefinida'}, EncodingType=${fs?.EncodingType ? 'definido' : 'indefinido'}`;
  console.log(`[Exportar] módulo de arquivos: ${r}`);
  return r;
}

// Etapa (d): confere o compartilhamento antes de abrir
async function diagCompartilhar(): Promise<string> {
  const sh = Sharing as unknown as Record<string, unknown>;
  let disponivel = 'desconhecido';
  try {
    if (typeof sh?.isAvailableAsync === 'function') disponivel = String(await Sharing.isAvailableAsync());
  } catch (e: unknown) { disponivel = `erro (${(e as Error)?.message})`; }
  const r = `shareAsync=${tipo(sh?.shareAsync)}, isAvailableAsync=${tipo(sh?.isAvailableAsync)}, disponível=${disponivel}`;
  console.log(`[Exportar] compartilhamento: ${r}`);
  return r;
}

async function compartilhar(uri: string, opcoes: Parameters<typeof Sharing.shareAsync>[1]): Promise<void> {
  let diag = '';
  try { diag = await diagCompartilhar(); } catch { /* ignora */ }
  await executarEtapa('Falha ao abrir o compartilhamento', () => Sharing.shareAsync(uri, opcoes), () => diag);
}

export async function exportarExcel(r: RelatorioDef): Promise<void> {
  const base64 = await executarEtapa('Falha ao gerar a planilha', () => gerarExcelBase64(r));
  const uri = await executarEtapa('Falha ao gravar o arquivo no aparelho', async () => {
    diagArquivos();
    const destino = `${FileSystem.cacheDirectory}${nomeArquivo(r, 'xlsx')}`;
    await FileSystem.writeAsStringAsync(destino, base64, { encoding: FileSystem.EncodingType.Base64 });
    return destino;
  }, diagArquivos);
  await compartilhar(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: r.titulo,
  });
}
export async function exportarPdf(r: RelatorioDef): Promise<void> {
  const { uri } = await executarEtapa('Falha ao gerar o PDF', () =>
    Print.printToFileAsync({ html: gerarHtmlPdf(r), width: 595, height: 842, base64: false }));
  const destino = await executarEtapa('Falha ao gravar o arquivo no aparelho', async () => {
    diagArquivos();
    const novo = `${FileSystem.cacheDirectory}${nomeArquivo(r, 'pdf')}`;
    await FileSystem.moveAsync({ from: uri, to: novo });
    return novo;
  }, diagArquivos);
  await compartilhar(destino, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: r.titulo });
}
