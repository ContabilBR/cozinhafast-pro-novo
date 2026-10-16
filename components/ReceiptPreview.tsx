import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import ReceiptPdfView from './ReceiptPdfView';
import { printBluetooth } from '@/utils/printer';
import { generateReceiptPdf, printReceiptOnDevice, ReceiptPdf, releaseReceiptPdf, shareReceiptPdf } from '@/utils/receiptPdf';

type Request = { text: string; title: string };
type Props = { request: Request; onClose: (printed: boolean) => void };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível abrir o PDF. Tente novamente.';

function ReceiptPreview({ request, onClose }: Props) {
  const colors = useColors();
  const [pdf, setPdf] = useState<ReceiptPdf | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    let active = true;
    let generated: ReceiptPdf | undefined;
    setPdf(null); setLoaded(false); setError('');
    generateReceiptPdf(request.text).then(async value => {
      generated = value;
      if (active) setPdf(value);
      else await releaseReceiptPdf(value).catch(() => {});
    }).catch(value => { if (active) setError(errorMessage(value)); });
    return () => { active = false; if (generated) void releaseReceiptPdf(generated).catch(() => {}); };
  }, [request.text, attempt]);

  const deviceFallback = () => new Promise<'retry' | 'device' | 'cancel'>(resolve => {
    Alert.alert('Impressora não disponível', 'Não foi possível imprimir via Bluetooth. O que deseja fazer?', [
      { text: 'Tentar novamente', onPress: () => resolve('retry') },
      { text: 'Imprimir pelo aparelho', onPress: () => resolve('device') },
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve('cancel') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') });
  });
  const print = async () => {
    if (!pdf || !loaded || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (Platform.OS === 'web') { await printReceiptOnDevice(pdf); return; }
      while (alive.current) {
        if (await printBluetooth(pdf.text)) { onClose(true); return; }
        const choice = await deviceFallback();
        if (choice === 'cancel' || !alive.current) return;
        if (choice === 'device') { await printReceiptOnDevice(pdf); return; }
      }
    } catch (value) {
      // A cancelled system print panel leaves the preview available, never
      // automatically retries Bluetooth or consumes another sheet of paper.
      if (alive.current) setError(errorMessage(value));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const share = async () => {
    if (!pdf || lock.current) return;
    lock.current = true; setBusy(true);
    try { await shareReceiptPdf(pdf); }
    catch (value) { if ((value as { name?: string })?.name !== 'AbortError' && alive.current) setError(errorMessage(value)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal visible animationType="slide" onRequestClose={() => { if (!lock.current) onClose(false); }}>
    <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Pré-visualização em PDF</Text>
        <Text style={{ color: colors.textSecondary }}>{request.title} · 58 mm · 32 colunas</Text>
        <Text style={{ color: colors.textSecondary }}>Confira a via. Nada é impresso ao abrir esta tela.</Text>
      </View>
      <View style={styles.document}>
        {pdf && <ReceiptPdfView uri={pdf.uri} onLoad={() => setLoaded(true)} onError={value => { setLoaded(false); setError(errorMessage(value)); }} />}
        {!loaded && !error && <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text>Preparando PDF…</Text></View>}
      </View>
      {!!error && <View style={styles.error} accessibilityLiveRegion="polite"><Text style={{ color: colors.text }}>{error}</Text>
        {!loaded && <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={styles.retry}><Text style={{ color: colors.primary }}>Gerar PDF novamente</Text></Pressable>}
      </View>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy || !loaded} onPress={print}
          style={[styles.button, { backgroundColor: colors.primary, opacity: busy || !loaded ? 0.45 : 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Imprimir</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !loaded} onPress={share}
          style={[styles.button, { borderWidth: 1, borderColor: colors.primary, opacity: busy || !loaded ? 0.45 : 1 }]}>
          <Text style={[styles.label, { color: colors.primary }]}>Compartilhar PDF</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => onClose(false)} style={styles.button}>
          <Text style={[styles.label, { color: colors.textSecondary, opacity: busy ? 0.45 : 1 }]}>Cancelar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  </Modal>;
}

/** Each caller keeps its own modal; concurrent taps cannot create duplicate jobs. */
export function useReceiptPreview() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolve = useRef<((printed: boolean) => void) | null>(null);
  const previewReceipt = useCallback((text: string, title: string): Promise<boolean> => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise(done => { resolve.current = done; setRequest({ text, title }); });
  }, []);
  const close = useCallback((printed: boolean) => {
    const done = resolve.current; resolve.current = null; setRequest(null); done?.(printed);
  }, []);
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  return { previewReceipt, previewModal: request ? <ReceiptPreview request={request} onClose={close} /> : null };
}

const styles = StyleSheet.create({
  page: { flex: 1 }, header: { padding: 16, gap: 6 }, title: { fontSize: 20, fontWeight: '700' },
  document: { flex: 1, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#e5e7eb' },
  error: { paddingHorizontal: 16, paddingTop: 12 }, retry: { paddingVertical: 14 },
  actions: { padding: 12, gap: 4 }, button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  label: { fontWeight: '600', fontSize: 16 }, primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
