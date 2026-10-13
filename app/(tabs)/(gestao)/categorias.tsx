import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPost, apiPut, apiDelete } from "@/utils/api";
import { X, Tag, Search } from "lucide-react-native";

interface ApiCategoria {
  id: string;
  nome: string;
  descricao?: string;
}

export default function GestaoCategorias() {
  const COLORS = useColors();
  const router = useRouter();

  const [categorias, setCategorias] = useState<ApiCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<ApiCategoria | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

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

  const fetchCategorias = useCallback(async () => {
    console.log("[GestaoCategorias] GET /api/categorias");
    try {
      const res = await apiGet<any>("/api/categorias");
      const list: ApiCategoria[] = Array.isArray(res) ? res : (res.categorias || []);
      console.log("[GestaoCategorias] Carregadas", list.length, "categorias");
      setCategorias(list);
      setError("");
    } catch (e: unknown) {
      console.error("[GestaoCategorias] Erro:", e);
      setError("Não foi possível carregar as categorias.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("[GestaoCategorias] Tela focada — recarregando categorias");
      setLoading(true);
      fetchCategorias();
    }, [fetchCategorias])
  );

  const openCreate = () => {
    console.log("[GestaoCategorias] Abrir modal de criação");
    setEditingCat(null);
    setNome("");
    setDescricao("");
    setModalError("");
    setShowModal(true);
  };

  const openEdit = (c: ApiCategoria) => {
    console.log("[GestaoCategorias] Abrir modal de edição:", c.id);
    setEditingCat(c);
    setNome(c.nome);
    setDescricao(c.descricao ?? "");
    setModalError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) { setModalError("Nome é obrigatório."); return; }
    console.log("[GestaoCategorias] Salvar pressionado, editando:", editingCat?.id ?? "novo");
    setSaving(true);
    setModalError("");
    try {
      if (editingCat) {
        console.log("[GestaoCategorias] PUT /api/categorias/" + editingCat.id);
        await apiPut(`/api/categorias/${editingCat.id}`, { nome: nome.trim(), descricao: descricao.trim() || undefined });
        console.log("[GestaoCategorias] Categoria atualizada:", editingCat.id);
      } else {
        console.log("[GestaoCategorias] POST /api/categorias");
        await apiPost("/api/categorias", { nome: nome.trim(), descricao: descricao.trim() || undefined });
        console.log("[GestaoCategorias] Categoria criada");
      }
      setShowModal(false);
      await fetchCategorias();
    } catch (e: unknown) {
      console.error("[GestaoCategorias] Erro ao salvar:", e);
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, nomeCategoria: string) => {
    console.log("[GestaoCategorias] Confirmar exclusão:", id, nomeCategoria);
    setConfirmDialog({
      visible: true,
      title: "Excluir categoria?",
      message: `Deseja realmente excluir "${nomeCategoria}"?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        closeConfirm();
        console.log("[GestaoCategorias] DELETE /api/categorias/" + id);
        try {
          await apiDelete(`/api/categorias/${id}`);
          console.log("[GestaoCategorias] Categoria excluída:", id);
          setCategorias((prev) => prev.filter((c) => c.id !== id));
        } catch (e: unknown) {
          console.error("[GestaoCategorias] Erro ao excluir:", e);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    console.log("[GestaoCategorias] Toggle seleção:", id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log("[GestaoCategorias] Entrar modo seleção, item:", id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log("[GestaoCategorias] Sair modo seleção");
    setSelectMode(false);
    setSelected(new Set());
  };

  const doDelete = async (ids: string[]) => {
    console.log("[GestaoCategorias] Excluir em lote:", ids);
    setDeleting(true);
    for (const id of ids) {
      try {
        await apiDelete(`/api/categorias/${id}`);
        console.log("[GestaoCategorias] Categoria excluída:", id);
      } catch (e: unknown) {
        console.error("[GestaoCategorias] Erro ao excluir", id, ":", e);
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchCategorias();
  };

  const confirmBulkDelete = () => {
    if (selected.size === 0) return;
    console.log("[GestaoCategorias] Confirmar exclusão em lote:", selected.size, "itens");
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

  const searchLower = search.toLowerCase();
  const filteredCategorias = search.trim()
    ? categorias.filter(
        (c) =>
          c.nome.toLowerCase().includes(searchLower) ||
          (c.descricao ?? "").toLowerCase().includes(searchLower)
      )
    : categorias;

  const emptyText = search.trim() ? "Nenhum resultado encontrado" : "Nenhuma categoria";
  const emptySubText = search.trim() ? "Tente outro termo de busca" : "Toque em \"Incluir\" para criar categorias";

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
        {/* LEFT */}
        <View style={{ width: 80 }}>
          {selectMode ? (
            <TouchableOpacity onPress={exitSelectMode} style={{ paddingVertical: 8 }}>
              <Text style={{ color: "#007AFF", fontSize: 16, fontWeight: "500" }}>Cancelar</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoCategorias] Botão voltar pressionado");
                handleBack();
              }}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Ionicons name="chevron-back" size={26} color="#007AFF" />
              <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* CENTER */}
        <Text
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 17,
            fontWeight: "700",
            color: COLORS.text,
          }}
        >
          Categorias
        </Text>

        {/* RIGHT */}
        <View style={{ width: 80, alignItems: "flex-end" }}>
          {selectMode ? (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoCategorias] Botão excluir lote pressionado");
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
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Excluir ({selected.size})</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoCategorias] Botão incluir pressionado");
                openCreate();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: COLORS.success,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                gap: 4,
              }}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Incluir</Text>
            </TouchableOpacity>
          )}
        </View>
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
              console.log("[GestaoCategorias] Busca:", t);
              setSearch(t);
            }}
            placeholder="Buscar..."
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
          {[0, 1, 2].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar categorias
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
            onPress={fetchCategorias}
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
          {filteredCategorias.length === 0 ? (
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
                <Tag size={32} color={COLORS.primary} />
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
            filteredCategorias.map((item) => {
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
                        console.log("[GestaoCategorias] Checkbox toggle (select mode):", item.id);
                        toggleSelect(item.id);
                      } else {
                        console.log("[GestaoCategorias] Checkbox — entrar select mode:", item.id);
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
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Tag size={18} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text }}>
                      {item.nome}
                    </Text>
                    {item.descricao ? (
                      <Text
                        numberOfLines={1}
                        style={{
                          fontFamily: "Outfit_400Regular",
                          fontSize: 12,
                          color: COLORS.textSecondary,
                          marginTop: 2,
                        }}
                      >
                        {item.descricao}
                      </Text>
                    ) : null}
                  </View>
                  {!selectMode && (
                    <View onStartShouldSetResponder={() => true} style={{ gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoCategorias] Editar pressionado:", item.id);
                          openEdit(item);
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
                          console.log("[GestaoCategorias] Excluir pressionado:", item.id);
                          handleDelete(item.id, item.nome);
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

      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 20,
              padding: 24,
              width: "100%",
              maxWidth: 380,
              gap: 16,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                {editingCat ? "Editar Categoria" : "Nova Categoria"}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[GestaoCategorias] Modal fechado");
                  setShowModal(false);
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: COLORS.surfaceSecondary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} color={COLORS.textSecondary} />
              </AnimatedPressable>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Nome *</Text>
              <TextInput
                value={nome}
                onChangeText={setNome}
                placeholder="Ex: Entradas"
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
                autoFocus
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Descrição</Text>
              <TextInput
                value={descricao}
                onChangeText={setDescricao}
                placeholder="Descrição opcional"
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
              />
            </View>

            {modalError ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>
                {modalError}
              </Text>
            ) : null}

            <AnimatedPressable
              onPress={() => {
                console.log("[GestaoCategorias] Salvar categoria pressionado");
                handleSave();
              }}
              disabled={saving}
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 14,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                  {editingCat ? "Salvar alterações" : "Criar categoria"}
                </Text>
              )}
            </AnimatedPressable>
          </View>
        </View>
      </Modal>

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
