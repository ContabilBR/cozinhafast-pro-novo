import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPatch } from "@/utils/api";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Ionicons } from "@expo/vector-icons";
import { Globe, Plus, Search } from "lucide-react-native";

interface RestauranteItem {
  id: string;
  nome: string;
  cnpj?: string;
  cidade?: string;
  assinatura_status: string;
  created_at: string;
  email_responsavel?: string;
  ativo: boolean;
  plano?: string;
}

const STATUS_COLORS: Record<string, string> = {
  trial: "#F59E0B",
  ativa: "#22C55E",
  inadimplente: "#EF4444",
  desativado: "#94A3B8",
  cancelada: "#94A3B8",
  expirada: "#6B7280",
};

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  ativa: "Ativa",
  inadimplente: "Inadimplente",
  desativado: "Desativado",
  cancelada: "Cancelada",
  expirada: "Expirada",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

export default function SuperAdminRestaurantesScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [restaurantes, setRestaurantes] = useState<RestauranteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [updatingPlanoId, setUpdatingPlanoId] = useState<string | null>(null);

  const fetchRestaurantes = useCallback(async () => {
    console.log("[SuperAdmin] GET /api/superadmin/restaurantes");
    try {
      const res = await apiGet<{ restaurantes: RestauranteItem[] }>("/api/superadmin/restaurantes");
      const list = Array.isArray(res) ? res : (res.restaurantes ?? []);
      console.log("[SuperAdmin] Restaurantes loaded:", list.length);
      setRestaurantes(list);
    } catch (e: any) {
      console.error("[SuperAdmin] Failed to load restaurantes:", e?.message ?? String(e));
      Alert.alert("Erro", "Não foi possível carregar os restaurantes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRestaurantes();
  }, [fetchRestaurantes]);

  const handleToggleAtivo = async (item: RestauranteItem) => {
    const novoAtivo = !item.ativo;
    console.log("[SuperAdmin] Toggle ativo pressed for:", item.id, "→", novoAtivo);
    setTogglingId(item.id);
    try {
      await apiPatch(`/api/superadmin/restaurantes/${item.id}/status`, { ativo: novoAtivo });
      console.log("[SuperAdmin] Status updated for:", item.id);
      setRestaurantes((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, ativo: novoAtivo } : r))
      );
    } catch (e: any) {
      console.error("[SuperAdmin] Failed to toggle status:", e?.message ?? String(e));
      Alert.alert("Erro", "Não foi possível alterar o status.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleAlterarPlano = async (item: RestauranteItem, novoPlano: string) => {
    console.log("[SuperAdmin] handleAlterarPlano pressed for:", item.id, "→", novoPlano);
    setUpdatingPlanoId(item.id);
    try {
      await apiPatch(`/api/superadmin/restaurantes/${item.id}/assinatura`, { plano: novoPlano, assinatura_status: "ativa" });
      console.log("[SuperAdmin] Plano updated for:", item.id, "→", novoPlano);
      setRestaurantes(prev => prev.map(r => r.id === item.id ? { ...r, plano: novoPlano, assinatura_status: "ativa" } : r));
    } catch (e) {
      console.error("[SuperAdmin] Failed to update plano:", e);
      Alert.alert("Erro", "Não foi possível alterar o plano.");
    } finally {
      setUpdatingPlanoId(null);
    }
  };

  const handleAlterarStatus = async (item: RestauranteItem, novoStatus: string) => {
    console.log("[SuperAdmin] handleAlterarStatus pressed for:", item.id, "→", novoStatus);
    setUpdatingPlanoId(item.id);
    try {
      await apiPatch(`/api/superadmin/restaurantes/${item.id}/assinatura`, { assinatura_status: novoStatus });
      console.log("[SuperAdmin] Assinatura status updated for:", item.id, "→", novoStatus);
      setRestaurantes(prev => prev.map(r => r.id === item.id ? { ...r, assinatura_status: novoStatus } : r));
    } catch (e) {
      console.error("[SuperAdmin] Failed to update assinatura status:", e);
      Alert.alert("Erro", "Não foi possível alterar o status.");
    } finally {
      setUpdatingPlanoId(null);
    }
  };

  const filtered = restaurantes.filter((r) =>
    r.nome.toLowerCase().includes(search.toLowerCase())
  );

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
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Pressable
            onPress={() => {
              console.log("[SuperAdmin] Back button pressed");
              router.back();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 8 })}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Globe size={20} color="#6366F1" />
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 22,
                  color: COLORS.text,
                  letterSpacing: -0.3,
                }}
              >
                Plataforma
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 13,
                color: COLORS.textSecondary,
              }}
            >
              {restaurantes.length}
              {" restaurante"}
              {restaurantes.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <AnimatedPressable
            onPress={() => {
              console.log("[SuperAdmin] Novo restaurante button pressed");
              router.push("/superadmin/novo-restaurante");
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: "#6366F1",
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 9,
            }}
          >
            <Plus size={16} color="#fff" />
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 14,
                color: "#fff",
              }}
            >
              Novo
            </Text>
          </AnimatedPressable>
        </View>

        {/* Search */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            paddingHorizontal: 12,
            gap: 8,
          }}
        >
          <Search size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={(text) => {
              console.log("[SuperAdmin] Search changed:", text);
              setSearch(text);
            }}
            placeholder="Buscar por nome..."
            placeholderTextColor={COLORS.textSecondary}
            style={{
              flex: 1,
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.text,
              paddingVertical: 10,
            }}
          />
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 60, gap: 10 }}>
              <Globe size={40} color={COLORS.textSecondary} />
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 16,
                  color: COLORS.text,
                }}
              >
                Nenhum restaurante encontrado
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusColor = STATUS_COLORS[item.assinatura_status] ?? "#94A3B8";
            const statusLabel = STATUS_LABELS[item.assinatura_status] ?? item.assinatura_status;
            const isToggling = togglingId === item.id;
            const isUpdatingPlano = updatingPlanoId === item.id;
            const dataFormatada = formatDate(item.created_at);
            const ativoLabel = item.ativo ? "Ativo" : "Desativado";
            const ativoColor = item.ativo ? "#22C55E" : "#EF4444";

            const PLANO_BUTTONS = [
              { label: "Trial", value: "trial" },
              { label: "Básico", value: "basico" },
              { label: "Pro", value: "profissional" },
              { label: "Enterprise", value: "enterprise" },
            ];

            const STATUS_BUTTONS = [
              { label: "Ativa", value: "ativa" },
              { label: "Inadimplente", value: "inadimplente" },
              { label: "Cancelada", value: "cancelada" },
            ];

            return (
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: item.ativo ? COLORS.border : "#EF444430",
                  opacity: item.ativo ? 1 : 0.7,
                }}
              >
                {/* Top row */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{
                        fontFamily: "Outfit_700Bold",
                        fontSize: 16,
                        color: COLORS.text,
                      }}
                    >
                      {item.nome}
                    </Text>
                    {item.cnpj ? (
                      <Text
                        style={{
                          fontFamily: "Outfit_400Regular",
                          fontSize: 12,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {"CNPJ: "}
                        {item.cnpj}
                      </Text>
                    ) : null}
                    {item.cidade ? (
                      <Text
                        style={{
                          fontFamily: "Outfit_400Regular",
                          fontSize: 12,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {item.cidade}
                      </Text>
                    ) : null}
                  </View>
                  {/* Status badge */}
                  <View
                    style={{
                      backgroundColor: statusColor + "20",
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Outfit_600SemiBold",
                        fontSize: 12,
                        color: statusColor,
                      }}
                    >
                      {statusLabel}
                    </Text>
                  </View>
                </View>

                {/* Meta row */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ gap: 2 }}>
                    {item.email_responsavel ? (
                      <Text
                        style={{
                          fontFamily: "Outfit_400Regular",
                          fontSize: 12,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {item.email_responsavel}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        fontFamily: "Outfit_400Regular",
                        fontSize: 11,
                        color: COLORS.textSecondary,
                      }}
                    >
                      {"Criado em "}
                      {dataFormatada}
                    </Text>
                  </View>
                  {/* Toggle ativo */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      style={{
                        fontFamily: "Outfit_400Regular",
                        fontSize: 12,
                        color: ativoColor,
                      }}
                    >
                      {ativoLabel}
                    </Text>
                    {isToggling ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Switch
                        value={item.ativo}
                        onValueChange={() => handleToggleAtivo(item)}
                        trackColor={{ false: "#EF444440", true: "#22C55E40" }}
                        thumbColor={item.ativo ? "#22C55E" : "#EF4444"}
                      />
                    )}
                  </View>
                </View>

                {/* Plano + Status inline controls */}
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 10,
                    alignItems: "center",
                  }}
                >
                  {/* Plan group */}
                  {isUpdatingPlano ? (
                    <ActivityIndicator size="small" color="#6366F1" />
                  ) : (
                    PLANO_BUTTONS.map((btn) => {
                      const isActive = item.plano === btn.value;
                      return (
                        <Pressable
                          key={btn.value}
                          onPress={() => {
                            if (!isActive) {
                              console.log("[SuperAdmin] Plano button pressed:", btn.value, "for:", item.id);
                              handleAlterarPlano(item, btn.value);
                            }
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            backgroundColor: isActive ? "#6366F1" : "transparent",
                            borderWidth: isActive ? 0 : 1,
                            borderColor: "#334155",
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: "Outfit_600SemiBold",
                              color: isActive ? "#fff" : "#94A3B8",
                            }}
                          >
                            {btn.label}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}

                  {/* Divider */}
                  <View
                    style={{
                      width: 1,
                      alignSelf: "stretch",
                      backgroundColor: "#1E293B",
                      marginHorizontal: 4,
                    }}
                  />

                  {/* Status group */}
                  {isUpdatingPlano ? (
                    <ActivityIndicator size="small" color="#F97316" />
                  ) : (
                    STATUS_BUTTONS.map((btn) => {
                      const isActive = item.assinatura_status === btn.value;
                      const activeBg = STATUS_COLORS[btn.value] ?? "#94A3B8";
                      return (
                        <Pressable
                          key={btn.value}
                          onPress={() => {
                            if (!isActive) {
                              console.log("[SuperAdmin] Status button pressed:", btn.value, "for:", item.id);
                              handleAlterarStatus(item, btn.value);
                            }
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            backgroundColor: isActive ? activeBg : "transparent",
                            borderWidth: isActive ? 0 : 1,
                            borderColor: "#334155",
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: "Outfit_600SemiBold",
                              color: isActive ? "#fff" : "#94A3B8",
                            }}
                          >
                            {btn.label}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
