import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { apiGet, apiPost, apiPut } from "@/utils/api";
import { isAdmin } from "@/utils/helpers";
import { deslocarDias } from "@/utils/exportacao/periodo";

interface Reserva {
  id: string;
  nome_pessoa: string;
  telefone?: string | null;
  data_hora: string;
  numero_pessoas: number;
  mesa: { id: string; numero: number } | null;
  observacao?: string | null;
  status: "confirmada" | "sentada" | "cancelada" | "nao_compareceu";
  duracao?: number;
  comanda_id?: string | null;
}

type Filtro = "todas" | Reserva["status"];

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "confirmada", label: "Confirmadas" },
  { key: "sentada", label: "Sentadas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "nao_compareceu", label: "Não compareceu" },
];

const STATUS_LABEL: Record<Reserva["status"], string> = {
  confirmada: "Confirmada",
  sentada: "Sentada",
  cancelada: "Cancelada",
  nao_compareceu: "Não compareceu",
};

// Brasília = UTC-3 (sem horário de verão)
function horaBrasilia(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  if (isNaN(d.getTime())) return "--:--";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// "Hoje" em Brasília (UTC-3), independente do relógio/fuso do aparelho
function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function diaSemana(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

function paraIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mensagemErro(e: any): string {
  const status = e?.status;
  const base = e?.body?.error || e?.message || "";
  if (status === 404 && !e?.body?.error) return "Esta função de reservas ainda não está disponível no servidor (rota não encontrada).";
  if (status === 409 && e?.body?.conflicting_reservation_time) {
    return `${base || "Horário indisponível."}\nConflito com a reserva das ${horaBrasilia(e.body.conflicting_reservation_time)}`;
  }
  return base || "Não foi possível concluir a ação. Tente novamente.";
}

export default function ReservasScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role as string | undefined;
  const gerencia = isAdmin(role);

  const [dia, setDia] = useState(hojeBrasilia());
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [itens, setItens] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState("");
  const [escolhendoData, setEscolhendoData] = useState(false);
  const [agindo, setAgindo] = useState<string | null>(null);

  const carregar = useCallback(
    async (opts?: { silencioso?: boolean }) => {
      if (!opts?.silencioso) setLoading(true);
      try {
        const qs = `?data=${dia}${filtro !== "todas" ? `&status=${filtro}` : ""}`;
        console.log("[Reservas] GET /api/reservas" + qs);
        const res = await apiGet<any>(`/api/reservas${qs}`);
        const lista: Reserva[] = Array.isArray(res) ? res : res?.reservas || [];
        setItens(lista);
        setErro("");
      } catch (e: any) {
        console.error("[Reservas] Erro ao carregar:", e?.message);
        setErro(mensagemErro(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [dia, filtro]
  );

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  const voltar = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/(mesas)");
  };

  const abrirForm = (r?: Reserva) => {
    if (r) router.push({ pathname: "/reservas/form", params: { reserva: JSON.stringify(r), dia } });
    else router.push({ pathname: "/reservas/form", params: { dia } });
  };

  const mudarStatus = (r: Reserva, status: "cancelada" | "nao_compareceu") => {
    const titulo = status === "cancelada" ? "Cancelar reserva" : "Marcar como não compareceu";
    const msg =
      status === "cancelada"
        ? `Cancelar a reserva de ${r.nome_pessoa} às ${horaBrasilia(r.data_hora)}?`
        : `Marcar que ${r.nome_pessoa} não compareceu?`;
    Alert.alert(titulo, msg, [
      { text: "Voltar", style: "cancel" },
      {
        text: "Confirmar",
        style: "destructive",
        onPress: async () => {
          setAgindo(r.id);
          try {
            await apiPut(`/api/reservas/${r.id}/status`, { status });
            await carregar({ silencioso: true });
          } catch (e: any) {
            Alert.alert("Não foi possível atualizar", mensagemErro(e));
          } finally {
            setAgindo(null);
          }
        },
      },
    ]);
  };

  const abrirComanda = (r: Reserva) => {
    if (!r.mesa) return;
    Alert.alert("Abrir comanda", `Abrir comanda para ${r.nome_pessoa} na mesa ${r.mesa.numero}?`, [
      { text: "Voltar", style: "cancel" },
      {
        text: "Abrir comanda",
        onPress: async () => {
          setAgindo(r.id);
          try {
            const res = await apiPost<any>(`/api/reservas/${r.id}/sentar`, {});
            const comandaId = res?.comanda_id;
            await carregar({ silencioso: true });
            if (comandaId) {
              router.push({ pathname: "/comanda/[id]", params: { id: comandaId, mesa_numero: String(r.mesa!.numero) } });
            }
          } catch (e: any) {
            Alert.alert("Não foi possível abrir a comanda", mensagemErro(e));
          } finally {
            setAgindo(null);
          }
        },
      },
    ]);
  };

  const corStatus = (s: Reserva["status"]) =>
    s === "confirmada" ? COLORS.statusRecebido : s === "sentada" ? COLORS.success : s === "cancelada" ? COLORS.danger : COLORS.warning;

  const botao = (label: string, onPress: () => void, opts?: { primario?: boolean; perigo?: boolean; disabled?: boolean }) => (
    <AnimatedPressable
      onPress={onPress}
      disabled={opts?.disabled}
      hitSlop={6}
      style={{
        minHeight: 40,
        paddingHorizontal: 14,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: opts?.primario ? COLORS.primary : COLORS.surface,
        borderWidth: opts?.primario ? 0 : 1,
        borderColor: opts?.perigo ? COLORS.danger : COLORS.border,
      }}
    >
      <Text
        style={{
          fontFamily: "Outfit_600SemiBold",
          fontSize: 13,
          color: opts?.primario ? "#fff" : opts?.perigo ? COLORS.danger : COLORS.text,
        }}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );

  const renderItem = ({ item: r }: { item: Reserva }) => {
    const cor = corStatus(r.status);
    const ocupado = agindo === r.id;
    return (
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: COLORS.border,
          padding: 14,
          marginBottom: 12,
          flexDirection: "row",
          gap: 14,
        }}
      >
        <View style={{ alignItems: "center", minWidth: 62 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 24, color: COLORS.primary, letterSpacing: -0.5 }}>
            {horaBrasilia(r.data_hora)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text }} numberOfLines={1}>
              {r.nome_pessoa}
            </Text>
            <View style={{ backgroundColor: cor + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: cor }}>{STATUS_LABEL[r.status]}</Text>
            </View>
          </View>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, marginTop: 3 }}>
            {r.numero_pessoas} {r.numero_pessoas === 1 ? "pessoa" : "pessoas"} · {r.mesa ? `Mesa ${r.mesa.numero}` : "Sem mesa"}
          </Text>
          {!!r.telefone && (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{r.telefone}</Text>
          )}
          {!!r.observacao && (
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.text, marginTop: 6 }}>{r.observacao}</Text>
          )}

          {r.status === "confirmada" && (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {botao("Editar", () => abrirForm(r), { disabled: ocupado })}
                {botao(ocupado ? "Abrindo..." : "Abrir comanda", () => abrirComanda(r), { primario: true, disabled: ocupado || !r.mesa })}
                {gerencia && botao("Não compareceu", () => mudarStatus(r, "nao_compareceu"), { disabled: ocupado })}
                {gerencia && botao("Cancelar", () => mudarStatus(r, "cancelada"), { perigo: true, disabled: ocupado })}
              </View>
              {!r.mesa && (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.warning, marginTop: 8 }}>
                  Edite a reserva e escolha uma mesa
                </Text>
              )}
            </View>
          )}
          {r.status === "sentada" && !!r.comanda_id && (
            <View style={{ flexDirection: "row", marginTop: 12 }}>
              {botao(
                "Ver comanda",
                () =>
                  router.push({
                    pathname: "/comanda/[id]",
                    params: { id: r.comanda_id as string, mesa_numero: r.mesa ? String(r.mesa.numero) : "" },
                  }),
                { primario: true }
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  const setaDia = (delta: number) => (
    <AnimatedPressable
      onPress={() => setDia(deslocarDias(dia, delta))}
      hitSlop={10}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      accessibilityLabel={delta < 0 ? "Dia anterior" : "Próximo dia"}
    >
      {delta < 0 ? <ChevronLeft size={22} color={COLORS.primary} /> : <ChevronRight size={22} color={COLORS.primary} />}
    </AnimatedPressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 56,
          paddingHorizontal: 8,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <AnimatedPressable
          onPress={voltar}
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center", padding: 10, gap: 4, minHeight: 44 }}
        >
          <ArrowLeft size={20} color={COLORS.primary} />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.primary }}>Voltar</Text>
        </AnimatedPressable>
        <Text
          style={{ flex: 1, textAlign: "center", fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }}
          numberOfLines={1}
        >
          Reservas
        </Text>
        <AnimatedPressable
          onPress={() => abrirForm()}
          hitSlop={8}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minHeight: 40,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: COLORS.primary,
          }}
        >
          <Plus size={16} color="#fff" />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: "#fff" }}>Nova reserva</Text>
        </AnimatedPressable>
      </View>

      <View style={{ backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 }}>
          {setaDia(-1)}
          <AnimatedPressable
            onPress={() => setEscolhendoData((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12 }}
          >
            <CalendarDays size={18} color={COLORS.primary} />
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text }}>
              {dataBR(dia)} · {dia === hojeBrasilia() ? "hoje" : diaSemana(dia)}
            </Text>
          </AnimatedPressable>
          {setaDia(1)}
        </View>
        {escolhendoData && (
          <View>
            <DateTimePicker
              value={new Date(`${dia}T12:00:00`)}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(ev, data) => {
                if (Platform.OS !== "ios" || ev.type === "dismissed") setEscolhendoData(false);
                if (ev.type === "dismissed" || !data) return;
                setDia(paraIso(data));
                if (Platform.OS === "ios") setEscolhendoData(false);
              }}
            />
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
          {FILTROS.map((f) => {
            const ativo = filtro === f.key;
            return (
              <AnimatedPressable
                key={f.key}
                onPress={() => setFiltro(f.key)}
                style={{
                  paddingHorizontal: 14,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: ativo ? COLORS.primary : COLORS.surfaceSecondary,
                }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: ativo ? "#fff" : COLORS.textSecondary }}>
                  {f.label}
                </Text>
              </AnimatedPressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : erro ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text, textAlign: "center" }}>
            Não foi possível carregar as reservas
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>{erro}</Text>
          {botao("Tentar de novo", () => carregar(), { primario: true })}
        </View>
      ) : (
        <FlatList
          data={itens}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.primary}
              onRefresh={() => {
                setRefreshing(true);
                carregar({ silencioso: true });
              }}
            />
          }
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 14 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.textSecondary }}>
                Nenhuma reserva neste dia
              </Text>
              {botao("Nova reserva", () => abrirForm(), { primario: true })}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
