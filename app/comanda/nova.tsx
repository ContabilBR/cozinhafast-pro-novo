import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Alert,
  Modal,
  TextInput,
  Animated,
  ActivityIndicator,
  ImageSourcePropType,
  Platform,
  UIManager,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import useModoComanda from "@/hooks/useModoComanda";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet, apiPost } from "@/utils/api";
import {
  ArrowLeft,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  UtensilsCrossed,
  Send,
  Search,
} from "lucide-react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiPrato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  imagem_url?: string;
  disponivel?: boolean;
  categoria?: { id?: string; nome: string };
  categoria_id?: string;
}

interface CartItem {
  id: string;
  nome: string;
  preco: number;
  imagem_url?: string;
  quantidade: number;
  observacao: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveImageSource(
  source: string | number | ImageSourcePropType | undefined
): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

function formatPreco(preco: number | string | undefined): string {
  const n = Number(preco);
  if (isNaN(n)) return "R$ --";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PratoSkeleton() {
  const COLORS = useColors();
  return (
    <View
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: 14,
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <SkeletonLine width={64} height={64} borderRadius={10} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonLine width="60%" height={14} />
        <SkeletonLine width="80%" height={11} />
        <SkeletonLine width="35%" height={13} />
      </View>
      <SkeletonLine width={88} height={36} borderRadius={10} />
    </View>
  );
}

// ─── Prato Card ───────────────────────────────────────────────────────────────

function PratoCard({
  prato,
  cartItem,
  onAdd,
  onIncrement,
  onDecrement,
  onObservacaoChange,
  index,
}: {
  prato: ApiPrato;
  cartItem: CartItem | undefined;
  onAdd: (observacao: string) => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onObservacaoChange: (text: string) => void;
  index: number;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  const [pendingObservacao, setPendingObservacao] = useState('');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay: index * 35,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        delay: index * 35,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  const inCart = !!cartItem;
  const qty = cartItem?.quantidade ?? 0;
  const precoDisplay = formatPreco(prato.preco);
  const hasImage = !!prato.imagem_url;
  const isUnavailable = prato.disponivel === false;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 14,
          marginHorizontal: 16,
          marginBottom: 10,
          padding: 12,
          borderWidth: 1.5,
          borderColor: inCart ? COLORS.primary + "40" : COLORS.border,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 1,
          opacity: isUnavailable ? 0.5 : 1,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {/* Thumbnail */}
          {hasImage ? (
            <Image
              source={resolveImageSource(prato.imagem_url)}
              style={{ width: 64, height: 64, borderRadius: 10 }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 10,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <UtensilsCrossed size={22} color={COLORS.textTertiary} />
            </View>
          )}

          {/* Info */}
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 15,
                color: COLORS.text,
                letterSpacing: -0.1,
              }}
            >
              {prato.nome}
            </Text>
            {!!prato.descricao && (
              <Text
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 12,
                  color: COLORS.textSecondary,
                  lineHeight: 17,
                }}
              >
                {prato.descricao}
              </Text>
            )}
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 14,
                color: "#22C55E",
                marginTop: 2,
              }}
            >
              {precoDisplay}
            </Text>
          </View>

          {/* Add / Qty controls */}
          {isUnavailable ? (
            <View
              style={{
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 11,
                  color: COLORS.textTertiary,
                }}
              >
                Indisponível
              </Text>
            </View>
          ) : inCart ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <AnimatedPressable
                onPress={() => {
                  console.log("[Comanda] Decrementar prato:", prato.nome, "qty atual:", qty);
                  onDecrement();
                }}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Minus size={14} color={COLORS.text} />
              </AnimatedPressable>
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 15,
                  color: COLORS.text,
                  minWidth: 24,
                  textAlign: "center",
                }}
              >
                {qty}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[Comanda] Incrementar prato:", prato.nome, "qty atual:", qty);
                  onIncrement();
                }}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={14} color={COLORS.primary} />
              </AnimatedPressable>
            </View>
          ) : (
            <AnimatedPressable
              onPress={() => {
                console.log("[Comanda] Adicionar prato ao carrinho:", prato.nome, "id:", prato.id, "observacao:", pendingObservacao);
                onAdd(pendingObservacao);
                setPendingObservacao('');
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: COLORS.primaryMuted,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 9,
              }}
            >
              <Plus size={14} color={COLORS.primary} />
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 13,
                  color: COLORS.primary,
                }}
              >
                Adicionar
              </Text>
            </AnimatedPressable>
          )}
        </View>

        {/* Observation field — always visible */}
        <TextInput
          value={inCart ? (cartItem?.observacao ?? '') : pendingObservacao}
          onChangeText={(text) => {
            if (inCart) {
              console.log("[Comanda] Observação alterada para:", prato.nome, "—", text);
              onObservacaoChange(text);
            } else {
              setPendingObservacao(text);
            }
          }}
          placeholder="Observação (ex: sem cebola)"
          placeholderTextColor={COLORS.textTertiary}
          style={{
            marginTop: 10,
            backgroundColor: COLORS.surfaceSecondary,
            borderWidth: 1,
            borderColor: COLORS.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontFamily: "Outfit_400Regular",
            fontSize: 13,
            color: COLORS.text,
          }}
        />
      </View>
    </Animated.View>
  );
}

// ─── Cart Summary Item ────────────────────────────────────────────────────────

function CartSummaryItem({
  item,
  mesaNumero,
}: {
  item: CartItem;
  mesaNumero: string;
}) {
  const COLORS = useColors();
  const mesaLabel = `Mesa ${mesaNumero}`;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.divider,
        gap: 10,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: "Outfit_700Bold",
            fontSize: 14,
            color: COLORS.text,
          }}
        >
          {item.nome}
        </Text>
        <Text
          style={{
            fontFamily: "Outfit_400Regular",
            fontSize: 12,
            color: COLORS.textSecondary,
          }}
        >
          {mesaLabel}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: "#F59E0B",
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 3,
        }}
      >
        <Text
          style={{
            fontFamily: "Outfit_600SemiBold",
            fontSize: 11,
            color: "#fff",
          }}
        >
          pendente
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NovaComandaScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { mesa_id, mesa_numero } = useLocalSearchParams<{
    mesa_id: string;
    mesa_numero: string;
  }>();

  const { modo, loading: modoLoading } = useModoComanda();
  const individual = modo === "individual";

  const [pratos, setPratos] = useState<ApiPrato[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"cardapio" | "pedido">("cardapio");
  const [showSuccess, setShowSuccess] = useState(false);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [rotulo, setRotulo] = useState("");
  const [rotuloError, setRotuloError] = useState("");
  const TAMANHO_MAXIMO_NOME = 40;

  const mesaNumeroDisplay = mesa_numero ? String(mesa_numero) : "?";
  const titleText = `Comanda — Mesa ${mesaNumeroDisplay}`;

  // ── Fetch pratos ────────────────────────────────────────────────────────────
  const fetchPratos = useCallback(async () => {
    console.log("[Comanda] GET /api/pratos");
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiGet<any>("/api/pratos");
      const list: ApiPrato[] = Array.isArray(res) ? res : (res.pratos || []);
      const disponiveis = list.filter((p) => p.disponivel !== false);
      console.log("[Comanda] Pratos disponíveis:", disponiveis.length);
      setPratos(list); // show all, mark unavailable visually
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Comanda] Erro ao carregar pratos:", msg);
      setLoadError("Não foi possível carregar o cardápio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPratos();
  }, [fetchPratos]);

  // ── Cart helpers ─────────────────────────────────────────────────────────────
  const addToCart = useCallback((prato: ApiPrato, initialObservacao = '') => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === prato.id);
      if (existing) {
        return prev.map((c) =>
          c.id === prato.id ? { ...c, quantidade: c.quantidade + 1 } : c
        );
      }
      return [
        ...prev,
        {
          id: prato.id,
          nome: prato.nome,
          preco: Number(prato.preco),
          imagem_url: prato.imagem_url,
          quantidade: 1,
          observacao: initialObservacao,
        },
      ];
    });
  }, []);

  const incrementItem = useCallback((id: string) => {
    setCart((prev) =>
      prev.map((c) => (c.id === id ? { ...c, quantidade: c.quantidade + 1 } : c))
    );
  }, []);

  const decrementItem = useCallback((id: string) => {
    setCart((prev) => {
      const item = prev.find((c) => c.id === id);
      if (!item) return prev;
      if (item.quantidade <= 1) return prev.filter((c) => c.id !== id);
      return prev.map((c) =>
        c.id === id ? { ...c, quantidade: c.quantidade - 1 } : c
      );
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const setObservacao = useCallback((pratoId: string, text: string) => {
    setCart((prev) =>
      prev.map((c) => (c.id === pratoId ? { ...c, observacao: text } : c))
    );
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────────
  const cartCount = cart.reduce((sum, c) => sum + c.quantidade, 0);
  const subtotal = cart.reduce((sum, c) => sum + c.preco * c.quantidade, 0);
  const subtotalDisplay = formatPreco(subtotal);
  const cartIsEmpty = cart.length === 0;

  const categories = useMemo(() => {
    const names = new Set<string>();
    pratos.forEach((p) => {
      if (p.categoria?.nome) names.add(p.categoria.nome);
    });
    return ["Todos", ...Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))];
  }, [pratos]);

  const filteredPratos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pratos.filter((p) => {
      const matchesSearch = !q || p.nome.toLowerCase().includes(q);
      const matchesCategory =
        selectedCategory === "Todos" ||
        (p.categoria?.nome ?? "") === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [pratos, searchQuery, selectedCategory]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cartIsEmpty) return;
    if (!mesa_id) {
      Alert.alert("Erro", "Mesa não identificada. Volte e selecione uma mesa.");
      return;
    }
    const nomeComanda = rotulo.trim();
    if (individual && nomeComanda.length === 0) {
      Alert.alert("Nome da comanda", "Informe o nome da comanda (por exemplo, o nome do cliente).");
      return;
    }

    console.log(
      "[Comanda] Salvar e Enviar Pedido — mesa_id:",
      mesa_id,
      "mesa_numero:",
      mesaNumeroDisplay,
      "itens:",
      cart.length,
      "total:",
      subtotalDisplay
    );
    setSubmitting(true);

    try {
      const itens = cart.map((c) => ({
        prato_id: c.id,
        quantidade: c.quantidade,
        preco_unitario: c.preco,
        observacao: c.observacao || null,
      }));

      // O nome só é enviado no modo individual; no modo mesa o servidor o ignoraria
      const corpo: any = individual ? { mesa_id, itens, rotulo: nomeComanda } : { mesa_id, itens };
      console.log("[Comanda] POST /api/comandas — body:", JSON.stringify(corpo));
      await apiPost<any>("/api/comandas", corpo);

      console.log("[Comanda] Comanda criada com sucesso para mesa:", mesaNumeroDisplay);
      setCart([]);
      setShowSuccess(true);
      Animated.timing(successOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        console.log("[Comanda] Navegar de volta para Mesas após sucesso");
        router.replace("/(tabs)/(mesas)");
      }, 2500);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Comanda] Erro ao criar comanda:", msg);
      Alert.alert("Erro ao criar comanda", msg || "Não foi possível enviar o pedido.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={["top", "left", "right"]}
    >
      {/* ── Success Modal ── */}
      <Modal visible={showSuccess} transparent animationType="none" statusBarTranslucent>
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
            opacity: successOpacity,
          }}
        >
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 24,
              padding: 36,
              alignItems: "center",
              marginHorizontal: 40,
              gap: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 24,
              elevation: 12,
            }}
          >
            <Text style={{ fontSize: 56, lineHeight: 68 }}>✅</Text>
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 22,
                color: "#111827",
                textAlign: "center",
                letterSpacing: -0.3,
                marginTop: 4,
              }}
            >
              Pedido enviado!
            </Text>
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 14,
                color: "#6B7280",
                textAlign: "center",
                lineHeight: 21,
                maxWidth: 240,
              }}
            >
              Seu pedido foi registrado e enviado para a cozinha com sucesso.
            </Text>
          </View>
        </Animated.View>
      </Modal>
      {/* ── Header ── */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: 56,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}
      >
        <AnimatedPressable
          onPress={() => {
            console.log("[Comanda] Botão Voltar pressionado");
            router.back();
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 8,
            gap: 4,
          }}
        >
          <ArrowLeft size={20} color={COLORS.primary} />
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 15,
              color: COLORS.primary,
            }}
          >
            Voltar
          </Text>
        </AnimatedPressable>

        <Text
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: "Outfit_700Bold",
            fontSize: 16,
            color: COLORS.text,
            letterSpacing: -0.2,
            height: 56,
            lineHeight: 56,
          }}
          numberOfLines={1}
          pointerEvents="none"
        >
          {titleText}
        </Text>

        {/* Cart badge */}
        {cartCount > 0 && (
          <View
            style={{
              position: "absolute",
              right: 16,
              backgroundColor: COLORS.primary,
              borderRadius: 14,
              paddingHorizontal: 10,
              paddingVertical: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ShoppingCart size={13} color="#fff" />
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 12,
                color: "#fff",
              }}
            >
              {cartCount}
            </Text>
          </View>
        )}
      </View>

      {/* ── Nome da comanda (somente no modo individual) ── */}
      {individual ? (
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 6,
          }}
        >
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 13,
              color: COLORS.textSecondary,
            }}
          >
            Nome da comanda *
          </Text>
          <TextInput
            value={rotulo}
            onChangeText={setRotulo}
            placeholder="Ex.: Maria"
            placeholderTextColor={COLORS.textTertiary}
            maxLength={TAMANHO_MAXIMO_NOME}
            autoCapitalize="words"
            returnKeyType="done"
            style={{
              backgroundColor: COLORS.surfaceSecondary,
              borderWidth: 1,
              borderColor: COLORS.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              fontFamily: "Outfit_400Regular",
              fontSize: 15,
              color: COLORS.text,
            }}
          />
        </View>
      ) : null}

      {/* ── Tabs ── */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          paddingHorizontal: 20,
        }}
      >
        <AnimatedPressable
          onPress={() => {
            console.log("[Comanda] Tab Cardápio selecionada");
            setActiveTab("cardapio");
          }}
          style={{
            paddingVertical: 13,
            paddingHorizontal: 4,
            marginRight: 24,
            borderBottomWidth: 2.5,
            borderBottomColor:
              activeTab === "cardapio" ? COLORS.primary : "transparent",
          }}
        >
          <Text
            style={{
              fontFamily:
                activeTab === "cardapio" ? "Outfit_700Bold" : "Outfit_400Regular",
              fontSize: 15,
              color:
                activeTab === "cardapio" ? COLORS.primary : COLORS.textSecondary,
            }}
          >
            Cardápio
          </Text>
        </AnimatedPressable>

        <AnimatedPressable
          onPress={() => {
            console.log("[Comanda] Tab Meu Pedido selecionada");
            setActiveTab("pedido");
          }}
          style={{
            paddingVertical: 13,
            paddingHorizontal: 4,
            borderBottomWidth: 2.5,
            borderBottomColor:
              activeTab === "pedido" ? COLORS.primary : "transparent",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Text
            style={{
              fontFamily:
                activeTab === "pedido" ? "Outfit_700Bold" : "Outfit_400Regular",
              fontSize: 15,
              color:
                activeTab === "pedido" ? COLORS.primary : COLORS.textSecondary,
            }}
          >
            Meu Pedido
          </Text>
          {cartCount > 0 && (
            <View
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 10,
                minWidth: 20,
                height: 20,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 5,
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 11,
                  color: "#fff",
                }}
              >
                {cartCount}
              </Text>
            </View>
          )}
        </AnimatedPressable>
      </View>

      {/* ── Content ── */}
      <View style={{ flex: 1 }}>
        {activeTab === "cardapio" ? (
          loading ? (
            <ScrollView
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 160 }}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <PratoSkeleton key={i} />
              ))}
            </ScrollView>
          ) : loadError ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
                gap: 14,
              }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: "rgba(239,68,68,0.10)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <UtensilsCrossed size={32} color={COLORS.danger} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 17,
                  color: COLORS.text,
                  textAlign: "center",
                }}
              >
                Erro ao carregar cardápio
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  lineHeight: 20,
                }}
              >
                {loadError}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[Comanda] Tentar novamente pressionado");
                  fetchPratos();
                }}
                style={{
                  backgroundColor: COLORS.primary,
                  borderRadius: 12,
                  paddingHorizontal: 28,
                  paddingVertical: 13,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Outfit_600SemiBold",
                    fontSize: 15,
                    color: "#fff",
                  }}
                >
                  Tentar novamente
                </Text>
              </AnimatedPressable>
            </View>
          ) : pratos.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 40,
                gap: 14,
              }}
            >
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <UtensilsCrossed size={36} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 18,
                  color: COLORS.text,
                  textAlign: "center",
                }}
              >
                Nenhum prato disponível
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  lineHeight: 21,
                }}
              >
                O cardápio está vazio no momento
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredPratos}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 160 }}
              ListHeaderComponent={
                <View>
                  {/* Search field */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginHorizontal: 16,
                      marginBottom: 10,
                      backgroundColor: COLORS.surfaceSecondary,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      gap: 8,
                    }}
                  >
                    <Search size={16} color={COLORS.textTertiary} />
                    <TextInput
                      value={searchQuery}
                      onChangeText={(text) => {
                        console.log("[Comanda] Busca alterada:", text);
                        setSearchQuery(text);
                      }}
                      placeholder="Buscar prato..."
                      placeholderTextColor={COLORS.textTertiary}
                      style={{
                        flex: 1,
                        fontFamily: "Outfit_400Regular",
                        fontSize: 14,
                        color: COLORS.text,
                        padding: 0,
                      }}
                      returnKeyType="search"
                      clearButtonMode="while-editing"
                    />
                  </View>

                  {/* Category filter chips */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{
                      paddingHorizontal: 16,
                      paddingBottom: 10,
                      gap: 8,
                    }}
                  >
                    {categories.map((cat) => {
                      const isSelected = selectedCategory === cat;
                      return (
                        <AnimatedPressable
                          key={cat}
                          onPress={() => {
                            console.log("[Comanda] Categoria selecionada:", cat);
                            setSelectedCategory(cat);
                          }}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 7,
                            borderRadius: 20,
                            backgroundColor: isSelected
                              ? COLORS.primary
                              : COLORS.surfaceSecondary,
                            borderWidth: 1,
                            borderColor: isSelected
                              ? COLORS.primary
                              : COLORS.border,
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: isSelected
                                ? "Outfit_600SemiBold"
                                : "Outfit_400Regular",
                              fontSize: 13,
                              color: isSelected ? "#fff" : COLORS.textSecondary,
                            }}
                          >
                            {cat}
                          </Text>
                        </AnimatedPressable>
                      );
                    })}
                  </ScrollView>
                </View>
              }
              renderItem={({ item, index }) => {
                const cartItem = cart.find((c) => c.id === item.id);
                return (
                  <PratoCard
                    prato={item}
                    cartItem={cartItem}
                    onAdd={(observacao) => addToCart(item, observacao)}
                    onIncrement={() => incrementItem(item.id)}
                    onDecrement={() => decrementItem(item.id)}
                    onObservacaoChange={(text) => setObservacao(item.id, text)}
                    index={index}
                  />
                );
              }}
              ListEmptyComponent={
                <View
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 40,
                    gap: 10,
                  }}
                >
                  <Search size={32} color={COLORS.textTertiary} />
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 16,
                      color: COLORS.text,
                      textAlign: "center",
                    }}
                  >
                    Nenhum prato encontrado
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 13,
                      color: COLORS.textSecondary,
                      textAlign: "center",
                    }}
                  >
                    Tente outro termo ou categoria
                  </Text>
                </View>
              }
            />
          )
        ) : (
          // ── Meu Pedido Tab ──
          cartIsEmpty ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: 40,
                gap: 14,
              }}
            >
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  backgroundColor: COLORS.primaryMuted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ShoppingCart size={36} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 18,
                  color: COLORS.text,
                  textAlign: "center",
                }}
              >
                Carrinho vazio
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  lineHeight: 21,
                  maxWidth: 260,
                }}
              >
                Adicione pratos do cardápio para montar o pedido
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[Comanda] Ir para cardápio pressionado");
                  setActiveTab("cardapio");
                }}
                style={{
                  backgroundColor: COLORS.primaryMuted,
                  borderRadius: 12,
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: COLORS.primary + "30",
                }}
              >
                <Text
                  style={{
                    fontFamily: "Outfit_600SemiBold",
                    fontSize: 15,
                    color: COLORS.primary,
                  }}
                >
                  Ver cardápio
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 160 }}
            >
              {/* Cart items */}
              <View
                style={{
                  marginHorizontal: 16,
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Outfit_700Bold",
                    fontSize: 15,
                    color: COLORS.text,
                    marginBottom: 4,
                  }}
                >
                  Itens do pedido
                </Text>
                {cart.map((item) => (
                  <CartSummaryItem
                    key={item.id}
                    item={item}
                    mesaNumero={mesaNumeroDisplay}
                  />
                ))}
              </View>

              {/* Total card */}
              <View
                style={{
                  marginHorizontal: 16,
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  padding: 16,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View>
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 13,
                      color: COLORS.textSecondary,
                    }}
                  >
                    Total do pedido
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 12,
                      color: COLORS.textTertiary,
                      marginTop: 2,
                    }}
                  >
                    {cartCount} {cartCount === 1 ? "item" : "itens"}
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: "Outfit_700Bold",
                    fontSize: 24,
                    color: "#22C55E",
                    letterSpacing: -0.5,
                  }}
                >
                  {subtotalDisplay}
                </Text>
              </View>
            </ScrollView>
          )
        )}
      </View>

      {/* ── Fixed bottom submit button ── */}
      <View
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 32,
        }}
      >
        <AnimatedPressable
          onPress={() => {
            console.log(
              "[Comanda] Salvar e Enviar Pedido pressionado — itens:",
              cart.length,
              "total:",
              subtotalDisplay
            );
            handleSubmit();
          }}
          disabled={submitting || cartIsEmpty || modoLoading}
          style={{
            backgroundColor: cartIsEmpty ? COLORS.surfaceSecondary : COLORS.primary,
            borderRadius: 14,
            height: 56,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: COLORS.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: cartIsEmpty ? 0 : 0.3,
            shadowRadius: 10,
            elevation: cartIsEmpty ? 0 : 4,
            flexDirection: "row",
            gap: 8,
          }}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              {!cartIsEmpty && <Send size={18} color="#fff" />}
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 16,
                  color: cartIsEmpty ? COLORS.textTertiary : "#fff",
                }}
              >
                {cartIsEmpty
                  ? "Adicione itens ao pedido"
                  : "Salvar e Enviar Pedido"}
              </Text>
            </>
          )}
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}
