import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, ScrollView, Pressable, Image, Modal, ActivityIndicator, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { useMesaCliente } from "@/contexts/MesaClienteContext";
import { MesaClienteConfig } from "@/utils/mesaCliente";

type Prato = { id: string; nome: string; descricao?: string; preco: number; imagemUrl?: string };
type Categoria = { categoria: { id: string; nome: string }; pratos: Prato[] };
type CartItem = { pratoId: string; nome: string; preco: number; quantidade: number };
type PedidoStatus = { id: string; quantidade: number; precoUnitario: string; status: string; pratoNome: string };

const STATUS_LABEL: Record<string, string> = {
  pendente: "Recebido",
  em_preparo: "Preparando",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export default function MesaClienteScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { config, loading: loadingConfig } = useMesaCliente();
  const [cardapio, setCardapio] = useState<Categoria[]>([]);
  const [loadingCardapio, setLoadingCardapio] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartVisible, setCartVisible] = useState(false);
  const [clienteNome, setClienteNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aba, setAba] = useState<"cardapio" | "pedidos">("cardapio");
  const [pedidos, setPedidos] = useState<PedidoStatus[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregarCardapio = useCallback(async (cfg: MesaClienteConfig) => {
    setLoadingCardapio(true);
    try {
      const data = await apiGet<any>(`/api/public/cardapio/${cfg.restauranteId}`);
      setCardapio(data?.cardapio || []);
    } catch (error) {
      console.error("[MesaCliente] Erro ao carregar cardápio:", error);
    } finally {
      setLoadingCardapio(false);
    }
  }, []);

  const carregarPedidos = useCallback(async (cfg: MesaClienteConfig) => {
    try {
      const data = await apiGet<any>(`/api/public/mesa/${cfg.restauranteId}/${cfg.mesaNumero}`);
      setPedidos(data?.pedidos || []);
    } catch (error) {
      console.error("[MesaCliente] Erro ao carregar status dos pedidos:", error);
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  useEffect(() => {
    if (config) carregarCardapio(config);
  }, [config, carregarCardapio]);

  useEffect(() => {
    if (!config || aba !== "pedidos") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    setLoadingPedidos(true);
    carregarPedidos(config);
    pollRef.current = setInterval(() => carregarPedidos(config), 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [config, aba, carregarPedidos]);

  const adicionarAoCarrinho = (prato: Prato) => {
    setCart((prev) => {
      const existente = prev.find((i) => i.pratoId === prato.id);
      if (existente) {
        return prev.map((i) => i.pratoId === prato.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...prev, { pratoId: prato.id, nome: prato.nome, preco: prato.preco, quantidade: 1 }];
    });
  };

  const alterarQuantidade = (pratoId: string, delta: number) => {
    setCart((prev) => {
      const atualizado = prev.map((i) => i.pratoId === pratoId ? { ...i, quantidade: i.quantidade + delta } : i);
      return atualizado.filter((i) => i.quantidade > 0);
    });
  };

  const totalCarrinho = cart.reduce((sum, i) => sum + i.preco * i.quantidade, 0);
  const itensCarrinho = cart.reduce((sum, i) => sum + i.quantidade, 0);

  const enviarPedido = async () => {
    if (!config || cart.length === 0) return;
    setEnviando(true);
    try {
      const resp = await apiPost<any>("/api/public/pedido", {
        restaurante_id: config.restauranteId,
        mesa_numero: config.mesaNumero,
        cliente_nome: clienteNome || undefined,
        itens: cart.map((i) => ({ prato_id: i.pratoId, quantidade: i.quantidade })),
      });
      setSucesso(resp?.mensagem || "Pedido enviado! A cozinha já está preparando.");
      setCart([]);
      setClienteNome("");
    } catch (error: any) {
      Alert.alert("Não foi possível enviar", error?.message || "Tente novamente em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  if (loadingConfig) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!config) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
        <Ionicons name="tablet-landscape-outline" size={40} color={COLORS.textTertiary} />
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, textAlign: "center" }}>Tablet não configurado</Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>Peça a um gerente para configurar este tablet em Gestão {'>'} Modo mesa.</Text>
        <Pressable
          onPress={() => router.push("/mesa-cliente-setup")}
          style={{ marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }}
        >
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: "white" }}>Sou gerente — configurar agora</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: COLORS.primary }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: "white" }}>{config.restauranteNome || "Cardápio"}</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: "white", opacity: 0.85, marginTop: 2 }}>Mesa {config.mesaNumero}</Text>
          </View>
          {/* Botão discreto pra equipe sair do modo mesa. Não é escondido, mas também não
              chama atenção — quem toca sem ser gerente/admin só vê uma tela de login e
              pode voltar (a mesma trava de permissão que a tela de configuração já tinha). */}
          <Pressable
            onPress={() => router.push("/mesa-cliente-setup")}
            hitSlop={12}
            style={{ padding: 6, marginLeft: 8, opacity: 0.6 }}
          >
            <Ionicons name="log-out-outline" size={22} color="white" />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <Pressable onPress={() => setAba("cardapio")} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: aba === "cardapio" ? "white" : "rgba(255,255,255,0.15)", alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: aba === "cardapio" ? COLORS.primary : "white" }}>Cardápio</Text>
          </Pressable>
          <Pressable onPress={() => setAba("pedidos")} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: aba === "pedidos" ? "white" : "rgba(255,255,255,0.15)", alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: aba === "pedidos" ? COLORS.primary : "white" }}>Meus pedidos</Text>
          </Pressable>
        </View>
      </View>

      {aba === "cardapio" ? (
        loadingCardapio ? (
          <View style={{ padding: 24 }}><ActivityIndicator size="large" color={COLORS.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
            {cardapio.length === 0 && (
              <Text style={{ textAlign: "center", color: COLORS.textSecondary, marginTop: 40 }}>Nenhum prato disponível no momento.</Text>
            )}
            {cardapio.map((cat) => (
              <View key={cat.categoria.id} style={{ marginBottom: 20 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: COLORS.primary, textTransform: "uppercase", marginBottom: 8 }}>{cat.categoria.nome}</Text>
                {cat.pratos.map((prato) => (
                  <Pressable key={prato.id} onPress={() => adicionarAoCarrinho(prato)} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 15, color: COLORS.text }}>{prato.nome}</Text>
                      {!!prato.descricao && <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{prato.descricao}</Text>}
                    </View>
                    {!!prato.imagemUrl && <Image source={{ uri: prato.imagemUrl }} style={{ width: 52, height: 52, borderRadius: 8, marginLeft: 10 }} />}
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.primary, marginLeft: 12 }}>R$ {prato.preco.toFixed(2).replace(".", ",")}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {loadingPedidos && pedidos.length === 0 ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 24 }} />
          ) : pedidos.length === 0 ? (
            <Text style={{ textAlign: "center", color: COLORS.textSecondary, marginTop: 40 }}>Nenhum pedido enviado ainda nesta mesa.</Text>
          ) : (
            pedidos.map((p) => (
              <View key={p.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}>
                <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 15, color: COLORS.text }}>{p.quantidade}x {p.pratoNome}</Text>
                <View style={{ backgroundColor: COLORS.primaryMuted, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 12, color: COLORS.primary }}>{STATUS_LABEL[p.status] || p.status}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {aba === "cardapio" && itensCarrinho > 0 && (
        <Pressable onPress={() => setCartVisible(true)} style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 16, backgroundColor: COLORS.primary, borderRadius: 14, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "white" }}>Ver pedido ({itensCarrinho})</Text>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "white" }}>R$ {totalCarrinho.toFixed(2).replace(".", ",")}</Text>
        </Pressable>
      )}

      <Modal visible={cartVisible} transparent animationType="slide" onRequestClose={() => setCartVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" }}>
            {sucesso ? (
              <View style={{ alignItems: "center", paddingVertical: 30, gap: 8 }}>
                <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text }}>Pedido enviado!</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>{sucesso}</Text>
                <Pressable onPress={() => { setSucesso(null); setCartVisible(false); setAba("pedidos"); }} style={{ marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 }}>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: "white" }}>Acompanhar pedido</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>Seu pedido</Text>
                <ScrollView style={{ maxHeight: 280 }}>
                  {cart.map((item) => (
                    <View key={item.pratoId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.border }}>
                      <View>
                        <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 14, color: COLORS.text }}>{item.nome}</Text>
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>R$ {item.preco.toFixed(2).replace(".", ",")}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Pressable onPress={() => alterarQuantidade(item.pratoId, -1)} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: COLORS.primary, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: COLORS.primary, fontSize: 16 }}>−</Text>
                        </Pressable>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text, minWidth: 18, textAlign: "center" }}>{item.quantidade}</Text>
                        <Pressable onPress={() => alterarQuantidade(item.pratoId, 1)} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: COLORS.primary, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: COLORS.primary, fontSize: 16 }}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }}>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>Total</Text>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.primary }}>R$ {totalCarrinho.toFixed(2).replace(".", ",")}</Text>
                </View>
                <TextInput
                  value={clienteNome}
                  onChangeText={setClienteNome}
                  placeholder="Seu nome (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.text, marginBottom: 10 }}
                />
                <Pressable disabled={enviando || cart.length === 0} onPress={enviarPedido} style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: enviando ? 0.7 : 1 }}>
                  {enviando ? <ActivityIndicator color="white" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "white" }}>Enviar pedido</Text>}
                </Pressable>
                <Pressable onPress={() => setCartVisible(false)} style={{ paddingVertical: 14, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 14, color: COLORS.textSecondary }}>Continuar pedindo</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
