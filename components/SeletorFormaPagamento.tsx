import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { FORMA_DINHEIRO, FORMAS_GRADE } from "@/utils/formasPagamento";

// Dinheiro sozinho na largura toda; abaixo, grade de 2 colunas com 4 botões do mesmo tamanho:
// Débito e Crédito, depois Voucher e Pix.
export function SeletorFormaPagamento({ forma, onChange }: { forma: string; onChange: (key: string) => void }) {
  const COLORS = useColors();
  const botao = (f: { key: string; label: string; icon: any }) => {
    const sel = forma === f.key;
    return (
      <Pressable key={f.key} onPress={() => onChange(f.key)} style={{ flex: 1, backgroundColor: sel ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: sel ? COLORS.primary : COLORS.surfaceSecondary }}>
        <Ionicons name={f.icon} size={24} color={sel ? "white" : COLORS.textSecondary} />
        <Text style={{ fontSize: 13, fontWeight: "500", color: sel ? "white" : COLORS.text, marginTop: 6 }}>{f.label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <View style={{ flexDirection: "row" }}>{botao(FORMA_DINHEIRO)}</View>
      <View style={{ flexDirection: "row", gap: 8 }}>{FORMAS_GRADE.slice(0, 2).map(botao)}</View>
      <View style={{ flexDirection: "row", gap: 8 }}>{FORMAS_GRADE.slice(2, 4).map(botao)}</View>
    </View>
  );
}
