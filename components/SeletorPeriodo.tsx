import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useColors } from '@/hooks/useColors';
import { dataBR } from '@/utils/exportacao/definicao';
import { OPCOES_PERIODO, hojeBrasilia, resolverPeriodo } from '@/utils/exportacao/periodo';
import type { OpcaoPeriodo } from '@/utils/exportacao/periodo';

export interface EstadoPeriodo { opcao: OpcaoPeriodo; inicio: string; fim: string }
export const periodoInicial = (): EstadoPeriodo => ({ opcao: 'hoje', inicio: hojeBrasilia(), fim: hojeBrasilia() });
export const periodoDoEstado = (e: EstadoPeriodo) => resolverPeriodo(e.opcao, e.inicio, e.fim);

const paraIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const paraData = (iso: string) => new Date(`${iso}T12:00:00`);

/** Seletor de período reutilizável: Hoje, Ontem, Últimos 7 dias, Mês atual, Mês anterior, Personalizado. */
export function SeletorPeriodo({ value, onChange }: { value: EstadoPeriodo; onChange: (v: EstadoPeriodo) => void }) {
  const colors = useColors();
  const [escolhendo, setEscolhendo] = useState<'inicio' | 'fim' | null>(null);
  const hoje = hojeBrasilia();
  const periodo = periodoDoEstado(value);
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {OPCOES_PERIODO.map(o => {
          const ativo = value.opcao === o.valor;
          return (
            <AnimatedPressable key={o.valor} accessibilityRole="button" accessibilityState={{ selected: ativo }}
              onPress={() => onChange({ ...value, opcao: o.valor })}
              style={[styles.chip, { backgroundColor: ativo ? colors.primary : colors.surface, borderColor: ativo ? colors.primary : colors.border }]}>
              <Text style={{ color: ativo ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{o.rotulo}</Text>
            </AnimatedPressable>
          );
        })}
      </ScrollView>
      {value.opcao === 'personalizado' && (
        <View style={styles.datas}>
          {(['inicio', 'fim'] as const).map(campo => (
            <AnimatedPressable key={campo} accessibilityRole="button" onPress={() => setEscolhendo(campo)}
              style={[styles.data, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{campo === 'inicio' ? 'Data inicial' : 'Data final'}</Text>
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{dataBR(campo === 'inicio' ? periodo.inicio : periodo.fim)}</Text>
            </AnimatedPressable>
          ))}
        </View>
      )}
      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
        Período: {periodo.inicio === periodo.fim ? dataBR(periodo.inicio) : `${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}`}
      </Text>
      {escolhendo && (
        <DateTimePicker
          value={paraData(escolhendo === 'inicio' ? periodo.inicio : periodo.fim)} mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'} maximumDate={paraData(hoje)}
          onChange={(evento, data) => {
            const campo = escolhendo;
            if (Platform.OS !== 'ios' || evento.type === 'dismissed') setEscolhendo(null);
            if (evento.type === 'dismissed' || !data || !campo) return;
            const iso = paraIso(data);
            onChange(campo === 'inicio' ? { ...value, inicio: iso, fim: periodo.fim < iso ? iso : periodo.fim }
              : { ...value, fim: iso, inicio: periodo.inicio > iso ? iso : periodo.inicio });
          }}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  datas: { flexDirection: 'row', gap: 8 },
  data: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 48 },
});
