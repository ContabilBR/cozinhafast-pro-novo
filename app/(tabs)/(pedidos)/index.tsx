import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Animated,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet, apiPut, apiDelete } from "@/utils/api";
import { Plus, Minus } from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { CancelarItemModal } from "@/components/CancelarItemModal";
import { cancelarItem, permissaoCancelarItem, type MotivoCancelamento } from "@/utils/cancelamento";

// ─── API response types ───────────────────────────────────────────────────────

// Flat pedido item returned by GET /api/pedidos
interface ApiPedidoFlat {
  id: string;
  comanda_id: string;
  mesa_numero?: number;
  prato_nome?: string;
  prato?: { nome: string; imagem_url?: string };
  quantidade: number;
  preco_unitario?: number;
  observacao?: string;
  status: "pendente" | "em_preparo" | "pronto" | "entregue" | "cancelado" | string;
  created_at?: string;
}

// Comanda-grouped shape (legacy, kept for fallback)
interface ApiComanda {
  id: string;
  mesa?: { numero: number };
  mesa_numero?: number;
  created_at: string;
  pedidos?: ApiPedidoFlat[];
  itens?: ApiPedidoFlat[];
}

// ─── Internal display types ───────────────────────────────────────────────────

interface GarcomPedidoItem {
  id: string;
  prato_nome: string;
  quantidade: number;
  preco_unitario?: number;
  observacao?: string;
  status: "pendente" | "em_preparo" | "pronto" | "entregue" | "cancelado" | string;
  created_at: string;
}

interface GarcomPedido {
  numero_sequencial: number;
  comanda_id: string;
  mesa_numero: number;
  created_at: string;
  itens: GarcomPedidoItem[];
}

// ─── Normalise raw API response into display shape ────────────────────────────

function normalisePedidos(raw: any): GarcomPedido[] {
  // Handle flat array of pedido items (GET /api/pedidos returns flat list)
  const flatList: ApiPedidoFlat[] = Array.isArray(raw)
    ? raw
    : (raw?.pedidos ?? raw?.comandas ?? []);

  // If the array items have comanda_id, it's a flat pedidos list — group by comanda_id
  if (flatList.length > 0 && "comanda_id" in flatList[0]) {
    const grouped = new Map<string, GarcomPedido>();
    let seq = 1;

    for (const item of flatList) {
      const cid = item.comanda_id;
      if (!grouped.has(cid)) {
        grouped.set(cid, {
          numero_sequencial: seq++,
          comanda_id: cid,
          mesa_numero: item.mesa_numero ?? 0,
          created_at: item.created_at ?? "",
          itens: [],
        });
      }
      const group = grouped.get(cid)!;
      // Update mesa_numero if we get a better value
      if (item.mesa_numero && !group.mesa_numero) {
        group.mesa_numero = item.mesa_numero;
      }
      group.itens.push({
        id: item.id,
        prato_nome: item.prato?.nome ?? item.prato_nome ?? "Prato",
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        observacao: item.observacao,
        status: item.status ?? "aguardando",
        created_at: item.created_at ?? "",
      });
    }

    return Array.from(grouped.values());
  }

  // Fallback: treat as comanda-grouped shape
  const comandas: ApiComanda[] = flatList as unknown as ApiComanda[];
  return comandas.map((comanda, idx) => {
    const mesaNumero = comanda.mesa?.numero ?? comanda.mesa_numero ?? 0;
    const rawItems: ApiPedidoFlat[] = comanda.pedidos ?? comanda.itens ?? [];

    const itens: GarcomPedidoItem[] = rawItems.map((item) => ({
      id: item.id,
      prato_nome: item.prato?.nome ?? item.prato_nome ?? "Prato",
      quantidade: item.quantidade,
      preco_unitario: item.preco_unitario,
      observacao: item.observacao,
      status: item.status ?? "aguardando",
      created_at: item.created_at ?? comanda.created_at,
    }));

    return {
      numero_sequencial: idx + 1,
      comanda_id: comanda.id,
      mesa_numero: mesaNumero,
      created_at: comanda.created_at,
      itens,
    };
  });
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const COLORS = useColors();
  // Guard: ensure onConfirm fires at most once per modal open
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (visible) {
      confirmedRef.current = false;
    }
  }, [visible]);

  const handleConfirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
        onPress={onCancel}
      >
        <Pressable
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 18,
            padding: 24,
            width: "100%",
            maxWidth: 340,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 10,
          }}
          onPress={() => {}}
        >
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 17,
              color: COLORS.text,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.textSecondary,
              lineHeight: 20,
              marginBottom: 24,
            }}
          >
            {message}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: COLORS.surfaceSecondary,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 15,
                  color: COLORS.text,
                }}
              >
                Cancelar
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#EF4444",
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 15,
                  color: "#fff",
                }}
              >
                Excluir
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pendente:   { label: "Pendente",    bg: "#94A3B820", text: "#94A3B8" },
  em_preparo: { label: "Em Preparo",  bg: "#F59E0B20", text: "#F59E0B" },
  pronto:     { label: "Pronto",      bg: "#22C55E20", text: "#22C55E" },
  entregue:   { label: "Entregue",    bg: "#0D908820", text: "#0D9088" },
  cancelado:  { label: "Cancelado",   bg: "#EF444420", text: "#EF4444" },
  // legado — manter para compatibilidade com dados antigos
  aguardando: { label: "Aguardando",  bg: "#94A3B820", text: "#94A3B8" },
  preparando: { label: "Em Preparo",  bg: "#F59E0B20", text: "#F59E0B" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, bg: "#94A3B8", text: "#fff" };
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${day}, ${time}`;
  } catch {
    return iso;
  }
}

function ItemRow({
  item,
  role,
  onCancel,
  onUpdate,
}: {
  item: GarcomPedidoItem;
  role: string | null | undefined;
  onCancel: (id: string, motivo: MotivoCancelamento, detalhe: string | null) => Promise<void>;
  onUpdate: (id: string, fields: { quantidade?: number; observacao?: string }) => void;
}) {
  const COLORS = useColors();
  const cfg = getStatusConfig(item.status);

  const [obsValue, setObsValue] = useState(item.observacao ?? "");
  const [obsFocused, setObsFocused] = useState(false);
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cancelarVisivel, setCancelarVisivel] = useState(false);
  const permissao = permissaoCancelarItem(role, item.status);
  const cancelado = item.status === "cancelado";
  // Garçom diante de item já iniciado: mostra um cadeado explicando por que não pode cancelar
  const bloqueadoPorPapel = !permissao.pode && permissao.aposInicio;

  // Debounce ref for observacao
  const obsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync if parent refreshes the item
  useEffect(() => {
    setObsValue(item.observacao ?? "");
    setQuantidade(item.quantidade);
  }, [item.observacao, item.quantidade]);

  const saveField = useCallback(
    async (fields: { quantidade?: number; observacao?: string }) => {
      console.log("[Pedidos] PUT /api/pedidos/" + item.id, fields);
      setSaving(true);
      setSaveError("");
      try {
        await apiPut<any>(`/api/pedidos/${item.id}`, fields);
        console.log("[Pedidos] Pedido atualizado:", item.id, fields);
        onUpdate(item.id, fields);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Pedidos] Erro ao atualizar pedido:", msg);
        setSaveError("Não foi possível salvar");
        // Revert local state on error
        setObsValue(item.observacao ?? "");
        setQuantidade(item.quantidade);
      } finally {
        setSaving(false);
      }
    },
    [item.id, item.observacao, item.quantidade, onUpdate]
  );

  const handleObsChange = (t: string) => {
    setObsValue(t);
    setSaveError("");
    if (obsDebounceRef.current) clearTimeout(obsDebounceRef.current);
    obsDebounceRef.current = setTimeout(() => {
      const trimmed = t.trim();
      const original = (item.observacao ?? "").trim();
      if (trimmed !== original) {
        console.log("[Pedidos] Debounce disparado — salvar observacao pedido:", item.id);
        saveField({ observacao: trimmed });
      }
    }, 800);
  };

  // Clear debounce on unmount
  useEffect(() => {
    return () => {
      if (obsDebounceRef.current) clearTimeout(obsDebounceRef.current);
    };
  }, []);

  const handleDecrement = () => {
    if (quantidade <= 1) return;
    const next = quantidade - 1;
    console.log("[Pedidos] Diminuir quantidade — pedido:", item.id, "->", next);
    setQuantidade(next);
    saveField({ quantidade: next });
  };

  const handleIncrement = () => {
    const next = quantidade + 1;
    console.log("[Pedidos] Aumentar quantidade — pedido:", item.id, "->", next);
    setQuantidade(next);
    saveField({ quantidade: next });
  };

  const handleCancelarPress = () => {
    console.log("[Pedidos] Cancelar item pressionado — pedido:", item.id, "prato:", item.prato_nome);
    setCancelarVisivel(true);
  };

  const handleBloqueadoPress = () => {
    Alert.alert("Cancelamento não permitido", permissao.motivoNegado ?? "Você não pode cancelar este item.");
  };

  // Item cancelado: só mostra o nome riscado e o selo "Cancelado" (sem quantidade nem observação editáveis)
  if (cancelado) {
    return (
      <View style={{ paddingVertical: 10, opacity: 0.6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text
            style={{
              fontFamily: "Outfit_500Medium",
              fontSize: 14,
              color: COLORS.textSecondary,
              flex: 1,
              marginRight: 8,
              textDecorationLine: "line-through",
            }}
          >
            {quantidade}x {item.prato_nome}
          </Text>
          <View style={{ backgroundColor: cfg.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: cfg.text }}>{cfg.label}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: 10 }}>
      <CancelarItemModal
        visible={cancelarVisivel}
        pratoNome={item.prato_nome}
        aposInicio={permissao.aposInicio}
        onClose={() => setCancelarVisivel(false)}
        onConfirm={(motivo, detalhe) => onCancel(item.id, motivo, detalhe)}
      />
      {/* Top row: name + status badge + cancelar */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <Text
          style={{
            fontFamily: "Outfit_500Medium",
            fontSize: 14,
            color: COLORS.text,
            flex: 1,
            marginRight: 8,
          }}
        >
          {item.prato_nome}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              backgroundColor: cfg.bg,
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: cfg.text }}>
              {cfg.label}
            </Text>
          </View>

          {/* Cancelar item (garçom, gerente e administrador) */}
          {permissao.pode ? (
            <Pressable
              onPress={handleCancelarPress}
              disabled={saving}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => ({ opacity: saving ? 0.4 : pressed ? 0.5 : 1, padding: 2 })}
            >
              <Ionicons name="close-circle-outline" size={19} color="#EF4444" />
            </Pressable>
          ) : bloqueadoPorPapel ? (
            <Pressable
              onPress={handleBloqueadoPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ padding: 2 }}
            >
              <Ionicons name="lock-closed-outline" size={17} color={COLORS.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Quantity controls */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
        <Pressable
          onPress={handleDecrement}
          disabled={saving || quantidade <= 1}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={({ pressed }) => ({
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: COLORS.surfaceSecondary,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || quantidade <= 1 ? 0.4 : 1,
          })}
        >
          <Minus size={13} color={COLORS.text} />
        </Pressable>

        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.primary, minWidth: 20, textAlign: "center" }}>
          {quantidade}
        </Text>

        <Pressable
          onPress={handleIncrement}
          disabled={saving}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={({ pressed }) => ({
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: COLORS.primaryMuted,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Plus size={13} color={COLORS.primary} />
        </Pressable>

        {saving && (
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginLeft: 4 }} />
        )}
      </View>

      {/* Observações field */}
      <View style={{ marginTop: 8 }}>
        <Text
          style={{
            fontFamily: "Outfit_500Medium",
            fontSize: 11,
            color: COLORS.textSecondary,
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Observações
        </Text>
        <TextInput
          value={obsValue}
          onChangeText={handleObsChange}
          onFocus={() => {
            console.log("[Pedidos] Campo observação focado — pedido:", item.id);
            setObsFocused(true);
          }}
          onBlur={() => setObsFocused(false)}
          placeholder="Ex: sem cebola, bem passado..."
          placeholderTextColor={COLORS.textTertiary ?? "#bbb"}
          multiline
          editable={!saving}
          style={{
            fontFamily: "Outfit_400Regular",
            fontSize: 13,
            color: COLORS.text,
            backgroundColor: COLORS.surfaceSecondary ?? "#f5f5f5",
            borderRadius: 10,
            borderWidth: 1,
            borderColor: obsFocused ? COLORS.primary : (COLORS.border ?? "#e5e5e5"),
            paddingHorizontal: 10,
            paddingVertical: 7,
            minHeight: 36,
            lineHeight: 18,
            opacity: saving ? 0.6 : 1,
          }}
        />
        {!!saveError && (
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 11,
              color: "#ef4444",
              marginTop: 3,
            }}
          >
            {saveError}
          </Text>
        )}
      </View>
    </View>
  );
}

function PedidoCard({
  pedido,
  index,
  onCancelItem,
  onDeleteComanda,
  onUpdateItem,
  role,
}: {
  pedido: GarcomPedido;
  index: number;
  onCancelItem: (comandaId: string, itemId: string, motivo: MotivoCancelamento, detalhe: string | null) => Promise<void>;
  onDeleteComanda: (comandaId: string) => void;
  onUpdateItem: (comandaId: string, itemId: string, fields: { quantidade?: number; observacao?: string }) => void;
  role: string | null | undefined;
}) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        delay: index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 380,
        delay: index * 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  const dateStr = formatDateTime(pedido.created_at);
  // Itens cancelados não contam como itens do pedido
  const itemCount = pedido.itens.filter((it) => it.status !== "cancelado").length;
  const canceladosCount = pedido.itens.length - itemCount;
  const itemCountLabel =
    itemCount === 0 && canceladosCount > 0
      ? "Todos os itens foram cancelados"
      : `${itemCount} ${itemCount === 1 ? "item" : "itens"}` +
        (canceladosCount > 0 ? ` · ${canceladosCount} cancelado${canceladosCount > 1 ? "s" : ""}` : "");
  const pedidoLabel = `Pedido #${pedido.numero_sequencial}`;
  const mesaLabel = `Mesa ${pedido.mesa_numero}`;

  const [confirmDeleteComandaVisible, setConfirmDeleteComandaVisible] = useState(false);

  const handleDeleteComandaPress = () => {
    console.log("[Pedidos] Trash icon pressed — comanda:", pedido.comanda_id, "mesa:", pedido.mesa_numero);
    setConfirmDeleteComandaVisible(true);
  };

  const handleDeleteComandaConfirm = () => {
    console.log("[Pedidos] Confirmado — DELETE /api/comandas/" + pedido.comanda_id);
    setConfirmDeleteComandaVisible(false);
    onDeleteComanda(pedido.comanda_id);
  };

  const handleDeleteComandaCancel = () => {
    console.log("[Pedidos] Exclusão de comanda cancelada:", pedido.comanda_id);
    setConfirmDeleteComandaVisible(false);
  };

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }],
        marginHorizontal: 16,
        marginBottom: 14,
      }}
    >
      <ConfirmDeleteModal
        visible={confirmDeleteComandaVisible}
        title="Excluir pedido?"
        message="Isso irá remover todos os pratos desta comanda. Deseja continuar?"
        onCancel={handleDeleteComandaCancel}
        onConfirm={handleDeleteComandaConfirm}
      />
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: COLORS.border,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 2,
        }}
      >
        {/* Card header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: COLORS.surfaceSecondary,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
          }}
        >
          {/* Left: order number + date */}
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 17,
                color: COLORS.text,
                letterSpacing: -0.2,
              }}
            >
              {pedidoLabel}
            </Text>
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 12,
                color: COLORS.textSecondary,
                marginTop: 2,
              }}
            >
              {dateStr}
            </Text>
          </View>

          {/* Right: Mesa pill + delete comanda */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 13,
                  color: "#fff",
                }}
              >
                {mesaLabel}
              </Text>
            </View>

            {/* Delete comanda button */}
            <Pressable
              onPress={handleDeleteComandaPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.5 : 1,
                padding: 4,
              })}
            >
              <Ionicons name="trash-outline" size={19} color="#EF4444" />
            </Pressable>
          </View>
        </View>

        {/* Items list */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          {pedido.itens.map((item, i) => (
            <View key={item.id}>
              <ItemRow
                item={item}
                role={role}
                onCancel={(itemId, motivo, detalhe) => onCancelItem(pedido.comanda_id, itemId, motivo, detalhe)}
                onUpdate={(itemId, fields) => onUpdateItem(pedido.comanda_id, itemId, fields)}
              />
              {i < pedido.itens.length - 1 && (
                <View
                  style={{
                    height: 1,
                    backgroundColor: COLORS.divider,
                  }}
                />
              )}
            </View>
          ))}
        </View>

        {/* Card footer */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: COLORS.divider,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Ionicons name="receipt-outline" size={13} color={COLORS.textSecondary} />
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 12,
              color: COLORS.textSecondary,
            }}
          >
            {itemCountLabel}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function SkeletonCard() {
  const COLORS = useColors();
  return (
    <View
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: COLORS.border,
        overflow: "hidden",
      }}
    >
      {/* Header skeleton */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: COLORS.surfaceSecondary,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <View style={{ gap: 6 }}>
          <SkeletonLine width={110} height={16} />
          <SkeletonLine width={80} height={12} />
        </View>
        <SkeletonLine width={72} height={32} borderRadius={20} />
      </View>
      {/* Body skeleton */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <SkeletonLine width={160} height={14} />
          <SkeletonLine width={80} height={24} borderRadius={20} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <SkeletonLine width={130} height={14} />
          <SkeletonLine width={70} height={24} borderRadius={20} />
        </View>
      </View>
    </View>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 40, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, translateY, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 80,
        left: 0,
        right: 0,
        alignItems: "center",
        opacity,
        transform: [{ translateY }],
        zIndex: 999,
      }}
    >
      <View
        style={{
          backgroundColor: "#333",
          borderRadius: 24,
          paddingHorizontal: 20,
          paddingVertical: 11,
          maxWidth: 280,
        }}
      >
        <Text
          style={{
            fontFamily: "Outfit_500Medium",
            fontSize: 14,
            color: "#fff",
            textAlign: "center",
          }}
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function PedidosGarcomScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;

  const [pedidos, setPedidos] = useState<GarcomPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const fetchPedidos = useCallback(async () => {
    console.log("[Pedidos Garçom] Fetching GET /api/pedidos");
    try {
      const data = await apiGet<any>("/api/pedidos");
      console.log("[Pedidos] raw:", JSON.stringify(data).slice(0, 500));

      const list = normalisePedidos(data);
      console.log("[Pedidos Garçom] Loaded", list.length, "comandas");
      setPedidos(list);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Pedidos Garçom] Fetch error:", msg);
      setError("Não foi possível carregar os pedidos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchPedidos();
    }, [fetchPedidos])
  );

  const handleRefresh = () => {
    console.log("[Pedidos Garçom] Pull-to-refresh triggered");
    setRefreshing(true);
    fetchPedidos();
  };

  const handleRetry = () => {
    console.log("[Pedidos Garçom] Retry button pressed");
    setLoading(true);
    setError("");
    fetchPedidos();
  };

  const handleBack = () => {
    console.log("[Pedidos Garçom] Back button pressed");
    router.back();
  };

  // Cancela um item (não é venda). Erros sobem para o modal, que mostra a mensagem do servidor.
  const handleCancelItem = useCallback(
    async (comandaId: string, itemId: string, motivo: MotivoCancelamento, detalhe: string | null) => {
      console.log("[Pedidos] PUT /api/pedidos/" + itemId + "/cancelar (comanda:", comandaId + ")", motivo);
      const res = await cancelarItem(itemId, motivo, detalhe);
      showToast(res.cancelado_apos_inicio ? "Item cancelado (registrado como perda)" : "Item cancelado");
      // Re-fetch para atualizar itens e totais
      await fetchPedidos();
    },
    [fetchPedidos, showToast]
  );

  const handleDeleteComanda = useCallback(async (comandaId: string) => {
    console.log("[Pedidos] DELETE /api/comandas/" + comandaId);
    try {
      await apiDelete(`/api/comandas/${comandaId}`);
      console.log("[Pedidos] Comanda deletada com sucesso:", comandaId);
      showToast("Item excluído com sucesso");
      // Remove entire comanda from local state
      setPedidos((prev) => prev.filter((p) => p.comanda_id !== comandaId));
      // Refresh to sync totals
      fetchPedidos();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Pedidos] Erro ao deletar comanda:", msg);
      Alert.alert("Erro", "Não foi possível remover o pedido. Tente novamente.");
    }
  }, [fetchPedidos, showToast]);

  const handleUpdateItem = useCallback(
    async (comandaId: string, itemId: string, fields: { quantidade?: number; observacao?: string }) => {
      console.log("[Pedidos] handleUpdateItem — comanda:", comandaId, "item:", itemId, fields);
      // Update local state optimistically
      setPedidos((prev) =>
        prev.map((p) =>
          p.comanda_id === comandaId
            ? {
                ...p,
                itens: p.itens.map((it) =>
                  it.id === itemId ? { ...it, ...fields } : it
                ),
              }
            : p
        )
      );
      showToast("Pedido atualizado");
      // Refresh to sync comanda totals from backend
      fetchPedidos();
    },
    [fetchPedidos, showToast]
  );

  const pedidoCount = pedidos.length;
  const pedidoCountLabel = `${pedidoCount} ${pedidoCount === 1 ? "pedido" : "pedidos"}`;
  const subtitleText = loading ? "Carregando..." : pedidoCountLabel;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Custom header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 14,
          paddingHorizontal: 16,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingVertical: 4,
            paddingRight: 8,
            opacity: pressed ? 0.6 : 1,
          })}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 15,
              color: COLORS.primary,
            }}
          >
            Voltar
          </Text>
        </Pressable>

        {/* Title centered */}
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 17,
              color: COLORS.text,
              letterSpacing: -0.2,
            }}
          >
            Meus Pedidos
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 12,
              color: COLORS.textSecondary,
              marginTop: 1,
            }}
          >
            {subtitleText}
          </Text>
        </View>

        {/* Spacer to balance back button */}
        <View style={{ width: 70 }} />
      </View>

      {/* Content */}
      {loading ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}
          scrollEnabled={false}
        >
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </ScrollView>
      ) : error ? (
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
            <Ionicons name="alert-circle-outline" size={34} color={COLORS.danger} />
          </View>
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 17,
              color: COLORS.text,
              textAlign: "center",
            }}
          >
            Erro ao carregar pedidos
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
            onPress={handleRetry}
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 12,
              paddingHorizontal: 28,
              paddingVertical: 13,
              marginTop: 4,
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
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingTop: 16,
            paddingBottom: 120,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
        >
          {pedidos.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 40,
                paddingTop: 80,
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
                <Ionicons name="clipboard-outline" size={38} color={COLORS.primary} />
              </View>
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 18,
                  color: COLORS.text,
                  textAlign: "center",
                  marginTop: 4,
                }}
              >
                Nenhum pedido encontrado
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
                Os pedidos que você registrar aparecerão aqui
              </Text>
            </View>
          ) : (
            pedidos.map((pedido, index) => (
              <PedidoCard
                key={`${pedido.comanda_id}-${pedido.numero_sequencial}`}
                pedido={pedido}
                index={index}
                onCancelItem={handleCancelItem}
                onDeleteComanda={handleDeleteComanda}
                onUpdateItem={handleUpdateItem}
                role={role}
              />
            ))
          )}
        </ScrollView>
      )}
      <Toast message={toastMessage} visible={toastVisible} />
    </View>
  );
}
