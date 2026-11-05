import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { printBluetooth, RECEIPT_COLUMNS, RECEIPT_WIDTH_MM } from '@/utils/printer';

type Request = { text: string; title: string };
type Props = { request: Request; onClose: (printed: boolean) => void };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível imprimir. Tente novamente.';

function ReceiptPreview({ request, onClose }: Props) {
  const colors = useColors();
  // The snapshot shown here is also the exact Bluetooth payload. Do not trim,
  // reformat, wrap or regenerate it when the user confirms printing.
  const { text, title } = request;
  const lines = text.split('\n');
  const columns = lines.reduce((max, line) => Math.max(max, Array.from(line).length), RECEIPT_COLUMNS);
  const [paperWidth, setPaperWidth] = useState(0);
  // ReceiptMono is bundled DejaVu Sans Mono (advance 0.60205 em). A small
  // allowance prevents subpixel rounding from clipping the final column.
  // Extra-long original lines fit too, without changing the restaurant header.
  const fontSize = paperWidth > 0 ? (paperWidth - 1) / (columns * 0.61) : 1;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const deviceFallback = () => new Promise<'retry' | 'device' | 'cancel'>(resolve => {
    Alert.alert('Impressora não disponível', 'Não foi possível imprimir via Bluetooth. O que deseja fazer?', [
      { text: 'Tentar novamente', onPress: () => resolve('retry') },
      { text: 'Imprimir pelo aparelho', onPress: () => resolve('device') },
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve('cancel') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') });
  });
  const print = async () => {
    if (paperWidth <= 0 || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      // Load PDF/system-print code only after an explicit print confirmation.
      if (Platform.OS === 'web') {
        const { printReceiptTextOnDevice } = await import('@/utils/receiptPdf');
        await printReceiptTextOnDevice(text);
        return;
      }
      while (alive.current) {
        if (await printBluetooth(text)) { onClose(true); return; }
        const choice = await deviceFallback();
        if (choice === 'cancel' || !alive.current) return;
        if (choice === 'device') {
          const { printReceiptTextOnDevice } = await import('@/utils/receiptPdf');
          await printReceiptTextOnDevice(text);
          return;
        }
      }
    } catch (value) {
      // Cancelling a system print panel never triggers a Bluetooth retry.
      if (alive.current) setError(errorMessage(value));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal visible animationType="slide" onRequestClose={() => { if (!lock.current) onClose(false); }}>
    <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Pré-visualização da impressão</Text>
        <Text style={{ color: colors.textSecondary }}>{title} · {RECEIPT_WIDTH_MM} mm · {RECEIPT_COLUMNS} colunas</Text>
        <Text style={{ color: colors.textSecondary }}>Confira a via antes de imprimir.</Text>
      </View>
      <ScrollView style={styles.document} contentContainerStyle={styles.roll}>
        <View style={styles.paper}>
          <View onLayout={event => setPaperWidth(event.nativeEvent.layout.width)}>
            {paperWidth > 0 && lines.map((line, index) => <Text key={index} allowFontScaling={false}
              numberOfLines={1} ellipsizeMode="clip"
              style={[styles.receiptText, { fontSize, lineHeight: fontSize * 1.35 }]}>{line || ' '}</Text>)}
          </View>
        </View>
      </ScrollView>
      {!!error && <View style={styles.error} accessibilityLiveRegion="polite"><Text style={{ color: colors.text }}>{error}</Text></View>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Imprimir" disabled={busy || paperWidth <= 0} onPress={print}
          style={[styles.button, { backgroundColor: colors.primary, opacity: busy || paperWidth <= 0 ? 0.45 : 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Imprimir</Text>}
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
  document: { flex: 1, backgroundColor: '#e5e7eb' }, roll: { padding: 16, alignItems: 'center' },
  paper: { width: '100%', maxWidth: 420, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, elevation: 3 },
  receiptText: { color: '#000', fontFamily: 'ReceiptMono', fontWeight: '400', letterSpacing: 0, includeFontPadding: false },
  error: { paddingHorizontal: 16, paddingTop: 12 },
  actions: { padding: 12, gap: 4 }, button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  label: { fontWeight: '600', fontSize: 16 }, primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
