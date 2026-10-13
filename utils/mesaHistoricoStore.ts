// Simple module-level store to pass mesa id to the historico screen
// without relying on Expo Router's useLocalSearchParams
let _mesaId: string | null = null;

export function setMesaHistoricoId(id: string) {
  _mesaId = id;
}

export function getMesaHistoricoId(): string | null {
  return _mesaId;
}

export function clearMesaHistoricoId() {
  _mesaId = null;
}
