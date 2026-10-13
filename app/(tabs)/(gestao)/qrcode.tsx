import React, { useState, useCallback, useEffect } from "react";
import { View, Text, FlatList, Pressable, Share, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";

export default function QRCodeScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mesas, setMesas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const getQRUrl = (mesaNumero: number) => baseUrl + "/cardapio?r=" + restauranteId + "&m=" + mesaNumero;

  const compartilharQR = async (mesaNumero: number) => {
    const url = getQRUrl(mesaNumero);
    await Share.share({ message: "Cardápio Mesa " + mesaNumero + "\n" + url, url });
  };

  const compartilharTodos = async () => {
    const links = mesas.map((m: any) => "Mesa " + m.numero + ": " + getQRUrl(m.numero)).join("\n");
    await Share.share({ message: "QR Codes do Cardápio\n\n" + links });
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 10 }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>QR Code Cardápio</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{mesas.length} mesa{mesas.length !== 1 ? "s" : ""}</Text>
        </View>
        <Pressable onPress={compartilharTodos} style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Ionicons name="share-outline" size={20} color="white" />
        </Pressable>
      </View>
      {loading ? <View style={{ padding: 16 }}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
        <FlatList data={mesas} keyExtractor={(m) => m.id} numColumns={2} columnWrapperStyle={{ gap: 10 }} contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => compartilharQR(item.numero)} style={{ flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, alignItems: "center" }}>
              <Ionicons name="qr-code-outline" size={40} color={COLORS.primary} />
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, marginTop: 8 }}>Mesa {item.numero}</Text>
              <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>Toque para compartilhar</Text>
            </Pressable>
          )}
          ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 60 }}><Ionicons name="qr-code-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>Nenhuma mesa cadastrada</Text></View>}
        />
      )}
    </View>
  );
}
