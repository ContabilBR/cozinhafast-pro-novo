import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  MOTIVOS_CANCELAMENTO,
  type AutorizacaoCancelamento,
  type MotivoCancelamento,
} from "@/utils/cancelamento";

interface CancelarComandaModalProps {
  visible: boolean;
  /** true quando há item em preparo ou pronto: conta como perda */
  temPerda: boolean;
  /** true quando um gerente precisa autorizar com e-mail e senha (garçom com item em preparo ou pronto) */
  exigeAutorizacao: boolean;
  onClose: () => void;
  /** Deve lançar erro se o servidor recusar; a mensagem aparece no modal. O modal fecha sozinho no sucesso. */
  onConfirm: (
    motivo: MotivoCancelamento,
    detalhe: string | null,
    autorizacao?: AutorizacaoCancelamento
  ) => Promise<void>;
}

export function CancelarComandaModal({ visible, temPerda, exigeAutorizacao, onClose, onConfirm }: CancelarComandaModalProps) {
  const COLORS = useColors();
  const [motivo, setMotivo] = useState<MotivoCancelamento | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [emailGerente, setEmailGerente] = useState("");
  const [senhaGerente, setSenhaGerente] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  // Garante que a confirmação dispara no máximo uma vez por abertura do modal
  const confirmouRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setMotivo(null);
      setDetalhe("");
      setEmailGerente("");
      setSenhaGerente("");
      setEnviando(false);
      setErro("");
      confirmouRef.current = false;
    }
  }, [visible]);

  const precisaDetalhe = motivo === "outro";
  const autorizacaoValida =
    !exigeAutorizacao || (/^[^\s@]+@[^\s@]+$/.test(emailGerente.trim()) && senhaGerente.trim().length > 0);
  const podeConfirmar =
    motivo !== null && (!precisaDetalhe || detalhe.trim().length > 0) && autorizacaoValida && !enviando;

  const handleConfirmar = async () => {
    if (!podeConfirmar || motivo === null || confirmouRef.current) return;
    confirmouRef.current = true;
    setEnviando(true);
    setErro("");
    try {
      await onConfirm(
        motivo,
        detalhe.trim() ? detalhe.trim() : null,
        exigeAutorizacao ? { email: emailGerente.trim(), senha: senhaGerente } : undefined
      );
      setSenhaGerente("");
      onClose();
    } catch (e: unknown) {
      confirmouRef.current = false;
      setSenhaGerente("");
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível cancelar a comanda. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const inputAutorizacao = {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceSecondary ?? "#f5f5f5",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border ?? "#e5e5e5",
    paddingHorizontal: 10,
    paddingVertical: 10,
  } as const;

  const handleFechar = () => {
    if (enviando) return;
    setSenhaGerente("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleFechar}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 }}
        onPress={handleFechar}
      >
        <Pressable
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 18,
            padding: 20,
            width: "100%",
            maxWidth: 380,
            maxHeight: "90%",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 10,
          }}
          onPress={() => {}}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text }}>Cancelar comanda</Text>

          <View
            style={{
              backgroundColor: "#F59E0B20",
              borderRadius: 10,
              padding: 10,
              marginTop: 10,
              marginBottom: 12,
              flexDirection: "row",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Ionicons name="warning-outline" size={18} color="#F59E0B" />
            <Text style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.text, lineHeight: 18 }}>
              {"Todos os itens ativos desta comanda serão cancelados e ela será encerrada sem cobrança."}
              {temPerda ? " Os itens em preparo ou prontos contam como perda." : ""}
              {exigeAutorizacao ? " O gerente precisa autorizar com e-mail e senha." : ""}
            </Text>
          </View>

          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 12,
              color: COLORS.textSecondary,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            Motivo (obrigatório)
          </Text>

          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
            {MOTIVOS_CANCELAMENTO.map((m) => {
              const selecionado = motivo === m.value;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => {
                    if (!enviando) setMotivo(m.value);
                  }}
                  style={({ pressed }: { pressed: boolean }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 10,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons
                    name={selecionado ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={selecionado ? "#EF4444" : COLORS.textSecondary}
                  />
                  <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 15, color: COLORS.text }}>{m.label}</Text>
                </Pressable>
              );
            })}

            {motivo !== null ? (
              <TextInput
                value={detalhe}
                onChangeText={setDetalhe}
                placeholder={precisaDetalhe ? "Descreva o motivo" : "Detalhe (opcional)"}
                placeholderTextColor={COLORS.textTertiary ?? "#bbb"}
                multiline
                maxLength={300}
                editable={!enviando}
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.text,
                  backgroundColor: COLORS.surfaceSecondary ?? "#f5f5f5",
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.border ?? "#e5e5e5",
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  minHeight: 60,
                  marginTop: 4,
                  textAlignVertical: "top",
                }}
              />
            ) : null}

            {exigeAutorizacao ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Autorização do gerente</Text>
                <TextInput
                  value={emailGerente}
                  onChangeText={setEmailGerente}
                  editable={!enviando}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  importantForAutofill="no"
                  accessibilityLabel="E-mail do gerente"
                  placeholder="E-mail do gerente"
                  placeholderTextColor={COLORS.textTertiary ?? "#bbb"}
                  style={inputAutorizacao}
                />
                <TextInput
                  value={senhaGerente}
                  onChangeText={setSenhaGerente}
                  editable={!enviando}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  textContentType="none"
                  importantForAutofill="noExcludeDescendants"
                  accessibilityLabel="Senha do gerente"
                  placeholder="Senha do gerente"
                  placeholderTextColor={COLORS.textTertiary ?? "#bbb"}
                  style={inputAutorizacao}
                />
              </View>
            ) : null}
          </ScrollView>

          {erro ? (
            <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 13, color: "#EF4444", marginTop: 10 }}>{erro}</Text>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Pressable
              onPress={handleFechar}
              disabled={enviando}
              style={({ pressed }: { pressed: boolean }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                opacity: enviando ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>Voltar</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirmar}
              disabled={!podeConfirmar}
              style={({ pressed }: { pressed: boolean }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#EF4444",
                alignItems: "center",
                justifyContent: "center",
                opacity: !podeConfirmar ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              {enviando ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>Cancelar comanda</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
