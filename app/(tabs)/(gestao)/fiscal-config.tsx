import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPut } from "@/utils/api";

interface FiscalForm {
  inscricao_estadual: string;
  inscricao_municipal: string;
  regime_tributario: string;
  cnae_principal: string;
  ncm_padrao: string;
  csc_id: string;
  csc_token: string;
  ambiente_focus: number;
  cep: string;
  logradouro: string;
  numero_endereco: string;
  complemento: string;
  bairro: string;
  codigo_municipio_ibge: string;
  uf: string;
}

const FORM_VAZIO: FiscalForm = {
  inscricao_estadual: "",
  inscricao_municipal: "",
  regime_tributario: "simples_nacional",
  cnae_principal: "",
  ncm_padrao: "21069090",
  csc_id: "",
  csc_token: "",
  ambiente_focus: 2,
  cep: "",
  logradouro: "",
  numero_endereco: "",
  complemento: "",
  bairro: "",
  codigo_municipio_ibge: "",
  uf: "",
};

const REGIMES = [
  { valor: "simples_nacional", label: "Simples Nacional" },
  { valor: "simples_excesso", label: "Simples — excesso de sublimite" },
  { valor: "regime_normal", label: "Regime Normal" },
  { valor: "mei", label: "MEI" },
];

// Campos exigidos pela validacao de NFC-e no backend
const OBRIGATORIOS: Array<keyof FiscalForm> = [
  "inscricao_estadual",
  "regime_tributario",
  "cnae_principal",
  "cep",
  "logradouro",
  "numero_endereco",
  "bairro",
  "codigo_municipio_ibge",
  "uf",
];

export default function FiscalConfigScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [form, setForm] = useState<FiscalForm>(FORM_VAZIO);
  const [cscConfigurado, setCscConfigurado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [nomeRestaurante, setNomeRestaurante] = useState("");
  const [cnpj, setCnpj] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await apiGet<any>("/api/restaurante");
      setNomeRestaurante(r?.nome || "");
      setCnpj(r?.cnpj || "");
      setCscConfigurado(!!r?.csc_configurado);
      setForm({
        inscricao_estadual: r?.inscricao_estadual || "",
        inscricao_municipal: r?.inscricao_municipal || "",
        regime_tributario: r?.regime_tributario || "simples_nacional",
        cnae_principal: r?.cnae_principal || "",
        ncm_padrao: r?.ncm_padrao || "21069090",
        csc_id: r?.csc_id || "",
        csc_token: "",
        ambiente_focus: typeof r?.ambiente_focus === "number" ? r.ambiente_focus : 2,
        cep: r?.cep || "",
        logradouro: r?.logradouro || "",
        numero_endereco: r?.numero_endereco || "",
        complemento: r?.complemento || "",
        bairro: r?.bairro || "",
        codigo_municipio_ibge:
          r?.codigo_municipio_ibge !== null && r?.codigo_municipio_ibge !== undefined
            ? String(r.codigo_municipio_ibge)
            : "",
        uf: r?.uf || "",
      });
    } catch (e: any) {
      Alert.alert("Erro", e.message || "Não foi possível carregar os dados fiscais");
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  const set = (campo: keyof FiscalForm, valor: any) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const faltando = OBRIGATORIOS.filter((c) => !String(form[c] || "").trim());
  const cscOk = cscConfigurado || form.csc_token.trim().length > 0;
  const cscIdOk = form.csc_id.trim().length > 0;
  const prontoParaEmitir = faltando.length === 0 && cscOk && cscIdOk;

  const salvar = async () => {
    setSalvando(true);
    try {
      const body: any = {
        nome: nomeRestaurante,
        inscricao_estadual: form.inscricao_estadual.trim() || null,
        inscricao_municipal: form.inscricao_municipal.trim() || null,
        regime_tributario: form.regime_tributario || null,
        cnae_principal: form.cnae_principal.trim() || null,
        ncm_padrao: form.ncm_padrao.trim() || null,
        csc_id: form.csc_id.trim() || null,
        ambiente_focus: form.ambiente_focus,
        cep: form.cep.trim() || null,
        logradouro: form.logradouro.trim() || null,
        numero_endereco: form.numero_endereco.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        codigo_municipio_ibge: form.codigo_municipio_ibge.trim()
          ? Number(form.codigo_municipio_ibge.trim())
          : null,
        uf: form.uf.trim() || null,
      };

      // Enviado apenas quando preenchido: campo em branco nao apaga o token salvo.
      if (form.csc_token.trim()) body.csc_token = form.csc_token.trim();

      await apiPut("/api/restaurante", body);
      setForm((f) => ({ ...f, csc_token: "" }));
      await carregar();
      Alert.alert("Salvo", "Configuração fiscal atualizada");
    } catch (e: any) {
      Alert.alert("Erro ao salvar", e.message || "Tente novamente");
    } finally {
      setSalvando(false);
    }
  };

  const Campo = ({
    label,
    campo,
    placeholder,
    ajuda,
    teclado,
    maxLength,
    somenteDigitos,
    maiusculas,
    secreto,
    forcarObrigatorio,
  }: {
    label: string;
    campo: keyof FiscalForm;
    placeholder?: string;
    ajuda?: string;
    teclado?: "default" | "number-pad";
    maxLength?: number;
    somenteDigitos?: boolean;
    maiusculas?: boolean;
    secreto?: boolean;
    forcarObrigatorio?: boolean;
  }) => {
    const obrigatorio = forcarObrigatorio || OBRIGATORIOS.includes(campo);
    const vazio = !String(form[campo] || "").trim();
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>
          {label}
          {obrigatorio ? <Text style={{ color: "#EF4444" }}> *</Text> : null}
        </Text>
        <TextInput
          value={String(form[campo] ?? "")}
          onChangeText={(t) => {
            let v = t;
            if (somenteDigitos) v = v.replace(/[^0-9]/g, "");
            if (maiusculas) v = v.toUpperCase();
            if (maxLength) v = v.slice(0, maxLength);
            set(campo, v);
          }}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textSecondary}
          keyboardType={teclado === "number-pad" ? "number-pad" : "default"}
          secureTextEntry={!!secreto}
          autoCapitalize={maiusculas ? "characters" : "sentences"}
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 10,
            padding: 12,
            color: COLORS.text,
            fontSize: 15,
            borderWidth: 1,
            borderColor: obrigatorio && vazio ? "#FCA5A5" : COLORS.border,
          }}
        />
        {ajuda ? (
          <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>{ajuda}</Text>
        ) : null}
      </View>
    );
  };

  const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <View
      style={{
        backgroundColor: COLORS.background,
        borderRadius: 14,
        padding: 14,
        marginBottom: 16,
        borderWidth: 0.5,
        borderColor: COLORS.border,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.text, marginBottom: 12 }}>
        {titulo}
      </Text>
      {children}
    </View>
  );

  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable onPress={() => router.back()} style={{ marginRight: 10 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>
            Configuração Fiscal
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            {nomeRestaurante || "Restaurante"}
            {cnpj ? " • CNPJ " + cnpj : ""}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View
          style={{
            backgroundColor: prontoParaEmitir ? "#D1FAE5" : "#FEF3C7",
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons
            name={prontoParaEmitir ? "checkmark-circle" : "warning-outline"}
            size={20}
            color={prontoParaEmitir ? "#065F46" : "#92400E"}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: "600",
              color: prontoParaEmitir ? "#065F46" : "#92400E",
            }}
          >
            {prontoParaEmitir
              ? "Pronto para emitir NFC-e"
              : "Faltam " +
                (faltando.length + (cscOk ? 0 : 1) + (cscIdOk ? 0 : 1)) +
                " campo(s) para emitir NFC-e"}
          </Text>
        </View>

        <Secao titulo="Identificação fiscal">
          <Campo
            label="Inscrição Estadual"
            campo="inscricao_estadual"
            placeholder="Somente números"
            somenteDigitos
            teclado="number-pad"
          />
          <Campo
            label="Inscrição Municipal"
            campo="inscricao_municipal"
            placeholder="Opcional — usada em NFS-e"
            somenteDigitos
            teclado="number-pad"
          />
          <Campo
            label="CNAE principal"
            campo="cnae_principal"
            placeholder="5611201"
            ajuda="Restaurantes e similares: 5611201"
            somenteDigitos
            maxLength={7}
            teclado="number-pad"
          />

          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>
            Regime tributário <Text style={{ color: "#EF4444" }}>*</Text>
          </Text>
          <View style={{ gap: 8, marginBottom: 14 }}>
            {REGIMES.map((r) => {
              const ativo = form.regime_tributario === r.valor;
              return (
                <Pressable
                  key={r.valor}
                  onPress={() => set("regime_tributario", r.valor)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: ativo ? COLORS.primary + "20" : COLORS.surface,
                    borderRadius: 10,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: ativo ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Ionicons
                    name={ativo ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={ativo ? COLORS.primary : COLORS.textSecondary}
                  />
                  <Text style={{ fontSize: 14, color: COLORS.text }}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Campo
            label="NCM padrão"
            campo="ncm_padrao"
            placeholder="21069090"
            ajuda="Usado quando o prato não tem NCM próprio. 21069090 = preparações alimentícias diversas."
            somenteDigitos
            maxLength={8}
            teclado="number-pad"
          />
        </Secao>

        <Secao titulo="Endereço fiscal">
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
            Precisa ser separado em campos porque a SEFAZ exige assim. O endereço do cadastro
            geral continua servindo para exibição.
          </Text>
          <Campo
            label="CEP"
            campo="cep"
            placeholder="Somente números"
            somenteDigitos
            maxLength={8}
            teclado="number-pad"
          />
          <Campo label="Logradouro" campo="logradouro" placeholder="Rua, avenida..." />
          <Campo label="Número" campo="numero_endereco" placeholder="100" />
          <Campo label="Complemento" campo="complemento" placeholder="Opcional" />
          <Campo label="Bairro" campo="bairro" placeholder="Centro" />
          <Campo
            label="Código IBGE do município"
            campo="codigo_municipio_ibge"
            placeholder="3304557"
            ajuda="7 dígitos. Rio de Janeiro: 3304557. Não é o CEP nem o DDD."
            somenteDigitos
            maxLength={7}
            teclado="number-pad"
          />
          <Campo label="UF" campo="uf" placeholder="RJ" maxLength={2} maiusculas />
        </Secao>

        <Secao titulo="CSC — Código de Segurança do Contribuinte">
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>
            Obtido no portal da SEFAZ do seu estado, não pela Focus NFe. É o que assina o QR
            Code do cupom — sem ele nenhuma NFC-e é autorizada, nem em homologação.
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 12,
              backgroundColor: cscConfigurado ? "#D1FAE5" : COLORS.surface,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <Ionicons
              name={cscConfigurado ? "lock-closed" : "lock-open-outline"}
              size={16}
              color={cscConfigurado ? "#065F46" : COLORS.textSecondary}
            />
            <Text
              style={{
                fontSize: 12,
                color: cscConfigurado ? "#065F46" : COLORS.textSecondary,
              }}
            >
              {cscConfigurado
                ? "Token já cadastrado (por segurança, não é exibido)"
                : "Token ainda não cadastrado"}
            </Text>
          </View>

          <Campo
            label="ID do CSC"
            campo="csc_id"
            placeholder="Ex: 000001"
            forcarObrigatorio
          />
          <Campo
            label={cscConfigurado ? "Novo token CSC (deixe vazio para manter)" : "Token CSC"}
            campo="csc_token"
            placeholder="Cole o token da SEFAZ"
            secreto
            forcarObrigatorio={!cscConfigurado}
          />
        </Secao>

        <Secao titulo="Ambiente de emissão">
          {[
            { v: 2, label: "Homologação", desc: "Notas de teste, sem valor fiscal" },
            { v: 1, label: "Produção", desc: "Notas válidas perante a SEFAZ" },
          ].map((a) => {
            const ativo = form.ambiente_focus === a.v;
            return (
              <Pressable
                key={a.v}
                onPress={() => set("ambiente_focus", a.v)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: ativo ? COLORS.primary + "20" : COLORS.surface,
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: ativo ? COLORS.primary : COLORS.border,
                }}
              >
                <Ionicons
                  name={ativo ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={ativo ? COLORS.primary : COLORS.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: COLORS.text, fontWeight: "600" }}>
                    {a.label}
                  </Text>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{a.desc}</Text>
                </View>
              </Pressable>
            );
          })}
        </Secao>

        <Pressable
          onPress={salvar}
          disabled={salvando}
          style={{
            backgroundColor: salvando ? "#9CA3AF" : "#22C55E",
            borderRadius: 12,
            padding: 16,
            alignItems: "center",
          }}
        >
          {salvando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
              Salvar configuração
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
