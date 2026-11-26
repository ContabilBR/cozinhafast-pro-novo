import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { entregarRespostaImpressaoStone } from "@/utils/impressaoStone";

// Destino de cozinhafastpro://print, para onde o aplicativo de impressão da Stone devolve o resultado.
export default function PrintResponseScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [semEspera, setSemEspera] = useState(false);
  const feito = useRef(false);

  const voltar = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/(home)");
  };

  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) r[k] = Array.isArray(v) ? v.join(", ") : String(v);
    if (entregarRespostaImpressaoStone(r)) voltar();
    else setSemEspera(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!semEspera) return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 16, color: COLORS.text, marginBottom: 16, textAlign: "center" }}>Resultado da impressão recebido.</Text>
      <Pressable onPress={voltar} style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 }}>
        <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Voltar</Text>
      </Pressable>
    </View>
  );
}
