import React, { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/utils/api";
import { isAdmin } from "@/utils/helpers";
import { saveMesaClienteConfig, getMesaClienteConfig, clearMesaClienteConfig, MesaClienteConfig } from "@/utils/mesaCliente";

export default function MesaClienteSetupScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signIn, signOut } = useAuth();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);

  const [mesas, setMesas] = useState<any[]>([]);
  const [restauranteId, setRestauranteId] = useState("");
  const [restauranteNome, setRestauranteNome] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [config, setConfig] = useState<MesaClienteConfig | null>(null);

  const canAccess = isAdmin(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rest, mesasResp, existing] = await Promise.all([
        apiGet<any>("/api/restaurante"),
        apiGet<any>("/api/mesas"),
        getMesaClienteConfig(),
      ]);
      setRestauranteId(rest?.id || "");
      setRestauranteNome(rest?.nome || "");
      setMesas(mesasResp?.mesas || (Array.isArray(mesasResp) ? mesasResp : []));
      setConfig(existing);
    } catch (error) {
      console.error("[MesaClienteSetup] Erro ao carregar:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess, load]);

  const entrar = async () => {
    if (!email || !senha) {
      setErroLogin("Informe e-mail e senha.");
      return;
    }
    setEntrando(true);
    setErroLogin(null);
    try {
      await signIn(email, senha);
    } catch (error: any) {
      setErroLogin(error?.message || "Não foi possível entrar.");
    } finally {
      setEntrando(false);
    }
  };

  const confirmarMesa = (mesa: any) => {
    Alert.alert(
      "Configurar este tablet",
      `Este tablet vai ficar fixo na Mesa ${mesa.numero}. Os clientes poderão ver o cardápio e fazer pedidos direto por aqui, sem precisar de login. Deseja continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => aplicarConfiguracao(mesa) },
      ]
    );
  };

  const aplicarConfiguracao = async (mesa: any) => {
    setSaving(mesa.id);
    try {
      await saveMesaClienteConfig({
        restauranteId,
        restauranteNome,
        mesaId: mesa.id,
        mesaNumero: mesa.numero,
        configuradoEm: new Date().toISOString(),
      });
      await signOut();
      router.replace("/(mesa-cliente)");
    } catch (error) {
      Alert.alert("Erro", "Não foi possível configurar este tablet. Tente novamente.");
      setSaving(null);
    }
  };

  const desvincular = () => {
    Alert.alert(
      "Remover modo mesa",
      "Este tablet vai parar de usar o cardápio de autoatendimento. Depois de remover, feche e abra o app novamente para aplicar.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Remover", style: "destructive", onPress: async () => {
          await clearMesaClienteConfig();
          Alert.alert("Configuração removida", "Feche e abra o app novamente.");
        }},
      ]
    );
  };

  if (!user) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: COLORS.background }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
          <Ionicons name="tablet-landscape-outline" size={40} color={COLORS.primary} style={{ alignSelf: "center", marginBottom: 8 }} />
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text, textAlign: "center" }}>Login de gerente</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginBottom: 8 }}>Entre para configurar o modo mesa deste tablet.</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="E-mail" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={COLORS.textTertiary} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }} />
          <TextInput value={senha} onChangeText={setSenha} placeholder="Senha" secureTextEntry placeholderTextColor={COLORS.textTertiary} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }} />
          {!!erroLogin && <Text style={{ color: "#EF4444", fontSize: 13, fontFamily: "Outfit_400Regular" }}>{erroLogin}</Text>}
          <Pressable disabled={entrando} onPress={entrar} style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8, opacity: entrando ? 0.7 : 1 }}>
            {entrando ? <ActivityIndicator color="white" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "white" }}>Entrar</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace("/(mesa-cliente)")} style={{ paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 13, color: COLORS.textSecondary }}>Voltar ao cardápio</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (!canAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <Ionicons name="lock-closed-outline" size={36} color={COLORS.textTertiary} />
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text, textAlign: "center" }}>Sem permissão</Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 }}>Esta área é restrita a gerentes e administradores.</Text>
        <Pressable onPress={() => signOut().then(() => router.replace("/(mesa-cliente)"))} style={{ marginTop: 8 }}>
          <Text style={{ color: COLORS.primary, fontFamily: "Outfit_500Medium", fontSize: 14 }}>Voltar ao cardápio</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.replace(config ? "/(mesa-cliente)" : "/(tabs)/(gestao)")} style={{ marginRight: 10 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text }}>Modo mesa</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>Fixar este tablet em uma mesa</Text>
        </View>
      </View>

      {config && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: COLORS.primaryMuted, borderRadius: 12, padding: 14 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.primary }}>Este tablet já está configurado na Mesa {config.mesaNumero}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Selecione outra mesa abaixo para reconfigurar, ou remova o modo mesa.</Text>
          <Pressable onPress={desvincular} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <Text style={{ color: "#EF4444", fontFamily: "Outfit_500Medium", fontSize: 13 }}>Remover modo mesa</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={{ padding: 16 }}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={mesas}
          keyExtractor={(m) => m.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              disabled={saving !== null}
              onPress={() => confirmarMesa(item)}
              style={{ flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: config?.mesaId === item.id ? 1.5 : 0.5, borderColor: config?.mesaId === item.id ? COLORS.primary : COLORS.surfaceSecondary, alignItems: "center" }}
            >
              {saving === item.id ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <Ionicons name="tablet-landscape-outline" size={32} color={COLORS.primary} />
                  <Text style={{ fontSize: 18, fontFamily: "Outfit_700Bold", color: COLORS.text, marginTop: 8 }}>Mesa {item.numero}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>{config?.mesaId === item.id ? "Configurada aqui" : "Toque para fixar"}</Text>
                </>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 60 }}><Text style={{ fontSize: 16, color: COLORS.textSecondary }}>Nenhuma mesa cadastrada</Text></View>}
        />
      )}
    </View>
  );
}
