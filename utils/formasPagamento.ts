// Nomes das formas de pagamento da comanda, alinhados com a maquininha Stone.
// Só a exibição: os valores internos (gravados no banco) não mudam.

export const ROTULO_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cartao_debito: 'Débito',
  cartao_credito: 'Crédito',
  vale_refeicao: 'Voucher',
  pix: 'Pix',
};

/** Nome exibido de uma forma de pagamento; valor desconhecido volta como veio. */
export function rotuloForma(forma: string | null | undefined): string {
  if (!forma) return '';
  return ROTULO_FORMA[forma] ?? forma;
}

/** Botões da escolha de forma de pagamento: Dinheiro sozinho, depois grade 2x2 (Débito, Crédito, Voucher, Pix). */
export const FORMA_DINHEIRO = { key: 'dinheiro', label: ROTULO_FORMA.dinheiro, icon: 'cash-outline' as const };
export const FORMAS_GRADE = [
  { key: 'cartao_debito', label: ROTULO_FORMA.cartao_debito, icon: 'wallet-outline' as const },
  { key: 'cartao_credito', label: ROTULO_FORMA.cartao_credito, icon: 'card-outline' as const },
  { key: 'vale_refeicao', label: ROTULO_FORMA.vale_refeicao, icon: 'restaurant-outline' as const },
  { key: 'pix', label: ROTULO_FORMA.pix, icon: 'qr-code-outline' as const },
];
export const FORMAS_BOTOES = [FORMA_DINHEIRO, ...FORMAS_GRADE];
