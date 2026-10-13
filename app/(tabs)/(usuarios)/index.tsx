import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet, apiPost, apiPut, apiDelete } from "@/utils/api";
import { getRoleLabel, getInitials } from "@/utils/helpers";
import { Users, Plus, Pencil, Trash2, X, ChevronDown } from "lucide-react-native";

interface ApiUser {
  id: string;
  nome?: string;
  name?: string;
  email: string;
  role: string;
}

const ROLE_COLORS: Record<string, string> = {
  garcom: "#3B82F6",
  administrador: "#EF4444",
  admin: "#EF4444",
  gerente: "#8B5CF6",
  cozinheiro: "#F59E0B",
};

type RoleOption = "garcom" | "cozinheiro" | "gerente" | "administrador";
const ROLES: RoleOption[] = ["garcom", "cozinheiro", "gerente", "administrador"];

function getUserDisplayName(user: ApiUser): string {
  return user.nome || user.name || "";
}

function UserCard({
  user,
  index,
  onEdit,
  onDelete,
  canManage,
}: {
  user: ApiUser;
  index: number;
  onEdit: (u: ApiUser) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const roleColor = ROLE_COLORS[user.role] || COLORS.textSecondary;
  const displayName = getUserDisplayName(user);
  const initials = getInitials(displayName || user.email);
  const roleLabel = getRoleLabel(user.role);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          padding: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: COLORS.border,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: roleColor + "20",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: roleColor }}>
            {initials}
          </Text>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>
            {displayName || "Sem nome"}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
            {user.email}
          </Text>
          <View
            style={{
              backgroundColor: roleColor + "20",
              borderRadius: 6,
              paddingHorizontal: 7,
              paddingVertical: 2,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: roleColor }}>
              {roleLabel}
            </Text>
          </View>
        </View>

        {canManage && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AnimatedPressable
              onPress={() => {
                console.log("[Usuarios] Edit pressed:", user.id);
                onEdit(user);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Pencil size={16} color={COLORS.textSecondary} />
            </AnimatedPressable>
            <AnimatedPressable
              onPress={() => {
                console.log("[Usuarios] Delete pressed:", user.id);
                onDelete(user.id);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: COLORS.danger + "15",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trash2 size={16} color={COLORS.danger} />
            </AnimatedPressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export default function UsuariosScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user: authUser } = useAuth();

  const role = authUser?.role ?? "";
  const canManage = role === "admin" || role === "administrador" || role === "gerente";

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleOption>("garcom");
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const fetchUsers = useCallback(async () => {
    console.log("[Usuarios] Fetching users from /api/usuarios");
    try {
      const res = await apiGet<any>("/api/usuarios");
      const list: ApiUser[] = Array.isArray(res) ? res : (res.data || res.usuarios || res.users || []);
      console.log("[Usuarios] Loaded", list.length, "users");
      setUsers(list);
      setError("");
    } catch (e: any) {
      console.error("[Usuarios] Error:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRefresh = () => {
    console.log("[Usuarios] Manual refresh");
    setRefreshing(true);
    fetchUsers();
  };

  const openCreate = () => {
    console.log("[Usuarios] Open create modal");
    setEditingUser(null);
    setNome("");
    setEmail("");
    setSenha("");
    setSelectedRole("garcom");
    setModalError("");
    setShowModal(true);
  };

  const openEdit = (u: ApiUser) => {
    console.log("[Usuarios] Open edit modal:", u.id);
    setEditingUser(u);
    setNome(getUserDisplayName(u));
    setEmail(u.email ?? "");
    setSenha("");
    setSelectedRole((u.role as RoleOption) ?? "garcom");
    setModalError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) { setModalError("Nome é obrigatório."); return; }
    if (!editingUser && !email.trim()) { setModalError("E-mail é obrigatório."); return; }
    if (!editingUser && !senha.trim()) { setModalError("Senha é obrigatória."); return; }
    console.log("[Usuarios] Save pressed, editingUser:", editingUser?.id ?? "new", "role:", selectedRole);
    setSaving(true);
    setModalError("");
    try {
      if (editingUser) {
        const payload: any = { nome: nome.trim(), email: email.trim(), role: selectedRole };
        if (senha.trim()) payload.senha = senha;
        await apiPut(`/api/usuarios/${editingUser.id}`, payload);
        console.log("[Usuarios] User updated:", editingUser.id);
      } else {
        await apiPost("/api/usuarios", {
          nome: nome.trim(),
          email: email.trim(),
          senha: senha,
          role: selectedRole,
        });
        console.log("[Usuarios] User created");
      }
      setShowModal(false);
      await fetchUsers();
    } catch (e: any) {
      console.error("[Usuarios] Save error:", e);
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar o usuário.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    console.log("[Usuarios] Delete user:", id);
    try {
      await apiDelete(`/api/usuarios/${id}`);
      console.log("[Usuarios] User deleted:", id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      console.error("[Usuarios] Delete error:", e);
    }
  };

  const inputStyle = {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    fontFamily: "Outfit_400Regular" as const,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
          Usuários
        </Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
          {users.length} cadastrados
        </Text>
      </View>

      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar usuários
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
            {error}
          </Text>
          <AnimatedPressable
            onPress={fetchUsers}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
              Tentar novamente
            </Text>
          </AnimatedPressable>
        </View>
      ) : (
        <FlatList
          data={users}
          renderItem={({ item, index }) => (
            <UserCard user={item} index={index} onEdit={openEdit} onDelete={handleDelete} canManage={canManage} />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: listPaddingBottom }}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
          ListEmptyComponent={
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
                Nenhum usuário encontrado
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                Adicione usuários para gerenciar o acesso
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — only for admins/gerentes */}
      {canManage && (
        <AnimatedPressable
          onPress={openCreate}
          style={{
            position: "absolute",
            bottom: insets.bottom + 90,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: COLORS.primary,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(232, 82, 26, 0.4)",
          }}
        >
          <Plus size={24} color="#fff" />
        </AnimatedPressable>
      )}

      {/* Modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 400, gap: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                {editingUser ? "Editar Usuário" : "Novo Usuário"}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[Usuarios] Modal closed");
                  setShowModal(false);
                }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}
              >
                <X size={16} color={COLORS.textSecondary} />
              </AnimatedPressable>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Nome *</Text>
              <TextInput
                value={nome}
                onChangeText={setNome}
                placeholder="Nome completo"
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
                autoFocus
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                E-mail {editingUser ? "" : "*"}
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="email@exemplo.com"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                style={inputStyle}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {editingUser ? "Nova senha (opcional)" : "Senha *"}
              </Text>
              <PasswordInput
                value={senha}
                onChangeText={setSenha}
                placeholder={editingUser ? "Deixe em branco para manter" : "Senha"}
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Função</Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[Usuarios] Role picker toggled");
                  setShowRolePicker((v) => !v);
                }}
                style={[inputStyle, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
              >
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text }}>
                  {getRoleLabel(selectedRole)}
                </Text>
                <ChevronDown size={16} color={COLORS.textSecondary} />
              </AnimatedPressable>
              {showRolePicker && (
                <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" }}>
                  {ROLES.map((r) => (
                    <AnimatedPressable
                      key={r}
                      onPress={() => {
                        console.log("[Usuarios] Role selected:", r);
                        setSelectedRole(r);
                        setShowRolePicker(false);
                      }}
                      style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.divider, backgroundColor: selectedRole === r ? COLORS.primaryMuted : "transparent" }}
                    >
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }}>
                        {getRoleLabel(r)}
                      </Text>
                    </AnimatedPressable>
                  ))}
                </View>
              )}
            </View>

            {modalError ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>
                {modalError}
              </Text>
            ) : null}

            <AnimatedPressable
              onPress={handleSave}
              disabled={saving}
              style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                  {editingUser ? "Salvar alterações" : "Criar usuário"}
                </Text>
              )}
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
