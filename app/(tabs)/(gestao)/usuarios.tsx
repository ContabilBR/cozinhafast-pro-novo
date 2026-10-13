import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiDelete } from "@/utils/api";
import { getInitials, getRoleLabel } from "@/utils/helpers";
import { Users, Search } from "lucide-react-native";

interface ApiUsuario {
  id: string;
  nome?: string;
  name?: string;
  email: string;
  role?: string;
}

function getDisplayName(u: ApiUsuario): string {
  return u.name || u.nome || "";
}

function getRoleBadgeColor(role: string | undefined): { bg: string; text: string } {
  switch (role) {
    case "administrador":
    case "admin":
      return { bg: "#FEE2E2", text: "#DC2626" };
    case "gerente":
      return { bg: "#FEF3C7", text: "#D97706" };
    case "garcom":
      return { bg: "#DBEAFE", text: "#2563EB" };
    case "cozinheiro":
      return { bg: "#D1FAE5", text: "#059669" };
    default:
      return { bg: "#F1F5F9", text: "#64748B" };
  }
}

export default function GestaoUsuariosScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [usuarios, setUsuarios] = useState<ApiUsuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>({ visible: false, title: "", message: "", confirmLabel: "Excluir", onConfirm: () => {} });

  const closeConfirm = () => setConfirmDialog((prev) => ({ ...prev, visible: false }));

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/(gestao)" as any);
    }
  };

  const fetchUsuarios = useCallback(async () => {
    console.log("[GestaoUsuarios] GET /api/usuarios");
    try {
      const res = await apiGet<any>("/api/usuarios");
      const list: ApiUsuario[] = Array.isArray(res) ? res : (res.data || res.usuarios || res.users || []);
      console.log("[GestaoUsuarios] Carregados", list.length, "usuários");
      setUsuarios(list);
      setError("");
    } catch (e: unknown) {
      console.error("[GestaoUsuarios] Erro:", e);
      setError("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("[GestaoUsuarios] Tela focada — recarregando usuários");
      setLoading(true);
      fetchUsuarios();
    }, [fetchUsuarios])
  );

  const handleDelete = (id: string, nomeUsuario: string) => {
    const displayNome = nomeUsuario || "Usuário";
    console.log("[GestaoUsuarios] Confirmar exclusão:", id, displayNome);
    setConfirmDialog({
      visible: true,
      title: "Excluir usuário?",
      message: `Deseja excluir "${displayNome}"?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        closeConfirm();
        console.log("[GestaoUsuarios] DELETE /api/usuarios/" + id);
        try {
          await apiDelete(`/api/usuarios/${id}`);
          console.log("[GestaoUsuarios] Usuário excluído:", id);
          setUsuarios((prev) => prev.filter((u) => u.id !== id));
        } catch (e: unknown) {
          console.error("[GestaoUsuarios] Erro ao excluir:", e);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    console.log("[GestaoUsuarios] Toggle seleção:", id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log("[GestaoUsuarios] Entrar modo seleção, item:", id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log("[GestaoUsuarios] Sair modo seleção");
    setSelectMode(false);
    setSelected(new Set());
  };

  const doDelete = async (ids: string[]) => {
    console.log("[GestaoUsuarios] Excluir em lote:", ids);
    setDeleting(true);
    for (const id of ids) {
      try {
        await apiDelete(`/api/usuarios/${id}`);
        console.log("[GestaoUsuarios] Usuário excluído:", id);
      } catch (e: unknown) {
        console.error("[GestaoUsuarios] Erro ao excluir", id, ":", e);
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchUsuarios();
  };

  const confirmBulkDelete = () => {
    if (selected.size === 0) return;
    console.log("[GestaoUsuarios] Confirmar exclusão em lote:", selected.size, "itens");
    setConfirmDialog({
      visible: true,
      title: `Excluir ${selected.size} item(s)?`,
      message: `Deseja excluir ${selected.size} item(s) selecionado(s)?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: `Excluir ${selected.size}`,
      onConfirm: () => {
        closeConfirm();
        doDelete(Array.from(selected));
      },
    });
  };

  const searchLower = search.toLowerCase();
  const filteredUsuarios = search.trim()
    ? usuarios.filter((u) => {
        const n = getDisplayName(u).toLowerCase();
        const e = (u.email ?? "").toLowerCase();
        const r = getRoleLabel(u.role).toLowerCase();
        return n.includes(searchLower) || e.includes(searchLower) || r.includes(searchLower);
      })
    : usuarios;

  const emptyText = search.trim() ? "Nenhum resultado encontrado" : "Nenhum usuário cadastrado";
  const emptySubText = search.trim() ? "Tente outro termo de busca" : "Toque em \"Incluir\" para adicionar usuários";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: 56,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}
      >
        {selectMode ? (
          <TouchableOpacity onPress={exitSelectMode} style={{ paddingVertical: 8, paddingRight: 12 }}>
            <Text style={{ color: "#007AFF", fontSize: 16, fontWeight: "500" }}>Cancelar</Text>
          </TouchableOpacity>
        ) : (
          <AnimatedPressable
            onPress={() => {
              console.log("[GestaoUsuarios] Botão voltar pressionado");
              handleBack();
            }}
            style={{ flexDirection: "row", alignItems: "center", zIndex: 1, paddingVertical: 8, paddingRight: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
          </AnimatedPressable>
        )}
        <Text
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 17,
            fontWeight: "700",
            color: COLORS.text,
            height: 56,
            lineHeight: 56,
          }}
        >
          Usuários
        </Text>
        <View style={{ flex: 1 }} />
        {selectMode ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={exitSelectMode}
              style={{
                borderWidth: 1,
                borderColor: COLORS.border,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: "500" }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoUsuarios] Botão excluir lote pressionado");
                confirmBulkDelete();
              }}
              disabled={selected.size === 0 || deleting}
              style={{
                backgroundColor: selected.size > 0 ? "#FF3B30" : COLORS.border,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="trash" size={14} color="#fff" />
              )}
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                Excluir ({selected.size})
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoUsuarios] Entrar modo seleção");
                setSelectMode(true);
              }}
              style={{
                borderWidth: 1,
                borderColor: COLORS.border,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: "500" }}>Selecionar</Text>
            </TouchableOpacity>
            <AnimatedPressable
              onPress={() => {
                console.log("[GestaoUsuarios] Botão incluir pressionado");
                router.push("/usuario/novo");
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: COLORS.success,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                gap: 6,
              }}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Incluir</Text>
            </AnimatedPressable>
          </View>
        )}
      </View>

      {/* Search bar */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.divider,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            gap: 8,
          }}
        >
          <Search size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={(t) => {
              console.log("[GestaoUsuarios] Busca:", t);
              setSearch(t);
            }}
            placeholder="Buscar por nome, e-mail ou função..."
            placeholderTextColor={COLORS.textTertiary}
            style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text, padding: 0 }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar usuários
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.textSecondary,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
          <TouchableOpacity
            onPress={fetchUsuarios}
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
            }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
              Tentar novamente
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {filteredUsuarios.length === 0 ? (
            <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Users size={32} color={COLORS.primary} />
              </View>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                {emptyText}
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                }}
              >
                {emptySubText}
              </Text>
            </View>
          ) : (
            filteredUsuarios.map((item) => {
              const displayName = getDisplayName(item);
              const initials = getInitials(displayName || item.email);
              const roleLabel = getRoleLabel(item.role);
              const badgeColors = getRoleBadgeColor(item.role);
              const isSelected = selected.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  style={{
                    backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    shadowColor: "#000",
                    shadowOpacity: 0.06,
                    shadowRadius: 4,
                    elevation: 2,
                    borderWidth: 1,
                    borderColor: isSelected ? COLORS.primary : COLORS.border,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => {
                      if (selectMode) {
                        console.log("[GestaoUsuarios] Checkbox toggle (select mode):", item.id);
                        toggleSelect(item.id);
                      } else {
                        console.log("[GestaoUsuarios] Checkbox — entrar select mode:", item.id);
                        enterSelectMode(item.id);
                      }
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      borderWidth: 2,
                      borderColor: isSelected ? COLORS.primary : COLORS.border,
                      backgroundColor: isSelected ? COLORS.primary : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 10,
                    }}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.primary }}>
                      {initials}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}
                      numberOfLines={1}
                    >
                      {displayName || "Sem nome"}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}
                    >
                      {item.email}
                    </Text>
                    <View style={{ marginTop: 4 }}>
                      <View
                        style={{
                          alignSelf: "flex-start",
                          backgroundColor: badgeColors.bg,
                          borderRadius: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: badgeColors.text }}>
                          {roleLabel}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {!selectMode && (
                    <View onStartShouldSetResponder={() => true} style={{ gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoUsuarios] Editar pressionado:", item.id);
                          router.push(`/usuario/${item.id}`);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#007AFF",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 7,
                          gap: 4,
                        }}
                      >
                        <Ionicons name="pencil" size={14} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoUsuarios] Excluir pressionado:", item.id);
                          handleDelete(item.id, displayName);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FF3B30",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 7,
                          gap: 4,
                        }}
                      >
                        <Ionicons name="trash" size={14} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Excluir</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={confirmDialog.visible}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        destructive
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirm}
      />
    </SafeAreaView>
  );
}
