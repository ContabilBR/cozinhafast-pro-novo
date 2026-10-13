import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  FlatList,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";
import { Plus, Minus, UtensilsCrossed } from "lucide-react-native";
import type { ImageSourcePropType } from "react-native";

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

interface ApiPrato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  imagem_url?: string;
  categoria_id?: string;
  categoria?: { id: string; nome: string };
  disponivel?: boolean;
}

interface ApiCategoria {
  id: string;
  nome: string;
}

interface CartItem {
  prato: ApiPrato;
  quantidade: number;
  observacao: string;
}

export default function NovoPedidoScreen() {
  const { comanda_id, mesa_id } = useLocalSearchParams<{ comanda_id: string; mesa_id: string }>();
  const COLORS = useColors();
  const router = useRouter();

  const [step, setStep] = useState<"browse" | "review">("browse");
  const [pratos, setPratos] = useState<ApiPrato[]>([]);
  const [categorias, setCategorias] = useState<ApiCategoria[]>([]);
  const [selectedCategoria, setSelectedCategoria] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    console.log("[NovoPedido] GET /api/pratos e /api/categorias");
    try {
      const [pratosRes, catRes] = await Promise.all([
        apiGet<any>("/api/pratos"),
        apiGet<any>("/api/categorias"),
      ]);
      const pratoList: ApiPrato[] = Array.isArray(pratosRes) ? pratosRes : (pratosRes.pratos || []);
      const catList: ApiCategoria[] = Array.isArray(catRes) ? catRes : (catRes.categorias || []);
      console.log("[NovoPedido] Carregados", pratoList.length, "pratos,", catList.length, "categorias");
      setPratos(pratoList.filter((p) => p.disponivel !== false));
      setCategorias(catList);
    } catch (e: any) {
      console.error("[NovoPedido] Erro:", e);
      setError("Não foi possível carregar o cardápio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addToCart = (prato: ApiPrato) => {
    console.log("[NovoPedido] Adicionar ao carrinho:", prato.nome);
    setCart((prev) => {
      const existing = prev.find((c) => c.prato.id === prato.id);
      if (existing) return prev.map((c) => c.prato.id === prato.id ? { ...c, quantidade: c.quantidade + 1 } : c);
      return [...prev, { prato, quantidade: 1, observacao: "" }];
    });
  };

  const removeFromCart = (pratoId: string) => {
    console.log("[NovoPedido] Remover do carrinho:", pratoId);
    setCart((prev) => {
      const existing = prev.find((c) => c.prato.id === pratoId);
      if (existing && existing.quantidade > 1) return prev.map((c) => c.prato.id === pratoId ? { ...c, quantidade: c.quantidade - 1 } : c);
      return prev.filter((c) => c.prato.id !== pratoId);
    });
  };

  const updateObservacao = (pratoId: string, obs: string) => {
    setCart((prev) => prev.map((c) => c.prato.id === pratoId ? { ...c, observacao: obs } : c));
  };

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    console.log("[NovoPedido] Enviar pedidos, comanda:", comanda_id, "itens:", cart.length);
    setSubmitting(true);
    setError("");
    try {
      console.log("[NovoPedido] POST /api/pedidos (múltiplos itens)");
      await Promise.all(
        cart.map((item) =>
          apiPost("/api/pedidos", {
            comanda_id,
            prato_id: item.prato.id,
            quantidade: item.quantidade,
            observacao: item.observacao || undefined,
          })
        )
      );
      console.log("[NovoPedido] Pedidos criados com sucesso");
      router.back();
    } catch (e: any) {
      console.error("[NovoPedido] Erro ao enviar:", e);
      setError("Não foi possível criar o pedido. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPratos = selectedCategoria ? pratos.filter((p) => p.categoria_id === selectedCategoria) : pratos;
  const cartTotal = cart.reduce((sum, c) => sum + c.prato.preco * c.quantidade, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantidade, 0);
  const cartTotalStr = formatCurrency(cartTotal);

  if (step === "review") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <Pressable
            onPress={() => { console.log("[NovoPedido] Voltar para browse"); setStep("browse"); }}
            style={{ flexDirection: "row", alignItems: "center", paddingRight: 12 }}
          >
            <Ionicons name="arrow-back" size={22} color="#007AFF" />
            <Text style={{ color: "#007AFF", fontSize: 16, marginLeft: 4 }}>Voltar</Text>
          </Pressable>
          <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: "#111" }}>
            Revisar Pedido
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>Itens do pedido</Text>

          {cart.map((item) => {
            const itemTotal = formatCurrency(item.prato.preco * item.quantidade);
            return (
              <View key={item.prato.id} style={{ backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text, flex: 1 }}>{item.prato.nome}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <AnimatedPressable
                      onPress={() => { console.log("[NovoPedido] Diminuir quantidade:", item.prato.nome); removeFromCart(item.prato.id); }}
                      style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}
                    >
                      <Minus size={14} color={COLORS.text} />
                    </AnimatedPressable>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text, minWidth: 20, textAlign: "center" }}>{item.quantidade}</Text>
                    <AnimatedPressable
                      onPress={() => { console.log("[NovoPedido] Aumentar quantidade:", item.prato.nome); addToCart(item.prato); }}
                      style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}
                    >
                      <Plus size={14} color={COLORS.primary} />
                    </AnimatedPressable>
                  </View>
                </View>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>{itemTotal}</Text>
                <TextInput
                  value={item.observacao}
                  onChangeText={(t) => updateObservacao(item.prato.id, t)}
                  placeholder="Observação (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 10, padding: 10, fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.text }}
                />
              </View>
            );
          })}

          {error ? (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger, textAlign: "center" }}>{error}</Text>
          ) : null}
        </ScrollView>

        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Total estimado</Text>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.primary }}>{cartTotalStr}</Text>
          </View>
          <AnimatedPressable
            onPress={() => { console.log("[NovoPedido] Confirmar pedido pressionado"); handleSubmit(); }}
            disabled={submitting || cart.length === 0}
            style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" }}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Confirmar Pedido</Text>}
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
        <Pressable
          onPress={() => { console.log("[NovoPedido] Botão voltar pressionado"); router.back(); }}
          style={{ flexDirection: "row", alignItems: "center", paddingRight: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color="#007AFF" />
          <Text style={{ color: "#007AFF", fontSize: 16, marginLeft: 4 }}>Voltar</Text>
        </Pressable>
        <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: "#111" }}>
          Novo Pedido
        </Text>
      </View>

      {/* Category filter */}
      <View style={{ backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 12 }}>
          <AnimatedPressable
            onPress={() => { console.log("[NovoPedido] Filtro: Todos"); setSelectedCategoria(null); }}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: !selectedCategoria ? COLORS.primary : COLORS.surfaceSecondary }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: !selectedCategoria ? "#fff" : COLORS.textSecondary }}>Todos</Text>
          </AnimatedPressable>
          {categorias.map((cat) => (
            <AnimatedPressable
              key={cat.id}
              onPress={() => { console.log("[NovoPedido] Filtro categoria:", cat.nome); setSelectedCategoria(cat.id === selectedCategoria ? null : cat.id); }}
              style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: selectedCategoria === cat.id ? COLORS.primary : COLORS.surfaceSecondary }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: selectedCategoria === cat.id ? "#fff" : COLORS.textSecondary }}>{cat.nome}</Text>
            </AnimatedPressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredPratos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 120, gap: 10 }}
          renderItem={({ item }) => {
            const cartItem = cart.find((c) => c.prato.id === item.id);
            const qty = cartItem?.quantidade ?? 0;
            const price = formatCurrency(item.preco);
            const imageSource = resolveImageSource(item.imagem_url);
            return (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: qty > 0 ? COLORS.primary + "40" : COLORS.border, flexDirection: "row", overflow: "hidden" }}>
                <View style={{ width: 80, height: 80, backgroundColor: COLORS.surfaceSecondary }}>
                  {item.imagem_url ? (
                    <Image source={imageSource} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <UtensilsCrossed size={22} color={COLORS.textTertiary} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, padding: 12, justifyContent: "space-between" }}>
                  <View>
                    <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>{item.nome}</Text>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: COLORS.primary, marginTop: 2 }}>{price}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {qty > 0 ? (
                      <>
                        <AnimatedPressable
                          onPress={() => { console.log("[NovoPedido] Remover:", item.nome); removeFromCart(item.id); }}
                          style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}
                        >
                          <Minus size={13} color={COLORS.text} />
                        </AnimatedPressable>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text, minWidth: 18, textAlign: "center" }}>{qty}</Text>
                      </>
                    ) : null}
                    <AnimatedPressable
                      onPress={() => { console.log("[NovoPedido] Adicionar:", item.nome); addToCart(item); }}
                      style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}
                    >
                      <Plus size={13} color={COLORS.primary} />
                    </AnimatedPressable>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
              <UtensilsCrossed size={32} color={COLORS.textTertiary} />
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>Nenhum prato disponível</Text>
            </View>
          }
        />
      )}

      {cartCount > 0 ? (
        <View style={{ position: "absolute", bottom: 20, left: 16, right: 16 }}>
          <AnimatedPressable
            onPress={() => { console.log("[NovoPedido] Revisar carrinho pressionado, itens:", cartCount); setStep("review"); }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 16, height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 }}
          >
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: "#fff" }}>{cartCount}</Text>
            </View>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Revisar pedido</Text>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "rgba(255,255,255,0.85)" }}>{cartTotalStr}</Text>
          </AnimatedPressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
