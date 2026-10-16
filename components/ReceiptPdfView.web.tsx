import React from 'react';

type Props = { uri: string; onLoad: () => void; onError: (error: unknown) => void };
export default function ReceiptPdfView({ uri, onLoad, onError }: Props) {
  return <iframe title="Pré-visualização do PDF da via" src={`${uri}#toolbar=0&navpanes=0&view=FitH`}
    style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#e5e7eb' }}
    onLoad={onLoad} onError={onError} />;
}
