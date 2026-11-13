import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Modal, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useColors } from '@/hooks/useColors';
import { dataBR } from '@/utils/exportacao/definicao';
import type { Periodo, RelatorioDef } from '@/utils/exportacao/definicao';
import { executarEtapa, exportarExcel, exportarPdf } from '@/utils/exportacao/exportar';
import { resolverPeriodo } from '@/utils/exportacao/periodo';

type Opcao = 'dia' | '7dias' | 'mes';
type Formato = 'excel' | 'pdf';

const OPCOES: { valor: Opcao; rotulo: string }[] = [
  { valor: 'dia', rotulo: 'Dia exibido' },
  { valor: '7dias', rotulo: 'Últimos 7 dias' },
  { valor: 'mes', rotulo: 'Mês atual' },
];
const ALTURA_TELA = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Dia que está na tela agora (AAAA-MM-DD). */
  diaExibido: string;
  /** Mesma geração de antes: monta a definição do relatório para o período. */
  gerar: (periodo: Periodo) => Promise<RelatorioDef>;
}

/** Tela flutuante (bottom sheet) para escolher período e formato da exportação do fechamento. */
export function ExportarFechamentoSheet({ visible, onClose, diaExibido, gerar }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [montado, setMontado] = useState(visible);
  const [opcao, setOpcao] = useState<Opcao>('dia');
  const [formato, setFormato] = useState<Formato | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const ocupadoRef = useRef(false);
  const translateY = useRef(new Animated.Value(ALTURA_TELA)).current;
  const fundo = useRef(new Animated.Value(0)).current;

  const periodo = useMemo<Periodo>(
    () => (opcao === 'dia' ? { inicio: diaExibido, fim: diaExibido } : resolverPeriodo(opcao)),
    [opcao, diaExibido],
  );

  // Abre e fecha com animação; ao abrir, volta ao estado inicial (Dia exibido, nenhum formato).
  useEffect(() => {
    if (visible) {
      setOpcao('dia'); setFormato(null); setErro(''); setOcupado(false); ocupadoRef.current = false;
      translateY.setValue(ALTURA_TELA); fundo.setValue(0);
      setMontado(true);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(fundo, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } else if (montado) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: ALTURA_TELA, duration: 200, useNativeDriver: true }),
        Animated.timing(fundo, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMontado(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Enquanto o arquivo é gerado a sheet não fecha, para não perder o compartilhamento.
  const pedirFechar = () => { if (!ocupadoRef.current) onClose(); };

  const arrastar = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (!ocupadoRef.current && (g.dy > 100 || g.vy > 0.8)) onClose();
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onClose]);

  const exportar = async () => {
    if (!formato || ocupadoRef.current) return;
    ocupadoRef.current = true; setOcupado(true); setErro('');
    try {
      const definicao = await executarEtapa('Falha ao montar o relatório', () => gerar(periodo));
      await (formato === 'excel' ? exportarExcel(definicao) : exportarPdf(definicao));
      ocupadoRef.current = false; setOcupado(false);
      onClose();
    } catch (e: unknown) {
      setErro((e as Error)?.message || 'Não foi possível exportar. Tente novamente.');
      ocupadoRef.current = false; setOcupado(false);
    }
  };

  const textoPeriodo = periodo.inicio === periodo.fim ? dataBR(periodo.inicio) : `${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}`;
  const opcaoBotao = (ativo: boolean) => ({
    backgroundColor: ativo ? colors.primary : colors.surface, borderColor: ativo ? colors.primary : colors.border,
  });

  return (
    <Modal visible={montado} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={pedirFechar}>
      <View style={styles.raiz}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.fundo, { opacity: fundo }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={pedirFechar} accessibilityLabel="Fechar" />
        </Animated.View>
        <Animated.View style={[styles.sheet, {
          backgroundColor: colors.background, borderColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 12) + 4, transform: [{ translateY }],
        }]}>
          <View {...arrastar.panHandlers} style={styles.topo}>
            <View style={[styles.alca, { backgroundColor: colors.border }]} />
            <View style={styles.linhaTitulo}>
              <Text accessibilityRole="header" style={[styles.titulo, { color: colors.text }]}>Exportar relatório</Text>
              <AnimatedPressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={pedirFechar} disabled={ocupado}
                style={styles.fechar}>
                <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>Fechar</Text>
              </AnimatedPressable>
            </View>
          </View>

          <View style={styles.corpo}>
            <View style={styles.chips}>
              {OPCOES.map(o => {
                const ativo = opcao === o.valor;
                return (
                  <AnimatedPressable key={o.valor} accessibilityRole="button" accessibilityState={{ selected: ativo, disabled: ocupado }}
                    disabled={ocupado} onPress={() => setOpcao(o.valor)} style={[styles.chip, opcaoBotao(ativo)]}>
                    <Text style={{ color: ativo ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{o.rotulo}</Text>
                  </AnimatedPressable>
                );
              })}
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Período: {textoPeriodo}</Text>

            <View style={styles.formatos}>
              {([['excel', 'Excel', 'grid-outline'], ['pdf', 'PDF', 'document-text-outline']] as const).map(([valor, rotulo, icone]) => {
                const ativo = formato === valor;
                return (
                  <View key={valor} style={{ flex: 1 }}>
                    <AnimatedPressable accessibilityRole="button" accessibilityState={{ selected: ativo, disabled: ocupado }}
                      disabled={ocupado} onPress={() => setFormato(valor)} style={[styles.formato, opcaoBotao(ativo)]}>
                      <Ionicons name={icone} size={18} color={ativo ? '#fff' : colors.primary} />
                      <Text style={{ color: ativo ? '#fff' : colors.text, fontWeight: '600', fontSize: 14 }}>{rotulo}</Text>
                    </AnimatedPressable>
                  </View>
                );
              })}
            </View>
          </View>

          {!!erro && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, marginTop: 4 }}>{erro}</Text>}
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Exportar" accessibilityState={{ disabled: !formato || ocupado, busy: ocupado }}
            disabled={!formato || ocupado} onPress={exportar}
            style={[styles.principal, { backgroundColor: colors.primary }]}>
            {ocupado ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.principalTexto}>{ocupado ? 'Exportando…' : 'Exportar'}</Text>
          </AnimatedPressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, justifyContent: 'flex-end' },
  fundo: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, gap: 12 },
  topo: { paddingTop: 8, gap: 8 },
  alca: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titulo: { fontSize: 18, fontWeight: '700' },
  fechar: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  corpo: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  formatos: { flexDirection: 'row', gap: 8 },
  formato: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, minHeight: 46 },
  principal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, minHeight: 50 },
  principalTexto: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
