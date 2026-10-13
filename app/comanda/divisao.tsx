import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { CampoMoeda } from "@/components/CampoMoeda";

export default function DivisaoScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [tipo, setTipo] = useState<"igual" | "por_itens">("igual");
  const [numPessoas, setNumPessoas] = useState("2");
  const [gorjeta, setGorjeta] = useState("0");
  const [divisao, setDivisao] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [comanda, setComanda] = useState<any>(null);

  useEffect(() => {
    console.log("[DivisaoScreen] Fetching comanda:", id);
    apiGet("/api/comandas/" + id).then((d: any) => {
      console.log("[DivisaoScreen] Comanda loaded:", d);
      setComanda(d.comanda || d);
    }).catch((err) => { console.log("[DivisaoScreen] Error fetching comanda:", err); });
  }, [id]);

  const calcular = async () => {
    console.log("[DivisaoScreen] Calcular pressed:", { tipo, numPessoas, gorjeta, comanda: id });
    setLoading(true);
    try {
      const body: any = { tipo, gorjeta: parseFloat(gorjeta.replace(",", ".")) || 0 };
      if (tipo === "igual") body.num_pessoas = parseInt(numPessoas) || 2;
      const res = await apiPost("/api/comandas/" + id + "/divisao", body);
      console.log("[DivisaoScreen] Divisao calculated:", res);
      setDivisao(res);
    } catch (err: any) {
      console.log("[DivisaoScreen] Error calculating divisao:", err);
      Alert.alert("Erro", err?.message || "Erro ao calcular divisão");
    } finally { setLoading(false); }
  };

  const irParaPagamento = (valor: number) => {
    console.log("[DivisaoScreen] Navigate to pagamento with valor:", valor);
    router.push({ pathname: "/comanda/pagamento", params: { id: id!, valor: valor.toFixed(2) } });
  };

  const totalComanda = parseFloat(comanda?.total || "0");

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => { console.log("[DivisaoScreen] Back pressed"); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Dividir conta</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16, alignItems: "center" }}>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total da comanda</Text>
          <Text style={{ fontSize: 28, fontWeight: "700", color: COLORS.primary, marginTop: 4 }}>{formatCurrency(totalComanda)}</Text>
        </View>

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Tipo de divisão</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          <Pressable onPress={() => { console.log("[DivisaoScreen] Tipo selected: igual"); setTipo("igual"); }} style={{ flex: 1, backgroundColor: tipo === "igual" ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: tipo === "igual" ? COLORS.primary : COLORS.surfaceSecondary }}>
            <Ionicons name="people-outline" size={24} color={tipo === "igual" ? "white" : COLORS.textSecondary} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: tipo === "igual" ? "white" : COLORS.text, marginTop: 6 }}>Igual</Text>
          </Pressable>
          <Pressable onPress={() => { console.log("[DivisaoScreen] Tipo selected: por_itens"); setTipo("por_itens"); }} style={{ flex: 1, backgroundColor: tipo === "por_itens" ? COLORS.primary : COLORS.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: tipo === "por_itens" ? COLORS.primary : COLORS.surfaceSecondary }}>
            <Ionicons name="list-outline" size={24} color={tipo === "por_itens" ? "white" : COLORS.textSecondary} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: tipo === "por_itens" ? "white" : COLORS.text, marginTop: 6 }}>Por itens</Text>
          </Pressable>
        </View>

        {tipo === "igual" && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Número de pessoas</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable onPress={() => { const next = Math.max(2, parseInt(numPessoas) - 1); console.log("[DivisaoScreen] Decrease pessoas to:", next); setNumPessoas(String(next)); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surfaceSecondary, justifyContent: "center", alignItems: "center" }}><Ionicons name="remove" size={22} color={COLORS.text} /></Pressable>
              <Text style={{ fontSize: 32, fontWeight: "700", color: COLORS.text, minWidth: 50, textAlign: "center" }}>{numPessoas}</Text>
              <Pressable onPress={() => { const next = parseInt(numPessoas) + 1; console.log("[DivisaoScreen] Increase pessoas to:", next); setNumPessoas(String(next)); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center" }}><Ionicons name="add" size={22} color="white" /></Pressable>
            </View>
          </View>
        )}

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Gorjeta (R$)</Text>
        <CampoMoeda value={gorjeta} onChangeText={setGorjeta} placeholder="0,00" placeholderTextColor={COLORS.textTertiary} style={{ backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 16, color: COLORS.text, marginBottom: 16 }} />

        <Pressable onPress={calcular} disabled={loading} style={{ backgroundColor: loading ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 16 }}>
          {loading ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Calcular divisão</Text>}
        </Pressable>

        {divisao && divisao.divisao && (
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Resultado</Text>
            {divisao.divisao.map((d: any, i: number) => (
              <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: i < divisao.divisao.length - 1 ? 0.5 : 0, borderBottomColor: COLORS.surfaceSecondary }}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: "500", color: COLORS.text }}>{d.nome || "Pessoa " + (d.pessoa || i + 1)}</Text>
                  {d.gorjeta_proporcional > 0 && <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>inclui gorjeta {formatCurrency(d.gorjeta_proporcional)}</Text>}
                </View>
                <Pressable onPress={() => irParaPagamento(d.total_a_pagar || d.valor)} style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: "white", fontSize: 14, fontWeight: "600" }}>{formatCurrency(d.total_a_pagar || d.valor)}</Text>
                  <Ionicons name="arrow-forward" size={14} color="white" />
                </Pressable>
              </View>
            ))}
            {divisao.gorjeta > 0 && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
                <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Total com gorjeta</Text>
                <Text style={{ fontSize: 13, fontWeight: "500", color: COLORS.text }}>{formatCurrency(divisao.total_com_gorjeta)}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
