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
} from "react-native";
import { useRouter } from "expo-router";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react-native";
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

export default function EsqueciSenhaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleEnviar = async () => {
    console.log("[EsqueciSenha] Enviar link button pressed, email:", email.trim());
    setSubmitting(true);
    try {
      await apiPost("/api/auth/esqueci-senha", { email: email.trim() });
      console.log("[EsqueciSenha] POST /api/auth/esqueci-senha success");
    } catch (e: any) {
      console.warn("[EsqueciSenha] POST /api/auth/esqueci-senha error (showing confirmation anyway):", e?.message);
    } finally {
      setSubmitting(false);
      setEnviado(true);
    }
  };

  const handleVoltarLogin = () => {
    console.log("[EsqueciSenha] Voltar ao login pressed");
    router.replace("/auth-screen" as any);
  };

  const handleInserirCodigo = () => {
    console.log("[EsqueciSenha] Inserir código manualmente pressed");
    router.push("/redefinir-senha" as any);
  };

  const handleJaTenhoCodigo = () => {
    console.log("[EsqueciSenha] Já tenho um código pressed");
    router.push("/redefinir-senha" as any);
  };

  const handleBack = () => {
    console.log("[EsqueciSenha] Back to login pressed");
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/auth-screen" as any);
    }
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
        <TouchableOpacity
          onPress={handleBack}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 32 }}
          hitSlop={8}
        >
          <ArrowLeft size={18} color={TEXT_SECONDARY} />
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: TEXT_SECONDARY }}>
            Voltar ao login
          </Text>
        </TouchableOpacity>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          {!enviado ? (
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
                Esqueci minha senha
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
                Digite seu e-mail e enviaremos um link para redefinir sua senha.
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
                {/* Email input */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                    E-mail
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
                    <Mail size={18} color={TEXT_SECONDARY} />
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="seu@email.com"
                      placeholderTextColor={TEXT_TERTIARY}
                      keyboardType="email-address"
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

                {/* Submit button */}
                <AnimatedPressable
                  onPress={handleEnviar}
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
                      Enviar link
                    </Text>
                  )}
                </AnimatedPressable>

                {/* Already have a code link */}
                <TouchableOpacity
                  onPress={handleJaTenhoCodigo}
                  style={{ alignItems: "center", paddingVertical: 4 }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 14,
                      color: TEXT_SECONDARY,
                    }}
                  >
                    Já tenho um código
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* ── State 2: Confirmation ── */
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
                Verifique seu e-mail
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
                Se esse e-mail estiver cadastrado, você receberá um link em instantes. Verifique também sua caixa de spam.
              </Text>

              <AnimatedPressable
                onPress={handleVoltarLogin}
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
                  Voltar ao login
                </Text>
              </AnimatedPressable>

              <TouchableOpacity
                onPress={handleInserirCodigo}
                style={{ paddingVertical: 4 }}
              >
                <Text
                  style={{
                    fontFamily: "Outfit_400Regular",
                    fontSize: 14,
                    color: TEXT_SECONDARY,
                  }}
                >
                  Inserir código manualmente
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
