import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Share,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type ItemRecibo = {
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  subtotal_item: number;
};

const formatBRL = (value: number) =>
  Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDateTime = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const DASHES = '- - - - - - - - - - - - - - - -';

export default function ComprovanteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    mesa_numero: string;
    subtotal: string;
    gorjeta: string;
    total_final: string;
    num_pessoas: string;
    valor_por_pessoa: string;
    created_at: string;
    closed_at: string;
    itens: string;
  }>();

  const mesaNumero = params.mesa_numero ?? '';
  const subtotal = Number(params.subtotal ?? 0);
  const gorjeta = Number(params.gorjeta ?? 0);
  const totalFinal = Number(params.total_final ?? 0);
  const numPessoas = Number(params.num_pessoas ?? 1);
  const valorPorPessoa = Number(params.valor_por_pessoa ?? 0);
  const createdAt = params.created_at ?? '';
  const closedAt = params.closed_at ?? '';

  let itens: ItemRecibo[] = [];
  try {
    itens = JSON.parse(params.itens ?? '[]');
  } catch {
    itens = [];
  }

  const entradaDisplay = formatDateTime(createdAt);
  const encerramentoDisplay = formatDateTime(closedAt);
  const subtotalDisplay = formatBRL(subtotal);
  const gorjetaDisplay = formatBRL(gorjeta);
  const totalDisplay = formatBRL(totalFinal);
  const porPessoaDisplay = formatBRL(valorPorPessoa);
  const mesaLabel = `Mesa ${mesaNumero}`;
  const showGorjeta = gorjeta > 0;
  const showPessoas = numPessoas > 1;

  const buildShareText = () => {
    const lines: string[] = [];
    lines.push('CozinhaFast Pro');
    lines.push(mesaLabel);
    lines.push(`Entrada: ${entradaDisplay}`);
    lines.push(`Encerramento: ${encerramentoDisplay}`);
    lines.push('--------------------------------');
    itens.forEach((item) => {
      lines.push(item.prato_nome);
      const unitStr = formatBRL(Number(item.preco_unitario));
      const subStr = formatBRL(Number(item.subtotal_item));
      lines.push(`${item.quantidade}x ${unitStr} = ${subStr}`);
    });
    lines.push('--------------------------------');
    lines.push(`Subtotal: ${subtotalDisplay}`);
    if (showGorjeta) {
      lines.push(`Gorjeta: ${gorjetaDisplay}`);
    }
    lines.push(`TOTAL: ${totalDisplay}`);
    if (showPessoas) {
      lines.push('--------------------------------');
      lines.push(`${numPessoas} pessoas - ${porPessoaDisplay} por pessoa`);
    }
    return lines.join('\n');
  };

  const handleShare = async () => {
    console.log('[Comprovante] Compartilhar pressed');
    const text = buildShareText();
    try {
      await Share.share({ message: text });
      console.log('[Comprovante] Share dialog opened');
    } catch (e: any) {
      console.error('[Comprovante] Share error:', e?.message);
    }
  };

  const handleConcluir = () => {
    console.log('[Comprovante] Concluir pressed — navigating to /(tabs)/(home)');
    router.replace('/(tabs)/(home)');
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 10 }}><Ionicons name="arrow-back" size={24} color="#000" /></Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Comprovante</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Restaurant name */}
        <Text style={styles.restaurantName}>CozinhaFast Pro</Text>
        <View style={styles.solidDivider} />

        {/* Mesa */}
        <Text style={styles.mesaLabel}>{mesaLabel}</Text>

        {/* Horários */}
        <View style={styles.horariosBlock}>
          <View style={styles.horarioRow}>
            <Text style={styles.horarioKey}>Entrada:</Text>
            <Text style={styles.horarioVal}>{entradaDisplay}</Text>
          </View>
          <View style={styles.horarioRow}>
            <Text style={styles.horarioKey}>Encerramento:</Text>
            <Text style={styles.horarioVal}>{encerramentoDisplay}</Text>
          </View>
        </View>

        {/* Dashed divider */}
        <Text style={styles.dashes}>{DASHES}</Text>

        {/* Itens */}
        {itens.map((item, idx) => {
          const unitStr = formatBRL(Number(item.preco_unitario));
          const subStr = formatBRL(Number(item.subtotal_item));
          const qtyUnit = `${item.quantidade}x  ${unitStr}`;
          return (
            <View key={idx} style={styles.itemBlock}>
              <Text style={styles.itemName}>{item.prato_nome}</Text>
              <View style={styles.itemPriceRow}>
                <Text style={styles.itemQtyUnit}>{qtyUnit}</Text>
                <Text style={styles.itemSubtotal}>{subStr}</Text>
              </View>
            </View>
          );
        })}

        {/* Dashed divider */}
        <Text style={styles.dashes}>{DASHES}</Text>

        {/* Subtotal */}
        <View style={styles.totalRow}>
          <Text style={styles.totalKey}>Subtotal</Text>
          <Text style={styles.totalVal}>{subtotalDisplay}</Text>
        </View>

        {/* Gorjeta */}
        {showGorjeta ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Gorjeta (10%)</Text>
            <Text style={styles.totalVal}>{gorjetaDisplay}</Text>
          </View>
        ) : null}

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.grandTotalKey}>TOTAL</Text>
          <Text style={styles.grandTotalVal}>{totalDisplay}</Text>
        </View>

        {/* Dashed divider */}
        <Text style={styles.dashes}>{DASHES}</Text>

        {/* Pessoas */}
        {showPessoas ? (
          <>
            <Text style={styles.pessoasText}>
              {numPessoas}
              {' pessoas — '}
              {porPessoaDisplay}
              {' por pessoa'}
            </Text>
            <Text style={styles.dashes}>{DASHES}</Text>
          </>
        ) : null}

        {/* Buttons */}
        <View style={styles.btnStack}>
          <Pressable
            style={styles.shareBtn}
            onPress={handleShare}
          >
            <Text style={styles.shareBtnText}>Compartilhar</Text>
          </Pressable>
          <Pressable
            style={styles.concluirBtn}
            onPress={handleConcluir}
          >
            <Text style={styles.concluirBtnText}>Concluir</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const MONO = 'Courier';
const INK = '#1a1a1a';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 32,
  },
  restaurantName: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '700',
    color: INK,
    textAlign: 'center',
    marginBottom: 12,
  },
  solidDivider: {
    height: 1,
    backgroundColor: '#d1d5db',
    marginBottom: 16,
  },
  mesaLabel: {
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: '700',
    color: INK,
    textAlign: 'center',
    marginBottom: 16,
  },
  horariosBlock: {
    marginBottom: 12,
  },
  horarioRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  horarioKey: {
    fontFamily: MONO,
    fontSize: 13,
    color: INK,
    width: 130,
  },
  horarioVal: {
    fontFamily: MONO,
    fontSize: 13,
    color: INK,
    flex: 1,
  },
  dashes: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginVertical: 12,
    letterSpacing: 1,
  },
  itemBlock: {
    marginBottom: 10,
  },
  itemName: {
    fontFamily: MONO,
    fontSize: 14,
    color: INK,
    marginBottom: 2,
  },
  itemPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemQtyUnit: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#4b5563',
  },
  itemSubtotal: {
    fontFamily: MONO,
    fontSize: 13,
    color: INK,
    fontWeight: '600',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  totalKey: {
    fontFamily: MONO,
    fontSize: 16,
    color: INK,
  },
  totalVal: {
    fontFamily: MONO,
    fontSize: 16,
    color: INK,
  },
  grandTotalKey: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '700',
    color: INK,
  },
  grandTotalVal: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: '700',
    color: INK,
  },
  pessoasText: {
    fontFamily: MONO,
    fontSize: 14,
    color: INK,
    textAlign: 'center',
    marginBottom: 4,
  },
  btnStack: {
    marginTop: 8,
    gap: 12,
  },
  shareBtn: {
    borderWidth: 1.5,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  shareBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: INK,
  },
  concluirBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  concluirBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
