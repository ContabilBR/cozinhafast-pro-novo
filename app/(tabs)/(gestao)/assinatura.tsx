import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";

const PLANO_ICONS: Record<string, string> = { trial: "time-outline", basico: "star-outline", profissional: "star-half-outline", enterprise: "star" };
const PLANO_COLORS: Record<string, string> = { trial: "#6B7280", basico: "#3B82F6", profissional: "#8B5CF6", enterprise: "#F59E0B" };

export default function AssinaturaScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [assinatura, setAssinatura] = useState<any>(null);
  const [planos, setPlanos] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [email, setEmail] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [planoSelecionado, setPlanoSelecionado] = useState("");

  const fetch = useCallback(async () => {
    console.log("[AssinaturaScreen] Fetching assinatura and planos");
    try {
      const [a, p] = await Promise.all([apiGet<any>("/api/assinatura"), apiGet<any>("/api/planos")]);
      console.log("[AssinaturaScreen] Assinatura loaded:", a);
      console.log("[AssinaturaScreen] Planos loaded:", p);
      setAssinatura(a);
      setPlanos(p.planos);
    } catch (e) {
      console.log("[AssinaturaScreen] Error fetching data:", e);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); fetch(); }, [fetch]));

  const upgrade = async () => {
    console.log("[AssinaturaScreen] Upgrade button pressed, plano:", planoSelecionado, "email:", email);
    if (!planoSelecionado || !email || !cpfCnpj) return Alert.alert("Erro", "Preencha todos os campos");
    setUpgrading(true);
    try {
      console.log("[AssinaturaScreen] Posting upgrade request:", { plano: planoSelecionado, email, cpf_cnpj: cpfCnpj });
      await apiPost("/api/assinatura/upgrade", { plano: planoSelecionado, email, cpf_cnpj: cpfCnpj });
      console.log("[AssinaturaScreen] Upgrade successful");
      Alert.alert("Sucesso", "Plano atualizado!");
      setShowUpgrade(false);
      fetch();
    } catch (err: any) {
      console.log("[AssinaturaScreen] Upgrade error:", err);
      Alert.alert("Erro", err?.message || "Erro ao fazer upgrade");
    }
    finally { setUpgrading(false); }
  };

  const cancelar = () => {
    console.log("[AssinaturaScreen] Cancelar assinatura button pressed");
    Alert.alert("Cancelar assinatura", "Tem certeza? Você perderá acesso às funcionalidades do plano.", [
      { text: "Não", style: "cancel", onPress: () => console.log("[AssinaturaScreen] Cancelar dismissed") },
      { text: "Sim, cancelar", style: "destructive", onPress: async () => {
        console.log("[AssinaturaScreen] Confirming cancellation");
        try {
          await apiPost("/api/assinatura/cancelar", {});
          console.log("[AssinaturaScreen] Cancellation successful");
          Alert.alert("Cancelada", "Assinatura cancelada."); fetch();
        }
        catch (err: any) {
          console.log("[AssinaturaScreen] Cancellation error:", err);
          Alert.alert("Erro", err?.message || "Erro");
        }
      }},
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const planoAtual = assinatura?.plano || "trial";
  const status = assinatura?.assinatura_status || "trial";
  const cor = PLANO_COLORS[planoAtual] || COLORS.primary;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 10 }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Assinatura</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={{ backgroundColor: cor, borderRadius: 16, padding: 20, marginBottom: 16, alignItems: "center" }}>
          <Ionicons name={PLANO_ICONS[planoAtual] as any} size={40} color="white" />
          <Text style={{ fontSize: 24, fontWeight: "700", color: "white", marginTop: 8 }}>Plano {assinatura?.plano_detalhes?.nome || planoAtual}</Text>
          <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>Status: {status}</Text>
          {planoAtual === "trial" && assinatura?.trial_expira_em && <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>Expira em: {new Date(assinatura.trial_expira_em).toLocaleDateString("pt-BR")}</Text>}
          {assinatura?.plano_detalhes?.preco > 0 && <Text style={{ fontSize: 20, fontWeight: "600", color: "white", marginTop: 8 }}>{formatCurrency(assinatura.plano_detalhes.preco)}/mês</Text>}
        </View>

        {assinatura?.plano_detalhes && (
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase" }}>Limites do plano</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}><Text style={{ color: COLORS.textSecondary }}>Mesas</Text><Text style={{ fontWeight: "500", color: COLORS.text }}>até {assinatura.plano_detalhes.max_mesas}</Text></View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}><Text style={{ color: COLORS.textSecondary }}>Usuários</Text><Text style={{ fontWeight: "500", color: COLORS.text }}>até {assinatura.plano_detalhes.max_usuarios}</Text></View>
          </View>
        )}

        {planos && !showUpgrade && (
          <Pressable onPress={() => { console.log("[AssinaturaScreen] Alterar plano pressed"); setShowUpgrade(true); }} style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 10 }}>
            <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Alterar plano</Text>
          </Pressable>
        )}

        {showUpgrade && planos && (
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 12, textTransform: "uppercase" }}>Escolha seu plano</Text>
            {Object.entries(planos).filter(([k]) => k !== "trial").map(([key, p]: [string, any]) => (
              <Pressable key={key} onPress={() => { console.log("[AssinaturaScreen] Plano selected:", key); setPlanoSelecionado(key); }} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderRadius: 10, marginBottom: 8, backgroundColor: planoSelecionado === key ? COLORS.primaryMuted : COLORS.background, borderWidth: planoSelecionado === key ? 1 : 0.5, borderColor: planoSelecionado === key ? COLORS.primary : COLORS.surfaceSecondary }}>
                <View><Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{p.nome}</Text><Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{p.max_mesas} mesas, {p.max_usuarios} usuários</Text></View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.primary }}>{formatCurrency(p.preco)}/mês</Text>
              </Pressable>
            ))}
            <TextInput placeholder="E-mail" value={email} onChangeText={(v) => { console.log("[AssinaturaScreen] Email changed"); setEmail(v); }} keyboardType="email-address" placeholderTextColor={COLORS.textTertiary} style={{ backgroundColor: COLORS.background, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 15, color: COLORS.text, marginBottom: 8, marginTop: 8 }} />
            <TextInput placeholder="CPF ou CNPJ" value={cpfCnpj} onChangeText={(v) => { console.log("[AssinaturaScreen] CPF/CNPJ changed"); setCpfCnpj(v); }} keyboardType="numeric" placeholderTextColor={COLORS.textTertiary} style={{ backgroundColor: COLORS.background, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 15, color: COLORS.text, marginBottom: 12 }} />
            <Pressable onPress={upgrade} disabled={upgrading} style={{ backgroundColor: upgrading ? COLORS.textTertiary : "#22C55E", borderRadius: 12, padding: 14, alignItems: "center" }}>
              {upgrading ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 15, fontWeight: "600" }}>Confirmar upgrade</Text>}
            </Pressable>
          </View>
        )}

        {status === "ativa" && <Pressable onPress={cancelar} style={{ borderWidth: 1, borderColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 6 }}><Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>Cancelar assinatura</Text></Pressable>}
      </ScrollView>
    </View>
  );
}
