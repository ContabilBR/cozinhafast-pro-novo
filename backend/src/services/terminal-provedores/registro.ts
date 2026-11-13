import type { ModoProvedor, ProvedorTerminal } from "./tipos.js";
import { stoneDeeplink } from "./stone-deeplink.js";

// Provedor usado hoje por todos os restaurantes. Para trocar, mude só esta constante
// (ou a função provedorDoRestaurante, quando a escolha passar a ser por restaurante).
export const PROVEDOR_PADRAO = "stone_deeplink";

export function provedorDoRestaurante(_restauranteId: string): string {
  return PROVEDOR_PADRAO;
}

const ADAPTADORES: Record<string, ProvedorTerminal> = {
  [stoneDeeplink.nome]: stoneDeeplink,
};

export class ProvedorDesconhecidoError extends Error {
  constructor(nome: string) {
    super(`Provedor de maquininha desconhecido: "${nome}". Disponíveis: ${Object.keys(ADAPTADORES).join(", ")}.`);
    this.name = "ProvedorDesconhecidoError";
  }
}

export function obterProvedor(nome: string): ProvedorTerminal {
  const adaptador = Object.prototype.hasOwnProperty.call(ADAPTADORES, nome) ? ADAPTADORES[nome] : undefined;
  if (!adaptador) throw new ProvedorDesconhecidoError(nome);
  return adaptador;
}

// Modo do provedor, ou null se o nome gravado não for conhecido (não derruba a leitura).
export function modoDoProvedor(nome: string | null | undefined): ModoProvedor | null {
  if (!nome || !Object.prototype.hasOwnProperty.call(ADAPTADORES, nome)) return null;
  return ADAPTADORES[nome].modo;
}
