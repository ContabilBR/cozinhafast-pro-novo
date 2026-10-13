import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function HomeRedirect() {
  const { user, isLoading } = useAuth();
  const COLORS = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth-screen" />;

  const role = user.role || "garcom";

  if (role === "cozinheiro" || role === "cozinha") return <Redirect href="/(tabs)/(cozinha)" />;
  if (role === "gerente" || role === "administrador" || role === "admin") return <Redirect href="/(tabs)/(dashboard)" />;
  return <Redirect href="/(tabs)/(mesas)" />;
}
