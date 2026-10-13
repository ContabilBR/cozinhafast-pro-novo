import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const MESA_CLIENTE_CONFIG_KEY = "cozinhafast_mesa_cliente_config";

export type MesaClienteConfig = {
  restauranteId: string;
  restauranteNome: string;
  mesaId: string;
  mesaNumero: number;
  configuradoEm: string;
};

const readRaw = async (): Promise<string | null> => {
  if (Platform.OS === "web") {
    return localStorage.getItem(MESA_CLIENTE_CONFIG_KEY);
  }
  return SecureStore.getItemAsync(MESA_CLIENTE_CONFIG_KEY);
};

export const getMesaClienteConfig = async (
  attempt = 0
): Promise<MesaClienteConfig | null> => {
  try {
    const raw = await readRaw();
    if (!raw) return null;
    return JSON.parse(raw) as MesaClienteConfig;
  } catch (error) {
    console.error(
      `[MesaCliente] Erro ao ler configuração (tentativa ${attempt + 1}):`,
      error
    );
    // Logo após o app voltar de muito tempo em segundo plano (ou de o SO tê-lo
    // matado silenciosamente), a primeira leitura do armazenamento seguro pode
    // falhar de forma passageira antes do módulo nativo estar pronto. Tenta
    // mais duas vezes com um pequeno intervalo antes de concluir que não há
    // configuração — evita tratar uma falha momentânea como "nunca configurado".
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return getMesaClienteConfig(attempt + 1);
    }
    console.error("[MesaCliente] Desistindo após 3 tentativas de leitura.");
    return null;
  }
};

export const saveMesaClienteConfig = async (
  config: MesaClienteConfig
): Promise<void> => {
  const raw = JSON.stringify(config);
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(MESA_CLIENTE_CONFIG_KEY, raw);
    } else {
      await SecureStore.setItemAsync(MESA_CLIENTE_CONFIG_KEY, raw);
    }
    console.log("[MesaCliente] Configuração salva para mesa", config.mesaNumero);
  } catch (error) {
    console.error("[MesaCliente] Erro ao salvar configuração:", error);
    throw error;
  }
};

export const clearMesaClienteConfig = async (): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(MESA_CLIENTE_CONFIG_KEY);
    } else {
      await SecureStore.deleteItemAsync(MESA_CLIENTE_CONFIG_KEY);
    }
    console.log("[MesaCliente] Configuração removida");
  } catch (error) {
    console.error("[MesaCliente] Erro ao remover configuração:", error);
  }
};
