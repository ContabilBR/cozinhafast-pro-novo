import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Category } from "@/types";
import { apiGet, apiPost } from "@/utils/api";
import { UtensilsCrossed } from "lucide-react-native";
import type { ImageSourcePropType } from "react-native";
import { CampoMoeda } from "@/components/CampoMoeda";

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

function FormField({
  label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize, autoCorrect, moeda,
}: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; multiline?: boolean; keyboardType?: any; autoCapitalize?: any; autoCorrect?: boolean; moeda?: boolean;
}) {
  const COLORS = useColors();
  const Campo: any = moeda ? CampoMoeda : TextInput;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{label}</Text>
      <Campo
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textTertiary}
        multiline={multiline}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={autoCorrect ?? true}
        style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14, fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text, minHeight: multiline ? 80 : 52, textAlignVertical: multiline ? "top" : "center" }}
      />
    </View>
  );
}

export default function NewDishScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();

  const role = (user as any)?.role;
  const canEdit = role === "administrador" || role === "gerente";

  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [prepTime, setPrepTime] = useState("15");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canEdit) {
      console.log("[NewDish] Sem permissão, voltando");
      router.back();
      return;
    }
    console.log("[NewDish] GET /api/categories");
    apiGet<any>("/api/categories")
      .then((res) => {
        const list: Category[] = Array.isArray(res) ? res : (res.categories || []);
        console.log("[NewDish] Carregadas", list.length, "categorias");
        setCategories(list);
      })
      .catch((e) => console.error("[NewDish] Erro ao carregar categorias:", e));
  }, [canEdit, router]);

  const handleSave = async () => {
    if (!name.trim()) { setError("Nome é obrigatório."); return; }
    if (!price.trim() || isNaN(Number(price.replace(",", ".")))) { setError("Preço inválido."); return; }
    console.log("[NewDish] Criar prato pressionado:", name);
    setError("");
    setSubmitting(true);
    try {
      console.log("[NewDish] POST /api/dishes");
      await apiPost("/api/dishes", {
        name: name.trim(),
        description: description.trim() || undefined,
        price: Number(price.replace(",", ".")),
        prep_time_minutes: Number(prepTime) || 15,
        image_url: imageUrl.trim() || undefined,
        category_id: categoryId || undefined,
        active,
      });
      console.log("[NewDish] Prato criado com sucesso");
      router.back();
    } catch (e: any) {
      console.error("[NewDish] Erro:", e);
      setError("Não foi possível criar o prato.");
    } finally {
      setSubmitting(false);
    }
  };

  const imageSource = resolveImageSource(imageUrl);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
        <TouchableOpacity
          onPress={() => { console.log("[NewDish] Botão voltar pressionado"); router.back(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}
        >
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
          <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
        </TouchableOpacity>
        <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text }}>
          Novo Prato
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ height: 160, borderRadius: 16, backgroundColor: COLORS.surfaceSecondary, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border }}>
          {imageUrl ? (
            <Image source={imageSource} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={200} />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
              <UtensilsCrossed size={32} color={COLORS.textTertiary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textTertiary }}>Sem imagem</Text>
            </View>
          )}
        </View>

        <FormField label="URL da Imagem" value={imageUrl} onChangeText={setImageUrl} placeholder="https://..." autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <FormField label="Nome *" value={name} onChangeText={setName} placeholder="Ex: Frango Grelhado" autoCapitalize="sentences" autoCorrect={true} />
        <FormField label="Descrição" value={description} onChangeText={setDescription} placeholder="Descrição do prato..." multiline autoCapitalize="sentences" autoCorrect={true} />

        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Categoria</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {categories.map((cat) => (
              <AnimatedPressable
                key={cat.id}
                onPress={() => { console.log("[NewDish] Categoria selecionada:", cat.name); setCategoryId(cat.id); }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: categoryId === cat.id ? COLORS.primary : COLORS.surfaceSecondary }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: categoryId === cat.id ? "#fff" : COLORS.textSecondary }}>{cat.name}</Text>
              </AnimatedPressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormField label="Preço (R$) *" value={price} onChangeText={setPrice} placeholder="0,00" moeda />
          </View>
          <View style={{ flex: 1 }}>
            <FormField label="Preparo (min)" value={prepTime} onChangeText={setPrepTime} placeholder="15" keyboardType="number-pad" />
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}>Prato ativo</Text>
          <Switch
            value={active}
            onValueChange={(v) => { console.log("[NewDish] Toggle ativo:", v); setActive(v); }}
            trackColor={{ false: COLORS.border, true: COLORS.primary + "80" }}
            thumbColor={active ? COLORS.primary : COLORS.textTertiary}
          />
        </View>

        {!!error && <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>{error}</Text>}

        <AnimatedPressable
          onPress={() => { console.log("[NewDish] Criar prato pressionado"); handleSave(); }}
          disabled={submitting}
          style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 8 }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Criar prato</Text>}
        </AnimatedPressable>
      </ScrollView>
    </SafeAreaView>
  );
}
