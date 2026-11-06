import { GRUPOS_FUSO } from "@/utils/fusoHorario";

// Nome IANA do fuso do aparelho; nulo se não for um fuso do Brasil da lista ou se a leitura falhar.
export function fusoDoAparelho(): string | null {
  try {
    const nome = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!nome) return null;
    return GRUPOS_FUSO.some((g) => g.fusos.includes(nome)) ? nome : null;
  } catch {
    return null;
  }
}
