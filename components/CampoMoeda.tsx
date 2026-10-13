import React from "react";
import { TextInput, TextInputProps } from "react-native";

/** Teto de qualquer valor em dinheiro: R$ 99.999,99 (em centavos). */
export const VALOR_MAXIMO_CENTAVOS = 9999999;

/**
 * Converte um texto de valor em centavos (inteiro).
 * Aceita "25.5", "25,50", "1.250,50", "R$ 10,00", número, vazio.
 * Regra: se houver vírgula, a vírgula é o decimal e os pontos são milhar;
 * sem vírgula, o ponto é o decimal.
 */
export function textoParaCentavos(texto: string | number | null | undefined): number {
  if (texto === null || texto === undefined) return 0;
  let s = String(texto).replace(/R\$\s*/g, "").trim();
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 100), VALOR_MAXIMO_CENTAVOS);
}

/** Centavos -> texto "1250,50" (vírgula decimal, sem milhar). Zero vira "". */
export function centavosParaTexto(centavos: number): string {
  if (!centavos || centavos <= 0) return "";
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  return `${reais},${String(cents).padStart(2, "0")}`;
}

/** Centavos -> texto exibido "1.250,50". Zero vira "". */
export function centavosParaExibicao(centavos: number): string {
  if (!centavos || centavos <= 0) return "";
  const reais = Math.floor(centavos / 100);
  const cents = centavos % 100;
  const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${milhar},${String(cents).padStart(2, "0")}`;
}

type Props = Omit<TextInputProps, "value" | "onChangeText" | "keyboardType"> & {
  /** Valor atual em texto ("25,50", "25.5", "" ...). */
  value: string;
  /** Recebe sempre "1250,50" (vírgula decimal, 2 casas) ou "" quando zerado. */
  onChangeText: (texto: string) => void;
};

/**
 * Campo de dinheiro com máscara estilo banco: os dígitos entram da direita
 * para a esquerda (5 -> 0,05; 50 -> 0,50; 5000 -> 50,00). Teto: R$ 99.999,99.
 * Substitui o TextInput nos campos de valor; o texto devolvido usa vírgula
 * decimal e é compatível com Number(x.replace(",", ".")) e parseBRL.
 */
export function CampoMoeda({ value, onChangeText, ...rest }: Props) {
  const centavosAtuais = textoParaCentavos(value);

  const aoDigitar = (texto: string) => {
    const digitos = texto.replace(/\D/g, "").slice(0, 15);
    const novo = digitos ? parseInt(digitos, 10) : 0;
    // Passou do teto: ignora a tecla e mantém o valor anterior.
    if (novo > VALOR_MAXIMO_CENTAVOS) return;
    onChangeText(centavosParaTexto(novo));
  };

  return (
    <TextInput
      {...rest}
      value={centavosParaExibicao(centavosAtuais)}
      onChangeText={aoDigitar}
      keyboardType="number-pad"
    />
  );
}

export default CampoMoeda;
