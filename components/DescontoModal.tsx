import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { CampoMoeda } from '@/components/CampoMoeda';
import {
  AplicarDescontoCorpo, DescontoAtual, MotivoDesconto,
  MOTIVOS_DESCONTO, calcularTotalComDesconto,
} from '@/utils/desconto';

type Props = {
  visible: boolean;
  subtotal: number;
  descontoAtual?: DescontoAtual | null;
  onApply: (corpo: AplicarDescontoCorpo) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
};

type OpcaoTipo = 'reais' | 'percentual' | 'cortesia';
const TIPOS: { value: OpcaoTipo; label: string }[] = [
  { value: 'reais', label: 'Desconto em R$' },
  { value: 'percentual', label: 'Desconto em %' },
  { value: 'cortesia', label: 'Cortesia' },
];
const moeda = (valor: number) => `R$ ${valor.toFixed(2).replace('.', ',')}`;

export function DescontoModal({ visible, subtotal, descontoAtual, onApply, onRemove, onClose }: Props) {
  const COLORS = useColors();
  const [tipo, setTipo] = useState<OpcaoTipo>('reais');
  const [valorTexto, setValorTexto] = useState('');
  const valor = Number(valorTexto.replace(',', '.'));
  const [percentual, setPercentual] = useState('');
  const [motivo, setMotivo] = useState<MotivoDesconto | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const emEnvio = useRef(false);
  const temDesconto = descontoAtual?.desconto_tipo === 'desconto' || descontoAtual?.desconto_tipo === 'cortesia';

  useEffect(() => {
    if (!visible) return;
    setTipo(descontoAtual?.desconto_tipo === 'cortesia' ? 'cortesia' : 'reais');
    const valorAtual = calcularTotalComDesconto(subtotal, descontoAtual?.desconto_tipo, descontoAtual?.desconto_valor).descontoEfetivo;
    setValorTexto(valorAtual > 0 ? valorAtual.toFixed(2).replace('.', ',') : '');
    setPercentual('');
    setMotivo(MOTIVOS_DESCONTO.find((m) => m.value === descontoAtual?.desconto_motivo)?.value ?? null);
    setDetalhe('');
    setErro('');
  }, [visible, subtotal, descontoAtual?.desconto_tipo, descontoAtual?.desconto_valor, descontoAtual?.desconto_motivo]);

  const percentualNumero = /^\d+(?:[.,]\d+)?$/.test(percentual.trim())
    ? Number(percentual.trim().replace(',', '.')) : NaN;
  const valorPreview = tipo === 'percentual'
    ? Math.round(subtotal * percentualNumero) / 100 : valor;
  const previa = calcularTotalComDesconto(subtotal, tipo === 'cortesia' ? 'cortesia' : 'desconto', valorPreview);

  const enviar = async (acao: () => Promise<void>) => {
    if (emEnvio.current) return;
    emEnvio.current = true;
    setEnviando(true);
    setErro('');
    try {
      await acao();
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível atualizar o desconto. Tente novamente.');
    } finally {
      emEnvio.current = false;
      setEnviando(false);
    }
  };

  const aplicar = () => {
    if (emEnvio.current) return;
    if (tipo === 'reais' && (!Number.isFinite(valor) || valor <= 0)) {
      setErro('Informe um valor maior que zero.'); return;
    }
    if (tipo === 'reais' && valor > subtotal) {
      setErro('O desconto não pode ser maior que o subtotal.'); return;
    }
    if (tipo === 'percentual' && (!Number.isFinite(percentualNumero) || percentualNumero <= 0 || percentualNumero > 100)) {
      setErro('Informe um percentual maior que zero e de no máximo 100.'); return;
    }
    if (!motivo) { setErro('Selecione um motivo.'); return; }
    const detalheLimpo = detalhe.trim();
    if (motivo === 'outro' && !detalheLimpo) { setErro('Informe o detalhe do motivo.'); return; }
    const dados = { motivo, ...(detalheLimpo ? { detalhe: detalheLimpo } : {}) };
    const corpo: AplicarDescontoCorpo = tipo === 'cortesia'
      ? { ...dados, tipo: 'cortesia' }
      : tipo === 'percentual'
        ? { ...dados, tipo: 'desconto', percentual: percentualNumero }
        : { ...dados, tipo: 'desconto', valor };
    setErro('');
    if (tipo === 'cortesia') {
      Alert.alert('Confirmar cortesia', `O valor integral dos itens (${moeda(subtotal)}) será abatido. Deseja aplicar a cortesia?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar cortesia', style: 'destructive', onPress: () => { void enviar(() => onApply(corpo)); } },
      ]);
    } else {
      void enviar(() => onApply(corpo));
    }
  };

  const remover = () => {
    if (emEnvio.current) return;
    Alert.alert('Remover desconto', 'O desconto ou a cortesia será removido e os itens voltarão a ser cobrados integralmente. Deseja continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover desconto', style: 'destructive', onPress: () => { void enviar(onRemove); } },
    ]);
  };

  const fechar = () => { if (!emEnvio.current) onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={fechar}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={fechar} accessibilityLabel="Fechar desconto" disabled={enviando} />
        <View style={[s.card, { backgroundColor: COLORS.surface }]}>
          <Text style={[s.title, { color: COLORS.text }]}>Desconto e cortesia</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={s.content}>
            <Text style={[s.label, { color: COLORS.textSecondary }]}>Tipo</Text>
            {TIPOS.map((t) => (
              <Pressable key={t.value} disabled={enviando} onPress={() => { setTipo(t.value); setErro(''); }}
                accessibilityRole="radio" accessibilityState={{ checked: tipo === t.value, disabled: enviando }}
                style={[s.option, { borderColor: tipo === t.value ? COLORS.primary : COLORS.border, backgroundColor: tipo === t.value ? COLORS.primaryMuted : COLORS.surface }]}>
                <View style={[s.radio, { borderColor: tipo === t.value ? COLORS.primary : COLORS.textTertiary }]}>
                  {tipo === t.value && <View style={[s.radioDot, { backgroundColor: COLORS.primary }]} />}
                </View>
                <Text style={[s.optionText, { color: COLORS.text }]}>{t.label}</Text>
              </Pressable>
            ))}
            {tipo === 'reais' && (
              <View style={{ marginTop: 12 }}>
                <Text style={[s.label, { color: COLORS.textSecondary }]}>Valor do desconto (R$)</Text>
                <CampoMoeda value={valorTexto} onChangeText={setValorTexto} editable={!enviando} accessibilityLabel="Valor do desconto em reais"
                  placeholder="0,00" placeholderTextColor={COLORS.textTertiary}
                  style={[s.input, { color: COLORS.text, borderColor: COLORS.border, backgroundColor: COLORS.surfaceSecondary }]} />
              </View>
            )}
            {tipo === 'percentual' && (
              <View style={{ marginTop: 12 }}>
                <Text style={[s.label, { color: COLORS.textSecondary }]}>Percentual (até 100%)</Text>
                <TextInput value={percentual} onChangeText={setPercentual} editable={!enviando} keyboardType="decimal-pad"
                  accessibilityLabel="Percentual do desconto" placeholder="Ex.: 10,5" placeholderTextColor={COLORS.textTertiary}
                  style={[s.input, { color: COLORS.text, borderColor: COLORS.border, backgroundColor: COLORS.surfaceSecondary }]} />
              </View>
            )}
            <Text style={[s.label, { color: COLORS.textSecondary, marginTop: 16 }]}>Motivo</Text>
            {MOTIVOS_DESCONTO.map((m) => (
              <Pressable key={m.value} disabled={enviando} onPress={() => setMotivo(m.value)}
                accessibilityRole="radio" accessibilityState={{ checked: motivo === m.value, disabled: enviando }}
                style={[s.option, { borderColor: motivo === m.value ? COLORS.primary : COLORS.border, backgroundColor: motivo === m.value ? COLORS.primaryMuted : COLORS.surface }]}>
                <View style={[s.radio, { borderColor: motivo === m.value ? COLORS.primary : COLORS.textTertiary }]}>
                  {motivo === m.value && <View style={[s.radioDot, { backgroundColor: COLORS.primary }]} />}
                </View>
                <Text style={[s.optionText, { color: COLORS.text }]}>{m.label}</Text>
              </Pressable>
            ))}
            <Text style={[s.label, { color: COLORS.textSecondary, marginTop: 12 }]}>{motivo === 'outro' ? 'Detalhe (obrigatório)' : 'Detalhe (opcional)'}</Text>
            <TextInput value={detalhe} onChangeText={setDetalhe} editable={!enviando} multiline maxLength={200}
              placeholder="Descreva o motivo" placeholderTextColor={COLORS.textTertiary} accessibilityLabel="Detalhe do desconto"
              style={[s.input, s.detail, { color: COLORS.text, borderColor: COLORS.border, backgroundColor: COLORS.surfaceSecondary }]} />
            <Text style={[s.counter, { color: COLORS.textTertiary }]}>{detalhe.length}/200</Text>
            <View style={[s.preview, { backgroundColor: COLORS.surfaceSecondary }]}>
              <View style={s.row}><Text style={{ color: COLORS.textSecondary }}>Subtotal</Text><Text style={{ color: COLORS.text }}>{moeda(subtotal)}</Text></View>
              <View style={s.row}><Text style={{ color: COLORS.textSecondary }}>Desconto</Text><Text style={{ color: COLORS.danger }}>− {moeda(previa.descontoEfetivo)}</Text></View>
              <View style={s.row}><Text style={[s.bold, { color: COLORS.text }]}>Novo total</Text><Text style={[s.bold, { color: COLORS.text }]}>{moeda(previa.total)}</Text></View>
            </View>
          </ScrollView>
          {erro ? <Text accessibilityRole="alert" style={[s.error, { color: COLORS.danger }]}>{erro}</Text> : null}
          {temDesconto && (
            <Pressable onPress={remover} disabled={enviando} style={[s.remove, { opacity: enviando ? 0.5 : 1 }]}>
              <Text style={[s.btnText, { color: COLORS.danger }]}>Remover desconto</Text>
            </Pressable>
          )}
          <View style={s.buttons}>
            <Pressable disabled={enviando} onPress={fechar} style={[s.btn, { borderWidth: 1, borderColor: COLORS.border, opacity: enviando ? 0.5 : 1 }]}>
              <Text style={[s.btnText, { color: COLORS.textSecondary }]}>Cancelar</Text>
            </Pressable>
            <Pressable disabled={enviando} onPress={aplicar} style={[s.btn, { backgroundColor: COLORS.primary, opacity: enviando ? 0.6 : 1 }]}>
              {enviando ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[s.btnText, { color: '#fff' }]}>Aplicar</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', borderRadius: 18, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 10 },
  title: { fontSize: 19, fontFamily: 'Outfit_700Bold', marginBottom: 12 },
  scroll: { flexShrink: 1 },
  content: { paddingBottom: 4 },
  label: { fontFamily: 'Outfit_600SemiBold', fontSize: 13, marginBottom: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44, marginBottom: 6 },
  optionText: { fontFamily: 'Outfit_400Regular', fontSize: 14 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44, fontSize: 14, fontFamily: 'Outfit_400Regular' },
  detail: { minHeight: 72, textAlignVertical: 'top' },
  counter: { fontSize: 11, textAlign: 'right', marginTop: 4 },
  preview: { padding: 12, borderRadius: 10, gap: 8, marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  bold: { fontFamily: 'Outfit_700Bold' },
  error: { fontFamily: 'Outfit_400Regular', fontSize: 13, marginTop: 10 },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, minHeight: 44, padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Outfit_600SemiBold', fontSize: 14 },
});
