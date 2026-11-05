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

export async function exportarExcel(r: RelatorioDef): Promise<void> {
  const base64 = await gerarExcelBase64(r);
  const uri = `${FileSystem.cacheDirectory}${nomeArquivo(r, 'xlsx')}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: r.titulo,
  });
}
export async function exportarPdf(r: RelatorioDef): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: gerarHtmlPdf(r), width: 595, height: 842, base64: false });
  const destino = `${FileSystem.cacheDirectory}${nomeArquivo(r, 'pdf')}`;
  await FileSystem.moveAsync({ from: uri, to: destino });
  await Sharing.shareAsync(destino, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: r.titulo });
}
