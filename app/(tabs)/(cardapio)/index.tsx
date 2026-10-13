import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TextInput,
  Animated,
  SectionList,
  ImageSourcePropType,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet, apiPatch } from "@/utils/api";
import { useAuth } from "@/contexts/AuthContext";
import { Search, UtensilsCrossed, X, Check, Ban } from "lucide-react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Categoria {
  id: string;
  nome: string;
  descricao?: string;
}

interface Prato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  imagem_url?: string;
  disponivel?: boolean;
  categoria_id?: string;
  categoria?: { id?: string; nome: string };
}

interface SectionData {
  title: string;
  icon: string;
  data: Prato[];
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

const CATEGORY_ICONS: Record<string, string> = {
  "Entradas": "🥗",
  "Pratos Principais": "🍽",
  "Carnes": "🥩",
  "Peixes": "🐟",
  "Massas": "🍝",
  "Pizzas": "🍕",
  "Saladas": "🥗",
  "Sobremesas": "🍮",
  "Bebidas": "🥤",
  "Sucos": "🧃",
  "Cervejas": "🍺",
  "Vinhos": "🍷",
  "Outros": "🍴",
};

function getCategoryIcon(nome: string): string {
  return CATEGORY_ICONS[nome] || "🍴";
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PratoCardSkeleton() {
  const COLORS = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 16,
        marginBottom: 10,
        backgroundColor: COLORS.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 12,
      }}
    >
      <SkeletonLine width={72} height={72} borderRadius={10} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonLine width="65%" height={15} />
        <SkeletonLine width="85%" height={11} />
        <SkeletonLine width="35%" height={14} />
      </View>
    </View>
  );
}

function SectionSkeleton() {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 }}>
        <SkeletonLine width={140} height={18} />
      </View>
      {[0, 1, 2].map((i) => (
        <PratoCardSkeleton key={i} />
      ))}
    </View>
  );
}

// ─── Prato Card ───────────────────────────────────────────────────────────────

function PratoCard({
  prato,
  index,
  podeAlternarDisponibilidade,
  onToggleDisponibilidade,
}: {
  prato: Prato;
  index: number;
  podeAlternarDisponibilidade?: boolean;
  onToggleDisponibilidade?: (id: string, novoValor: boolean) => void;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay: index * 40,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        delay: index * 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  const precoDisplay = formatPreco(prato.preco);
  const cardOpacity = prato.disponivel === false ? 0.5 : 1;
  const hasImage = !!prato.imagem_url;

  return (
    <Animated.View
      style={{
        opacity: Animated.multiply(opacity, new Animated.Value(cardOpacity)),
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 10,
          backgroundColor: COLORS.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: COLORS.border,
          padding: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 1,
          opacity: cardOpacity,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {/* Image */}
          {hasImage ? (
            <Image
              source={resolveImageSource(prato.imagem_url)}
              style={{ width: 72, height: 72, borderRadius: 10 }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 10,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <UtensilsCrossed size={24} color={COLORS.textTertiary} />
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
                fontSize: 15,
                color: "#22C55E",
                marginTop: 2,
              }}
            >
              {precoDisplay}
            </Text>
          </View>
        </View>

        {/* Disponibilidade: badge estático, ou botão de alternar para quem pode.
            Fica numa linha própria, abaixo do nome/descrição/preço, para ter
            espaço de sobra pro texto sem espremer o resto do card. */}
        {podeAlternarDisponibilidade && onToggleDisponibilidade ? (
          <AnimatedPressable
            onPress={() => onToggleDisponibilidade(prato.id, prato.disponivel === false)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              alignSelf: "flex-start",
              gap: 4,
              marginTop: 10,
              backgroundColor: prato.disponivel === false ? "#EF444420" : "#22C55E20",
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            {prato.disponivel === false ? (
              <Ban size={12} color="#EF4444" />
            ) : (
              <Check size={12} color="#22C55E" />
            )}
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 10,
                color: prato.disponivel === false ? "#EF4444" : "#22C55E",
                letterSpacing: 0.3,
              }}
            >
              {prato.disponivel === false ? "Esgotado — toque p/ voltar" : "Disponível — toque p/ esgotar"}
            </Text>
          </AnimatedPressable>
        ) : (
          prato.disponivel === false && (
            <View
              style={{
                alignSelf: "flex-start",
                marginTop: 10,
                backgroundColor: COLORS.surfaceSecondary,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 10,
                  color: COLORS.textTertiary,
                  letterSpacing: 0.3,
                }}
              >
                Indisponível
              </Text>
            </View>
          )
        )}
      </View>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CardapioScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const listPaddingBottom = insets.bottom + 96;
  const { user } = useAuth();
  const [pratos, setPratos] = useState<Prato[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const podeAlternarDisponibilidade =
    user?.role === "cozinheiro" ||
    user?.role === "gerente" ||
    user?.role === "administrador" ||
    user?.role === "admin";

  const handleToggleDisponibilidade = useCallback(async (id: string, novoValor: boolean) => {
    // Optimistic update — reverte se a chamada falhar.
    setPratos((prev) => prev.map((p) => (p.id === id ? { ...p, disponivel: novoValor } : p)));
    try {
      console.log("[Cardápio] PATCH /api/pratos/" + id + "/disponibilidade ->", novoValor);
      await apiPatch(`/api/pratos/${id}/disponibilidade`, { disponivel: novoValor });
    } catch (e) {
      console.error("[Cardápio] Erro ao alternar disponibilidade:", e);
      setPratos((prev) => prev.map((p) => (p.id === id ? { ...p, disponivel: !novoValor } : p)));
    }
  }, []);

  const fetchData = useCallback(async () => {
    console.log("[Cardápio] GET /api/pratos e /api/categorias");
    try {
      const [pratosRes, categoriasRes] = await Promise.all([
        apiGet<any>("/api/pratos"),
        apiGet<any>("/api/categorias"),
      ]);
      const pratosList: Prato[] = Array.isArray(pratosRes)
        ? pratosRes
        : (pratosRes.pratos ?? []);
      const categoriasList: Categoria[] = Array.isArray(categoriasRes)
        ? categoriasRes
        : (categoriasRes.categorias ?? []);
      console.log("[Cardápio] Pratos:", pratosList.length, "Categorias:", categoriasList.length);
      setPratos(pratosList);
      setCategorias(categoriasList);
      setError("");
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Cardápio] Erro ao carregar dados:", msg);
      setError("Não foi possível carregar o cardápio.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData])
  );

  // Build sections from categories + pratos (respects selectedCategoryId)
  const sections: SectionData[] = React.useMemo(() => {
    const result: SectionData[] = [];
    const usedPratoIds = new Set<string>();

    // Deduplicate categories by ID to prevent duplicate section headers
    const seenCatIds = new Set<string>();
    const uniqueCategorias = categorias.filter((c) => {
      if (seenCatIds.has(c.id)) return false;
      seenCatIds.add(c.id);
      return true;
    });

    const filteredCats = selectedCategoryId
      ? uniqueCategorias.filter((c) => c.id === selectedCategoryId)
      : uniqueCategorias;

    for (const cat of filteredCats) {
      const catPratos = pratos.filter((p) => {
        const catId = p.categoria_id || p.categoria?.id;
        return catId === cat.id;
      });
      if (catPratos.length > 0) {
        catPratos.forEach((p) => usedPratoIds.add(p.id));
        result.push({
          title: cat.nome,
          icon: getCategoryIcon(cat.nome),
          data: catPratos,
        });
      }
    }

    // Pratos without a matched category — only show when no category filter active
    if (!selectedCategoryId) {
      const outros = pratos.filter((p) => !usedPratoIds.has(p.id));
      if (outros.length > 0) {
        result.push({ title: "Outros", icon: "🍴", data: outros });
      }
    }

    return result;
  }, [pratos, categorias, selectedCategoryId]);

  const categoriasComPratos = React.useMemo(() => {
    const idsComPratos = new Set(
      pratos
        .map(p => p.categoria_id || p.categoria?.id)
        .filter(Boolean)
    );
    return categorias.filter(c => idsComPratos.has(c.id));
  }, [pratos, categorias]);

  // Search filter — applies on top of category filter
  const searchLower = searchQuery.toLowerCase().trim();
  const isSearching = searchLower.length > 0;

  const searchPool = selectedCategoryId
    ? pratos.filter((p) => {
        const catId = p.categoria_id || p.categoria?.id;
        return catId === selectedCategoryId;
      })
    : pratos;

  const searchResults = isSearching
    ? searchPool.filter(
        (p) =>
          p.nome.toLowerCase().includes(searchLower) ||
          (p.descricao || "").toLowerCase().includes(searchLower)
      )
    : [];

  const totalPratos = pratos.length;
  const subtitleText = loading ? "Carregando..." : `${totalPratos} pratos`;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 0,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <Text
          style={{
            fontFamily: "Outfit_700Bold",
            fontSize: 26,
            color: COLORS.text,
            letterSpacing: -0.3,
          }}
        >
          Cardápio
        </Text>
        <Text
          style={{
            fontFamily: "Outfit_400Regular",
            fontSize: 13,
            color: COLORS.textSecondary,
            marginTop: 2,
          }}
        >
          {subtitleText}
        </Text>

        {/* Category chips row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* "Todas" chip */}
          <Pressable
            onPress={() => {
              console.log("[Cardápio] Chip 'Todas' selecionado");
              setSelectedCategoryId(null);
            }}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 20,
              backgroundColor: selectedCategoryId === null ? COLORS.primary : COLORS.surfaceSecondary,
              borderWidth: 1,
              borderColor: selectedCategoryId === null ? COLORS.primary : COLORS.border,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: selectedCategoryId === null ? "Outfit_700Bold" : "Outfit_500Medium",
                fontSize: 13,
                color: selectedCategoryId === null ? "#fff" : COLORS.textSecondary,
              }}
            >
              Todas
            </Text>
          </Pressable>

          {/* One chip per category */}
          {categoriasComPratos.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            const icon = getCategoryIcon(cat.nome);
            return (
              <Pressable
                key={cat.id}
                onPress={() => {
                  console.log("[Cardápio] Chip categoria selecionado:", cat.nome, "id:", cat.id);
                  setSelectedCategoryId(isSelected ? null : cat.id);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: isSelected ? COLORS.primary : COLORS.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: isSelected ? COLORS.primary : COLORS.border,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ fontSize: 13 }}>{icon}</Text>
                <Text
                  style={{
                    fontFamily: isSelected ? "Outfit_700Bold" : "Outfit_500Medium",
                    fontSize: 13,
                    color: isSelected ? "#fff" : COLORS.textSecondary,
                  }}
                >
                  {cat.nome}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Search bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 14,
            borderWidth: 1.5,
            borderColor: searchFocused ? COLORS.primary : "transparent",
            gap: 8,
          }}
        >
          <Search size={16} color={searchFocused ? COLORS.primary : COLORS.textTertiary} />
          <TextInput
            value={searchQuery}
            onChangeText={(text) => {
              console.log("[Cardápio] Busca alterada:", text);
              setSearchQuery(text);
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Buscar prato ou descrição..."
            placeholderTextColor={COLORS.textTertiary}
            style={{
              flex: 1,
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.text,
              padding: 0,
            }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <AnimatedPressable
              onPress={() => {
                console.log("[Cardápio] Limpar busca pressionado");
                setSearchQuery("");
              }}
            >
              <X size={16} color={COLORS.textSecondary} />
            </AnimatedPressable>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: listPaddingBottom }}>
          <SectionSkeleton />
          <SectionSkeleton />
        </ScrollView>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 12,
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
            {error}
          </Text>
          <AnimatedPressable
            onPress={() => {
              console.log("[Cardápio] Tentar novamente pressionado");
              setLoading(true);
              fetchData();
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
      ) : isSearching ? (
        // ── Search results (flat list) ──
        <ScrollView
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listPaddingBottom }}
          keyboardShouldPersistTaps="handled"
        >
          {searchResults.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: 48,
                gap: 12,
                marginTop: 32,
              }}
            >
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
                <Search size={32} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 17,
                  color: COLORS.text,
                }}
              >
                Nenhum resultado
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                  maxWidth: 260,
                }}
              >
                Nenhum prato encontrado para "{searchQuery}"
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  paddingHorizontal: 20,
                  paddingBottom: 10,
                }}
              >
                {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
              </Text>
              {searchResults.map((prato, idx) => (
                <PratoCard
                  key={prato.id}
                  prato={prato}
                  index={idx}
                  podeAlternarDisponibilidade={podeAlternarDisponibilidade}
                  onToggleDisponibilidade={handleToggleDisponibilidade}
                />
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        // ── Category sections ──
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: listPaddingBottom }}
          contentInsetAdjustmentBehavior="automatic"
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                console.log("[Cardápio] Pull-to-refresh acionado");
                setRefreshing(true);
                fetchData();
              }}
              tintColor={COLORS.primary}
            />
          }
          renderSectionHeader={({ section }) => (
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 18 }}>{section.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "Outfit_700Bold",
                    fontSize: 16,
                    color: COLORS.text,
                    letterSpacing: -0.2,
                  }}
                >
                  {section.title}
                </Text>
                <View
                  style={{
                    height: 2,
                    width: 24,
                    backgroundColor: COLORS.primary,
                    borderRadius: 2,
                    marginTop: 3,
                  }}
                />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 12,
                  color: COLORS.textTertiary,
                }}
              >
                {section.data.length}
              </Text>
            </View>
          )}
          renderItem={({ item, index }) => (
            <PratoCard
              prato={item}
              index={index}
              podeAlternarDisponibilidade={podeAlternarDisponibilidade}
              onToggleDisponibilidade={handleToggleDisponibilidade}
            />
          )}
          ListEmptyComponent={
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: 48,
                gap: 12,
                marginTop: 32,
              }}
            >
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
                <UtensilsCrossed size={32} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 17,
                  color: COLORS.text,
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
                  maxWidth: 260,
                }}
              >
                O cardápio está vazio no momento
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
