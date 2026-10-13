import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  ImageSourcePropType,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Minus, Plus, Trash2, Search, UtensilsCrossed } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency, parseBRL } from "@/utils/helpers";
import { CampoMoeda } from "@/components/CampoMoeda";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiPrato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number | string;
  imagem_url?: string;
  disponivel?: boolean;
  categoria?: { id?: string; nome: string };
}

interface ItemPedido {
  prato_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  observacao?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveImageSource(
  source: string | number | ImageSourcePropType | undefined
): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PratoSkeleton({ COLORS }: { COLORS: ReturnType<typeof useColors> }) {
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

// ─── Prato Card (inside modal) ────────────────────────────────────────────────

function PratoCard({
  prato,
  draftQty,
  onAdd,
  onIncrement,
  onDecrement,
  index,
}: {
  prato: ApiPrato;
  draftQty: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  index: number;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        delay: Math.min(index * 30, 300),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        delay: Math.min(index * 30, 300),
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  const inCart = draftQty > 0;
  const hasImage = !!prato.imagem_url;
  const precoNum = Number(prato.preco);
  const precoDisplay = isNaN(precoNum) ? "R$ --" : `R$ ${precoNum.toFixed(2).replace(".", ",")}`;

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
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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

          {inCart ? (
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
                  console.log("[NovoDelivery] Modal: decrementar prato:", prato.nome, "qty atual:", draftQty);
                  onDecrement();
                }}
                style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
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
                {draftQty}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[NovoDelivery] Modal: incrementar prato:", prato.nome, "qty atual:", draftQty);
                  onIncrement();
                }}
                style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
              >
                <Plus size={14} color={COLORS.primary} />
              </AnimatedPressable>
            </View>
          ) : (
            <AnimatedPressable
              onPress={() => {
                console.log("[NovoDelivery] Modal: adicionar prato:", prato.nome, "id:", prato.id);
                onAdd();
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
      </View>
    </Animated.View>
  );
}

// ─── Dish Selector Modal ──────────────────────────────────────────────────────

function DishSelectorModal({
  visible,
  initialItens,
  onCommit,
  onClose,
}: {
  visible: boolean;
  initialItens: ItemPedido[];
  onCommit: (itens: ItemPedido[]) => void;
  onClose: () => void;
}) {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();

  const [pratos, setPratos] = useState<ApiPrato[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");

  // Draft cart — keyed by prato_id
  const [draft, setDraft] = useState<ItemPedido[]>([]);

  // Snapshot of itens when modal opened (for discard detection)
  const initialRef = useRef<ItemPedido[]>([]);

  // Load pratos once when modal opens
  const fetchPratos = useCallback(async () => {
    console.log("[NovoDelivery] Modal: GET /api/pratos");
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiGet<any>("/api/pratos");
      const list: ApiPrato[] = Array.isArray(res) ? res : (res.pratos || []);
      const disponiveis = list.filter((p) => p.disponivel !== false);
      console.log("[NovoDelivery] Modal: pratos disponíveis:", disponiveis.length);
      setPratos(disponiveis);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[NovoDelivery] Modal: erro ao carregar pratos:", msg);
      setLoadError("Não foi possível carregar o cardápio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      console.log("[NovoDelivery] Modal aberto, inicializando draft com", initialItens.length, "itens");
      setDraft(initialItens.map((i) => ({ ...i })));
      initialRef.current = initialItens.map((i) => ({ ...i }));
      setSearchQuery("");
      setSelectedCategory("Todos");
      if (pratos.length === 0) {
        fetchPratos();
      }
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Categories ──────────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const cats: string[] = [];
    for (const p of pratos) {
      const cat = p.categoria?.nome || "Sem categoria";
      if (!seen.has(cat)) {
        seen.add(cat);
        cats.push(cat);
      }
    }
    return cats;
  }, [pratos]);

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filteredPratos = useMemo(() => {
    const q = normalizeStr(searchQuery.trim());
    if (q) {
      return pratos.filter((p) => normalizeStr(p.nome).includes(q));
    }
    if (selectedCategory === "Todos") return pratos;
    return pratos.filter((p) => {
      const cat = p.categoria?.nome || "Sem categoria";
      return cat === selectedCategory;
    });
  }, [pratos, searchQuery, selectedCategory]);

  // ── Draft helpers ────────────────────────────────────────────────────────────
  const getDraftQty = (pratoId: string) =>
    draft.find((i) => i.prato_id === pratoId)?.quantidade ?? 0;

  const addToDraft = (prato: ApiPrato) => {
    setDraft((prev) => {
      const existing = prev.find((i) => i.prato_id === prato.id);
      if (existing) {
        return prev.map((i) =>
          i.prato_id === prato.id ? { ...i, quantidade: i.quantidade + 1 } : i
        );
      }
      return [
        ...prev,
        {
          prato_id: prato.id,
          nome: prato.nome,
          preco: Number(prato.preco),
          quantidade: 1,
          observacao: "",
        },
      ];
    });
  };

  const incrementDraft = (pratoId: string) => {
    setDraft((prev) =>
      prev.map((i) =>
        i.prato_id === pratoId ? { ...i, quantidade: i.quantidade + 1 } : i
      )
    );
  };

  const decrementDraft = (pratoId: string) => {
    setDraft((prev) => {
      const item = prev.find((i) => i.prato_id === pratoId);
      if (!item) return prev;
      if (item.quantidade <= 1) {
        console.log("[NovoDelivery] Modal: remover prato do draft:", pratoId);
        return prev.filter((i) => i.prato_id !== pratoId);
      }
      return prev.map((i) =>
        i.prato_id === pratoId ? { ...i, quantidade: i.quantidade - 1 } : i
      );
    });
  };

  // ── Category badge counts ────────────────────────────────────────────────────
  const categoryCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of draft) {
      const prato = pratos.find((p) => p.id === item.prato_id);
      const cat = prato?.categoria?.nome || "Sem categoria";
      map[cat] = (map[cat] ?? 0) + item.quantidade;
    }
    return map;
  }, [draft, pratos]);

  // ── Draft totals ─────────────────────────────────────────────────────────────
  const draftTotalQty = draft.reduce((s, i) => s + i.quantidade, 0);
  const draftSubtotal = draft.reduce((s, i) => s + i.preco * i.quantidade, 0);

  // ── Discard check ────────────────────────────────────────────────────────────
  const hasDraftChanged = () => {
    const init = initialRef.current;
    if (draft.length !== init.length) return true;
    for (const d of draft) {
      const orig = init.find((i) => i.prato_id === d.prato_id);
      if (!orig || orig.quantidade !== d.quantidade) return true;
    }
    return false;
  };

  const handleClose = () => {
    console.log("[NovoDelivery] Modal: botão fechar pressionado");
    if (hasDraftChanged()) {
      Alert.alert(
        "Descartar mudanças?",
        "As alterações feitas aqui serão perdidas.",
        [
          { text: "Continuar editando" },
          {
            text: "Descartar",
            style: "destructive",
            onPress: () => {
              console.log("[NovoDelivery] Modal: mudanças descartadas");
              onClose();
            },
          },
        ]
      );
    } else {
      onClose();
    }
  };

  const handleCommit = () => {
    console.log("[NovoDelivery] Modal: concluir pressionado, itens:", draft.length, "total:", draftTotalQty);
    onCommit(draft);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const footerHeight = 72 + insets.bottom;

  const renderItem = ({ item, index }: { item: ApiPrato; index: number }) => (
    <PratoCard
      prato={item}
      draftQty={getDraftQty(item.id)}
      onAdd={() => addToDraft(item)}
      onIncrement={() => incrementDraft(item.id)}
      onDecrement={() => decrementDraft(item.id)}
      index={index}
    />
  );

  const ListEmpty = () => {
    if (loading) return null;
    const emptyText = searchQuery.trim()
      ? "Nenhum prato encontrado"
      : "Nenhum prato disponível no cardápio";
    return (
      <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 32 }}>
        <UtensilsCrossed size={40} color={COLORS.textTertiary} />
        <Text
          style={{
            marginTop: 12,
            fontSize: 15,
            color: COLORS.textSecondary,
            textAlign: "center",
            fontFamily: "Outfit_400Regular",
          }}
        >
          {emptyText}
        </Text>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: 10,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.background,
            borderBottomWidth: 0.5,
            borderBottomColor: COLORS.border,
          }}
        >
          <AnimatedPressable
            onPress={handleClose}
            style={{ padding: 4, marginRight: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </AnimatedPressable>
          <Text
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 17,
              fontWeight: "700",
              color: COLORS.text,
              fontFamily: "Outfit_700Bold",
            }}
          >
            Escolher pratos
          </Text>
          {/* Spacer to balance the back button */}
          <View style={{ width: 32 }} />
        </View>

        {/* Search */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: COLORS.background,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.border,
              paddingHorizontal: 12,
              gap: 8,
            }}
          >
            <Search size={16} color={COLORS.textTertiary} />
            <TextInput
              value={searchQuery}
              onChangeText={(t) => {
                console.log("[NovoDelivery] Modal: busca alterada:", t);
                setSearchQuery(t);
              }}
              placeholder="Buscar prato"
              placeholderTextColor={COLORS.textTertiary}
              style={{
                flex: 1,
                paddingVertical: 10,
                fontSize: 15,
                color: COLORS.text,
                fontFamily: "Outfit_400Regular",
              }}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        </View>

        {/* Category chips */}
        {!searchQuery.trim() && categories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}
          >
            {["Todos", ...categories].map((cat) => {
              const isSelected = selectedCategory === cat;
              const count = cat === "Todos"
                ? draftTotalQty
                : (categoryCount[cat] ?? 0);
              return (
                <AnimatedPressable
                  key={cat}
                  onPress={() => {
                    const next = isSelected && cat !== "Todos" ? "Todos" : cat;
                    console.log("[NovoDelivery] Modal: categoria selecionada:", next);
                    setSelectedCategory(next);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 20,
                    backgroundColor: isSelected ? COLORS.primary : COLORS.surface,
                    borderWidth: 1,
                    borderColor: isSelected ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Outfit_600SemiBold",
                      color: isSelected ? "#fff" : COLORS.text,
                    }}
                  >
                    {cat}
                  </Text>
                  {count > 0 && (
                    <View
                      style={{
                        backgroundColor: isSelected ? "rgba(255,255,255,0.3)" : COLORS.primary,
                        borderRadius: 10,
                        minWidth: 18,
                        height: 18,
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: "700",
                          color: "#fff",
                        }}
                      >
                        {count}
                      </Text>
                    </View>
                  )}
                </AnimatedPressable>
              );
            })}
          </ScrollView>
        )}

        {/* Error state */}
        {loadError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Text style={{ fontSize: 15, color: COLORS.textSecondary, textAlign: "center", marginBottom: 16 }}>
              {loadError}
            </Text>
            <AnimatedPressable
              onPress={() => {
                console.log("[NovoDelivery] Modal: tentar de novo pressionado");
                fetchPratos();
              }}
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 10,
                paddingHorizontal: 20,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>Tentar de novo</Text>
            </AnimatedPressable>
          </View>
        ) : loading ? (
          <FlatList
            data={[1, 2, 3, 4, 5]}
            keyExtractor={(i) => String(i)}
            renderItem={() => <PratoSkeleton COLORS={COLORS} />}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: footerHeight + 16 }}
            scrollEnabled={false}
          />
        ) : (
          <FlatList
            data={filteredPratos}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            ListEmptyComponent={<ListEmpty />}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: footerHeight + 16 }}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Footer */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: COLORS.surface,
            borderTopWidth: 1,
            borderTopColor: COLORS.border,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, fontFamily: "Outfit_400Regular" }}>
              {draftTotalQty}
              {" "}
              {draftTotalQty === 1 ? "item" : "itens"}
            </Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.text, fontFamily: "Outfit_700Bold" }}>
              {formatCurrency(draftSubtotal)}
            </Text>
          </View>
          <AnimatedPressable
            onPress={draftTotalQty > 0 ? handleCommit : undefined}
            style={{
              backgroundColor: draftTotalQty > 0 ? COLORS.primary : COLORS.textTertiary,
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
              opacity: draftTotalQty > 0 ? 1 : 0.5,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Outfit_700Bold" }}>
              Concluir
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function NovoDelivery() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [clienteNome, setClienteNome] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cep, setCep] = useState("");
  const [referencia, setReferencia] = useState("");
  const [taxaEntrega, setTaxaEntrega] = useState("0");
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [saving, setSaving] = useState(false);
  const [pagMomento, setPagMomento] = useState<"ja_pago" | "na_entrega">("na_entrega");
  const [pagForma, setPagForma] = useState<"pix" | "credito" | "debito" | "dinheiro">("dinheiro");
  const [trocoPara, setTrocoPara] = useState("");
  const [showModal, setShowModal] = useState(false);

  const subtotal = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const taxa = parseBRL(taxaEntrega) ?? 0;
  const total = subtotal + taxa;

  const handleCommitItens = (newItens: ItemPedido[]) => {
    console.log("[NovoDelivery] Itens confirmados do modal:", newItens.length);
    setItens(newItens);
    setShowModal(false);
  };

  const removeItem = (pratoId: string) => {
    console.log("[NovoDelivery] removeItem pressed:", pratoId);
    setItens((prev) => prev.filter((i) => i.prato_id !== pratoId));
  };

  const decrementItem = (pratoId: string) => {
    console.log("[NovoDelivery] decrementItem pressed:", pratoId);
    setItens((prev) => {
      const item = prev.find((i) => i.prato_id === pratoId);
      if (!item) return prev;
      if (item.quantidade <= 1) return prev.filter((i) => i.prato_id !== pratoId);
      return prev.map((i) =>
        i.prato_id === pratoId ? { ...i, quantidade: i.quantidade - 1 } : i
      );
    });
  };

  const incrementItem = (pratoId: string) => {
    console.log("[NovoDelivery] incrementItem pressed:", pratoId);
    setItens((prev) =>
      prev.map((i) =>
        i.prato_id === pratoId ? { ...i, quantidade: i.quantidade + 1 } : i
      )
    );
  };

  const updateObservacao = (pratoId: string, text: string) => {
    setItens((prev) =>
      prev.map((i) => (i.prato_id === pratoId ? { ...i, observacao: text } : i))
    );
  };

  const submit = async () => {
    console.log("[NovoDelivery] submit pressed", { clienteNome, clienteTelefone, endereco, itens: itens.length, pagMomento, pagForma });
    if (!clienteNome.trim()) return Alert.alert("Erro", "Informe o nome do cliente");
    if (!clienteTelefone.trim()) return Alert.alert("Erro", "Informe o telefone");
    if (!endereco.trim()) return Alert.alert("Erro", "Informe o endereço");
    if (itens.length === 0) return Alert.alert("Erro", "Adicione pelo menos um item");
    setSaving(true);
    try {
      console.log("[NovoDelivery] POST /api/delivery/pedidos", { cliente_nome: clienteNome, itens, pagMomento, pagForma });
      await apiPost("/api/delivery/pedidos", {
        cliente_nome: clienteNome.trim(),
        cliente_telefone: clienteTelefone.trim(),
        endereco: endereco.trim(),
        complemento: complemento.trim() || undefined,
        bairro: bairro.trim() || undefined,
        cep: cep.trim() || undefined,
        referencia: referencia.trim() || undefined,
        taxa_entrega: taxa,
        observacao: observacao.trim() || undefined,
        itens: itens.map((i) => ({
          prato_id: i.prato_id,
          quantidade: i.quantidade,
          observacao: i.observacao,
        })),
        pagamento: {
          momento: pagMomento,
          forma: pagForma,
          ...(pagMomento === "na_entrega" && pagForma === "dinheiro" && trocoPara
            ? { troco_para: parseBRL(trocoPara) }
            : {}),
        },
      });
      console.log("[NovoDelivery] Pedido criado com sucesso");
      router.back();
    } catch (err: any) {
      console.log("[NovoDelivery] Erro ao criar pedido:", err?.message);
      Alert.alert("Erro", err?.message || "Erro ao criar pedido");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: COLORS.surfaceSecondary,
    padding: 12,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 10,
  };

  const addBtnLabel = itens.length === 0 ? "Adicionar item" : "Adicionar ou editar itens";

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => {
            console.log("[NovoDelivery] back pressed");
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Novo delivery</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Cliente */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: COLORS.primary,
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Dados do cliente
        </Text>
        <TextInput
          placeholder="Nome do cliente"
          placeholderTextColor={COLORS.textTertiary}
          value={clienteNome}
          onChangeText={setClienteNome}
          style={inputStyle}
        />
        <TextInput
          placeholder="Telefone"
          placeholderTextColor={COLORS.textTertiary}
          value={clienteTelefone}
          onChangeText={setClienteTelefone}
          keyboardType="phone-pad"
          style={inputStyle}
        />

        {/* Endereço */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: COLORS.primary,
            marginBottom: 8,
            marginTop: 6,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Endereço
        </Text>
        <TextInput
          placeholder="Endereço completo"
          placeholderTextColor={COLORS.textTertiary}
          value={endereco}
          onChangeText={setEndereco}
          style={inputStyle}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            placeholder="Bairro"
            placeholderTextColor={COLORS.textTertiary}
            value={bairro}
            onChangeText={setBairro}
            style={{ ...inputStyle, flex: 1 }}
          />
          <TextInput
            placeholder="CEP"
            placeholderTextColor={COLORS.textTertiary}
            value={cep}
            onChangeText={setCep}
            keyboardType="numeric"
            style={{ ...inputStyle, width: 110 }}
          />
        </View>
        <TextInput
          placeholder="Complemento"
          placeholderTextColor={COLORS.textTertiary}
          value={complemento}
          onChangeText={setComplemento}
          style={inputStyle}
        />
        <TextInput
          placeholder="Referência"
          placeholderTextColor={COLORS.textTertiary}
          value={referencia}
          onChangeText={setReferencia}
          style={inputStyle}
        />

        {/* Itens */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: COLORS.primary,
            marginBottom: 8,
            marginTop: 6,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Itens do pedido
        </Text>

        {itens.map((item) => (
          <View
            key={item.prato_id}
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 10,
              borderWidth: 0.5,
              borderColor: COLORS.surfaceSecondary,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {/* Name + price */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>
                  {item.nome}
                </Text>
                <Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: "500", marginTop: 2 }}>
                  {formatCurrency(item.preco * item.quantidade)}
                </Text>
              </View>

              {/* − qty + trash */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <AnimatedPressable
                  onPress={() => decrementItem(item.prato_id)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: COLORS.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Minus size={14} color={COLORS.text} />
                </AnimatedPressable>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: COLORS.text,
                    minWidth: 24,
                    textAlign: "center",
                  }}
                >
                  {item.quantidade}
                </Text>
                <AnimatedPressable
                  onPress={() => incrementItem(item.prato_id)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: COLORS.surfaceSecondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={14} color={COLORS.primary} />
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => removeItem(item.prato_id)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: "#FEE2E2",
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: 4,
                  }}
                >
                  <Trash2 size={14} color="#EF4444" />
                </AnimatedPressable>
              </View>
            </View>

            {/* Observation */}
            <TextInput
              value={item.observacao ?? ""}
              onChangeText={(t) => {
                console.log("[NovoDelivery] observacao alterada para:", item.nome, "—", t);
                updateObservacao(item.prato_id, t);
              }}
              placeholder="Observação (ex: sem cebola)"
              placeholderTextColor={COLORS.textTertiary}
              maxLength={200}
              style={{
                marginTop: 8,
                backgroundColor: COLORS.surfaceSecondary,
                borderWidth: 1,
                borderColor: COLORS.border,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 7,
                fontSize: 13,
                color: COLORS.textSecondary,
              }}
            />
          </View>
        ))}

        {/* Add / edit items button */}
        <AnimatedPressable
          onPress={() => {
            console.log("[NovoDelivery] abrir modal cardapio, itens atuais:", itens.length);
            setShowModal(true);
          }}
          style={{
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: COLORS.primary,
            borderRadius: 10,
            padding: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <Ionicons name="add" size={18} color={COLORS.primary} />
          <Text style={{ fontSize: 14, fontWeight: "500", color: COLORS.primary }}>
            {addBtnLabel}
          </Text>
        </AnimatedPressable>

        {/* Entrega */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: COLORS.primary,
            marginBottom: 8,
            marginTop: 6,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Entrega
        </Text>
        <CampoMoeda
          placeholder="Taxa de entrega (ex: 10,50)"
          placeholderTextColor={COLORS.textTertiary}
          value={taxaEntrega}
          onChangeText={setTaxaEntrega}
          style={inputStyle}
        />
        <TextInput
          placeholder="Observações"
          placeholderTextColor={COLORS.textTertiary}
          value={observacao}
          onChangeText={setObservacao}
          multiline
          style={{ ...inputStyle, minHeight: 60 }}
        />

        {/* Totals */}
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 10,
            borderWidth: 0.5,
            borderColor: COLORS.surfaceSecondary,
            padding: 14,
            marginTop: 6,
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Subtotal</Text>
            <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Taxa de entrega</Text>
            <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(taxa)}</Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingTop: 8,
              borderTopWidth: 0.5,
              borderTopColor: COLORS.surfaceSecondary,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Pagamento */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>
            Pagamento *
          </Text>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {(["na_entrega", "ja_pago"] as const).map((op) => (
              <Pressable
                key={op}
                onPress={() => {
                  console.log("[NovoDelivery] pagMomento selected:", op);
                  setPagMomento(op);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor: pagMomento === op ? COLORS.primary : COLORS.surface,
                  borderWidth: 1,
                  borderColor: pagMomento === op ? COLORS.primary : COLORS.border,
                }}
              >
                <Text
                  style={{
                    color: pagMomento === op ? "#fff" : COLORS.text,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {op === "na_entrega" ? "Paga na entrega" : "Já pago"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>
            {pagMomento === "ja_pago" ? "Forma de pagamento" : "Forma prevista"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                { key: "dinheiro", label: "Dinheiro" },
                { key: "pix", label: "Pix" },
                { key: "credito", label: "Cartão crédito" },
                { key: "debito", label: "Cartão débito" },
              ] as const
            ).map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => {
                  console.log("[NovoDelivery] pagForma selected:", key);
                  setPagForma(key);
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: pagForma === key ? COLORS.primary : COLORS.surface,
                  borderWidth: 1,
                  borderColor: pagForma === key ? COLORS.primary : COLORS.border,
                }}
              >
                <Text style={{ color: pagForma === key ? "#fff" : COLORS.text, fontSize: 13 }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {pagMomento === "na_entrega" && pagForma === "dinheiro" && (
            <View style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>
                Troco para quanto? (opcional)
              </Text>
              <CampoMoeda
                value={trocoPara}
                onChangeText={setTrocoPara}
                placeholder="Ex: 50,00"
                placeholderTextColor={COLORS.textTertiary}
                style={{
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  borderRadius: 8,
                  padding: 10,
                  color: COLORS.text,
                  fontSize: 14,
                }}
              />
            </View>
          )}
        </View>

        {/* Submit */}
        <Pressable
          onPress={submit}
          disabled={saving}
          style={{
            backgroundColor: saving ? COLORS.textTertiary : COLORS.primary,
            borderRadius: 12,
            padding: 16,
            alignItems: "center",
          }}
        >
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Confirmar pedido</Text>
          )}
        </Pressable>
      </ScrollView>

      {/* Dish selector modal */}
      <DishSelectorModal
        visible={showModal}
        initialItens={itens}
        onCommit={handleCommitItens}
        onClose={() => {
          console.log("[NovoDelivery] Modal fechado sem salvar");
          setShowModal(false);
        }}
      />
    </View>
  );
}
