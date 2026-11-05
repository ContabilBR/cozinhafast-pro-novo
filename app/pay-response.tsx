import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { lerTransacaoPendente, TransacaoPendente } from "@/utils/terminalPendente";
import { voltarDaMaquininha } from "@/utils/cobrancaMaquininha";

// Destino de cozinhafastpro://pay-response, para onde a Stone devolve o resultado.
// Nesta etapa só exibe o que chegou, para diagnóstico.
export default function PayResponseScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const [pendente, setPendente] = useState<TransacaoPendente | null>(null);

  useEffect(() => {
    lerTransacaoPendente().then(setPendente);
  }, []);

  const linhas = Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);

  const voltar = () => {
    console.log("[PayResponse] Voltar à comanda pressed");
    if (voltarDaMaquininha(pendente?.comandaId, pendente?.retorno)) return;
    if (pendente?.comandaId) router.replace({ pathname: "/comanda/[id]", params: { id: pendente.comandaId } });
    else router.replace("/(tabs)/(home)");
  };

  const card = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16 } as const;
  const titulo = { fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Resposta da maquininha</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        <Text style={titulo}>Transação pendente</Text>
        <View style={card}>
          <Text selectable style={{ fontSize: 13, color: COLORS.text }}>
            {pendente ? "Transação: " + pendente.transacaoId + "\nComanda: " + pendente.comandaId : "Nenhuma transação pendente guardada."}
          </Text>
        </View>
        <Text style={titulo}>Parâmetros recebidos</Text>
        <View style={card}>
          {linhas.length === 0 ? (
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Nenhum parâmetro recebido.</Text>
          ) : (
            linhas.map(([k, v]) => (
              <View key={k} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{k}</Text>
                <Text selectable style={{ fontSize: 14, color: COLORS.text }}>{v}</Text>
              </View>
            ))
          )}
        </View>
        <Pressable onPress={voltar} style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Voltar à comanda</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
