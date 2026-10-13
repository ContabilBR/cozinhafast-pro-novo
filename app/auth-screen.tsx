import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { TEST_MODE, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "@/constants/testMode";
import { ChefHat, Mail, Lock, Eye, EyeOff } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PRIMARY = "#e94560";
const BG = "#1a1a2e";
const CARD = "#16213e";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#ffffff";
const TEXT_SECONDARY = "rgba(255,255,255,0.55)";
const TEXT_TERTIARY = "rgba(255,255,255,0.30)";
const INPUT_BG = "rgba(255,255,255,0.06)";

const DEMO_CREDENTIALS = [
  { role: "Garçom", email: "garcom@cozinhafast.com" },
  { role: "Cozinheiro", email: "cozinheiro@cozinhafast.com" },
  { role: "Gerente", email: "gerente@cozinhafast.com" },
  { role: "Administrador", email: "admin@cozinhafast.com" },
];

const ROLE_ROUTES: Record<string, string> = {
  garcom: "/(tabs)/(mesas)",
  cozinheiro: "/(tabs)/(cozinha)",
  cozinha: "/(tabs)/(cozinha)",
  admin: "/(tabs)/(dashboard)",
  administrador: "/(tabs)/(dashboard)",
  gerente: "/(tabs)/(dashboard)",
};

export default function AuthScreen() {
  const { user, isLoading, signIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (!isLoading && user) {
      const role = user.role || "";
      const route = ROLE_ROUTES[role] || "/(tabs)/(mesas)";
      console.log("[AuthScreen] User authenticated, role:", role, "-> redirecting to:", route);
      router.replace(route as any);
    }
  }, [user, isLoading, router]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Preencha e-mail e senha.");
      return;
    }
    console.log("[AuthScreen] Entrar button pressed for:", email);
    setError("");
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      console.log("[AuthScreen] Login successful");
    } catch (e: any) {
      console.error("[AuthScreen] Login error:", e);
      const msg: string = e?.message || "";
      if (
        msg.toLowerCase().includes("invalid") ||
        msg.toLowerCase().includes("incorrect") ||
        msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("credenciais") ||
        msg.toLowerCase().includes("inválid") ||
        msg.toLowerCase().includes("senha") ||
        msg.toLowerCase().includes("password") ||
        msg.includes("401") ||
        msg.includes("403")
      ) {
        setError("E-mail ou senha incorretos. Tente novamente.");
      } else {
        setError(msg || "Erro ao fazer login. Tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestLogin = async () => {
    console.log("[AuthScreen] Test login button pressed");
    setError("");
    setSubmitting(true);
    try {
      await signIn(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      console.log("[AuthScreen] Test login successful");
      router.replace("/superadmin/restaurantes" as any);
    } catch (e: any) {
      console.error("[AuthScreen] Test login error:", e);
      setError("Erro no login de teste. Verifique se o backend está rodando.");
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (cred: (typeof DEMO_CREDENTIALS)[0]) => {
    console.log("[AuthScreen] Demo credentials selected for:", cred.role);
    setEmail(cred.email);
    setPassword("123456");
    setError("");
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG }}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40, paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View
          style={{
            alignItems: "center",
            marginBottom: 12,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              backgroundColor: PRIMARY,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 12,
              shadowColor: PRIMARY,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <ChefHat size={42} color="#fff" strokeWidth={2} />
          </View>
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 28,
              color: TEXT,
              letterSpacing: -0.5,
            }}
          >
            CozinhaFast Pro
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 15,
              color: TEXT_SECONDARY,
              marginTop: 6,
              textAlign: "center",
            }}
          >
            Gestão inteligente para seu restaurante
          </Text>
        </Animated.View>

        {/* Form */}
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
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
            {/* Email */}
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
                  onChangeText={(t) => { setEmail(t); setError(""); }}
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

            {/* Password */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                Senha
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
                <Lock size={18} color={TEXT_SECONDARY} />
                <TextInput
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(""); }}
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
                <TouchableOpacity
                  onPress={() => {
                    console.log("[AuthScreen] Toggle password visibility");
                    setShowPassword(!showPassword);
                  }}
                  hitSlop={8}
                >
                  {showPassword
                    ? <EyeOff size={18} color={TEXT_SECONDARY} />
                    : <Eye size={18} color={TEXT_SECONDARY} />
                  }
                </TouchableOpacity>
              </View>
            </View>

            {/* Forgot password */}
            <TouchableOpacity
              onPress={() => {
                console.log("[AuthScreen] Esqueci minha senha pressed");
                router.push("/esqueci-senha" as any);
              }}
              style={{ alignSelf: "flex-end", marginTop: -8 }}
              hitSlop={8}
            >
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 13,
                  color: TEXT_SECONDARY,
                }}
              >
                Esqueci minha senha
              </Text>
            </TouchableOpacity>

            {/* Error */}
            {!!error && (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: "#ff6b6b" }}>
                {error}
              </Text>
            )}

            {/* Submit */}
            <AnimatedPressable
              onPress={handleLogin}
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
                  Entrar
                </Text>
              )}
            </AnimatedPressable>
          </View>
        </Animated.View>

        {/* Test mode */}
        {TEST_MODE && (
          <Animated.View style={{ marginTop: 16, opacity: fadeAnim, alignItems: "center", gap: 10 }}>
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 11,
                color: "rgba(255,255,255,0.35)",
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              Modo de teste
            </Text>
            <AnimatedPressable
              onPress={handleTestLogin}
              disabled={submitting}
              style={{
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.18)",
                borderRadius: 12,
                height: 46,
                paddingHorizontal: 20,
                alignItems: "center",
                justifyContent: "center",
                opacity: submitting ? 0.5 : 1,
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 14,
                  color: "rgba(255,255,255,0.55)",
                }}
              >
                Entrar como Admin Geral (teste)
              </Text>
            </AnimatedPressable>
          </Animated.View>
        )}

        {/* Demo credentials */}
        <Animated.View style={{ marginTop: 32, opacity: fadeAnim }}>
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 12,
              color: TEXT_SECONDARY,
              textAlign: "center",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Credenciais de demonstração
          </Text>
          <View
            style={{
              backgroundColor: CARD,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: BORDER,
              overflow: "hidden",
            }}
          >
            {DEMO_CREDENTIALS.map((cred, i) => (
              <AnimatedPressable
                key={cred.role}
                onPress={() => fillDemo(cred)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i < DEMO_CREDENTIALS.length - 1 ? 1 : 0,
                  borderBottomColor: BORDER,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: TEXT }}>
                    {cred.role}
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: TEXT_SECONDARY }}>
                    {cred.email}
                  </Text>
                </View>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: PRIMARY }}>
                  Usar
                </Text>
              </AnimatedPressable>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
