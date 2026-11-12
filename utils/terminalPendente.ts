import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "cozinhafast_terminal_pendente";

export type RetornoCobranca = "fechar-conta";
export type TransacaoPendente = { transacaoId: string; comandaId: string; retorno?: RetornoCobranca; provedor?: string };

export async function salvarTransacaoPendente(p: TransacaoPendente): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(p));
}

export async function lerTransacaoPendente(): Promise<TransacaoPendente | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.transacaoId || !p?.comandaId) return null;
    // Leitura tolerante: registros antigos não têm "provedor"
    return { ...p, provedor: typeof p.provedor === "string" ? p.provedor : undefined };
  } catch {
    return null;
  }
}

export async function limparTransacaoPendente(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
