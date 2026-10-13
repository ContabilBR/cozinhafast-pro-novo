import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { PasswordInput } from "@/components/PasswordInput";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { UserRole } from "@/types";
import { apiGet, apiPut, apiDelete } from "@/utils/api";
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

export default function EditarUsuarioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const COLORS = useColors();
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<UserRole>("garcom");
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    console.log("[EditarUsuario] GET /api/usuarios/" + id);
    apiGet<any>(`/api/usuarios/${id}`)
      .then((res) => {
        const u = res.usuario || res.user || res;
        if (u && u.id) {
          console.log("[EditarUsuario] Usuário carregado:", u.name ?? u.nome);
          setNome(u.name ?? u.nome ?? "");
          setEmail(u.email ?? "");
          setRole(u.role ?? "garcom");
        } else {
          setError("Usuário não encontrado.");
        }
      })
      .catch((e) => {
        console.error("[EditarUsuario] Erro ao carregar:", e);
        setError("Não foi possível carregar o usuário.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!nome.trim()) { setError("Nome é obrigatório."); return; }
    console.log("[EditarUsuario] Salvar alterações pressionado:", id, "role:", role);
    setSubmitting(true);
    setError("");
    try {
      const payload: any = { name: nome.trim(), nome: nome.trim(), email: email.trim(), role };
      if (senha.trim()) payload.senha = senha;
      console.log("[EditarUsuario] PUT /api/usuarios/" + id);
      await apiPut(`/api/usuarios/${id}`, payload);
      console.log("[EditarUsuario] Usuário atualizado com sucesso");
      router.back();
    } catch (e: any) {
      console.error("[EditarUsuario] Erro ao salvar:", e);
      setError(e instanceof Error ? e.message : "Não foi possível salvar as alterações.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    console.log("[EditarUsuario] Excluir usuário pressionado:", id);
    Alert.alert(
      "Excluir usuário?",
      `Deseja realmente excluir "${nome || "este usuário"}"?\n\nEsta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            console.log("[EditarUsuario] DELETE /api/usuarios/" + id);
            try {
              await apiDelete(`/api/usuarios/${id}`);
              console.log("[EditarUsuario] Usuário excluído:", id);
              router.back();
            } catch (e: any) {
              console.error("[EditarUsuario] Erro ao excluir:", e);
              Alert.alert("Erro", "Não foi possível excluir o usuário.");
            }
          },
        },
      ]
    );
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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <Pressable onPress={() => { console.log("[EditarUsuario] Botão voltar pressionado (loading)"); router.back(); }} style={{ flexDirection: "row", alignItems: "center", padding: 8, zIndex: 10 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color="#22c55e" />
            <Text style={{ color: "#22c55e", marginLeft: 6, fontSize: 16, fontWeight: "500" }}>Voltar</Text>
          </Pressable>
          <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text, height: 56, lineHeight: 56 }}>Editar Usuário</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
            onPress={() => { console.log("[EditarUsuario] Botão voltar pressionado"); router.back(); }}
            style={{ flexDirection: "row", alignItems: "center", padding: 8, zIndex: 10 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#22c55e" />
            <Text style={{ color: "#22c55e", marginLeft: 6, fontSize: 16, fontWeight: "500" }}>Voltar</Text>
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
            Editar Usuário
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
              autoCorrect={true}
              autoCapitalize="sentences"
              keyboardType="default"
            />
          </FormField>

          <FormField label="E-mail">
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

          <FormField label="Nova senha (opcional)">
            <PasswordInput
              value={senha}
              onChangeText={setSenha}
              placeholder="Deixe em branco para manter"
              placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              style={inputStyle}
            />
          </FormField>

          <FormField label="Função">
            <AnimatedPressable
              onPress={() => { console.log("[EditarUsuario] Seletor de função alternado"); setShowRolePicker((v) => !v); }}
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
                    onPress={() => { console.log("[EditarUsuario] Função selecionada:", r); setRole(r); setShowRolePicker(false); }}
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
            onPress={() => { console.log("[EditarUsuario] Salvar alterações pressionado"); handleSave(); }}
            disabled={submitting}
            style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Salvar alterações</Text>
            )}
          </AnimatedPressable>

          <AnimatedPressable
            onPress={() => { console.log("[EditarUsuario] Excluir usuário pressionado"); handleDelete(); }}
            style={{ backgroundColor: "transparent", borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.danger }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.danger }}>Excluir usuário</Text>
          </AnimatedPressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
