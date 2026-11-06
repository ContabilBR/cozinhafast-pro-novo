import React from 'react';
import { View, Text, ScrollView, Pressable, Linking, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { getRoleLabel } from '@/utils/helpers';

// Número do WhatsApp de atendimento, com DDI e DDD, só dígitos (ex.: 5511999999999).
const WHATSAPP_NUMERO = '5521995679931';
const EMAIL_CONTATO = 'contato@cozinhafastpro.com.br';

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
  const restauranteRaw = u.restaurante_nome ?? u.restaurante?.nome ?? u.restaurant_name ?? u.tenant_nome ?? '';
  const restaurante = typeof restauranteRaw === 'string' ? restauranteRaw.trim() : '';

  const linhasContexto = [
    ...(nome ? [`Usuário: ${nome}${papel ? ` (${papel})` : ''}`] : []),
    ...(restaurante ? [`Restaurante: ${restaurante}`] : []),
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
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
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

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }}>
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
    </View>
  );
}
