import React from "react";
import { View, useWindowDimensions } from "react-native";
import { Slot } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import FloatingTabBar, { TabBarItem } from "@/components/FloatingTabBar";
import { useColors } from "@/hooks/useColors";
import { usePratoProntoCount, useDeliveryProntoCount } from "@/hooks/usePratoProntoCount";

// FloatingTabBar centers its pill with 20px margin on each side — the
// container can never be wider than the screen minus that margin, or the
// first/last tabs get clipped off-screen (which is what was happening).
const CONTAINER_HORIZONTAL_MARGIN = 40;

const DELIVERY_BADGE_ROLES = ["garcom", "gerente", "administrador", "admin"];

function getTabsForRole(role: string, pratoProntoCount: number, deliveryProntoCount: number): TabBarItem[] {
  const perfilTab: TabBarItem = {
    name: "perfil",
    route: "/(tabs)/(perfil)",
    icon: "account-circle",
    label: "Perfil",
  };

  switch (role) {
    case "garcom":
      return [
        { name: "mesas", route: "/(tabs)/(mesas)", icon: "grid-view", label: "Mesas" },
        { name: "cardapio", route: "/(tabs)/(cardapio)", icon: "restaurant-menu", label: "Cardápio" },
        { name: "comandas", route: "/(tabs)/(comandas)", icon: "receipt-long", label: "Comandas" },
        { name: "pedidos", route: "/(tabs)/(pedidos)", icon: "list-alt", label: "Pedidos", badge: pratoProntoCount },
        { name: "delivery", route: "/(tabs)/(delivery)", icon: "delivery-dining", label: "Delivery", badge: deliveryProntoCount },
        perfilTab,
      ];
    case "cozinheiro":
    case "cozinha":
      return [
        { name: "cozinha", route: "/(tabs)/(cozinha)", icon: "local-fire-department", label: "Cozinha" },
        { name: "cardapio", route: "/(tabs)/(cardapio)", icon: "restaurant-menu", label: "Cardápio" },
        perfilTab,
      ];
    case "gerente":
    case "administrador":
    case "admin":
      return [
        { name: "dashboard", route: "/(tabs)/(dashboard)", icon: "bar-chart", label: "Dashboard" },
        { name: "mesas", route: "/(tabs)/(mesas)", icon: "grid-view", label: "Mesas" },
        { name: "comandas", route: "/(tabs)/(comandas)", icon: "receipt-long", label: "Comandas" },
        { name: "delivery", route: "/(tabs)/(delivery)", icon: "delivery-dining", label: "Delivery", badge: deliveryProntoCount },
        { name: "cardapio", route: "/(tabs)/(cardapio)", icon: "restaurant-menu", label: "Cardápio" },
        { name: "gestao", route: "/(tabs)/(gestao)", icon: "settings", label: "Gestão" },
        perfilTab,
      ];
    default:
      return [
        { name: "mesas", route: "/(tabs)/(mesas)", icon: "grid-view", label: "Mesas" },
        perfilTab,
      ];
  }
}

export default function TabLayout() {
  const { user, isLoading } = useAuth();
  const COLORS = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const role = user?.role || "garcom";
  const pratoProntoCount = usePratoProntoCount(role === "garcom");
  const deliveryProntoCount = useDeliveryProntoCount(DELIVERY_BADGE_ROLES.includes(role));

  if (isLoading) return null;
  // Não redireciona por conta própria — o _layout.tsx raiz decide pra onde ir
  // quando não há usuário (auth-screen no fluxo normal, ou /(mesa-cliente) se
  // o tablet estiver configurado em modo mesa). Um <Redirect> aqui competia
  // com essa decisão e sempre ganhava a corrida, mandando qualquer tablet sem
  // sessão pra tela de login mesmo já configurado como mesa fixa.
  if (!user) return null;

  const tabs = getTabsForRole(role, pratoProntoCount, deliveryProntoCount);
  const tabCount = tabs.length;
  const desiredWidth = 60 + tabCount * 72;
  const maxWidth = screenWidth - CONTAINER_HORIZONTAL_MARGIN;
  const containerWidth = Math.min(desiredWidth, maxWidth, 420);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Slot />
      <FloatingTabBar tabs={tabs} containerWidth={containerWidth} />
    </View>
  );
}
