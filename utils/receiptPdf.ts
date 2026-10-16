import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PDFDocument, decodeFromBase64, encodeToBase64 } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { RECEIPT_COLUMNS, RECEIPT_WIDTH_MM } from './printer';

export type ReceiptPdf = { text: string; uri: string; html: string };
const WIDTH = RECEIPT_WIDTH_MM * 72 / 25.4;
const MARGIN = 3 * 72 / 25.4;
let fontData: Promise<Uint8Array> | undefined;

function loadReceiptFont(): Promise<Uint8Array> {
  if (!fontData) {
    fontData = (async () => {
      const asset = Asset.fromModule(require('../assets/fonts/ReceiptMono.ttf'));
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer());
      return decodeFromBase64(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
    })().catch(error => { fontData = undefined; throw error; });
  }
  return fontData;
}

// The source is never trimmed, re-formatted or regenerated when confirming print.
// Wrap only at the same 32-column paper boundary, including existing blank lines.
function paperLines(text: string): string[] {
  return text.split('\n').flatMap(line => {
    const chars = Array.from(line.replace(/\r$/, ''));
    if (!chars.length) return [''];
    const result: string[] = [];
    for (let i = 0; i < chars.length; i += RECEIPT_COLUMNS) result.push(chars.slice(i, i + RECEIPT_COLUMNS).join(''));
    return result;
  });
}

/** One PDF generator for delivery slips and table checks, on all platforms. */
export async function generateReceiptPdf(text: string): Promise<ReceiptPdf> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadReceiptFont();
  const font = await doc.embedFont(bytes, { subset: true });
  const size = (WIDTH - MARGIN * 2) / font.widthOfTextAtSize('0'.repeat(RECEIPT_COLUMNS), 1);
  const leading = size * 1.35;
  const lines = paperLines(text);
  // PDF has a finite page limit. Very long checks continue onto full-width pages.
  const maxLines = Math.floor((14000 - MARGIN * 2) / leading);
  for (let start = 0; start < lines.length; start += maxLines) {
    const part = lines.slice(start, start + maxLines);
    const height = Math.max(72, MARGIN * 2 + part.length * leading);
    const page = doc.addPage([WIDTH, height]);
    part.forEach((line, index) => {
      if (line) page.drawText(line, { x: MARGIN, y: height - MARGIN - size - index * leading, size, font });
    });
  }
  const base64 = await doc.saveAsBase64();
  // Browser printing uses the identical line grid and embedded font. Only this
  // utility owns receipt HTML; native device printing uses the generated PDF.
  const fontBase64 = encodeToBase64(bytes);
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:ReceiptMono;src:url(data:font/ttf;base64,${fontBase64})} @page{size:58mm auto;margin:3mm}html,body{margin:0;padding:0;color:#000;background:#fff}pre{font-family:ReceiptMono,monospace;font-size:${size}pt;line-height:${leading}pt;width:52mm;white-space:pre;margin:0;font-variant-ligatures:none}</style></head><body><pre>${escape(lines.join('\n'))}</pre></body></html>`;
  let uri: string;
  if (Platform.OS === 'web') {
    const buffer = Uint8Array.from(decodeFromBase64(base64)).buffer;
    uri = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
  } else {
    const dir = FileSystem.cacheDirectory;
    if (!dir) throw new Error('Não foi possível acessar a pasta temporária do PDF.');
    uri = `${dir}via-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  }
  return { text, uri, html };
}

export async function shareReceiptPdf(pdf: ReceiptPdf): Promise<void> {
  if (Platform.OS !== 'web') {
    if (!await Sharing.isAvailableAsync()) throw new Error('O compartilhamento não está disponível neste aparelho.');
    await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Compartilhar PDF' });
    return;
  }
  const file = new File([await (await fetch(pdf.uri)).blob()], 'via-cozinhafast.pdf', { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'CozinhaFast Pro' });
  } else {
    const link = document.createElement('a');
    link.href = pdf.uri;
    link.download = file.name;
    link.click();
  }
}

export async function printReceiptOnDevice(pdf: ReceiptPdf): Promise<void> {
  if (Platform.OS === 'web') await Print.printAsync({ html: pdf.html });
  else await Print.printAsync({ uri: pdf.uri });
}

export async function releaseReceiptPdf(pdf: ReceiptPdf): Promise<void> {
  if (Platform.OS === 'web') URL.revokeObjectURL(pdf.uri);
  else await FileSystem.deleteAsync(pdf.uri, { idempotent: true });
}
