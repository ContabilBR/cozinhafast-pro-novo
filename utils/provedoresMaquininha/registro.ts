import type { ExecutorProvedor, ModoProvedor } from "./tipos";
import { executorStone } from "./stone";

export const PROVEDOR_STONE = "stone_deeplink";

const EXECUTORES: Record<string, ExecutorProvedor> = {
  [PROVEDOR_STONE]: executorStone,
};

// Executor do provedor no modo "aparelho"; undefined para modo "nuvem" ou provedor desconhecido.
export function obterExecutor(provedor: string | null | undefined, modo?: ModoProvedor | string | null): ExecutorProvedor | undefined {
  if (modo && modo !== "aparelho") return undefined;
  if (!provedor || !Object.prototype.hasOwnProperty.call(EXECUTORES, provedor)) return undefined;
  return EXECUTORES[provedor];
}

// Nome de exibição para textos; sem provedor conhecido, usa o da Stone (comportamento anterior).
export function nomeExibicaoProvedor(provedor: string | null | undefined): string {
  return (obterExecutor(provedor) ?? executorStone).nomeExibicao;
}
