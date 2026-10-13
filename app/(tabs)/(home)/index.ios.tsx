import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { UserRole } from "@/types";

export default function HomeRedirectIOS() {
  const { user, loading } = useAuth();
  const COLORS = useColors();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth-screen" />;

  const role = ((user as any).role as UserRole) || "garcom";

  if (role === "cozinheiro") return <Redirect href="/(tabs)/(cozinha)" />;
  if (role === "gerente" || role === "administrador") return <Redirect href="/(tabs)/(dashboard)" />;
  return <Redirect href="/(tabs)/(mesas)" />;
}
