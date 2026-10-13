import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, apiDelete } from "@/utils/api";

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  pendente: { label: "Pendente", bg: "#FEF3C7", text: "#92400E", icon: "time-outline" },
  processando: { label: "Processando", bg: "#DBEAFE", text: "#1E40AF", icon: "sync-outline" },
  autorizada: { label: "Autorizada", bg: "#D1FAE5", text: "#065F46", icon: "checkmark-circle-outline" },
  rejeitada: { label: "Rejeitada", bg: "#FEE2E2", text: "#991B1B", icon: "close-circle-outline" },
  cancelada: { label: "Cancelada", bg: "#F3F4F6", text: "#6B7280", icon: "ban-outline" },
  erro: { label: "Erro", bg: "#FEE2E2", text: "#991B1B", icon: "alert-circle-outline" },
};

interface Nota { id: string; referenciaFocus?: string; referencia_focus?: string; status: string; chaveAcesso?: string; chave_acesso?: string; numeroNota?: number; numero_nota?: number; serie?: number; mensagemSefaz?: string; mensagem_sefaz?: string; createdAt?: string; created_at?: string;
  danfeUrl?: string;
  danfe_url?: string;
  xmlUrl?: string;
  xml_url?: string;
}
interface ComandaHistorico { id: string; mesa_numero?: number; garcom_nome?: string; total: string; closed_at?: string; pedidos: Array<{ id: string; prato_nome?: string; quantidade: number; preco_unitario: string }>; }

export default function FiscalScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [notas, setNotas] = useState<Nota[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEmitir, setShowEmitir] = useState(false);
  const [comandas, setComandas] = useState<ComandaHistorico[]>([]);
  const [loadingComandas, setLoadingComandas] = useState(false);
  const [selectedComanda, setSelectedComanda] = useState<ComandaHistorico | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [showCancelar, setShowCancelar] = useState(false);
  const [notaCancelar, setNotaCancelar] = useState<Nota | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [cancelando, setCancelando] = useState(false);

  const fetchNotas = useCallback(async () => {
    try { const res = await apiGet<any>("/api/fiscal/notas"); setNotas(Array.isArray(res) ? res : (res.notas || [])); } catch (e) { console.error("Erro:", e); } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); fetchNotas(); }, [fetchNotas]));

  const getRef = (n: Nota) => n.referenciaFocus || n.referencia_focus || "";
  const getChave = (n: Nota) => n.chaveAcesso || n.chave_acesso || "";
  const getNumero = (n: Nota) => n.numeroNota || n.numero_nota;
  const getMsg = (n: Nota) => n.mensagemSefaz || n.mensagem_sefaz;
  const getDate = (n: Nota) => n.createdAt || n.created_at || "";
  const getDanfe = (n: Nota) => n.danfeUrl || n.danfe_url || "";
  const getXml = (n: Nota) => n.xmlUrl || n.xml_url || "";
  const fmt = (v: string | number) => "R$ " + parseFloat(String(v)).toFixed(2).replace(".", ",");

  const openEmitir = async () => { setShowEmitir(true); setSelectedComanda(null); setLoadingComandas(true); console.log("[FiscalScreen] openEmitir: abrindo modal de emissão"); try { const res = await apiGet<any>("/api/historico"); console.log("[FiscalScreen] openEmitir: comandas carregadas"); setComandas(Array.isArray(res) ? res : (res.historico || [])); } catch (e) { Alert.alert("Erro", "Não foi possível carregar comandas"); setShowEmitir(false); } finally { setLoadingComandas(false); } };
  const handleEmitir = async () => { if (!selectedComanda) { Alert.alert("Erro", "Comanda sem itens"); return; } console.log("[FiscalScreen] handleEmitir: emitindo NFS-e para comanda", selectedComanda.id); setEmitindo(true); try { const body = { comanda_historico_id: selectedComanda.id, descricao_servico: "Fornecimento de alimentação - Mesa " + (selectedComanda.mesa_numero || ""), valor_servico: parseFloat(selectedComanda.total) }; console.log("[FiscalScreen] handleEmitir: POST /api/fiscal/nfsen", body); const res = await apiPost<any>("/api/fiscal/nfsen", body); setShowEmitir(false); fetchNotas(); const status = res.nota_fiscal?.status || "processando"; if (status === "autorizada") Alert.alert("Sucesso", "NFS-e autorizada!"); else if (status === "rejeitada" || status === "erro") Alert.alert("Atenção", "NFS-e " + status); else Alert.alert("Enviado", "NFS-e em processamento."); } catch (e: any) { Alert.alert("Erro", e.message || "Erro ao emitir"); } finally { setEmitindo(false); } };
  const atualizarStatus = async (nota: Nota) => { console.log("[FiscalScreen] atualizarStatus: GET /api/fiscal/nfsen/", getRef(nota)); try { await apiGet<any>("/api/fiscal/nfsen/" + getRef(nota)); fetchNotas(); Alert.alert("Atualizado", "Status atualizado"); } catch (e: any) { Alert.alert("Erro", e.message || "Erro"); } };
  const openCancelar = (nota: Nota) => { console.log("[FiscalScreen] openCancelar: abrindo modal de cancelamento para nota", nota.id); setNotaCancelar(nota); setJustificativa(""); setShowCancelar(true); };
  const handleCancelar = async () => { if (!notaCancelar || justificativa.length < 15) { Alert.alert("Atenção", "Justificativa mínima: 15 caracteres"); return; } console.log("[FiscalScreen] handleCancelar: DELETE /api/fiscal/nfsen/", getRef(notaCancelar)); setCancelando(true); try { await apiDelete<any>("/api/fiscal/nfsen/" + getRef(notaCancelar), { justificativa }); setShowCancelar(false); fetchNotas(); Alert.alert("Sucesso", "NFS-e cancelada"); } catch (e: any) { Alert.alert("Erro", e.message || "Erro"); } finally { setCancelando(false); } };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => { console.log("[FiscalScreen] back pressed"); router.back(); }} style={{ marginRight: 10 }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Notas Fiscais de Serviço</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{notas.length} nota{notas.length !== 1 ? "s" : ""}</Text>
        </View>
        <Pressable onPress={openEmitir} style={{ backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="add" size={18} color="white" /><Text style={{ color: "white", fontWeight: "700", fontSize: 14 }}>Emitir</Text>
        </Pressable>
      </View>
      {loading ? <View style={{ padding: 16 }}><ActivityIndicator size="large" color={COLORS.primary} /></View> : (
        <FlatList data={notas} keyExtractor={(n) => n.id} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotas(); }} tintColor={COLORS.primary} />}
          renderItem={({ item }) => { const s = STATUS_CFG[item.status] || STATUS_CFG.pendente; return (
            <View style={{ backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: COLORS.border }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name={s.icon as any} size={16} color={s.text} /><Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>#{getRef(item).slice(-8)}</Text></View>
                <View style={{ backgroundColor: s.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}><Text style={{ fontSize: 11, fontWeight: "600", color: s.text }}>{s.label}</Text></View>
              </View>
              {getNumero(item) ? <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>Nota nº {getNumero(item)} • Série {item.serie}</Text> : null}
              {getChave(item) ? <Text style={{ fontSize: 10, color: COLORS.textSecondary, marginTop: 2 }} numberOfLines={1}>Chave: {getChave(item)}</Text> : null}
              <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>{new Date(getDate(item)).toLocaleString("pt-BR")}</Text>
              {getMsg(item) ? <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>{getMsg(item)}</Text> : null}
              {item.status === "autorizada" && (getDanfe(item) || getXml(item)) && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  {getDanfe(item) ? <Pressable onPress={() => { const Linking = require("react-native").Linking; Linking.openURL(getDanfe(item)); }} style={{ flex: 1, backgroundColor: "#D1FAE5", borderRadius: 8, paddingVertical: 8, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 }}><Ionicons name="document-text-outline" size={14} color="#065F46" /><Text style={{ fontSize: 12, fontWeight: "600", color: "#065F46" }}>Ver DANFSe</Text></Pressable> : null}
                  {getXml(item) ? <Pressable onPress={() => { const Linking = require("react-native").Linking; Linking.openURL(getXml(item)); }} style={{ flex: 1, backgroundColor: "#DBEAFE", borderRadius: 8, paddingVertical: 8, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 }}><Ionicons name="code-download-outline" size={14} color="#1E40AF" /><Text style={{ fontSize: 12, fontWeight: "600", color: "#1E40AF" }}>Baixar XML</Text></Pressable> : null}
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                {(item.status === "processando" || item.status === "pendente" || item.status === "erro") && <Pressable onPress={() => atualizarStatus(item)} style={{ flex: 1, backgroundColor: "#DBEAFE", borderRadius: 8, paddingVertical: 8, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 }}><Ionicons name="sync-outline" size={14} color="#1E40AF" /><Text style={{ fontSize: 12, fontWeight: "600", color: "#1E40AF" }}>Atualizar</Text></Pressable>}
                {item.status === "autorizada" && <Pressable onPress={() => openCancelar(item)} style={{ flex: 1, backgroundColor: "#FEE2E2", borderRadius: 8, paddingVertical: 8, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 }}><Ionicons name="close-circle-outline" size={14} color="#991B1B" /><Text style={{ fontSize: 12, fontWeight: "600", color: "#991B1B" }}>Cancelar</Text></Pressable>}
              </View>
            </View>); }}
          ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 60 }}><Ionicons name="document-text-outline" size={48} color={COLORS.textSecondary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>Nenhuma nota fiscal</Text><Pressable onPress={openEmitir} style={{ marginTop: 16, backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}><Text style={{ color: "white", fontWeight: "700" }}>Emitir primeira NFS-e</Text></Pressable></View>}
        />
      )}
      <Modal visible={showEmitir} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "85%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text }}>Emitir NFS-e</Text>
              <Pressable onPress={() => setShowEmitir(false)}><Ionicons name="close" size={24} color={COLORS.text} /></Pressable>
            </View>
            {loadingComandas ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 20 }} />
            ) : !selectedComanda ? (
              <>
                <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 }}>Selecione uma comanda fechada:</Text>
                <FlatList data={comandas} keyExtractor={(c) => c.id} style={{ maxHeight: 400 }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => { console.log("[FiscalScreen] comanda selecionada:", item.id); setSelectedComanda(item); }} style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.border }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View>
                          <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{item.mesa_numero ? "Mesa " + item.mesa_numero : "Comanda"}</Text>
                          <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{item.pedidos?.length || 0} ite{(item.pedidos?.length || 0) !== 1 ? "ns" : "m"} • {item.garcom_nome || ""}</Text>
                        </View>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.primary }}>{fmt(item.total)}</Text>
                      </View>
                      {item.closed_at && <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>Fechada em {new Date(item.closed_at).toLocaleString("pt-BR")}</Text>}
                    </Pressable>
                  )}
                  ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 30 }}><Text style={{ color: COLORS.textSecondary }}>Nenhuma comanda fechada</Text></View>}
                />
              </>
            ) : (
              <ScrollView>
                <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: COLORS.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{selectedComanda.mesa_numero ? "Mesa " + selectedComanda.mesa_numero : "Comanda"}</Text>
                    <Pressable onPress={() => setSelectedComanda(null)}><Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: "600" }}>Trocar</Text></Pressable>
                  </View>
                  {selectedComanda.pedidos?.map((p, i) => (
                    <View key={p.id || i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: i === 0 ? 0.5 : 0, borderTopColor: COLORS.border }}>
                      <Text style={{ fontSize: 13, color: COLORS.text, flex: 1 }}>{p.quantidade}x {p.prato_nome || "Item"}</Text>
                      <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{fmt(parseFloat(p.preco_unitario) * p.quantidade)}</Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.border }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.text }}>Total</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.primary }}>{fmt(selectedComanda.total)}</Text>
                  </View>
                </View>
                <Pressable onPress={handleEmitir} disabled={emitindo} style={{ backgroundColor: "#22C55E", borderRadius: 12, padding: 16, alignItems: "center" }}>
                  {emitindo ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Emitir NFS-e</Text>}
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <Modal visible={showCancelar} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text }}>Cancelar NFS-e</Text>
              <Pressable onPress={() => setShowCancelar(false)}><Ionicons name="close" size={24} color={COLORS.text} /></Pressable>
            </View>
            {notaCancelar && (
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 }}>
                Nota #{(notaCancelar.referenciaFocus || notaCancelar.referencia_focus || "").slice(-8)}
                {(notaCancelar.numeroNota || notaCancelar.numero_nota) ? " • nº " + (notaCancelar.numeroNota || notaCancelar.numero_nota) : ""}
              </Text>
            )}
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Justificativa (mínimo 15 caracteres) *</Text>
            <TextInput value={justificativa} onChangeText={setJustificativa} placeholder="Ex: Erro na emissão, dados incorretos" placeholderTextColor={COLORS.textSecondary} multiline numberOfLines={3}
              style={{ backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 4, borderWidth: 0.5, borderColor: COLORS.border, minHeight: 80, textAlignVertical: "top" }} />
            <Text style={{ fontSize: 11, color: justificativa.length >= 15 ? "#22C55E" : COLORS.textSecondary, marginBottom: 16 }}>{justificativa.length}/15 caracteres</Text>
            <Pressable onPress={handleCancelar} disabled={cancelando || justificativa.length < 15} style={{ backgroundColor: justificativa.length >= 15 ? "#EF4444" : "#ccc", borderRadius: 12, padding: 16, alignItems: "center" }}>
              {cancelando ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Confirmar Cancelamento</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
