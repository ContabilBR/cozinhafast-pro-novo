import React from 'react';
import Pdf from 'react-native-pdf';
import { StyleSheet, View } from 'react-native';

export type ReceiptPdfViewProps = { uri: string; onLoad: () => void; onError: (error: unknown) => void };

export default function ReceiptPdfView({ uri, onLoad, onError }: ReceiptPdfViewProps) {
  return <View style={styles.pdf} accessibilityLabel="PDF da via, role para conferir todo o conteúdo">
    <Pdf source={{ uri }} style={styles.pdf} fitPolicy={0} minScale={1} maxScale={3}
      enablePaging={false} trustAllCerts={false} onLoadComplete={onLoad} onError={onError} />
  </View>;
}
const styles = StyleSheet.create({ pdf: { flex: 1, width: '100%', backgroundColor: '#e5e7eb' } });
