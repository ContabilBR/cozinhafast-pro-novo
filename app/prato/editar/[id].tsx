import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  Modal,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Prato, Categoria } from "@/types";
import { apiGet, apiPut, BACKEND_URL, getBearerToken } from "@/utils/api";
import { ChevronDown, Camera, Image as ImageIcon, UtensilsCrossed } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
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

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  const COLORS = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{label}</Text>
      {children}
    </View>
  );
}

export default function EditarPratoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const COLORS = useColors();
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [imagemUrl, setImagemUrl] = useState("");
  const [disponivel, setDisponivel] = useState(true);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    console.log("[EditarPrato] GET /api/pratos/" + id + " e /api/categorias");
    Promise.all([
      apiGet<any>(`/api/pratos/${id}`),
      apiGet<any>("/api/categorias"),
    ]).then(([pratoRes, catRes]) => {
      const p: Prato = pratoRes.prato || pratoRes;
      const cats: Categoria[] = Array.isArray(catRes) ? catRes : (catRes.categorias || []);
      console.log("[EditarPrato] Carregado prato:", p.nome, "categorias:", cats.length);
      setNome(p.nome ?? "");
      setDescricao(p.descricao ?? "");
      const precoRaw = p.preco != null ? Number(p.preco).toFixed(2).replace(".", ",") : "";
      setPreco(precoRaw);
      setCategoriaId(p.categoria_id ?? "");
      setImagemUrl(p.imagem_url ?? "");
      setDisponivel(p.disponivel ?? true);
      setCategorias(cats);
    }).catch((e) => {
      console.error("[EditarPrato] Erro:", e);
      setError("Não foi possível carregar o prato.");
    }).finally(() => setLoading(false));
  }, [id]);

  const selectedCat = categorias.find((c) => c.id === categoriaId);
  const selectedCatNome = selectedCat?.nome ?? "Selecionar categoria";

  const handleSave = async () => {
    const precoNum = parseFloat(preco.replace(",", "."));
    if (!nome.trim()) throw new Error("Nome obrigatório");
    if (isNaN(precoNum) || precoNum < 0) throw new Error("Preço inválido");
    console.log("[EditarPrato] PUT /api/pratos/" + id, "nome:", nome, "categoria_id:", categoriaId || null);
    const payload: any = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      preco: precoNum,
      disponivel,
      categoria_id: categoriaId || null,
    };
    if (imagemUrl.trim() && !localImageUri) payload.imagem_url = imagemUrl.trim();
    await apiPut(`/api/pratos/${id}`, payload);
    console.log("[EditarPrato] PUT concluído");
  };

  const handleSavePress = () => {
    console.log("[EditarPrato] Botão Salvar alterações pressionado");
    setShowSaveConfirm(true);
  };

  const confirmSave = async () => {
    console.log("[EditarPrato] Confirmação de salvar pressionada");
    setSaving(true);
    try {
      await handleSave();
      setShowSaveConfirm(false);
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        router.back();
      }, 1500);
    } catch (e) {
      console.error("[EditarPrato] Erro ao salvar:", e);
      setSaving(false);
      Alert.alert("Erro", "Não foi possível salvar o prato.");
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async (source: "camera" | "gallery") => {
    console.log("[EditarPrato] Selecionar imagem, fonte:", source);
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert("Permissão necessária", "Permita o acesso à câmera."); return; }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.8, base64: true });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert("Permissão necessária", "Permita o acesso à galeria."); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8, base64: true });
      }
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        console.log("[EditarPrato] Imagem selecionada:", asset.uri);
        setLocalImageUri(asset.uri);
      }
    } catch (e) {
      console.error("[EditarPrato] Erro no seletor de imagem:", e);
    }
  };

  const uploadFoto = async (): Promise<void> => {
    if (!localImageUri || !id) return;
    console.log("[EditarPrato] POST /api/pratos/" + id + "/foto (base64)");
    setUploading(true);
    try {
      const token = await getBearerToken();
      const ext = localImageUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = ext === "png" ? "image/png" : "image/jpeg";
      const base64 = await FileSystem.readAsStringAsync(localImageUri, { encoding: "base64" as any });
      const imagem_base64 = `data:${mimeType};base64,${base64}`;
      const res = await fetch(`${BACKEND_URL}/api/pratos/${id}/foto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ imagem_base64 }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        console.log("[EditarPrato] Upload de foto concluído, url:", data?.url);
      } else {
        const text = await res.text().catch(() => "");
        console.warn("[EditarPrato] Upload de foto falhou:", res.status, text.slice(0, 100));
      }
    } catch (e) {
      console.error("[EditarPrato] Erro no upload de foto:", e);
    } finally {
      setUploading(false);
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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <AnimatedPressable onPress={() => { console.log("[EditarPrato] Botão voltar pressionado (loading)"); router.back(); }} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingRight: 8 }}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
          </AnimatedPressable>
          <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text, height: 56, lineHeight: 56 }}>Editar Prato</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Fixed nav bar */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        height: 56,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        backgroundColor: COLORS.surface,
      }}>
        <AnimatedPressable
          onPress={() => { console.log("[EditarPrato] Botão voltar pressionado"); router.back(); }}
          style={{ flexDirection: "row", alignItems: "center", zIndex: 1, paddingVertical: 8, paddingRight: 8 }}
        >
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
          <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
        </AnimatedPressable>
        <Text style={{
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 17,
          fontWeight: "700",
          color: COLORS.text,
          height: 56,
          lineHeight: 56,
        }}>
          Editar Prato
        </Text>
      </View>

      {/* Scrollable form */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 16 }}
      >
        <FormField label="Nome *">
          <TextInput
            value={nome}
            onChangeText={setNome}
            placeholder="Nome do prato"
            placeholderTextColor={COLORS.textTertiary}
            style={inputStyle}
            autoCorrect={true}
            autoCapitalize="sentences"
            keyboardType="default"
          />
        </FormField>

        <FormField label="Descrição">
          <TextInput
            value={descricao}
            onChangeText={setDescricao}
            placeholder="Descrição"
            placeholderTextColor={COLORS.textTertiary}
            multiline
            numberOfLines={3}
            style={[inputStyle, { minHeight: 80, textAlignVertical: "top" }]}
            autoCorrect={true}
            autoCapitalize="sentences"
            keyboardType="default"
          />
        </FormField>

        <FormField label="Preço (R$) *">
          <CampoMoeda
            value={preco}
            onChangeText={setPreco}
            placeholder="0,00"
            placeholderTextColor={COLORS.textTertiary}
            style={inputStyle}
          />
        </FormField>

        <FormField label="Categoria">
          <TouchableOpacity
            onPress={() => { console.log("[EditarPrato] Abrir modal de categoria"); setShowCatModal(true); }}
            style={[inputStyle, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            activeOpacity={0.7}
          >
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: selectedCat ? COLORS.text : COLORS.textTertiary }}>
              {selectedCatNome}
            </Text>
            <ChevronDown size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </FormField>

        <FormField label="URL da imagem">
          <TextInput
            value={imagemUrl}
            onChangeText={(t) => { console.log("[EditarPrato] imagem_url alterada"); setImagemUrl(t); setLocalImageUri(null); }}
            placeholder="https://exemplo.com/imagem.jpg"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={inputStyle}
          />
          {imagemUrl.trim() && !localImageUri ? (
            <View style={{ width: "100%", height: 200, borderRadius: 12, overflow: "hidden", backgroundColor: COLORS.surfaceSecondary, marginTop: 8 }}>
              <Image source={resolveImageSource(imagemUrl)} style={{ width: "100%", height: "100%" }} contentFit="cover" />
              <AnimatedPressable
                onPress={() => { console.log("[EditarPrato] Remover URL pressionado"); setImagemUrl(""); }}
                style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </AnimatedPressable>
            </View>
          ) : null}
        </FormField>

        <FormField label="Foto do prato (câmera/galeria)">
          <View style={{ gap: 10 }}>
            {localImageUri ? (
              <View style={{ width: "100%", height: 200, borderRadius: 12, overflow: "hidden", backgroundColor: COLORS.surfaceSecondary }}>
                <Image source={resolveImageSource(localImageUri)} style={{ width: "100%", height: 200 }} contentFit="cover" />
                <AnimatedPressable
                  onPress={() => { console.log("[EditarPrato] Remover foto pressionado"); setLocalImageUri(null); }}
                  style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </AnimatedPressable>
                <View style={{ position: "absolute", bottom: 8, left: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: "#fff" }}>Nova foto selecionada</Text>
                </View>
              </View>
            ) : imagemUrl.trim() ? null : (
              <View style={{ width: "100%", height: 200, borderRadius: 12, backgroundColor: COLORS.surfaceSecondary, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", gap: 6 }}>
                <UtensilsCrossed size={28} color={COLORS.textTertiary} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textTertiary }}>Sem imagem</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <AnimatedPressable
                onPress={() => { console.log("[EditarPrato] Câmera pressionada"); pickImage("camera"); }}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.surface, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border }}
              >
                <Camera size={18} color={COLORS.primary} />
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}>Tirar Foto</Text>
              </AnimatedPressable>
              <AnimatedPressable
                onPress={() => { console.log("[EditarPrato] Galeria pressionada"); pickImage("gallery"); }}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.surface, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border }}
              >
                <ImageIcon size={18} color={COLORS.primary} />
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.primary }}>Galeria</Text>
              </AnimatedPressable>
            </View>
            {localImageUri ? (
              <AnimatedPressable
                onPress={() => { console.log("[EditarPrato] Upload de foto pressionado"); uploadFoto(); }}
                disabled={uploading}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12, opacity: uploading ? 0.7 : 1 }}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: "#fff" }}>Enviar foto</Text>
                )}
              </AnimatedPressable>
            ) : null}
          </View>
        </FormField>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>Disponível</Text>
          <Switch
            value={disponivel}
            onValueChange={(val) => { console.log("[EditarPrato] Disponível alternado:", val); setDisponivel(val); }}
            trackColor={{ false: COLORS.border, true: COLORS.primary + "80" }}
            thumbColor={disponivel ? COLORS.primary : COLORS.textTertiary}
          />
        </View>

        {error ? (
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger, textAlign: "center" }}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* Fixed bottom save button */}
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border }}>
        <AnimatedPressable
          onPress={handleSavePress}
          style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Salvar alterações</Text>
        </AnimatedPressable>
      </View>

      {/* Category Modal */}
      <Modal visible={showCatModal} transparent animationType="slide" onRequestClose={() => setShowCatModal(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
          activeOpacity={1}
          onPress={() => { console.log("[EditarPrato] Modal categoria fechado (overlay)"); setShowCatModal(false); }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={{ backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 }}>
              <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border }} />
              </View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, paddingHorizontal: 20, paddingVertical: 14 }}>
                Categoria
              </Text>
              <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                {categorias.length === 0 ? (
                  <View style={{ padding: 24, alignItems: "center" }}>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Nenhuma categoria disponível</Text>
                  </View>
                ) : (
                  categorias.map((cat) => {
                    const isSelected = categoriaId === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        onPress={() => {
                          console.log("[EditarPrato] Categoria selecionada:", cat.nome, cat.id);
                          setCategoriaId(cat.id);
                          setShowCatModal(false);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingHorizontal: 20,
                          paddingVertical: 16,
                          borderBottomWidth: 1,
                          borderBottomColor: COLORS.border,
                          backgroundColor: isSelected ? COLORS.primaryMuted : "transparent",
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontFamily: isSelected ? "Outfit_600SemiBold" : "Outfit_400Regular", fontSize: 15, color: isSelected ? COLORS.primary : COLORS.text }}>
                          {cat.nome}
                        </Text>
                        {isSelected ? <Ionicons name="checkmark" size={18} color={COLORS.primary} /> : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
              <TouchableOpacity
                onPress={() => { console.log("[EditarPrato] Modal categoria cancelado"); setShowCatModal(false); }}
                style={{ marginHorizontal: 20, marginTop: 12, height: 48, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" }}
                activeOpacity={0.7}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.textSecondary }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Save confirmation modal */}
      <Modal visible={showSaveConfirm} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, width: "100%", gap: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, textAlign: "center" }}>Salvar alterações?</Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>As alterações feitas neste prato serão salvas.</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity
                onPress={() => { console.log("[EditarPrato] Confirmação de salvar cancelada"); setShowSaveConfirm(false); }}
                style={{ flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: COLORS.textSecondary, fontWeight: "600" }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmSave}
                style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" }}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Salvar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success modal */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 32, width: "100%", alignItems: "center", gap: 12 }}>
            <Text style={{ fontSize: 40 }}>✅</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text }}>Prato salvo!</Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>As alterações foram gravadas com sucesso.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
