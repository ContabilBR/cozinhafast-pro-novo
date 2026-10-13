import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle, Key } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiPost } from "@/utils/api";

const PRIMARY = "#e94560";
const BG = "#1a1a2e";
const CARD = "#16213e";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#ffffff";
const TEXT_SECONDARY = "rgba(255,255,255,0.55)";
const TEXT_TERTIARY = "rgba(255,255,255,0.30)";
const INPUT_BG = "rgba(255,255,255,0.06)";
const ERROR_COLOR = "#ff6b6b";

export default function RedefinirSenhaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (params.token) {
      console.log("[RedefinirSenha] Token pre-filled from URL params");
      setToken(params.token);
    }
  }, [params.token]);

  const validate = (): boolean => {
    let valid = true;

    if (password.length < 6) {
      setPasswordError("A senha deve ter pelo menos 6 caracteres.");
      valid = false;
    } else {
      setPasswordError("");
    }

    if (password !== confirmPassword) {
      setConfirmError("As senhas não coincidem.");
      valid = false;
    } else {
      setConfirmError("");
    }

    return valid;
  };

  const handleRedefinir = async () => {
    console.log("[RedefinirSenha] Redefinir senha button pressed");

    if (!token.trim()) {
      Alert.alert("Erro", "Digite o código de redefinição.");
      return;
    }

    if (!validate()) {
      console.log("[RedefinirSenha] Validation failed");
      return;
    }

    console.log("[RedefinirSenha] POST /api/auth/redefinir-senha with token:", token.trim());
    setSubmitting(true);
    try {
      await apiPost("/api/auth/redefinir-senha", { token: token.trim(), novaSenha: password });
      console.log("[RedefinirSenha] POST /api/auth/redefinir-senha success");
      setSucesso(true);
    } catch (e: any) {
      console.error("[RedefinirSenha] POST /api/auth/redefinir-senha error:", e?.message);
      Alert.alert("Erro", e?.message || "Código inválido ou expirado. Solicite um novo link.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleIrParaLogin = () => {
    console.log("[RedefinirSenha] Ir para o login pressed");
    router.replace("/auth-screen" as any);
  };

  const handleSolicitarNovoLink = () => {
    console.log("[RedefinirSenha] Solicitar novo link pressed");
    router.push("/esqueci-senha" as any);
  };

  const handleBack = () => {
    console.log("[RedefinirSenha] Back pressed");
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/auth-screen" as any);
    }
  };

  const handleTogglePassword = () => {
    console.log("[RedefinirSenha] Toggle nova senha visibility");
    setShowPassword(!showPassword);
  };

  const handleToggleConfirmPassword = () => {
    console.log("[RedefinirSenha] Toggle confirmar senha visibility");
    setShowConfirmPassword(!showConfirmPassword);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        {!sucesso && (
          <TouchableOpacity
            onPress={handleBack}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 32 }}
            hitSlop={8}
          >
            <ArrowLeft size={18} color={TEXT_SECONDARY} />
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: TEXT_SECONDARY }}>
              Voltar
            </Text>
          </TouchableOpacity>
        )}

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          {!sucesso ? (
            /* ── State 1: Form ── */
            <View>
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 28,
                  color: TEXT,
                  letterSpacing: -0.5,
                  marginBottom: 8,
                }}
              >
                Redefinir senha
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 15,
                  color: TEXT_SECONDARY,
                  marginBottom: 32,
                  lineHeight: 22,
                }}
              >
                Digite o código recebido por e-mail e escolha uma nova senha.
              </Text>

              <View
                style={{
                  backgroundColor: CARD,
                  borderRadius: 20,
                  padding: 24,
                  borderWidth: 1,
                  borderColor: BORDER,
                  gap: 16,
                }}
              >
                {/* Token input */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                    Código de redefinição
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: INPUT_BG,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: BORDER,
                      paddingHorizontal: 14,
                      height: 52,
                      gap: 10,
                    }}
                  >
                    <Key size={18} color={TEXT_SECONDARY} />
                    <TextInput
                      value={token}
                      onChangeText={setToken}
                      placeholder="Cole o código aqui"
                      placeholderTextColor={TEXT_TERTIARY}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{
                        flex: 1,
                        fontFamily: "Outfit_400Regular",
                        fontSize: 15,
                        color: TEXT,
                      }}
                    />
                  </View>
                </View>

                {/* New password input */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                    Nova senha
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: INPUT_BG,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: passwordError ? ERROR_COLOR : BORDER,
                      paddingHorizontal: 14,
                      height: 52,
                      gap: 10,
                    }}
                  >
                    <Lock size={18} color={TEXT_SECONDARY} />
                    <TextInput
                      value={password}
                      onChangeText={(t) => { setPassword(t); setPasswordError(""); }}
                      placeholder="••••••••"
                      placeholderTextColor={TEXT_TERTIARY}
                      secureTextEntry={!showPassword}
                      style={{
                        flex: 1,
                        fontFamily: "Outfit_400Regular",
                        fontSize: 15,
                        color: TEXT,
                      }}
                    />
                    <TouchableOpacity onPress={handleTogglePassword} hitSlop={8}>
                      {showPassword
                        ? <EyeOff size={18} color={TEXT_SECONDARY} />
                        : <Eye size={18} color={TEXT_SECONDARY} />
                      }
                    </TouchableOpacity>
                  </View>
                  {!!passwordError && (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: ERROR_COLOR }}>
                      {passwordError}
                    </Text>
                  )}
                </View>

                {/* Confirm password input */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                    Confirmar nova senha
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: INPUT_BG,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: confirmError ? ERROR_COLOR : BORDER,
                      paddingHorizontal: 14,
                      height: 52,
                      gap: 10,
                    }}
                  >
                    <Lock size={18} color={TEXT_SECONDARY} />
                    <TextInput
                      value={confirmPassword}
                      onChangeText={(t) => { setConfirmPassword(t); setConfirmError(""); }}
                      placeholder="••••••••"
                      placeholderTextColor={TEXT_TERTIARY}
                      secureTextEntry={!showConfirmPassword}
                      style={{
                        flex: 1,
                        fontFamily: "Outfit_400Regular",
                        fontSize: 15,
                        color: TEXT,
                      }}
                    />
                    <TouchableOpacity onPress={handleToggleConfirmPassword} hitSlop={8}>
                      {showConfirmPassword
                        ? <EyeOff size={18} color={TEXT_SECONDARY} />
                        : <Eye size={18} color={TEXT_SECONDARY} />
                      }
                    </TouchableOpacity>
                  </View>
                  {!!confirmError && (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: ERROR_COLOR }}>
                      {confirmError}
                    </Text>
                  )}
                </View>

                {/* Submit button */}
                <AnimatedPressable
                  onPress={handleRedefinir}
                  disabled={submitting}
                  style={{
                    backgroundColor: PRIMARY,
                    borderRadius: 14,
                    height: 52,
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 4,
                    opacity: submitting ? 0.7 : 1,
                    shadowColor: PRIMARY,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.35,
                    shadowRadius: 10,
                    elevation: 4,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                      Redefinir senha
                    </Text>
                  )}
                </AnimatedPressable>

                {/* Request new link */}
                <TouchableOpacity
                  onPress={handleSolicitarNovoLink}
                  style={{ alignItems: "center", paddingVertical: 4 }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 14,
                      color: TEXT_SECONDARY,
                    }}
                  >
                    Solicitar novo link
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* ── State 2: Success ── */
            <View
              style={{
                backgroundColor: CARD,
                borderRadius: 20,
                padding: 32,
                borderWidth: 1,
                borderColor: BORDER,
                alignItems: "center",
                gap: 16,
              }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: "rgba(233,69,96,0.15)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 8,
                }}
              >
                <CheckCircle size={36} color={PRIMARY} strokeWidth={2} />
              </View>

              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 24,
                  color: TEXT,
                  letterSpacing: -0.3,
                  textAlign: "center",
                }}
              >
                Senha redefinida!
              </Text>

              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 15,
                  color: TEXT_SECONDARY,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                Sua senha foi alterada com sucesso. Faça login com sua nova senha.
              </Text>

              <AnimatedPressable
                onPress={handleIrParaLogin}
                style={{
                  backgroundColor: PRIMARY,
                  borderRadius: 14,
                  height: 52,
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  marginTop: 8,
                  shadowColor: PRIMARY,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35,
                  shadowRadius: 10,
                  elevation: 4,
                }}
              >
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                  Ir para o login
                </Text>
              </AnimatedPressable>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
