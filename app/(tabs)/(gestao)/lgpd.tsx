import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiDelete } from "@/utils/api";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export default function LgpdScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportarDados = async () => {
    setExporting(true);
    try {
      const data = await apiGet<any>("/api/lgpd/meus-dados");
      const path = FileSystem.documentDirectory + "meus-dados-lgpd.json";
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
      await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Exportar meus dados" });
    } catch (err: any) { Alert.alert("Erro", err?.message || "Erro ao exportar"); }
    finally { setExporting(false); }
  };

  const excluirDados = () => {
    Alert.alert("Excluir meus dados", "Esta ação é irreversível. Seus dados pessoais serão anonimizados e você não poderá mais fazer login.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir permanentemente", style: "destructive", onPress: async () => {
        setDeleting(true);
        try {
          await apiDelete("/api/lgpd/meus-dados");
          Alert.alert("Dados excluídos", "Seus dados foram anonimizados.");
        } catch (err: any) { Alert.alert("Erro", err?.message || "Erro ao excluir"); }
        finally { setDeleting(false); }
      }},
    ]);
  };

  const cardStyle = { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 10 }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Privacidade e Dados</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>LGPD — seus direitos</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={cardStyle}>
          <Ionicons name="shield-checkmark-outline" size={32} color={COLORS.primary} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text, marginTop: 8 }}>Seus direitos</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 20 }}>Conforme a Lei Geral de Proteção de Dados (LGPD), você tem direito a acessar, corrigir e solicitar a exclusão dos seus dados pessoais a qualquer momento.</Text>
        </View>

        <View style={cardStyle}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>Dados que coletamos</Text>
          {["Nome e email do usuário", "CNPJ e dados do restaurante", "Histórico de comandas e pagamentos", "Notas fiscais emitidas"].map((item, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
              <Ionicons name="ellipse" size={6} color={COLORS.primary} />
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{item}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={exportarDados} disabled={exporting} style={{ ...cardStyle, flexDirection: "row", alignItems: "center", gap: 12 }}>
          {exporting ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="download-outline" size={24} color={COLORS.primary} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>Exportar meus dados</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>Baixar todos os dados em formato JSON</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </Pressable>

        <Pressable onPress={excluirDados} disabled={deleting} style={{ ...cardStyle, flexDirection: "row", alignItems: "center", gap: 12, borderColor: "#FCA5A5" }}>
          {deleting ? <ActivityIndicator color="#EF4444" /> : <Ionicons name="trash-outline" size={24} color="#EF4444" />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#EF4444" }}>Excluir meus dados</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>Anonimizar dados e encerrar conta</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </Pressable>

        <View style={{ ...cardStyle, marginTop: 4 }}>
          <Text style={{ fontSize: 13, color: COLORS.textTertiary, textAlign: "center" }}>Contato DPO: privacidade@cozinhafastpro.com.br</Text>
        </View>
      </ScrollView>
    </View>
  );
}
