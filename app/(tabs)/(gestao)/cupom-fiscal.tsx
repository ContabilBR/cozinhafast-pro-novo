import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Image,
  Alert,
  Linking,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";

interface Pedido {
  id: string;
  prato_nome?: string;
  quantidade: number;
  preco_unitario: string;
}

interface ComandaHistorico {
  id: string;
  mesa_numero?: number;
  garcom_nome?: string;
  total: string;
  closed_at?: string;
  pedidos: Pedido[];
}

interface NotaNfce {
  id: string;
  referenciaFocus?: string;
  ref?: string;
  status: string;
  chaveAcesso?: string;
  chaveAcessoFormatada?: string;
  numeroNota?: number;
  serie?: number;
  protocolo?: string;
  mensagemSefaz?: string;
  danfeUrl?: string;
  urlConsulta?: string;
  qrCodeBase64?: string | null;
  imprimivel?: boolean;
}

const NOMES_CAMPOS: Record<string, string> = {
  cnpj: "CNPJ",
  nome: "Nome do restaurante",
  inscricaoEstadual: "Inscrição Estadual",
  regimeTributario: "Regime tributário",
  cscToken: "Token CSC (obtido na SEFAZ)",
  cscId: "ID do CSC (obtido na SEFAZ)",
  cnaePrincipal: "CNAE principal",
  cep: "CEP",
  logradouro: "Logradouro",
  numeroEndereco: "Número",
  bairro: "Bairro",
  codigoMunicipioIbge: "Código IBGE do município",
  uf: "UF",
};

const MAX_POLLS = 5;

export default function CupomFiscalScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [etapa, setEtapa] = useState<"lista" | "confirmar" | "resultado">("lista");
  const [comandas, setComandas] = useState<ComandaHistorico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionada, setSelecionada] = useState<ComandaHistorico | null>(null);
  const [cpf, setCpf] = useState("");
  const [emitindo, setEmitindo] = useState(false);
  const [nota, setNota] = useState<NotaNfce | null>(null);
  const [camposFaltantes, setCamposFaltantes] = useState<string[] | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const pollsRef = useRef(0);

  const fmt = (v: string | number) =>
    "R$ " + parseFloat(String(v)).toFixed(2).replace(".", ",");

  const carregarComandas = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await apiGet<any>("/api/historico");
      setComandas(Array.isArray(res) ? res : res.historico || []);
    } catch (e: any) {
      Alert.alert("Erro", e.message || "Não foi possível carregar as comandas");
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (etapa === "lista") carregarComandas();
    }, [etapa, carregarComandas])
  );

  const getRef = (n: NotaNfce | null) => n?.ref || n?.referenciaFocus || "";

  const consultarNota = useCallback(async (referencia: string, silencioso = false) => {
    if (!referencia) return;
    if (!silencioso) setAtualizando(true);
    try {
      const res = await apiGet<NotaNfce>("/api/fiscal/nfce/" + referencia);
      setNota((anterior) => ({ ...(anterior || {}), ...res }));
    } catch (e: any) {
      if (!silencioso) Alert.alert("Erro", e.message || "Falha ao consultar a nota");
    } finally {
      if (!silencioso) setAtualizando(false);
    }
  }, []);

  // Auto-consulta enquanto a SEFAZ ainda está processando, com limite.
  useEffect(() => {
    if (etapa !== "resultado" || !nota || nota.status !== "processando") return;
    if (pollsRef.current >= MAX_POLLS) return;

    const timer = setTimeout(() => {
      pollsRef.current += 1;
      consultarNota(getRef(nota), true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [etapa, nota, consultarNota]);

  const emitir = async () => {
    if (!selecionada) return;
    setEmitindo(true);
    setCamposFaltantes(null);
    pollsRef.current = 0;

    const cpfLimpo = cpf.replace(/[^0-9]/g, "");
    const body: any = { comanda_id: selecionada.id };
    if (cpfLimpo.length === 11) body.cpf_destinatario = cpfLimpo;

    try {
      const res = await apiPost<NotaNfce>("/api/fiscal/nfce", body);
      setNota(res);
      setEtapa("resultado");
    } catch (e: any) {
      if (e.status === 400 && Array.isArray(e.body?.campos_faltantes)) {
        setCamposFaltantes(e.body.campos_faltantes);
      } else if (e.status === 409 && e.body?.referencia_focus) {
        // Cupom já emitido antes: busca e exibe em vez de erro seco.
        setNota({ id: e.body.nota_id, ref: e.body.referencia_focus, status: "processando" });
        setEtapa("resultado");
        consultarNota(e.body.referencia_focus);
      } else if (e.status === 502) {
        Alert.alert(
          "Erro na comunicação com a SEFAZ",
          (e.message || "Falha ao emitir") +
            (e.body?.detail ? "\n\nDetalhe: " + String(e.body.detail).slice(0, 400) : "") +
            (e.body?.ref ? "\n\nRef: " + e.body.ref : "")
        );
      } else if (e.status === 500) {
        Alert.alert(
          "Erro no servidor",
          "Não foi possível emitir o cupom. Avise o suporte técnico.\n\nDetalhe: " +
            String(e.message || "").slice(0, 120)
        );
      } else {
        Alert.alert("Não foi possível emitir", e.message || "Erro desconhecido");
      }
    } finally {
      setEmitindo(false);
    }
  };

  const reiniciar = () => {
    setNota(null);
    setSelecionada(null);
    setCpf("");
    setCamposFaltantes(null);
    pollsRef.current = 0;
    setEtapa("lista");
  };

  const cores: Record<string, { bg: string; fg: string; icone: string; titulo: string }> = {
    autorizada: { bg: "#D1FAE5", fg: "#065F46", icone: "checkmark-circle", titulo: "Cupom autorizado" },
    processando: { bg: "#DBEAFE", fg: "#1E40AF", icone: "sync", titulo: "Aguardando a SEFAZ" },
    rejeitada: { bg: "#FEE2E2", fg: "#991B1B", icone: "close-circle", titulo: "Rejeitado pela SEFAZ" },
    erro: { bg: "#FEE2E2", fg: "#991B1B", icone: "alert-circle", titulo: "Erro na emissão" },
    cancelada: { bg: "#F3F4F6", fg: "#6B7280", icone: "ban", titulo: "Cupom cancelado" },
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => (etapa === "lista" ? router.back() : reiniciar())}
          style={{ marginRight: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>
            Cupom Fiscal
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            NFC-e — modelo 65
          </Text>
        </View>
      </View>

      {/* ---------- Cadastro fiscal incompleto ---------- */}
      {camposFaltantes && (
        <View
          style={{
            margin: 16,
            backgroundColor: "#FEF3C7",
            borderRadius: 12,
            padding: 14,
            borderWidth: 0.5,
            borderColor: "#F59E0B",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="warning-outline" size={18} color="#92400E" />
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#92400E" }}>
              Cadastro fiscal incompleto
            </Text>
          </View>
          <Text style={{ fontSize: 13, color: "#92400E", marginBottom: 8 }}>
            Preencha estes dados antes de emitir:
          </Text>
          {camposFaltantes.map((c) => (
            <Text key={c} style={{ fontSize: 13, color: "#92400E", marginLeft: 4 }}>
              • {NOMES_CAMPOS[c] || c}
            </Text>
          ))}
          <Pressable
            onPress={() => router.push("/(tabs)/(gestao)/fiscal-config")}
            style={{
              marginTop: 12,
              backgroundColor: "#F59E0B",
              borderRadius: 8,
              paddingVertical: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
              Abrir cadastro do restaurante
            </Text>
          </Pressable>
        </View>
      )}

      {/* ---------- Etapa 1: escolher comanda ---------- */}
      {etapa === "lista" && (
        carregando ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={comandas}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            ListHeaderComponent={
              <Text style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 }}>
                Selecione a comanda para emitir o cupom:
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setSelecionada(item);
                  setCamposFaltantes(null);
                  setEtapa("confirmar");
                }}
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 8,
                  borderWidth: 0.5,
                  borderColor: COLORS.border,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>
                      {item.mesa_numero ? "Mesa " + item.mesa_numero : "Comanda"}
                    </Text>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                      {item.pedidos?.length || 0} item{(item.pedidos?.length || 0) !== 1 ? "s" : ""}
                      {item.garcom_nome ? " • " + item.garcom_nome : ""}
                    </Text>
                    {item.closed_at && (
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>
                        {new Date(item.closed_at).toLocaleString("pt-BR")}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.primary }}>
                    {fmt(item.total)}
                  </Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingTop: 60 }}>
                <Ionicons name="receipt-outline" size={48} color={COLORS.textSecondary} />
                <Text style={{ fontSize: 15, color: COLORS.textSecondary, marginTop: 12 }}>
                  Nenhuma comanda fechada
                </Text>
              </View>
            }
          />
        )
      )}

      {/* ---------- Etapa 2: confirmar ---------- */}
      {etapa === "confirmar" && selecionada && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              padding: 14,
              borderWidth: 0.5,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>
              {selecionada.mesa_numero ? "Mesa " + selecionada.mesa_numero : "Comanda"}
            </Text>
            {selecionada.pedidos?.map((p, i) => (
              <View
                key={p.id || i}
                style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}
              >
                <Text style={{ fontSize: 13, color: COLORS.text, flex: 1 }}>
                  {p.quantidade}x {p.prato_nome || "Item"}
                </Text>
                <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                  {fmt(parseFloat(p.preco_unitario) * p.quantidade)}
                </Text>
              </View>
            ))}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 8,
                paddingTop: 8,
                borderTopWidth: 0.5,
                borderTopColor: COLORS.border,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.text }}>Total</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.primary }}>
                {fmt(selecionada.total)}
              </Text>
            </View>
          </View>

          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 18, marginBottom: 6 }}>
            CPF na nota (opcional)
          </Text>
          <TextInput
            value={cpf}
            onChangeText={(t) => setCpf(t.replace(/[^0-9]/g, "").slice(0, 11))}
            placeholder="Somente números"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="number-pad"
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 10,
              padding: 12,
              color: COLORS.text,
              fontSize: 15,
              borderWidth: 0.5,
              borderColor: COLORS.border,
            }}
          />
          <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 6 }}>
            A NFC-e é exclusiva para consumidor pessoa física. Para clientes com CNPJ é
            necessário emitir NF-e modelo 55.
          </Text>

          <Pressable
            onPress={emitir}
            disabled={emitindo}
            style={{
              marginTop: 20,
              backgroundColor: emitindo ? "#9CA3AF" : "#22C55E",
              borderRadius: 12,
              padding: 16,
              alignItems: "center",
            }}
          >
            {emitindo ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                Emitir cupom fiscal
              </Text>
            )}
          </Pressable>

          <Pressable onPress={reiniciar} style={{ marginTop: 12, alignItems: "center" }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>Trocar comanda</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ---------- Etapa 3: resultado ---------- */}
      {etapa === "resultado" && nota && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {(() => {
            const c = cores[nota.status] || cores.processando;
            return (
              <View
                style={{
                  backgroundColor: c.bg,
                  borderRadius: 12,
                  padding: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons name={c.icone as any} size={22} color={c.fg} />
                <Text style={{ fontSize: 16, fontWeight: "700", color: c.fg }}>{c.titulo}</Text>
              </View>
            );
          })()}

          {nota.status === "autorizada" && nota.qrCodeBase64 ? (
            <View
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: 14,
                padding: 20,
                marginTop: 16,
                alignItems: "center",
                borderWidth: 0.5,
                borderColor: COLORS.border,
              }}
            >
              <Image
                source={{ uri: "data:image/png;base64," + nota.qrCodeBase64 }}
                style={{ width: 220, height: 220, borderRadius: 8 }}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: COLORS.textSecondary,
                  marginTop: 12,
                  textAlign: "center",
                }}
              >
                O cliente pode escanear este código para consultar a nota
              </Text>
            </View>
          ) : null}

          {nota.status === "autorizada" && !nota.qrCodeBase64 ? (
            <View
              style={{
                backgroundColor: "#FEF3C7",
                borderRadius: 12,
                padding: 14,
                marginTop: 16,
              }}
            >
              <Text style={{ fontSize: 13, color: "#92400E" }}>
                Nota autorizada, mas a Focus não devolveu a URL do QR Code. Verifique o log do
                servidor para identificar o nome do campo.
              </Text>
            </View>
          ) : null}

          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              padding: 14,
              marginTop: 16,
              borderWidth: 0.5,
              borderColor: COLORS.border,
            }}
          >
            {nota.numeroNota ? (
              <Text style={{ fontSize: 14, color: COLORS.text, marginBottom: 6 }}>
                Nota nº {nota.numeroNota} • Série {nota.serie}
              </Text>
            ) : null}
            {nota.chaveAcessoFormatada || nota.chaveAcesso ? (
              <>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>
                  Chave de acesso
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: COLORS.text,
                    fontFamily: "monospace",
                    marginTop: 2,
                  }}
                >
                  {nota.chaveAcessoFormatada || nota.chaveAcesso}
                </Text>
              </>
            ) : null}
            {nota.protocolo ? (
              <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 8 }}>
                Protocolo {nota.protocolo}
              </Text>
            ) : null}
            {nota.mensagemSefaz ? (
              <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 8 }}>
                {nota.mensagemSefaz}
              </Text>
            ) : null}
          </View>

          {nota.status === "processando" && (
            <Pressable
              onPress={() => consultarNota(getRef(nota))}
              disabled={atualizando}
              style={{
                marginTop: 16,
                backgroundColor: "#DBEAFE",
                borderRadius: 12,
                padding: 14,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {atualizando ? (
                <ActivityIndicator color="#1E40AF" />
              ) : (
                <>
                  <Ionicons name="sync-outline" size={16} color="#1E40AF" />
                  <Text style={{ color: "#1E40AF", fontWeight: "700" }}>Atualizar status</Text>
                </>
              )}
            </Pressable>
          )}

          {nota.danfeUrl ? (
            <Pressable
              onPress={() => Linking.openURL(nota.danfeUrl as string)}
              style={{
                marginTop: 12,
                backgroundColor: "#D1FAE5",
                borderRadius: 12,
                padding: 14,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#065F46", fontWeight: "700" }}>Ver DANFE NFC-e</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={reiniciar}
            style={{
              marginTop: 12,
              backgroundColor: COLORS.surface,
              borderRadius: 12,
              padding: 14,
              alignItems: "center",
              borderWidth: 0.5,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "600" }}>Emitir outro cupom</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
