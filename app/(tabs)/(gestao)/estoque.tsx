import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, ActivityIndicator, Modal, TextInput, TouchableOpacity, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { apiGet, apiPost, apiPut, apiDelete } from "@/utils/api";
import { CampoMoeda } from "@/components/CampoMoeda";

const UNIDADES = ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"];

interface Insumo {
  id: string;
  nome: string;
  descricao?: string;
  unidade: string;
  estoqueAtual: string;
  estoqueMinimo: string;
  custoUnitario: string;
  ativo: boolean;
}

export default function EstoqueScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [alertas, setAlertas] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"todos" | "alertas">("todos");

  // Modal cadastro/edição
  const [showModal, setShowModal] = useState(false);
  const [editingInsumo, setEditingInsumo] = useState<Insumo | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [unidade, setUnidade] = useState("un");
  const [estoqueMinimo, setEstoqueMinimo] = useState("");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [saving, setSaving] = useState(false);

  // Modal movimentação
  const [showMovModal, setShowMovModal] = useState(false);
  const [movInsumo, setMovInsumo] = useState<Insumo | null>(null);
  const [movTipo, setMovTipo] = useState<"entrada" | "saida">("entrada");
  const [movQtd, setMovQtd] = useState("");
  const [movMotivo, setMovMotivo] = useState("");
  const [movSaving, setMovSaving] = useState(false);

  const fetchData = useCallback(async () => {
    console.log("[EstoqueScreen] fetchData: loading insumos and alertas");
    try {
      const [insRes, alertRes] = await Promise.all([
        apiGet<any>("/api/insumos"),
        apiGet<any>("/api/insumos/alertas"),
      ]);
      console.log("[EstoqueScreen] fetchData: insumos loaded", insRes.insumos?.length, "alertas", alertRes.alertas?.length);
      setInsumos(insRes.insumos || []);
      setAlertas(alertRes.alertas || []);
    } catch (e) {
      console.error("Erro ao carregar estoque:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData(); }, [fetchData]));

  const filtered = (tab === "alertas" ? alertas : insumos)
    .filter((i) => i.nome.toLowerCase().includes(search.toLowerCase()));

  const openNew = () => {
    console.log("[EstoqueScreen] openNew: opening new insumo modal");
    setEditingInsumo(null); setNome(""); setDescricao(""); setUnidade("un");
    setEstoqueMinimo(""); setCustoUnitario(""); setShowModal(true);
  };

  const openEdit = (insumo: Insumo) => {
    console.log("[EstoqueScreen] openEdit: editing insumo", insumo.id, insumo.nome);
    setEditingInsumo(insumo); setNome(insumo.nome); setDescricao(insumo.descricao || "");
    setUnidade(insumo.unidade); setEstoqueMinimo(insumo.estoqueMinimo);
    setCustoUnitario(insumo.custoUnitario); setShowModal(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) return;
    console.log("[EstoqueScreen] handleSave: saving insumo", editingInsumo ? "PUT " + editingInsumo.id : "POST", { nome, unidade, estoqueMinimo, custoUnitario });
    setSaving(true);
    try {
      if (editingInsumo) {
        await apiPut("/api/insumos/" + editingInsumo.id, { nome, descricao, unidade, estoqueMinimo, custoUnitario: custoUnitario.replace(",", ".") });
      } else {
        await apiPost("/api/insumos", { nome, descricao, unidade, estoqueMinimo, custoUnitario: custoUnitario.replace(",", ".") });
      }
      console.log("[EstoqueScreen] handleSave: success");
      setShowModal(false); fetchData();
    } catch (e: any) { Alert.alert("Erro", e.message || "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDelete = (insumo: Insumo) => {
    console.log("[EstoqueScreen] handleDelete: prompt for insumo", insumo.id, insumo.nome);
    Alert.alert("Desativar insumo", "Desativar \"" + insumo.nome + "\"?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Desativar", style: "destructive", onPress: async () => {
        console.log("[EstoqueScreen] handleDelete: confirmed DELETE /api/insumos/" + insumo.id);
        await apiDelete("/api/insumos/" + insumo.id); fetchData();
      }},
    ]);
  };

  const openMov = (insumo: Insumo, tipo: "entrada" | "saida") => {
    console.log("[EstoqueScreen] openMov: tipo=" + tipo + " insumo=" + insumo.id, insumo.nome);
    setMovInsumo(insumo); setMovTipo(tipo); setMovQtd(""); setMovMotivo(""); setShowMovModal(true);
  };

  const handleMov = async () => {
    if (!movQtd.trim() || !movInsumo) return;
    console.log("[EstoqueScreen] handleMov: POST /api/estoque/movimentacao", { insumoId: movInsumo.id, tipo: movTipo, quantidade: movQtd, motivo: movMotivo });
    setMovSaving(true);
    try {
      await apiPost("/api/estoque/movimentacao", {
        insumoId: movInsumo.id, tipo: movTipo, quantidade: movQtd, motivo: movMotivo || undefined,
      });
      console.log("[EstoqueScreen] handleMov: success");
      setShowMovModal(false); fetchData();
    } catch (e: any) { Alert.alert("Erro", e.message || "Erro ao registrar"); }
    finally { setMovSaving(false); }
  };

  const isLow = (i: Insumo) => parseFloat(i.estoqueAtual) <= parseFloat(i.estoqueMinimo) && parseFloat(i.estoqueMinimo) > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top"]}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => { console.log("[EstoqueScreen] back pressed"); router.back(); }} style={{ marginRight: 4 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Estoque</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{insumos.length} insumo{insumos.length !== 1 ? "s" : ""} • {alertas.length} alerta{alertas.length !== 1 ? "s" : ""}</Text>
        </View>
        <Pressable onPress={openNew} style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Ionicons name="add" size={22} color="white" />
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
        {(["todos", "alertas"] as const).map((t) => (
          <Pressable key={t} onPress={() => { console.log("[EstoqueScreen] tab pressed:", t); setTab(t); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: tab === t ? COLORS.primary : COLORS.surface, alignItems: "center" }}>
            <Text style={{ fontWeight: "600", color: tab === t ? "#fff" : COLORS.text, fontSize: 14 }}>
              {t === "todos" ? "Todos" : "Alertas (" + alertas.length + ")"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, borderWidth: 0.5, borderColor: COLORS.border }}>
          <Ionicons name="search" size={18} color={COLORS.textSecondary} />
          <TextInput placeholder="Buscar insumo..." placeholderTextColor={COLORS.textSecondary} value={search} onChangeText={(v) => { console.log("[EstoqueScreen] search changed:", v); setSearch(v); }}
            style={{ flex: 1, paddingVertical: 10, paddingLeft: 8, color: COLORS.text, fontSize: 15 }} />
        </View>
      </View>

      {loading ? <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}>
          {filtered.length === 0 && (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Ionicons name="cube-outline" size={48} color={COLORS.textSecondary} />
              <Text style={{ color: COLORS.textSecondary, marginTop: 12, fontSize: 16 }}>{tab === "alertas" ? "Nenhum alerta" : "Nenhum insumo"}</Text>
            </View>
          )}
          {filtered.map((insumo) => (
            <AnimatedPressable key={insumo.id} onPress={() => openEdit(insumo)} style={{ backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: isLow(insumo) ? "#EF4444" : COLORS.border }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>{insumo.nome}</Text>
                  {insumo.descricao ? <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{insumo.descricao}</Text> : null}
                </View>
                {isLow(insumo) && <Ionicons name="warning" size={20} color="#EF4444" />}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <View>
                  <Text style={{ fontSize: 22, fontWeight: "700", color: isLow(insumo) ? "#EF4444" : COLORS.primary }}>{parseFloat(insumo.estoqueAtual).toFixed(1)} {insumo.unidade}</Text>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>Mín: {parseFloat(insumo.estoqueMinimo).toFixed(1)} {insumo.unidade}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => openMov(insumo, "entrada")} style={{ backgroundColor: "#22C55E20", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Ionicons name="add-circle-outline" size={20} color="#22C55E" />
                  </Pressable>
                  <Pressable onPress={() => openMov(insumo, "saida")} style={{ backgroundColor: "#EF444420", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <Ionicons name="remove-circle-outline" size={20} color="#EF4444" />
                  </Pressable>
                  <Pressable onPress={() => handleDelete(insumo)} style={{ backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8 }}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.textSecondary} />
                  </Pressable>
                </View>
              </View>
            </AnimatedPressable>
          ))}
        </ScrollView>
      )}

      {/* Modal Cadastro/Edição */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text }}>{editingInsumo ? "Editar Insumo" : "Novo Insumo"}</Text>
              <Pressable onPress={() => { console.log("[EstoqueScreen] modal closed"); setShowModal(false); }}><Ionicons name="close" size={24} color={COLORS.text} /></Pressable>
            </View>
            <ScrollView>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Nome *</Text>
              <TextInput value={nome} onChangeText={setNome} placeholder="Ex: Arroz" placeholderTextColor={COLORS.textSecondary}
                style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border }} />

              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Descrição</Text>
              <TextInput value={descricao} onChangeText={setDescricao} placeholder="Opcional" placeholderTextColor={COLORS.textSecondary}
                style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border }} />

              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Unidade *</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {UNIDADES.map((u) => (
                  <Pressable key={u} onPress={() => { console.log("[EstoqueScreen] unidade selected:", u); setUnidade(u); }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: unidade === u ? COLORS.primary : COLORS.surface, borderWidth: 0.5, borderColor: COLORS.border }}>
                    <Text style={{ color: unidade === u ? "#fff" : COLORS.text, fontWeight: "600" }}>{u}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Estoque Mínimo</Text>
              <TextInput value={estoqueMinimo} onChangeText={setEstoqueMinimo} placeholder="0" keyboardType="decimal-pad" placeholderTextColor={COLORS.textSecondary}
                style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border }} />

              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Custo Unitário (R$)</Text>
              <CampoMoeda value={custoUnitario} onChangeText={setCustoUnitario} placeholder="0,00" placeholderTextColor={COLORS.textSecondary}
                style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border }} />

              <Pressable onPress={handleSave} disabled={saving} style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Salvar</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal Movimentação */}
      <Modal visible={showMovModal} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text }}>
                {movTipo === "entrada" ? "Entrada" : "Saída"}: {movInsumo?.nome}
              </Text>
              <Pressable onPress={() => { console.log("[EstoqueScreen] movimentacao modal closed"); setShowMovModal(false); }}><Ionicons name="close" size={24} color={COLORS.text} /></Pressable>
            </View>

            {movInsumo && (
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                Estoque atual: {parseFloat(movInsumo.estoqueAtual).toFixed(1)} {movInsumo.unidade}
              </Text>
            )}

            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Quantidade *</Text>
            <TextInput value={movQtd} onChangeText={setMovQtd} placeholder="0" keyboardType="decimal-pad" placeholderTextColor={COLORS.textSecondary}
              style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border }} />

            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Motivo</Text>
            <TextInput value={movMotivo} onChangeText={setMovMotivo} placeholder="Ex: Compra fornecedor" placeholderTextColor={COLORS.textSecondary}
              style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 16, borderWidth: 0.5, borderColor: COLORS.border }} />

            <Pressable onPress={handleMov} disabled={movSaving} style={{ backgroundColor: movTipo === "entrada" ? "#22C55E" : "#EF4444", borderRadius: 12, padding: 16, alignItems: "center" }}>
              {movSaving ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                  {movTipo === "entrada" ? "Registrar Entrada" : "Registrar Saída"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
