import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useColors } from '@/hooks/useColors';
import { exportarExcel, exportarPdf } from '@/utils/exportacao/exportar';
import type { RelatorioDef } from '@/utils/exportacao/definicao';

/** Par de botões idêntico em todas as telas de relatório. `gerar` monta a definição do relatório. */
export function BotoesExportar({ gerar }: { gerar: () => Promise<RelatorioDef> }) {
  const colors = useColors();
  const [ocupado, setOcupado] = useState<'excel' | 'pdf' | null>(null);
  const [erro, setErro] = useState('');
  const executar = async (tipo: 'excel' | 'pdf') => {
    if (ocupado) return;
    setOcupado(tipo); setErro('');
    try {
      const definicao = await gerar();
      await (tipo === 'excel' ? exportarExcel(definicao) : exportarPdf(definicao));
    } catch (e: unknown) {
      setErro((e as Error)?.message || 'Não foi possível exportar. Tente novamente.');
    } finally { setOcupado(null); }
  };
  const botao = (tipo: 'excel' | 'pdf', rotulo: string, icone: 'grid-outline' | 'document-text-outline') => (
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={rotulo} disabled={!!ocupado} onPress={() => executar(tipo)}
      style={[styles.botao, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {ocupado === tipo ? <ActivityIndicator color={colors.primary} />
        : <Ionicons name={icone} size={18} color={colors.primary} />}
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{rotulo}</Text>
    </AnimatedPressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.linha}>
        <View style={{ flex: 1 }}>{botao('excel', 'Exportar Excel', 'grid-outline')}</View>
        <View style={{ flex: 1 }}>{botao('pdf', 'Exportar PDF', 'document-text-outline')}</View>
      </View>
      {!!erro && <Text style={{ color: colors.danger, fontSize: 12 }}>{erro}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 8 },
  botao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, minHeight: 46 },
});
