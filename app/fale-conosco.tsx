import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Platform, Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { getRoleLabel } from '@/utils/helpers';
import { apiGet, apiPost } from '@/utils/api';

// Número do WhatsApp de atendimento, com DDI e DDD, só dígitos (ex.: 5511999999999).
const WHATSAPP_NUMERO = '5521995679931';
const EMAIL_CONTATO = 'contato@cozinhafastpro.com.br';

const TIPOS_MENSAGEM = [
  { valor: 'problema', rotulo: 'Problema' },
  { valor: 'sugestao', rotulo: 'Sugestão' },
  { valor: 'duvida', rotulo: 'Dúvida' },
] as const;
const ROTULO_TIPO: Record<string, string> = { problema: 'Problema', sugestao: 'Sugestão', duvida: 'Dúvida' };
const ROTULO_STATUS: Record<string, string> = { recebida: 'Recebida', em_analise: 'Em análise', resolvida: 'Resolvida' };
const MIN_MENSAGEM = 10;
const MAX_MENSAGEM = 2000;

type MensagemContato = { id: string; tipo: string; mensagem: string; status: string; created_at: string };

// Data e hora no horário do aparelho
function dataHoraDoAparelho(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function FaleConoscoScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const versao = Constants.expoConfig?.version || '1.0.0';
  const plataforma = Platform.OS === 'android' ? 'Android' : 'iOS';
  const u: any = user ?? {};
  const nome = u.nome || u.name || u.email || '';
  const papel = u.role ? getRoleLabel(u.role) : '';
  const [restInfo, setRestInfo] = useState<{ nome: string; filial: string } | null>(null);
  const logado = !!user;

  // Formulário "Enviar uma mensagem"
  const [tipoMsg, setTipoMsg] = useState<string | null>(null);
  const [textoMsg, setTextoMsg] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const timerEnviado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const podeEnviar = !!tipoMsg && textoMsg.trim().length >= MIN_MENSAGEM && !enviando;

  // Lista "Minhas mensagens"
  const [minhas, setMinhas] = useState<MensagemContato[] | null>(null);
  const [erroLista, setErroLista] = useState(false);
  const [carregandoLista, setCarregandoLista] = useState(false);

  const carregarMinhas = useCallback(async () => {
    setCarregandoLista(true);
    setErroLista(false);
    try {
      const r = await apiGet<MensagemContato[]>('/api/mensagens-contato/minhas');
      setMinhas(Array.isArray(r) ? r.slice(0, 20) : []);
    } catch {
      setErroLista(true);
    } finally {
      setCarregandoLista(false);
    }
  }, []);

  useEffect(() => {
    if (logado) carregarMinhas();
  }, [logado, carregarMinhas]);

  useEffect(() => () => {
    if (timerEnviado.current) clearTimeout(timerEnviado.current);
  }, []);

  const enviarMensagem = async () => {
    if (!podeEnviar || !tipoMsg) return;
    Keyboard.dismiss();
    setEnviando(true);
    setErroEnvio(null);
    setEnviado(false);
    try {
      await apiPost('/api/mensagens-contato', {
        tipo: tipoMsg,
        mensagem: textoMsg.trim(),
        versao_app: versao,
        plataforma: Platform.OS === 'android' ? 'android' : 'ios',
        tela: 'fale-conosco',
      });
      setTipoMsg(null);
      setTextoMsg('');
      setEnviado(true);
      if (timerEnviado.current) clearTimeout(timerEnviado.current);
      timerEnviado.current = setTimeout(() => setEnviado(false), 5000);
      carregarMinhas();
    } catch (e: any) {
      const st = e?.status;
      if ((st === 400 || st === 403 || st === 429) && typeof e?.message === 'string' && e.message.trim()) {
        setErroEnvio(e.message);
      } else {
        setErroEnvio('Não foi possível enviar agora. Seu texto foi mantido, tente novamente.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const corStatus = (st: string) =>
    st === 'resolvida' ? COLORS.statusLivre : st === 'em_analise' ? COLORS.statusReservada : COLORS.statusRecebido;

  useEffect(() => {
    if (!logado) return;
    let ativo = true;
    apiGet<any>('/api/restaurante')
      .then((r) => {
        if (!ativo) return;
        const d = r?.restaurante || r;
        const n = typeof d?.nome === 'string' ? d.nome.trim() : '';
        const f = typeof d?.filial === 'string' ? d.filial.trim() : '';
        if (n) setRestInfo({ nome: n, filial: f });
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [logado]);

  const linhasContexto = [
    ...(nome ? [`Usuário: ${nome}${papel ? ` (${papel})` : ''}`] : []),
    ...(logado && restInfo ? [`Restaurante: ${restInfo.nome}${restInfo.filial ? ` (${restInfo.filial})` : ''}`] : []),
    `Versão do app: ${versao}`,
    `Plataforma: ${plataforma}`,
  ];

  const voltar = () => {
    if (router.canGoBack()) router.back();
    else router.replace((user ? '/(tabs)/(perfil)' : '/auth-screen') as any);
  };

  const abrirWhatsApp = async () => {
    const msg = ['Olá, preciso de ajuda com o Cozinha Fácil.', ...linhasContexto].join('\n');
    const url = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(msg)}`;
    try {
      if (!WHATSAPP_NUMERO) throw new Error('sem número');
      await Linking.openURL(url);
    } catch (e) {
      console.log('[FaleConosco] WhatsApp não abriu:', e);
      Alert.alert('WhatsApp', 'Não foi possível abrir o WhatsApp. Tente pelo e-mail.');
    }
  };

  const abrirEmail = async () => {
    const corpo = ['', '', ...linhasContexto].join('\n');
    const url = `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent('Cozinha Fácil: contato')}&body=${encodeURIComponent(corpo)}`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.log('[FaleConosco] E-mail não abriu:', e);
      Alert.alert('E-mail', `Não foi possível abrir o aplicativo de e-mail. Escreva para ${EMAIL_CONTATO}.`);
    }
  };

  const card = {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  } as const;
  const titulo = { fontFamily: 'Outfit_700Bold', fontSize: 16, color: COLORS.text } as const;
  const texto = { fontFamily: 'Outfit_400Regular', fontSize: 14, color: COLORS.textSecondary } as const;
  const botao = {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  } as const;
  const botaoTxt = { fontFamily: 'Outfit_600SemiBold', fontSize: 15, color: '#fff' } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
        <Pressable
          onPress={voltar}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start' }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 15, color: COLORS.text }}>Voltar</Text>
        </Pressable>
        <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 26, color: COLORS.text, letterSpacing: -0.3, marginTop: 4 }}>Fale conosco</Text>
        <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 14, color: COLORS.textSecondary }}>Ajuda, problemas e sugestões</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
      >
        {logado && (
          <View style={card}>
            <Text style={titulo}>Enviar uma mensagem</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {TIPOS_MENSAGEM.map((t) => {
                const sel = tipoMsg === t.valor;
                return (
                  <Pressable
                    key={t.valor}
                    onPress={() => setTipoMsg(t.valor)}
                    disabled={enviando}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sel }}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: sel ? COLORS.primary : COLORS.border,
                      backgroundColor: sel ? COLORS.primaryMuted : COLORS.surface,
                    }}
                  >
                    <Text style={{ fontFamily: sel ? 'Outfit_600SemiBold' : 'Outfit_500Medium', fontSize: 14, color: sel ? COLORS.primary : COLORS.text }}>{t.rotulo}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 14, color: COLORS.text }}>Sua mensagem</Text>
              <TextInput
                value={textoMsg}
                onChangeText={(t) => setTextoMsg(t.slice(0, MAX_MENSAGEM))}
                placeholder="Conte o que aconteceu ou o que você gostaria de ver"
                placeholderTextColor={COLORS.textTertiary}
                multiline
                maxLength={MAX_MENSAGEM}
                editable={!enviando}
                textAlignVertical="top"
                style={{
                  minHeight: 120,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  borderRadius: 12,
                  padding: 12,
                  fontFamily: 'Outfit_400Regular',
                  fontSize: 15,
                  color: COLORS.text,
                  backgroundColor: COLORS.background,
                }}
              />
              <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 12, color: COLORS.textSecondary, alignSelf: 'flex-end' }}>
                {textoMsg.length}/{MAX_MENSAGEM}
              </Text>
            </View>
            {enviado && (
              <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 14, color: COLORS.statusLivre }}>Mensagem enviada. Obrigado!</Text>
            )}
            {!!erroEnvio && (
              <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 14, color: COLORS.statusCancelado }}>{erroEnvio}</Text>
            )}
            <AnimatedPressable onPress={enviarMensagem} disabled={!podeEnviar} style={[botao, !podeEnviar && { opacity: 0.5 }]}>
              {enviando ? <ActivityIndicator color="#fff" /> : <Text style={botaoTxt}>Enviar mensagem</Text>}
            </AnimatedPressable>
          </View>
        )}

        {logado && (
          <View style={card}>
            <Text style={titulo}>Minhas mensagens</Text>
            {erroLista ? (
              <View style={{ gap: 8 }}>
                <Text style={texto}>Não foi possível carregar suas mensagens.</Text>
                <AnimatedPressable onPress={carregarMinhas} disabled={carregandoLista} style={botao}>
                  {carregandoLista ? <ActivityIndicator color="#fff" /> : <Text style={botaoTxt}>Tentar de novo</Text>}
                </AnimatedPressable>
              </View>
            ) : minhas === null ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : minhas.length === 0 ? (
              <Text style={texto}>Você ainda não enviou nenhuma mensagem.</Text>
            ) : (
              minhas.map((m, i) => (
                <View
                  key={m.id}
                  style={{ gap: 4, paddingTop: i === 0 ? 0 : 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: COLORS.border }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 14, color: COLORS.text }}>{ROTULO_TIPO[m.tipo] ?? m.tipo}</Text>
                    <View style={{ backgroundColor: corStatus(m.status) + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 12, color: corStatus(m.status) }}>{ROTULO_STATUS[m.status] ?? m.status}</Text>
                    </View>
                  </View>
                  <Text numberOfLines={2} style={{ fontFamily: 'Outfit_400Regular', fontSize: 14, color: COLORS.text }}>{m.mensagem}</Text>
                  <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 12, color: COLORS.textSecondary }}>{dataHoraDoAparelho(m.created_at)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        <View style={card}>
          <Text style={titulo}>WhatsApp</Text>
          <Text style={texto}>Atendimento pelo WhatsApp</Text>
          <AnimatedPressable onPress={abrirWhatsApp} style={botao}>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={botaoTxt}>Abrir WhatsApp</Text>
          </AnimatedPressable>
        </View>

        <View style={card}>
          <Text style={titulo}>E-mail</Text>
          <Text style={texto}>Envie sua dúvida, problema ou sugestão</Text>
          <Text selectable style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 15, color: COLORS.text }}>{EMAIL_CONTATO}</Text>
          <AnimatedPressable onPress={abrirEmail} style={botao}>
            <Ionicons name="mail-outline" size={20} color="#fff" />
            <Text style={botaoTxt}>Enviar e-mail</Text>
          </AnimatedPressable>
        </View>

        <View style={card}>
          <Text style={titulo}>Sobre o aplicativo</Text>
          <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 15, color: COLORS.text }}>CozinhaFast Pro</Text>
          <Text style={texto}>Versão {versao}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
