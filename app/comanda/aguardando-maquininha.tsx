import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/utils/api";
import { lerTransacaoPendente, limparTransacaoPendente } from "@/utils/terminalPendente";
import { nomeExibicaoProvedor } from "@/utils/provedoresMaquininha/registro";
import { voltarDaMaquininha } from "@/utils/cobrancaMaquininha";

export default function AguardandoMaquininhaScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [provedor, setProvedor] = useState<string | undefined>(undefined);
  const params = useLocalSearchParams<{ transacaoId?: string; comandaId?: string; retorno?: string }>();
  const [retorno, setRetorno] = useState<string | undefined>(params.retorno);
  const [transacaoId, setTransacaoId] = useState<string | undefined>(params.transacaoId);
  const [comandaId, setComandaId] = useState<string | undefined>(params.comandaId);
  const [saving, setSaving] = useState(false);

  // Se o Android recriou o app, os parâmetros se perdem: recupera do armazenamento local
  useEffect(() => {
    lerTransacaoPendente().then((p) => {
      if (p && (!transacaoId || !comandaId || p.transacaoId === transacaoId)) setProvedor(p.provedor);
      if (p && (!transacaoId || !comandaId)) {
        console.log("[AguardandoMaquininha] Transação pendente recuperada:", p);
        setTransacaoId(p.transacaoId);
        setComandaId(p.comandaId);
        setRetorno(p.retorno);
      }
    });
  }, [transacaoId, comandaId]);

  const semResposta = async () => {
    console.log("[AguardandoMaquininha] Não recebi resposta pressed:", transacaoId);
    setSaving(true);
    try {
      if (transacaoId) await apiPost("/api/terminal/transacoes/" + transacaoId + "/sem-retorno", {});
      await limparTransacaoPendente();
      if (voltarDaMaquininha(comandaId, retorno)) return;
      if (comandaId) router.replace({ pathname: "/comanda/pagamento", params: { id: comandaId } });
      else router.back();
    } catch (err: any) {
      console.log("[AguardandoMaquininha] Erro ao marcar sem retorno:", err);
      Alert.alert("Erro", err?.message || "Não foi possível registrar a falta de resposta.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: insets.top + 8, paddingHorizontal: 16 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Aguardando a maquininha</Text>
        <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
          Conclua a cobrança no aplicativo de pagamento da {nomeExibicaoProvedor(provedor)}. Quando terminar, o resultado volta para cá.
        </Text>
      </View>
      <Pressable
        onPress={semResposta}
        disabled={saving}
        style={{ backgroundColor: saving ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center", marginBottom: insets.bottom + 16 }}
      >
        {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Não recebi resposta</Text>}
      </Pressable>
    </View>
  );
}
