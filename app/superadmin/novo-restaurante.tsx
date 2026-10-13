import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Clipboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiPost } from "@/utils/api";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Ionicons } from "@expo/vector-icons";
import { CheckCircle, Copy, Globe } from "lucide-react-native";

function validarCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(digits[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    return r === parseInt(digits[len]);
  };
  return calc(12) && calc(13);
}

interface SuccessData {
  restauranteNome: string;
  email: string;
  senha: string;
}

export default function NovoRestauranteScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [respNome, setRespNome] = useState("");
  const [respEmail, setRespEmail] = useState("");
  const [respSenha, setRespSenha] = useState("");
  const [respSenhaConf, setRespSenhaConf] = useState("");
  const [respRole, setRespRole] = useState<"administrador" | "gerente">("administrador");
  const [showSenha, setShowSenha] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  const handleSalvar = async () => {
    console.log("[NovoRestaurante] Salvar button pressed");
    if (!nome.trim()) return Alert.alert("Atenção", "Informe o nome do restaurante.");
    if (cnpj.trim() && !validarCNPJ(cnpj)) return Alert.alert("Atenção", "CNPJ inválido.");
    if (!respNome.trim()) return Alert.alert("Atenção", "Informe o nome do responsável.");
    if (!respEmail.trim() || !respEmail.includes("@")) return Alert.alert("Atenção", "Informe um e-mail válido.");
    if (respSenha.length < 6) return Alert.alert("Atenção", "A senha deve ter pelo menos 6 caracteres.");
    if (respSenha !== respSenhaConf) return Alert.alert("Atenção", "As senhas não coincidem.");

    setSaving(true);
    console.log("[NovoRestaurante] POST /api/superadmin/restaurantes");
    try {
      await apiPost("/api/superadmin/restaurantes", {
        nome: nome.trim(),
        cnpj: cnpj.trim() || undefined,
        telefone: telefone.trim() || undefined,
        cidade: cidade.trim() || undefined,
        uf: uf.trim() || undefined,
        responsavelNome: respNome.trim(),
        responsavelEmail: respEmail.trim().toLowerCase(),
        responsavelSenha: respSenha,
        responsavelRole: respRole,
      });
      console.log("[NovoRestaurante] Restaurante created successfully");
      setSuccessData({
        restauranteNome: nome.trim(),
        email: respEmail.trim().toLowerCase(),
        senha: respSenha,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[NovoRestaurante] Failed to create restaurante:", msg);
      if (
        msg.includes("409") ||
        msg.toLowerCase().includes("já cadastrado") ||
        msg.toLowerCase().includes("already")
      ) {
        Alert.alert("E-mail em uso", "Este e-mail já está cadastrado. Use outro e-mail para o responsável.");
      } else {
        Alert.alert("Erro", msg || "Não foi possível criar o restaurante.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopiar = () => {
    if (!successData) return;
    console.log("[NovoRestaurante] Copiar dados pressed");
    const text = `Restaurante: ${successData.restauranteNome}\nE-mail: ${successData.email}\nSenha: ${successData.senha}`;
    Clipboard.setString(text);
    Alert.alert("Copiado!", "Dados de acesso copiados para a área de transferência.");
  };

  // ── Tela de sucesso ──────────────────────────────────────────────────────────
  if (successData) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: 14,
            backgroundColor: COLORS.surface,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
          }}
        >
          <Pressable
            onPress={() => {
              console.log("[NovoRestaurante] Back from success pressed");
              router.back();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center", gap: 20 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: "#22C55E20",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 24,
            }}
          >
            <CheckCircle size={40} color="#22C55E" />
          </View>
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 24,
              color: COLORS.text,
              textAlign: "center",
              letterSpacing: -0.3,
            }}
          >
            Restaurante criado!
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 15,
              color: COLORS.textSecondary,
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            {successData.restauranteNome}
            {" foi cadastrado com sucesso."}
          </Text>

          {/* Dados de acesso */}
          <View
            style={{
              width: "100%",
              backgroundColor: COLORS.surface,
              borderRadius: 16,
              padding: 20,
              borderWidth: 1,
              borderColor: COLORS.border,
              gap: 12,
            }}
          >
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>
              Dados de acesso do responsável
            </Text>
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                E-mail
              </Text>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>
                {successData.email}
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                Senha
              </Text>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>
                {successData.senha}
              </Text>
            </View>
          </View>

          {/* Copiar */}
          <AnimatedPressable
            onPress={handleCopiar}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: "#6366F1",
              borderRadius: 14,
              paddingHorizontal: 24,
              paddingVertical: 14,
              width: "100%",
              justifyContent: "center",
            }}
          >
            <Copy size={18} color="#fff" />
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: "#fff" }}>
              Copiar dados de acesso
            </Text>
          </AnimatedPressable>

          {/* Instrução */}
          <View
            style={{
              backgroundColor: COLORS.surfaceSecondary,
              borderRadius: 12,
              padding: 16,
              width: "100%",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 13,
                color: COLORS.textSecondary,
                lineHeight: 20,
                textAlign: "center",
              }}
            >
              Para configurar este restaurante, saia da sua conta e entre com o e-mail acima.
            </Text>
          </View>

          <AnimatedPressable
            onPress={() => {
              console.log("[NovoRestaurante] Voltar à lista pressed");
              router.back();
            }}
            style={{
              borderRadius: 14,
              paddingHorizontal: 24,
              paddingVertical: 14,
              width: "100%",
              alignItems: "center",
              borderWidth: 1.5,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text }}>
              Voltar à lista
            </Text>
          </AnimatedPressable>
        </ScrollView>
      </View>
    );
  }

  // ── Formulário ───────────────────────────────────────────────────────────────
  const inputStyle = {
    fontFamily: "Outfit_400Regular" as const,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  };

  const labelStyle = {
    fontFamily: "Outfit_600SemiBold" as const,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  };

  const sectionStyle = {
    fontFamily: "Outfit_700Bold" as const,
    fontSize: 17,
    color: COLORS.text,
    marginBottom: 14,
    marginTop: 8,
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 14,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => {
            console.log("[NovoRestaurante] Back button pressed");
            router.back();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Globe size={20} color="#6366F1" />
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 20,
              color: COLORS.text,
              letterSpacing: -0.3,
            }}
          >
            Novo restaurante
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Restaurante */}
        <Text style={sectionStyle}>Dados do restaurante</Text>

        <View>
          <Text style={labelStyle}>Nome *</Text>
          <TextInput
            value={nome}
            onChangeText={setNome}
            placeholder="Nome do restaurante"
            placeholderTextColor={COLORS.textSecondary}
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>CNPJ (opcional)</Text>
          <TextInput
            value={cnpj}
            onChangeText={setCnpj}
            placeholder="00.000.000/0000-00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="numeric"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>Telefone</Text>
          <TextInput
            value={telefone}
            onChangeText={setTelefone}
            placeholder="(00) 00000-0000"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="phone-pad"
            style={inputStyle}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 2 }}>
            <Text style={labelStyle}>Cidade</Text>
            <TextInput
              value={cidade}
              onChangeText={setCidade}
              placeholder="São Paulo"
              placeholderTextColor={COLORS.textSecondary}
              style={inputStyle}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={labelStyle}>UF</Text>
            <TextInput
              value={uf}
              onChangeText={setUf}
              placeholder="SP"
              placeholderTextColor={COLORS.textSecondary}
              maxLength={2}
              autoCapitalize="characters"
              style={inputStyle}
            />
          </View>
        </View>

        {/* Responsável */}
        <Text style={[sectionStyle, { marginTop: 16 }]}>Responsável</Text>

        <View>
          <Text style={labelStyle}>Nome *</Text>
          <TextInput
            value={respNome}
            onChangeText={setRespNome}
            placeholder="Nome completo"
            placeholderTextColor={COLORS.textSecondary}
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>E-mail *</Text>
          <TextInput
            value={respEmail}
            onChangeText={setRespEmail}
            placeholder="email@restaurante.com"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>Senha *</Text>
          <View style={{ position: "relative" }}>
            <TextInput
              value={respSenha}
              onChangeText={setRespSenha}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry={!showSenha}
              style={[inputStyle, { paddingRight: 44 }]}
            />
            <Pressable
              onPress={() => {
                console.log("[NovoRestaurante] Toggle senha visibility");
                setShowSenha(!showSenha);
              }}
              style={{ position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" }}
            >
              <Ionicons
                name={showSenha ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={COLORS.textSecondary}
              />
            </Pressable>
          </View>
        </View>
        <View>
          <Text style={labelStyle}>Confirmar senha *</Text>
          <TextInput
            value={respSenhaConf}
            onChangeText={setRespSenhaConf}
            placeholder="Repita a senha"
            placeholderTextColor={COLORS.textSecondary}
            secureTextEntry={!showSenha}
            style={inputStyle}
          />
        </View>

        {/* Perfil */}
        <View>
          <Text style={labelStyle}>Perfil</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["administrador", "gerente"] as const).map((role) => {
              const isSelected = respRole === role;
              const roleLabel = role === "administrador" ? "Administrador" : "Gerente";
              return (
                <AnimatedPressable
                  key={role}
                  onPress={() => {
                    console.log("[NovoRestaurante] Role selected:", role);
                    setRespRole(role);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor: isSelected ? "#6366F1" : COLORS.surfaceSecondary,
                    borderWidth: 1.5,
                    borderColor: isSelected ? "#6366F1" : COLORS.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 14,
                      color: isSelected ? "#fff" : COLORS.text,
                    }}
                  >
                    {roleLabel}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </View>

        {/* Salvar */}
        <AnimatedPressable
          onPress={handleSalvar}
          disabled={saving}
          style={{
            backgroundColor: "#6366F1",
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: "center",
            marginTop: 8,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
              Criar restaurante
            </Text>
          )}
        </AnimatedPressable>
      </ScrollView>
    </View>
  );
}
