import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ArrowLeft, Plus, Minus, CalendarDays, Clock } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { apiGet, apiPost, apiPut } from "@/utils/api";
import { hojeBrasilia } from "@/utils/exportacao/periodo";

interface MesaOpt {
  id: string;
  numero: number;
  capacidade?: number;
}

function maskTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}${d.length > 6 ? "-" + d.slice(6) : ""}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  // 12–13 dígitos: com código do país
  const ddi = d.slice(0, 2);
  const r = d.slice(2);
  const ddd = r.slice(0, 2);
  const num = r.slice(2);
  const corte = num.length > 8 ? 5 : 4;
  return `+${ddi} (${ddd}) ${num.slice(0, corte)}-${num.slice(corte)}`;
}

// Brasília = UTC-3 (sem horário de verão)
function partesBrasilia(iso: string): { data: string; hora: string } {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    data: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

const dataBR = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};
const pad = (n: number) => String(n).padStart(2, "0");

function horaMask(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

function mensagemErro(e: any): string {
  const base = e?.body?.error || e?.message || "";
  if (e?.status === 404 && !e?.body?.error) return "Esta função de reservas ainda não está disponível no servidor (rota não encontrada).";
  if (e?.status === 409 && e?.body?.conflicting_reservation_time) {
    const p = partesBrasilia(e.body.conflicting_reservation_time);
    return `${base || "Horário indisponível para esta mesa."}\nConflito com a reserva das ${p.hora}`;
  }
  return base || "Não foi possível salvar a reserva. Tente novamente.";
}

export default function ReservaFormScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ reserva?: string; dia?: string }>();

  let existente: any = null;
  try {
    existente = params.reserva ? JSON.parse(params.reserva as string) : null;
  } catch {
    existente = null;
  }
  const editando = !!existente?.id;
  const inicial = existente ? partesBrasilia(existente.data_hora) : null;

  const [nome, setNome] = useState<string>(existente?.nome_pessoa ?? "");
  const [telefone, setTelefone] = useState<string>(existente?.telefone ? maskTelefone(existente.telefone) : "");
  const [data, setData] = useState<string>(inicial?.data ?? ((params.dia as string) || hojeBrasilia()));
  const [hora, setHora] = useState<string>(inicial?.hora ?? "");
  const [pessoas, setPessoas] = useState<number>(existente?.numero_pessoas ?? 2);
  const [mesaId, setMesaId] = useState<string | null>(existente?.mesa?.id ?? null);
  const [obs, setObs] = useState<string>(existente?.observacao ?? "");
  const [mesas, setMesas] = useState<MesaOpt[]>([]);
  const [mesasErro, setMesasErro] = useState("");
  const [carregandoMesas, setCarregandoMesas] = useState(true);
  const [pickerData, setPickerData] = useState(false);
  const [pickerHora, setPickerHora] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<any>("/api/mesas");
        const lista: MesaOpt[] = Array.isArray(res) ? res : res?.mesas || [];
        setMesas([...lista].sort((a, b) => a.numero - b.numero));
      } catch (e: any) {
        setMesasErro("Não foi possível carregar as mesas. Você ainda pode salvar sem mesa.");
      } finally {
        setCarregandoMesas(false);
      }
    })();
  }, []);

  const voltar = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/reservas");
  };

  const validar = (): { ok: true; iso: string } | { ok: false; msg: string } => {
    const n = nome.trim();
    if (!n) return { ok: false, msg: "Informe o nome de quem reservou." };
    if (n.length > 80) return { ok: false, msg: "O nome pode ter no máximo 80 caracteres." };
    const dig = telefone.replace(/\D/g, "");
    if (dig.length > 0 && (dig.length < 10 || dig.length > 13)) return { ok: false, msg: "Telefone inválido: use DDD + número (10 a 13 dígitos)." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, msg: "Escolha a data da reserva." };
    const m = /^(\d{2}):(\d{2})$/.exec(hora);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, msg: "Informe a hora no formato HH:MM (00:00 a 23:59)." };
    if (pessoas < 1 || pessoas > 50) return { ok: false, msg: "O número de pessoas deve ser de 1 a 50." };
    const iso = `${data}T${hora}:00-03:00`;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return { ok: false, msg: "Data ou hora inválida." };
    const agora = Date.now();
    if (t < agora - 5 * 60 * 1000) return { ok: false, msg: "A reserva não pode ser mais de 5 minutos no passado." };
    if (t > agora + 90 * 24 * 3600 * 1000) return { ok: false, msg: "A reserva não pode ser daqui a mais de 90 dias." };
    return { ok: true, iso };
  };

  const salvar = async () => {
    if (salvando) return;
    const v = validar();
    if (!v.ok) {
      setErro(v.msg);
      return;
    }
    setErro("");
    setSalvando(true);
    const body: Record<string, unknown> = {
      nome_pessoa: nome.trim(),
      data_hora: v.iso,
      numero_pessoas: pessoas,
    };
    if (telefone.trim()) body.telefone = telefone.trim();
    if (mesaId) body.mesa_id = mesaId;
    if (obs.trim()) body.observacao = obs.trim();
    // Na edição, campos limpos precisam ser enviados vazios
    if (editando) {
      body.telefone = telefone.trim() || null;
      body.mesa_id = mesaId || null;
      body.observacao = obs.trim() || null;
    }
    try {
      if (editando) {
        console.log("[ReservaForm] PUT /api/reservas/" + existente.id);
        await apiPut(`/api/reservas/${existente.id}`, body);
      } else {
        console.log("[ReservaForm] POST /api/reservas");
        await apiPost("/api/reservas", body);
      }
      // Volta à lista; ela recarrega ao ganhar foco
      voltar();
    } catch (e: any) {
      console.error("[ReservaForm] Erro:", e?.message);
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const labelStyle = { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 16 } as const;
  const inputStyle = {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    color: COLORS.text,
  } as const;

  const campoToque = (icone: React.ReactNode, texto: string, vazio: boolean, onPress: () => void) => (
    <AnimatedPressable onPress={onPress} style={{ ...inputStyle, flexDirection: "row", alignItems: "center", gap: 10 }}>
      {icone}
      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 16, color: vazio ? COLORS.textTertiary : COLORS.text }}>{texto}</Text>
    </AnimatedPressable>
  );

  const stepper = (icone: React.ReactNode, onPress: () => void, disabled: boolean, label: string) => (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={label}
      style={{ width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryMuted }}
    >
      {icone}
    </AnimatedPressable>
  );

  const chip = (key: string, label: string, ativo: boolean, onPress: () => void) => (
    <AnimatedPressable
      key={key}
      onPress={onPress}
      style={{
        minWidth: 64,
        height: 44,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ativo ? COLORS.primary : COLORS.surface,
        borderWidth: 1,
        borderColor: ativo ? COLORS.primary : COLORS.border,
      }}
    >
      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: ativo ? "#fff" : COLORS.text }}>{label}</Text>
    </AnimatedPressable>
  );

  const horaParaDate = () => {
    const m = /^(\d{2}):(\d{2})$/.exec(hora);
    const d = new Date();
    d.setHours(m ? Number(m[1]) : 19, m ? Number(m[2]) : 0, 0, 0);
    return d;
  };

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
        <Text style={{ flex: 1, textAlign: "center", fontFamily: "Outfit_700Bold", fontSize: 17, color: COLORS.text }} numberOfLines={1}>
          {editando ? "Editar reserva" : "Nova reserva"}
        </Text>
        <View style={{ width: 84 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        >
          <Text style={{ ...labelStyle, marginTop: 0 }}>Nome *</Text>
          <TextInput
            value={nome}
            onChangeText={setNome}
            maxLength={80}
            placeholder="Nome de quem reservou"
            placeholderTextColor={COLORS.textTertiary}
            style={inputStyle}
          />

          <Text style={labelStyle}>Telefone (opcional)</Text>
          <TextInput
            value={telefone}
            onChangeText={(t) => setTelefone(maskTelefone(t))}
            keyboardType="phone-pad"
            placeholder="(11) 91234-5678"
            placeholderTextColor={COLORS.textTertiary}
            style={inputStyle}
          />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 3 }}>
              <Text style={labelStyle}>Data *</Text>
              {campoToque(<CalendarDays size={18} color={COLORS.primary} />, dataBR(data), false, () => {
                setPickerHora(false);
                setPickerData((v) => !v);
              })}
            </View>
            <View style={{ flex: 2 }}>
              <Text style={labelStyle}>Hora *</Text>
              <TextInput
                value={hora}
                onChangeText={(t) => setHora(horaMask(t))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="19:30"
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <AnimatedPressable
              onPress={() => {
                setPickerData(false);
                setPickerHora((v) => !v);
              }}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 }}
            >
              <Clock size={15} color={COLORS.primary} />
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary }}>Escolher hora no relógio</Text>
            </AnimatedPressable>
          </View>
          {pickerData && (
            <DateTimePicker
              value={new Date(`${data}T12:00:00`)}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(ev, d) => {
                if (Platform.OS !== "ios" || ev.type === "dismissed") setPickerData(false);
                if (ev.type === "dismissed" || !d) return;
                setData(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                if (Platform.OS === "ios") setPickerData(false);
              }}
            />
          )}
          {pickerHora && (
            <DateTimePicker
              value={horaParaDate()}
              mode="time"
              is24Hour
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(ev, d) => {
                if (Platform.OS !== "ios" || ev.type === "dismissed") setPickerHora(false);
                if (ev.type === "dismissed" || !d) return;
                setHora(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
              }}
            />
          )}
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>
            Horário de Brasília. A reserva não pode ser mais de 5 minutos no passado nem daqui a mais de 90 dias.
          </Text>

          <Text style={labelStyle}>Número de pessoas *</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {stepper(<Minus size={20} color={COLORS.primary} />, () => setPessoas((p) => Math.max(1, p - 1)), pessoas <= 1, "Menos uma pessoa")}
            <Text style={{ minWidth: 40, textAlign: "center", fontFamily: "Outfit_700Bold", fontSize: 24, color: COLORS.text }}>{pessoas}</Text>
            {stepper(<Plus size={20} color={COLORS.primary} />, () => setPessoas((p) => Math.min(50, p + 1)), pessoas >= 50, "Mais uma pessoa")}
          </View>

          <Text style={labelStyle}>Mesa (opcional)</Text>
          {carregandoMesas ? (
            <ActivityIndicator color={COLORS.primary} style={{ alignSelf: "flex-start" }} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip("sem", "Sem mesa", mesaId === null, () => setMesaId(null))}
              {mesas.map((m) => chip(m.id, String(m.numero), mesaId === m.id, () => setMesaId(m.id)))}
            </View>
          )}
          {!!mesasErro && <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.warning, marginTop: 6 }}>{mesasErro}</Text>}

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <Text style={labelStyle}>Observação (opcional)</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>{obs.length}/300</Text>
          </View>
          <TextInput
            value={obs}
            onChangeText={setObs}
            maxLength={300}
            multiline
            placeholder="Aniversário, cadeirinha, alergias..."
            placeholderTextColor={COLORS.textTertiary}
            style={{ ...inputStyle, minHeight: 96, paddingTop: 12, textAlignVertical: "top" }}
          />

          {!!erro && (
            <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.10)" }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.danger }}>{erro}</Text>
            </View>
          )}

          <AnimatedPressable
            onPress={salvar}
            disabled={salvando}
            style={{
              marginTop: 20,
              minHeight: 52,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: COLORS.primary,
            }}
          >
            {salvando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                {editando ? "Salvar alterações" : "Salvar reserva"}
              </Text>
            )}
          </AnimatedPressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
