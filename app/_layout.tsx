import "react-native-reanimated";
import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { WidgetProvider } from "@/contexts/WidgetContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { MesaClienteProvider, useMesaCliente } from "@/contexts/MesaClienteContext";
import { PratoProntoNotifier } from "@/components/PratoProntoNotifier";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const { config: mesaClienteConfig, loading: mesaClienteLoading } = useMesaCliente();
  const mesaClienteConfigured = mesaClienteConfig !== null;
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || mesaClienteLoading) return;

    const inMesaCliente = segments[0] === "(mesa-cliente)";
    const inAuthScreen = segments[0] === "auth-screen";
    const inMesaClienteSetup = segments[0] === "mesa-cliente-setup";

    if (mesaClienteConfigured) {
      // Tablet fixo em modo mesa: fica preso na tela do cliente, exceto na
      // configuração (que pede login de gerente por dentro dela mesma).
      if (!inMesaCliente && !inMesaClienteSetup) {
        console.log("[Layout] Tablet em modo mesa — redirecionando para (mesa-cliente)");
        router.replace("/(mesa-cliente)");
      }
      return;
    }

    // Não está em modo mesa: nunca deve sobrar alguém preso em (mesa-cliente)
    // — se caiu aqui por qualquer motivo (config apagada, navegação restaurada
    // pelo SO, etc.), sai imediatamente pro lugar certo.
    if (inMesaCliente) {
      console.log("[Layout] Em (mesa-cliente) sem configuração — redirecionando para fora");
      router.replace(user ? "/(tabs)/(home)" : "/auth-screen");
      return;
    }

    if (!user && !inAuthScreen) {
      console.log("[Layout] No user — redirecionando para /auth-screen");
      router.replace("/auth-screen");
    } else if (user && inAuthScreen) {
      console.log("[Layout] User authenticated — redirecionando para /(tabs)/(home)");
      router.replace("/(tabs)/(home)");
    }
  }, [user, isLoading, mesaClienteConfigured, mesaClienteLoading, segments, router]);

  if (isLoading || mesaClienteLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#1a1a2e", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(mesa-cliente)" options={{ headerShown: false }} />
        <Stack.Screen name="mesa-cliente-setup" options={{ headerShown: false }} />
        <Stack.Screen name="auth-screen" options={{ headerShown: false }} />
        <Stack.Screen name="auth-popup" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="prato/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="prato/novo" options={{ headerShown: false }} />
        <Stack.Screen name="prato/editar/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="categoria/index" options={{ headerShown: false }} />
        <Stack.Screen name="mesa/index" options={{ headerShown: false }} />
        <Stack.Screen name="mesa/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="mesa-historico" options={{ headerShown: false }} />
        <Stack.Screen name="usuario/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="usuario/novo" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/nova" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/comprovante" options={{ headerShown: false, headerBackVisible: false }} />
        <Stack.Screen name="pedido/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="pedido/novo" options={{ headerShown: false }} />
        <Stack.Screen name="order/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="order/new" options={{ headerShown: false }} />
        <Stack.Screen name="dish/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="dish/new" options={{ headerShown: false }} />
        <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="user/new" options={{ headerShown: false }} />
      </Stack>
      {!mesaClienteConfigured && <PratoProntoNotifier />}
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="auto" animated />
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <SafeAreaProvider>
          <WidgetProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <AuthProvider>
                <MesaClienteProvider>
                  <RootLayoutNav />
                  <SystemBars style="auto" />
                </MesaClienteProvider>
              </AuthProvider>
            </GestureHandlerRootView>
          </WidgetProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </>
  );
}
