/**
 * CNPJ: o id do restaurante É o número do CNPJ (14 dígitos, sem pontos/barra/traço).
 * Este módulo é o único lugar que sabe normalizar e validar um CNPJ.
 */

/** Id reservado do restaurante interno da plataforma (Admin Geral). Não é um CNPJ real. */
export const ID_RESTAURANTE_PLATAFORMA = "00000000000000";

/** Remove tudo que não é dígito. Devolve "" se não houver nada. */
export function somenteDigitosCnpj(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/** true quando o texto tem 14 dígitos e os dois dígitos verificadores conferem. */
export function cnpjValido(valor: unknown): boolean {
  const c = somenteDigitosCnpj(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // 11111111111111 etc.

  const calcula = (base: string): number => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcula(c.slice(0, 12));
  const d2 = calcula(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

/** O id é um CNPJ (14 dígitos)? Ids antigos (uuid) e o da plataforma também retornam false/true conforme o caso. */
export function idEhCnpj(id: string): boolean {
  return /^\d{14}$/.test(id);
}
