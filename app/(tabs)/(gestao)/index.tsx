import React, { useRef, useEffect } from "react";
import { View, Text, ScrollView, Animated } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Settings, UtensilsCrossed, Tag, LayoutGrid, Lock, Users, Store, Globe } from "lucide-react-native";
import { Ionicons } from "@expo/vector-icons";
import { isAdmin } from "@/utils/helpers";

interface ManagementCard {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  route: string;
  color: string;
}

function ManagementCardItem({ card, index, onPress }: { card: ManagementCard; index: number; onPress: () => void }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 400, delay: index * 80, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 400, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }], flex: 1, margin: 6 }}>
      <AnimatedPressable onPress={onPress} style={{ backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.border, minHeight: 140, justifyContent: "space-between", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: card.color + "18", alignItems: "center", justifyContent: "center" }}>
          {card.icon}
        </View>
        <View style={{ gap: 4, marginTop: 12 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text, letterSpacing: -0.2 }}>{card.title}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>{card.subtitle}</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function GestaoScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user } = useAuth();

  const role = user?.role;
  const canAccess = isAdmin(role);

  const cards: ManagementCard[] = [
    ...(user?.is_super_admin ? [{
      icon: <Globe size={26} color="#6366F1" />,
      title: "Plataforma",
      subtitle: "Gerenciar restaurantes",
      route: "/superadmin/restaurantes",
      color: "#6366F1",
    }] : []),
    { icon: <UtensilsCrossed size={26} color={COLORS.primary} />, title: "Pratos", subtitle: "Gerenciar cardápio", route: "/(tabs)/(gestao)/pratos", color: COLORS.primary },
    { icon: <Tag size={26} color="#8B5CF6" />, title: "Categorias", subtitle: "Gerenciar categorias", route: "/(tabs)/(gestao)/categorias", color: "#8B5CF6" },
    { icon: <LayoutGrid size={26} color="#0EA5E9" />, title: "Mesas", subtitle: "Gerenciar mesas", route: "/(tabs)/(gestao)/mesas", color: "#0EA5E9" },
    { icon: <Users size={26} color="#EC4899" />, title: "Equipe", subtitle: "Gerenciar usuários", route: "/(tabs)/(usuarios)", color: "#EC4899" },
    { icon: <Store size={26} color="#F59E0B" />, title: "Restaurante", subtitle: "Dados do estabelecimento", route: "/(tabs)/(gestao)/restaurante", color: "#F59E0B" },
    { icon: <Ionicons name="cube-outline" size={26} color="#F97316" />, title: "Estoque", subtitle: "Controle de insumos", route: "/(tabs)/(gestao)/estoque", color: "#F97316" },
    { icon: <Ionicons name="document-text-outline" size={26} color="#EF4444" />, title: "Notas Fiscais", subtitle: "NFS-e emitidas", route: "/(tabs)/(gestao)/fiscal", color: "#EF4444" },
    { icon: <Ionicons name="receipt-outline" size={26} color="#16A34A" />, title: "Cupom Fiscal", subtitle: "Emitir NFC-e", route: "/(tabs)/(gestao)/cupom-fiscal", color: "#16A34A" },
    { icon: <Ionicons name="settings-outline" size={26} color="#0891B2" />, title: "Configuração Fiscal", subtitle: "Dados para emissão de NFC-e", route: "/(tabs)/(gestao)/fiscal-config", color: "#0891B2" },
    { icon: <Ionicons name="card-outline" size={26} color="#8B5CF6" />, title: "Assinatura", subtitle: "Plano e cobrança", route: "/(tabs)/(gestao)/assinatura", color: "#8B5CF6" },
    { icon: <Ionicons name="shield-checkmark-outline" size={26} color="#6B7280" />, title: "Privacidade", subtitle: "LGPD e dados", route: "/(tabs)/(gestao)/lgpd", color: "#6B7280" },
    { icon: <Ionicons name="qr-code-outline" size={26} color="#0EA5E9" />, title: "QR Code", subtitle: "Cardápio digital", route: "/(tabs)/(gestao)/qrcode", color: "#0EA5E9" },
    { icon: <Ionicons name="tablet-landscape-outline" size={26} color="#7C3AED" />, title: "Modo mesa", subtitle: "Tablets fixos por mesa", route: "/mesa-cliente-setup", color: "#7C3AED" },
  ];

  if (!canAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
          <Lock size={36} color={COLORS.textTertiary} />
        </View>
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text, textAlign: "center" }}>Sem permissão</Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 }}>Esta área é restrita a gerentes e administradores.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
            <Settings size={20} color={COLORS.primary} />
          </View>
          <View>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>Gestão</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>Administração do restaurante</Text>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: listPaddingBottom }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {cards.map((card, index) => (
            <View key={card.title} style={{ width: "50%" }}>
              <ManagementCardItem card={card} index={index} onPress={() => { console.log("[GestaoScreen] card pressed", card.title); router.push(card.route as any); }} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
