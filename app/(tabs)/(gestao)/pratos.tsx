import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Modal,
  TextInput,
  Switch,
  ScrollView,
  Platform,
  TouchableOpacity,
  KeyboardAvoidingView,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPost, apiPut, apiDelete, BACKEND_URL, getBearerToken } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { X, UtensilsCrossed, Camera, Image as ImageIcon, ChevronDown, Search } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import type { ImageSourcePropType } from "react-native";
import { CampoMoeda } from "@/components/CampoMoeda";

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") {
    if (!source.startsWith("http") && !source.startsWith("file") && !source.startsWith("data:")) {
      return { uri: `data:image/jpeg;base64,${source}` };
    }
    return { uri: source };
  }
  return source as ImageSourcePropType;
}

interface ApiPrato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  imagem_url?: string;
  disponivel?: boolean;
  tempoPreparoMinutos?: number | null;
  categoria_id?: string;
  categoria?: { id: string; nome: string };
}

interface ApiCategoria {
  id: string;
  nome: string;
}

export default function GestaoPratos() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;

  const [pratos, setPratos] = useState<ApiPrato[]>([]);
  const [categorias, setCategorias] = useState<ApiCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingPrato, setEditingPrato] = useState<ApiPrato | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [disponivel, setDisponivel] = useState(true);
  const [tempoPreparo, setTempoPreparo] = useState("");
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [imagemUrl, setImagemUrl] = useState("");
  const [imagemUrlInput, setImagemUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [showCatPicker, setShowCatPicker] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const showDeleteFeedback = () => {
    setShowDeleteSuccess(true);
    setTimeout(() => setShowDeleteSuccess(false), 1500);
  };

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

  const formatPreco = (value: string): string => {
    const num = parseFloat(value.replace(",", "."));
    if (isNaN(num)) return value;
    return num.toFixed(2).replace(".", ",");
  };

  const fetchData = useCallback(async () => {
    console.log("[GestaoPratos] GET /api/pratos e /api/categorias");
    try {
      const [pratosRes, catRes] = await Promise.all([
        apiGet<any>("/api/pratos"),
        apiGet<any>("/api/categorias"),
      ]);
      const pratoList: ApiPrato[] = Array.isArray(pratosRes) ? pratosRes : (pratosRes.pratos || []);
      const catList: ApiCategoria[] = Array.isArray(catRes) ? catRes : (catRes.categorias || []);
      catList.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
      console.log("[GestaoPratos] Carregados", pratoList.length, "pratos,", catList.length, "categorias");
      setPratos(pratoList);
      setCategorias(catList);
      setError("");
    } catch (e: unknown) {
      console.error("[GestaoPratos] Erro ao carregar:", e);
      setError("Não foi possível carregar os pratos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("[GestaoPratos] Tela focada — recarregando pratos");
      setLoading(true);
      fetchData();
    }, [fetchData])
  );

  const openCreate = () => {
    console.log("[GestaoPratos] Abrir modal de criação");
    setEditingPrato(null);
    setNome("");
    setDescricao("");
    setPreco("");
    setCategoriaId("");
    setDisponivel(true);
    setTempoPreparo("");
    setLocalImageUri(null);
    setImagemUrl("");
    setImagemUrlInput("");
    setModalError("");
    setShowCatPicker(false);
    setShowModal(true);
  };

  const openEdit = (p: ApiPrato) => {
    console.log("[GestaoPratos] Abrir modal de edição:", p.id);
    setEditingPrato(p);
    setNome(p.nome ?? "");
    setDescricao(p.descricao ?? "");
    setPreco(p.preco != null ? Number(p.preco).toFixed(2).replace(".", ",") : "");
    setCategoriaId(p.categoria_id ?? "");
    setDisponivel(p.disponivel !== false);
    setTempoPreparo(p.tempoPreparoMinutos != null ? String(p.tempoPreparoMinutos) : "");
    setLocalImageUri(null);
    setImagemUrl(p.imagem_url ?? "");
    setImagemUrlInput(p.imagem_url ?? "");
    setModalError("");
    setShowCatPicker(false);
    setShowModal(true);
  };

  const pickImage = async (source: "camera" | "gallery") => {
    console.log("[GestaoPratos] Selecionar imagem, fonte:", source);
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        result = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.8 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8 });
      }
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        console.log("[GestaoPratos] Imagem selecionada:", asset.uri);
        setLocalImageUri(asset.uri);
      }
    } catch (e) {
      console.error("[GestaoPratos] Erro no seletor de imagem:", e);
    }
  };

  const uploadFoto = async (pratoId: string): Promise<void> => {
    if (!localImageUri) return;
    console.log("[GestaoPratos] POST /api/pratos/" + pratoId + "/foto");
    setUploading(true);
    try {
      const token = await getBearerToken();
      const formData = new FormData();
      const ext = localImageUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      formData.append("file", { uri: localImageUri, name: `foto.${ext}`, type: mimeType } as any);
      const res = await fetch(`${BACKEND_URL}/api/pratos/${pratoId}/foto`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      });
      if (res.ok) {
        console.log("[GestaoPratos] Upload de foto concluído:", pratoId);
      } else {
        const text = await res.text().catch(() => "");
        console.warn("[GestaoPratos] Upload de foto falhou:", res.status, text.slice(0, 100));
      }
    } catch (e) {
      console.error("[GestaoPratos] Erro no upload de foto:", e);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!nome.trim()) { setModalError("Nome é obrigatório."); return; }
    const precoNum = parseFloat(preco.replace(",", "."));
    if (isNaN(precoNum) || precoNum < 0) { setModalError("Preço inválido."); return; }
    let tempoPreparoNum: number | null = null;
    if (tempoPreparo.trim()) {
      tempoPreparoNum = parseInt(tempoPreparo.trim(), 10);
      if (isNaN(tempoPreparoNum) || tempoPreparoNum < 0) { setModalError("Tempo de preparo inválido."); return; }
    }
    console.log("[GestaoPratos] Salvar pressionado, editando:", editingPrato?.id ?? "novo");
    setSaving(true);
    setModalError("");
    try {
      const payload: Record<string, unknown> = {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        preco: precoNum,
        disponivel,
        tempoPreparoMinutos: tempoPreparoNum,
      };
      if (categoriaId) payload.categoria_id = categoriaId;
      if (imagemUrlInput.trim() && !localImageUri) payload.imagem_url = imagemUrlInput.trim();

      if (editingPrato) {
        console.log("[GestaoPratos] PUT /api/pratos/" + editingPrato.id);
        await apiPut(`/api/pratos/${editingPrato.id}`, payload);
        console.log("[GestaoPratos] Prato atualizado:", editingPrato.id);
        if (localImageUri) await uploadFoto(editingPrato.id);
      } else {
        console.log("[GestaoPratos] POST /api/pratos");
        const res = await apiPost<any>("/api/pratos", payload);
        const pratoId = res?.prato?.id || res?.id;
        console.log("[GestaoPratos] Prato criado com sucesso:", pratoId);
        if (pratoId && localImageUri) await uploadFoto(pratoId);
      }
      setShowModal(false);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
      await fetchData();
    } catch (e: unknown) {
      console.error("[GestaoPratos] Erro ao salvar:", e);
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar o prato.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, nomePrato: string) => {
    console.log("[GestaoPratos] Confirmar exclusão:", id, nomePrato);
    setConfirmDialog({
      visible: true,
      title: "Excluir prato?",
      message: `Deseja realmente excluir "${nomePrato}"?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        closeConfirm();
        console.log("[GestaoPratos] DELETE /api/pratos/" + id);
        try {
          await apiDelete(`/api/pratos/${id}`);
          console.log("[GestaoPratos] Prato excluído:", id);
          setPratos((prev) => prev.filter((p) => p.id !== id));
          showDeleteFeedback();
        } catch (e: unknown) {
          console.error("[GestaoPratos] Erro ao excluir:", e);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    console.log("[GestaoPratos] Toggle seleção:", id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log("[GestaoPratos] Entrar modo seleção, item:", id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log("[GestaoPratos] Sair modo seleção");
    setSelectMode(false);
    setSelected(new Set());
  };

  const doDelete = async (ids: string[]) => {
    console.log("[GestaoPratos] Excluir em lote:", ids);
    setDeleting(true);
    for (const id of ids) {
      try {
        await apiDelete(`/api/pratos/${id}`);
        console.log("[GestaoPratos] Prato excluído:", id);
      } catch (e: unknown) {
        console.error("[GestaoPratos] Erro ao excluir", id, ":", e);
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchData();
    showDeleteFeedback();
  };

  const confirmBulkDelete = () => {
    if (selected.size === 0) return;
    console.log("[GestaoPratos] Confirmar exclusão em lote:", selected.size, "itens");
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

  const selectedCat = categorias.find((c) => c.id === categoriaId);

  const searchLower = search.toLowerCase();
  const filteredPratos = search.trim()
    ? pratos.filter(
        (p) =>
          p.nome.toLowerCase().includes(searchLower) ||
          (p.categoria?.nome ?? "").toLowerCase().includes(searchLower)
      )
    : pratos;

  const emptyText = search.trim() ? "Nenhum resultado encontrado" : "Nenhum prato cadastrado";
  const emptySubText = search.trim() ? "Tente outro termo de busca" : "Toque em \"Incluir\" para adicionar pratos";

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
                console.log("[GestaoPratos] Botão voltar pressionado");
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
          Pratos
        </Text>

        {/* RIGHT */}
        <View style={{ width: 80, alignItems: "flex-end" }}>
          {selectMode ? (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoPratos] Botão excluir lote pressionado");
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
                console.log("[GestaoPratos] Botão incluir pressionado");
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
              console.log("[GestaoPratos] Busca:", t);
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
            Erro ao carregar pratos
          </Text>
          <TouchableOpacity
            onPress={fetchData}
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
          contentContainerStyle={{ padding: 12, paddingBottom: listPaddingBottom }}
          showsVerticalScrollIndicator={false}
        >
          {filteredPratos.length === 0 ? (
            <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
              <UtensilsCrossed size={32} color={COLORS.textTertiary} />
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
            filteredPratos.map((item) => {
              const price = formatCurrency(item.preco);
              const imgSrc = resolveImageSource(item.imagem_url);
              const disponibilidade = item.disponivel !== false;
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
                        console.log("[GestaoPratos] Checkbox toggle (select mode):", item.id);
                        toggleSelect(item.id);
                      } else {
                        console.log("[GestaoPratos] Checkbox — entrar select mode:", item.id);
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
                      width: 64,
                      height: 64,
                      borderRadius: 10,
                      backgroundColor: COLORS.surfaceSecondary,
                      marginRight: 12,
                      overflow: "hidden",
                    }}
                  >
                    {item.imagem_url ? (
                      <Image source={imgSrc} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <UtensilsCrossed size={20} color={COLORS.textTertiary} />
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>{item.nome}</Text>
                    <Text style={{ fontSize: 14, color: COLORS.primary, fontWeight: "700", marginTop: 2 }}>
                      {price}
                    </Text>
                    {item.categoria && (
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                        {item.categoria.nome}
                      </Text>
                    )}
                    {!disponibilidade && (
                      <Text style={{ fontSize: 11, color: COLORS.danger, marginTop: 2 }}>Indisponível</Text>
                    )}
                  </View>
                  {!selectMode && (
                    <View onStartShouldSetResponder={() => true} style={{ gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoPratos] Editar pressionado:", item.id);
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
                          console.log("[GestaoPratos] Excluir pressionado:", item.id);
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

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: "92%",
              flex: 1,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 20,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.border,
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                {editingPrato ? "Editar Prato" : "Novo Prato"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log("[GestaoPratos] Modal fechado");
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
              </TouchableOpacity>
            </View>

            {/* Scrollable form */}
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 20, gap: 16 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* URL da imagem */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    URL da imagem
                  </Text>
                  <TextInput
                    value={imagemUrlInput}
                    onChangeText={(t) => {
                      console.log("[GestaoPratos] imagem_url alterada");
                      setImagemUrlInput(t);
                      setLocalImageUri(null);
                    }}
                    placeholder="https://exemplo.com/imagem.jpg"
                    placeholderTextColor={COLORS.textTertiary}
                    autoCapitalize="none"
                    keyboardType="url"
                    style={inputStyle}
                  />
                  {imagemUrlInput.trim() && !localImageUri ? (
                    <View
                      style={{
                        height: 120,
                        borderRadius: 12,
                        overflow: "hidden",
                        backgroundColor: COLORS.surfaceSecondary,
                      }}
                    >
                      <Image
                        source={resolveImageSource(imagemUrlInput)}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                      />
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoPratos] Remover URL pressionado");
                          setImagemUrlInput("");
                        }}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          backgroundColor: "rgba(0,0,0,0.5)",
                          borderRadius: 14,
                          width: 28,
                          height: 28,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="close" size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {/* Foto câmera/galeria */}
                <View style={{ gap: 8 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Foto (câmera/galeria)
                  </Text>
                  {localImageUri ? (
                    <View
                      style={{
                        height: 120,
                        borderRadius: 12,
                        overflow: "hidden",
                        backgroundColor: COLORS.surfaceSecondary,
                      }}
                    >
                      <Image
                        source={resolveImageSource(localImageUri)}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                      />
                      {uploading && (
                        <View
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: "rgba(0,0,0,0.4)",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <ActivityIndicator color="#fff" />
                          <Text
                            style={{
                              fontFamily: "Outfit_400Regular",
                              fontSize: 12,
                              color: "#fff",
                              marginTop: 6,
                            }}
                          >
                            Enviando...
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoPratos] Remover foto pressionado");
                          setLocalImageUri(null);
                        }}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          backgroundColor: "rgba(0,0,0,0.5)",
                          borderRadius: 14,
                          width: 28,
                          height: 28,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="close" size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View
                      style={{
                        height: 72,
                        borderRadius: 12,
                        backgroundColor: COLORS.surfaceSecondary,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <UtensilsCrossed size={20} color={COLORS.textTertiary} />
                      <Text
                        style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textTertiary }}
                      >
                        Nenhuma foto
                      </Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => {
                        console.log("[GestaoPratos] Câmera pressionada");
                        pickImage("camera");
                      }}
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        backgroundColor: COLORS.surfaceSecondary,
                        borderRadius: 12,
                        paddingVertical: 10,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                      }}
                    >
                      <Camera size={16} color={COLORS.primary} />
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>
                        Câmera
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        console.log("[GestaoPratos] Galeria pressionada");
                        pickImage("gallery");
                      }}
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        backgroundColor: COLORS.surfaceSecondary,
                        borderRadius: 12,
                        paddingVertical: 10,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                      }}
                    >
                      <ImageIcon size={16} color={COLORS.primary} />
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>
                        Galeria
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Nome */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Nome *
                  </Text>
                  <TextInput
                    value={nome}
                    onChangeText={(t) => { setNome(t); setModalError(""); }}
                    placeholder="Ex: Frango Grelhado"
                    placeholderTextColor={COLORS.textTertiary}
                    style={inputStyle}
                  />
                </View>

                {/* Descrição */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Descrição
                  </Text>
                  <TextInput
                    value={descricao}
                    onChangeText={setDescricao}
                    placeholder="Descrição do prato"
                    placeholderTextColor={COLORS.textTertiary}
                    multiline
                    numberOfLines={3}
                    style={[inputStyle, { minHeight: 80, textAlignVertical: "top" }]}
                  />
                </View>

                {/* Preço */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Preço (R$) *
                  </Text>
                  <CampoMoeda
                    value={preco}
                    onChangeText={(t) => { setPreco(t); setModalError(""); }}
                    placeholder="0,00"
                    placeholderTextColor={COLORS.textTertiary}
                    style={inputStyle}
                  />
                </View>

                {/* Tempo de preparo */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Tempo de preparo (minutos)
                  </Text>
                  <TextInput
                    value={tempoPreparo}
                    onChangeText={(t) => { setTempoPreparo(t.replace(/[^0-9]/g, "")); setModalError(""); }}
                    placeholder="Ex: 15 — usado pra alertar a cozinha se passar do prazo"
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType="number-pad"
                    style={inputStyle}
                  />
                </View>

                {/* Categoria */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Categoria
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      console.log("[GestaoPratos] Seletor de categoria alternado");
                      setShowCatPicker((v) => !v);
                    }}
                    style={[inputStyle, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
                  >
                    <Text
                      style={{
                        fontFamily: "Outfit_400Regular",
                        fontSize: 15,
                        color: selectedCat ? COLORS.text : COLORS.textTertiary,
                      }}
                    >
                      {selectedCat?.nome ?? "Selecionar categoria"}
                    </Text>
                    <ChevronDown size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  {showCatPicker && (
                    <View
                      style={{
                        backgroundColor: COLORS.surface,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        overflow: "hidden",
                      }}
                    >
                      {categorias.length === 0 ? (
                        <View style={{ padding: 14 }}>
                          <Text
                            style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}
                          >
                            Nenhuma categoria
                          </Text>
                        </View>
                      ) : (
                        categorias.map((cat) => (
                          <TouchableOpacity
                            key={cat.id}
                            onPress={() => {
                              console.log("[GestaoPratos] Categoria selecionada:", cat.nome);
                              setCategoriaId(cat.id);
                              setShowCatPicker(false);
                            }}
                            style={{
                              padding: 14,
                              borderBottomWidth: 1,
                              borderBottomColor: COLORS.border,
                              backgroundColor: categoriaId === cat.id ? COLORS.primaryMuted : "transparent",
                            }}
                          >
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text }}>
                              {cat.nome}
                            </Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  )}
                </View>

                {/* Disponível */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: COLORS.surfaceSecondary,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                    Disponível
                  </Text>
                  <Switch
                    value={disponivel}
                    onValueChange={(v) => {
                      console.log("[GestaoPratos] Disponível alternado:", v);
                      setDisponivel(v);
                    }}
                    trackColor={{ false: COLORS.border, true: COLORS.primary + "80" }}
                    thumbColor={disponivel ? COLORS.primary : COLORS.textTertiary}
                  />
                </View>

                {modalError ? (
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>
                    {modalError}
                  </Text>
                ) : null}
              </ScrollView>
            </KeyboardAvoidingView>

            {/* Fixed Save button — always visible */}
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 32,
                borderTopWidth: 1,
                borderTopColor: COLORS.border,
                backgroundColor: COLORS.surface,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  console.log("[GestaoPratos] Salvar prato pressionado");
                  handleSave();
                }}
                disabled={saving || uploading}
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 14,
                  height: 52,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: saving || uploading ? 0.7 : 1,
                }}
              >
                {saving || uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                    {editingPrato ? "Salvar alterações" : "Adicionar prato"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
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

      <Modal transparent visible={showDeleteSuccess} animationType="fade">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 20,
            padding: 32,
            alignItems: 'center',
            gap: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 10,
            minWidth: 240,
          }}>
            <Text style={{ fontSize: 48 }}>✅</Text>
            <Text style={{
              fontFamily: 'Outfit_700Bold',
              fontSize: 17,
              color: COLORS.text,
              textAlign: 'center',
            }}>
              {'Prato(s) excluído(s)\ncom sucesso!'}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showSaveSuccess} animationType="fade">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <View style={{
            backgroundColor: COLORS.surface,
            borderRadius: 20,
            padding: 32,
            alignItems: 'center',
            gap: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 10,
            minWidth: 240,
          }}>
            <Text style={{ fontSize: 48 }}>✅</Text>
            <Text style={{
              fontFamily: 'Outfit_700Bold',
              fontSize: 17,
              color: COLORS.text,
              textAlign: 'center',
            }}>
              Prato salvo com sucesso!
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
