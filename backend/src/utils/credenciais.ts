export const TAMANHO_MINIMO_SENHA = 8;

export const PAPEIS_ADMINISTRADOR = ["administrador", "admin", "superadmin", "super_admin"];

export function normalizarEmail(valor: any): string {
  if (typeof valor !== "string") return "";
  return valor.trim().toLowerCase();
}

export function papelNormalizado(valor: any): string {
  if (typeof valor !== "string") return "";
  return valor.trim().toLowerCase();
}

export function ehAdministrador(valor: any): boolean {
  const normalizado = papelNormalizado(valor);
  return PAPEIS_ADMINISTRADOR.includes(normalizado);
}

export function validarSenhaNova(senha: any): string | null {
  if (typeof senha !== "string" || senha.trim().length === 0 || senha.length < TAMANHO_MINIMO_SENHA) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }
  return null;
}
