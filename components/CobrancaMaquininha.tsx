import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { useColors } from "@/hooks/useColors";
import { cobrarNaMaquininha } from "@/utils/cobrancaMaquininha";
import { RetornoCobranca } from "@/utils/terminalPendente";

type Props = {
  comandaId: string;
  forma: string;
  // Devolve o valor a cobrar (em reais) ou null se inválido
  obterValor: () => number | null;
  gorjeta?: number;
  retorno?: RetornoCobranca;
  desabilitado?: boolean;
  onValorInvalido: () => void;
};

// Opção "Cobrar na maquininha": só no Android e para Pix, crédito ou débito
export function CobrancaMaquininha({ comandaId, forma, obterValor, gorjeta, retorno, desabilitado, onValorInvalido }: Props) {
  const COLORS = useColors();
  const [parcelas, setParcelas] = useState(1);
  const [tipoParcelamento, setTipoParcelamento] = useState<"lojista" | "emissor">("lojista");
  const [cobrando, setCobrando] = useState(false);
  if (Platform.OS !== "android" || !(forma === "pix" || forma === "cartao_credito" || forma === "cartao_debito")) return null;

  const cobrar = async () => {
    const v = obterValor();
    if (!v || v <= 0) return onValorInvalido();
    setCobrando(true);
    try {
      await cobrarNaMaquininha({ comandaId, forma, valor: v, parcelas, tipoParcelamento, gorjeta, retorno });
    } finally { setCobrando(false); }
  };

  return (
    <View style={{ marginTop: 8, marginBottom: 8 }}>
      {forma === "cartao_credito" && (
        <>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Parcelas</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
              <Pressable key={n} onPress={() => setParcelas(n)} style={{ width: 52, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: parcelas === n ? COLORS.primary : COLORS.surface, borderWidth: 0.5, borderColor: parcelas === n ? COLORS.primary : COLORS.surfaceSecondary }}>
                <Text style={{ fontSize: 14, fontWeight: "500", color: parcelas === n ? "white" : COLORS.text }}>{n}x</Text>
              </Pressable>
            ))}
          </View>
          {parcelas > 1 && (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {([["lojista", "Sem juros (lojista)"], ["emissor", "Com juros (emissor)"]] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => setTipoParcelamento(k)} style={{ flex: 1, padding: 12, borderRadius: 10, alignItems: "center", backgroundColor: tipoParcelamento === k ? COLORS.primary : COLORS.surface, borderWidth: 0.5, borderColor: tipoParcelamento === k ? COLORS.primary : COLORS.surfaceSecondary }}>
                  <Text style={{ fontSize: 13, fontWeight: "500", color: tipoParcelamento === k ? "white" : COLORS.text }}>{l}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
      <Pressable onPress={cobrar} disabled={cobrando || desabilitado} style={{ backgroundColor: cobrando ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
        {cobrando ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Cobrar na maquininha</Text>}
      </Pressable>
    </View>
  );
}
