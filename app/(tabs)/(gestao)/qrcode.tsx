import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, FlatList, Pressable, Share, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";

interface MesaQR {
  id: string;
  numero: number;
  qr_token?: string | null;
}

const temToken = (mesa: MesaQR) => typeof mesa.qr_token === "string" && /^[0-9a-f]{32}$/i.test(mesa.qr_token);

export default function QRCodeScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mesas, setMesas] = useState<MesaQR[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<string | null>(null);
  const gerandoRef = useRef(false);
  const bloqueado = loading || gerando !== null;

  const [restauranteId, setRestauranteId] = useState("");

  useEffect(() => {
    apiGet<any>("/api/restaurante").then((d) => {
      setRestauranteId(d.id || "");
    }).catch(() => {});
  }, []);
  const baseUrl = "https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev";

  useFocusEffect(useCallback(() => {
    setLoading(true);
    apiGet<any>("/api/mesas").then((d) => setMesas(d.mesas || (Array.isArray(d) ? d : []))).catch(() => {}).finally(() => setLoading(false));
  }, []));

  const getQRUrl = (mesa: MesaQR) => baseUrl + "/cardapio?r=" + encodeURIComponent(restauranteId) + "&m=" + mesa.numero + "&t=" + encodeURIComponent(mesa.qr_token || "");

  const compartilharQR = async (mesa: MesaQR) => {
    if (bloqueado || gerandoRef.current || !restauranteId || !temToken(mesa)) return;
    const url = getQRUrl(mesa);
    try {
      await Share.share({ message: "Cardápio Mesa " + mesa.numero + "\n" + url, url });
    } catch {
      Alert.alert("Não foi possível compartilhar", "Tente compartilhar o código novamente.");
    }
  };

  const compartilharTodos = async () => {
    if (bloqueado || gerandoRef.current || !restauranteId) return;
    const validas = mesas.filter(temToken);
    const excluidas = mesas.length - validas.length;
    if (!validas.length) {
      Alert.alert("Nenhum código para compartilhar", excluidas ? `${excluidas} mesa${excluidas !== 1 ? "s" : ""} sem código. Gere novos códigos antes de compartilhar.` : "Nenhuma mesa cadastrada.");
      return;
    }
    const compartilhar = async () => {
      if (gerandoRef.current) return;
      const links = validas.map((m) => "Mesa " + m.numero + ": " + getQRUrl(m)).join("\n");
      try {
        await Share.share({ message: "QR Codes do Cardápio\n\n" + links });
      } catch {
        Alert.alert("Não foi possível compartilhar", "Tente compartilhar os códigos novamente.");
      }
    };
    if (excluidas) {
      Alert.alert("Mesas sem código", `${excluidas} mesa${excluidas !== 1 ? "s" : ""} sem código ficaram de fora.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Compartilhar", onPress: () => { void compartilhar(); } },
      ]);
    } else {
      await compartilhar();
    }
  };

  const gerarCodigo = async (mesa?: MesaQR) => {
    if (gerandoRef.current || loading) return;
    gerandoRef.current = true;
    setGerando(mesa ? mesa.id : "todas");
    try {
      if (mesa) {
        const atualizada = await apiPost<MesaQR>(`/api/mesas/${mesa.id}/qr-token/regenerar`, {});
        if (!atualizada || atualizada.id !== mesa.id || !temToken(atualizada)) throw new Error("Resposta inválida");
        setMesas((atuais) => atuais.map((m) => m.id === mesa.id ? { ...m, qr_token: atualizada.qr_token } : m));
        Alert.alert("Código gerado", `O novo código da Mesa ${mesa.numero} está pronto para compartilhar e imprimir.`);
      } else {
        const resposta = await apiPost<{ mesas: MesaQR[] }>("/api/mesas/qr-token/regenerar-todas", {});
        if (!Array.isArray(resposta?.mesas) || !resposta.mesas.every((m) => m && typeof m.id === "string" && typeof m.numero === "number" && temToken(m))) throw new Error("Resposta inválida");
        setMesas(resposta.mesas);
        Alert.alert("Códigos gerados", "Os novos códigos estão prontos. Imprima-os novamente e reconfigure os tablets em modo mesa.");
      }
    } catch {
      Alert.alert("Não foi possível gerar os códigos", "A lista não foi alterada. Verifique sua conexão e se você tem permissão de gerente ou administrador. Tente novamente.");
    } finally {
      gerandoRef.current = false;
      setGerando(null);
    }
  };

  const confirmarGeracao = (mesa?: MesaQR) => {
    if (bloqueado || gerandoRef.current) return;
    Alert.alert(mesa ? "Gerar novo código" : "Gerar novos códigos", mesa
      ? `O QR atual da Mesa ${mesa.numero} deixará de funcionar e precisará ser impresso de novo. Continuar?`
      : "Todos os QR Codes atuais deixarão de funcionar, e os tablets em modo mesa precisarão ser configurados de novo. Continuar?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Gerar", style: "destructive", onPress: () => { void gerarCodigo(mesa); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} disabled={gerando !== null} style={{ marginRight: 10, opacity: gerando !== null ? 0.5 : 1 }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>QR Code Cardápio</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{mesas.length} mesa{mesas.length !== 1 ? "s" : ""}</Text>
        </View>
        <Pressable onPress={() => confirmarGeracao()} disabled={bloqueado || mesas.length === 0} accessibilityRole="button" accessibilityLabel="Gerar novos códigos de todas as mesas" style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, opacity: bloqueado || mesas.length === 0 ? 0.5 : 1 }}>
          {gerando === "todas" ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="refresh-outline" size={20} color="white" />}
        </Pressable>
        <Pressable onPress={compartilharTodos} disabled={bloqueado || !restauranteId || mesas.length === 0} accessibilityRole="button" accessibilityLabel="Compartilhar todos os códigos" style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, opacity: bloqueado || !restauranteId || mesas.length === 0 ? 0.5 : 1 }}>
          <Ionicons name="share-outline" size={20} color="white" />
        </Pressable>
      </View>
      {loading ? <View style={{ padding: 16 }}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
        <FlatList data={mesas} keyExtractor={(m) => m.id} numColumns={2} columnWrapperStyle={{ gap: 10 }} contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => compartilharQR(item)} disabled={bloqueado} style={{ flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, alignItems: "center", opacity: gerando !== null ? 0.5 : 1 }}>
              <Ionicons name="qr-code-outline" size={40} color={COLORS.primary} />
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, marginTop: 8 }}>Mesa {item.numero}</Text>
              <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>{temToken(item) ? "Toque para compartilhar" : "Sem código. Gere um novo."}</Text>
              <Pressable onPress={(event) => { event.stopPropagation(); confirmarGeracao(item); }} disabled={bloqueado} accessibilityRole="button" accessibilityLabel={`Gerar novo código da Mesa ${item.numero}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8, paddingVertical: 10, minHeight: 44 }}>
                {gerando === item.id ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="refresh-outline" size={16} color={COLORS.primary} />}
                <Text style={{ fontSize: 12, color: COLORS.primary, marginLeft: 5, flexShrink: 1 }}>Gerar novo código</Text>
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 60 }}><Ionicons name="qr-code-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>Nenhuma mesa cadastrada</Text></View>}
        />
      )}
    </View>
  );
}
