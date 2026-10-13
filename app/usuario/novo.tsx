import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { PasswordInput } from "@/components/PasswordInput";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { UserRole } from "@/types";
import { apiPost } from "@/utils/api";
import { getRoleLabel } from "@/utils/helpers";
import { ChevronDown } from "lucide-react-native";

const ROLES: UserRole[] = ["garcom", "cozinheiro", "gerente", "administrador"];

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  const COLORS = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{label}</Text>
      {children}
    </View>
  );
}

export default function NovoUsuarioScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [role, setRole] = useState<UserRole>("garcom");
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!nome.trim()) { setError("Nome é obrigatório."); return; }
    if (!email.trim()) { setError("E-mail é obrigatório."); return; }
    if (!senha.trim()) { setError("Senha é obrigatória."); return; }
    if (!confirmarSenha.trim()) { setError("Confirme a senha."); return; }
    if (senha !== confirmarSenha) { setError("As senhas não coincidem."); return; }
    console.log("[NovoUsuario] Criar usuário pressionado, email:", email, "role:", role);
    setSubmitting(true);
    setError("");
    try {
      console.log("[NovoUsuario] POST /api/usuarios");
      await apiPost("/api/usuarios", {
        name: nome.trim(),
        nome: nome.trim(),
        email: email.trim(),
        password: senha,
        senha,
        role,
      });
      console.log("[NovoUsuario] Usuário criado com sucesso");
      router.back();
    } catch (e: any) {
      console.error("[NovoUsuario] Erro ao salvar:", e);
      setError(e instanceof Error ? e.message : "Não foi possível criar o usuário.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    fontFamily: "Outfit_400Regular" as const,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  };

  const roleLabel = getRoleLabel(role);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Nav bar */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          height: 56,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}>
          <Pressable
            onPress={() => { console.log("[NovoUsuario] Botão voltar pressionado"); router.back(); }}
            style={{ flexDirection: "row", alignItems: "center", zIndex: 1, paddingRight: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 16, marginLeft: 4 }}>Voltar</Text>
          </Pressable>
          <Text style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 17,
            fontWeight: "700",
            color: COLORS.text,
            height: 56,
            lineHeight: 56,
          }}>
            Novo Usuário
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <FormField label="Nome *">
            <TextInput
              value={nome}
              onChangeText={setNome}
              placeholder="Nome completo"
              placeholderTextColor={COLORS.textTertiary}
              style={inputStyle}
              autoFocus
              autoCorrect={true}
              autoCapitalize="sentences"
              keyboardType="default"
            />
          </FormField>

          <FormField label="E-mail *">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="email@exemplo.com"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
          </FormField>

          <FormField label="Senha *">
            <PasswordInput
              value={senha}
              onChangeText={setSenha}
              placeholder="Senha"
              placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              style={inputStyle}
            />
          </FormField>

          <FormField label="Confirmar Senha *">
            <PasswordInput
              value={confirmarSenha}
              onChangeText={setConfirmarSenha}
              placeholder="Repita a senha"
              placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              style={inputStyle}
            />
            {confirmarSenha.length > 0 && senha.length > 0 ? (
              senha === confirmarSenha ? (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.success }}>Senhas coincidem ✓</Text>
              ) : (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.danger }}>As senhas não coincidem.</Text>
              )
            ) : null}
          </FormField>

          <FormField label="Função">
            <AnimatedPressable
              onPress={() => { console.log("[NovoUsuario] Seletor de função alternado"); setShowRolePicker((v) => !v); }}
              style={[inputStyle, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            >
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text }}>{roleLabel}</Text>
              <ChevronDown size={16} color={COLORS.textSecondary} />
            </AnimatedPressable>
            {showRolePicker && (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" }}>
                {ROLES.map((r) => (
                  <AnimatedPressable
                    key={r}
                    onPress={() => { console.log("[NovoUsuario] Função selecionada:", r); setRole(r); setShowRolePicker(false); }}
                    style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.divider, backgroundColor: role === r ? COLORS.primaryMuted : "transparent" }}
                  >
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }}>{getRoleLabel(r)}</Text>
                  </AnimatedPressable>
                ))}
              </View>
            )}
          </FormField>

          {error ? (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger, textAlign: "center" }}>{error}</Text>
          ) : null}

          <AnimatedPressable
            onPress={() => { console.log("[NovoUsuario] Salvar pressionado"); handleSave(); }}
            disabled={submitting}
            style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Criar usuário</Text>
            )}
          </AnimatedPressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
