import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { Table } from "@/types";
import { apiGet, apiPost } from "@/utils/api";
import { Minus, Plus, Users } from "lucide-react-native";

export default function NewOrderScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ table_id?: string; table_number?: string }>();

  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>(params.table_id ?? "");
  const [customerCount, setCustomerCount] = useState(2);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchTables = useCallback(async () => {
    console.log("[NewOrder] GET /api/tables");
    try {
      const res = await apiGet<any>("/api/tables");
      const all: Table[] = Array.isArray(res) ? res : (res.tables || []);
      const livres = all.filter((t) => t.status === "livre");
      console.log("[NewOrder] Encontradas", livres.length, "mesas livres");
      setTables(livres);
    } catch (e) {
      console.error("[NewOrder] Erro ao carregar mesas:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTables(); }, [fetchTables]);

  const handleSubmit = async () => {
    if (!selectedTableId) { setError("Selecione uma mesa."); return; }
    if (customerCount < 1) { setError("Número de pessoas deve ser pelo menos 1."); return; }
    console.log("[NewOrder] Criar comanda - mesa:", selectedTableId, "clientes:", customerCount);
    setError("");
    setSubmitting(true);
    try {
      console.log("[NewOrder] POST /api/orders");
      const res = await apiPost<any>("/api/orders", {
        table_id: selectedTableId,
        waiter_id: (user as any)?.id,
        customer_count: customerCount,
        notes: notes.trim() || undefined,
      });
      const orderId = res?.order?.id || res?.id;
      console.log("[NewOrder] Comanda criada:", orderId);
      router.replace(`/order/${orderId}`);
    } catch (e: any) {
      console.error("[NewOrder] Erro ao criar comanda:", e);
      setError("Não foi possível abrir a comanda. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.surface }}>
        <TouchableOpacity
          onPress={() => { console.log("[NewOrder] Botão voltar pressionado"); router.back(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}
        >
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
          <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
        </TouchableOpacity>
        <Text style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 17, fontWeight: "700", color: COLORS.text }}>
          Nova Comanda
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Table picker */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>Selecionar Mesa</Text>
          {loading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : tables.length === 0 ? (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 20, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary }}>Nenhuma mesa livre disponível</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {tables.map((table) => {
                const isSelected = selectedTableId === table.id;
                return (
                  <AnimatedPressable
                    key={table.id}
                    onPress={() => { console.log("[NewOrder] Mesa selecionada:", table.number); setSelectedTableId(table.id); setError(""); }}
                    style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: isSelected ? COLORS.primary : COLORS.surface, borderWidth: 2, borderColor: isSelected ? COLORS.primary : COLORS.border, alignItems: "center", justifyContent: "center", gap: 4 }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: isSelected ? "#fff" : COLORS.text }}>{table.number}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                      <Users size={10} color={isSelected ? "rgba(255,255,255,0.8)" : COLORS.textSecondary} />
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 10, color: isSelected ? "rgba(255,255,255,0.8)" : COLORS.textSecondary }}>{table.capacity}</Text>
                    </View>
                  </AnimatedPressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Customer count */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>Número de Pessoas</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 20, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, alignSelf: "flex-start" }}>
            <AnimatedPressable
              onPress={() => { console.log("[NewOrder] Diminuir contagem de clientes"); setCustomerCount((c) => Math.max(1, c - 1)); }}
              style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}
            >
              <Minus size={18} color={COLORS.text} />
            </AnimatedPressable>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 28, color: COLORS.text, minWidth: 40, textAlign: "center" }}>{customerCount}</Text>
            <AnimatedPressable
              onPress={() => { console.log("[NewOrder] Aumentar contagem de clientes"); setCustomerCount((c) => c + 1); }}
              style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}
            >
              <Plus size={18} color={COLORS.primary} />
            </AnimatedPressable>
          </View>
        </View>

        {/* Notes */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}>Observações</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Ex: cliente alérgico a amendoim..."
            placeholderTextColor={COLORS.textTertiary}
            multiline
            numberOfLines={3}
            style={{ backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 14, fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text, minHeight: 80, textAlignVertical: "top" }}
          />
        </View>

        {!!error && <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>{error}</Text>}

        <AnimatedPressable
          onPress={() => { console.log("[NewOrder] Abrir comanda pressionado"); handleSubmit(); }}
          disabled={submitting || !selectedTableId}
          style={{ backgroundColor: COLORS.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 8 }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>Abrir Comanda</Text>}
        </AnimatedPressable>
      </ScrollView>
    </SafeAreaView>
  );
}
