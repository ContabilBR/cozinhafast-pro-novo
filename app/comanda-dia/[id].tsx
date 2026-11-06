import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { apiGet } from '@/utils/api';
import { formatCurrency } from '@/utils/helpers';
import { MOTIVOS_CANCELAMENTO } from '@/utils/cancelamento';

type StatusComanda = 'aberta' | 'fechada' | 'cancelada';

interface Cancelamento {
  cancelado_em: string | null;
  cancelado_por_nome: string | null;
  motivo: string | null;
  motivo_detalhe: string | null;
  apos_inicio: boolean | null;
}
interface Item {
  id: string;
  prato_nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
  status: string;
  cancelamento: Cancelamento | null;
}
interface Pagamento {
  id: string;
  forma_pagamento: string;
  valor: number;
  troco: number;
  status: string;
  confirmado_em: string | null;
}
interface Desconto {
  valor: number;
  tipo: string | null;
  motivo: string | null;
  motivo_detalhe: string | null;
  autorizado_por: string | null;
  aplicado_por: string | null;
}
interface ComandaDia {
  id: string;
  origem: 'viva' | 'historico';
  mesa_numero: number | null;
  rotulo: string | null;
  garcom_nome: string | null;
  fechado_por_nome: string | null;
  status: StatusComanda;
  subtotal: number;
  gorjeta: number;
  total: number;
  desconto: Desconto | null;
  created_at: string | null;
  closed_at: string | null;
  itens: Item[];
  pagamentos: Pagamento[];
}

const STATUS_COMANDA: Record<string, { label: string; color: string }> = {
  aberta: { label: 'Aberta', color: '#22C55E' },
  fechada: { label: 'Fechada', color: '#6B7280' },
  cancelada: { label: 'Cancelada', color: '#EF4444' },
};

const STATUS_ITEM: Record<string, string> = {
  pendente: 'Pendente',
  em_preparo: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

const FORMAS: Record<string, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
};

const STATUS_PAGAMENTO: Record<string, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
};

function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')} ${g('hour')}:${g('minute')}`;
}

function rotuloMotivo(motivo: string | null | undefined): string {
  if (!motivo) return 'Sem motivo informado';
  return MOTIVOS_CANCELAMENTO.find((m) => m.value === motivo)?.label ?? motivo;
}

export default function ComandaDiaScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [dados, setDados] = useState<ComandaDia | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(
    async (modo: 'inicial' | 'refresh') => {
      if (!id) return;
      if (modo === 'inicial') setLoading(true);
      else setRefreshing(true);
      try {
        const d = await apiGet<ComandaDia>('/api/comandas-dia/' + id);
        setDados(d);
        setErro(null);
      } catch (e: any) {
        console.log('[ComandaDia] Erro ao carregar:', e);
        setErro(e?.message || 'Não foi possível carregar a comanda.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    carregar('inicial');
  }, [carregar]);

  const voltar = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(comandas)' as any);
  };

  const card = {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceSecondary,
    marginBottom: 12,
  } as const;
  const titulo = { fontFamily: 'Outfit_600SemiBold', fontSize: 16, color: COLORS.text, marginBottom: 12 } as const;
  const rotuloTxt = { fontFamily: 'Outfit_400Regular', fontSize: 14, color: COLORS.textSecondary } as const;
  const valorTxt = { fontFamily: 'Outfit_500Medium', fontSize: 14, color: COLORS.text } as const;

  const linha = (k: string, v: string, key?: string) => (
    <View key={key ?? k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 }}>
      <Text style={rotuloTxt}>{k}</Text>
      <Text style={[valorTxt, { flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );

  const header = (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={voltar}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}
      >
        <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        <Text style={{ fontFamily: 'Outfit_500Medium', fontSize: 15, color: COLORS.text }}>Voltar</Text>
      </Pressable>
      {dados && (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: COLORS.text }}>
              Mesa {dados.mesa_numero ?? '—'}
            </Text>
            {!!dados.rotulo && (
              <Text numberOfLines={1} style={{ fontFamily: 'Outfit_400Regular', fontSize: 13, color: COLORS.textSecondary }}>
                {dados.rotulo}
              </Text>
            )}
          </View>
          {(() => {
            const s = STATUS_COMANDA[dados.status] ?? { label: String(dados.status), color: '#6B7280' };
            return (
              <View style={{ backgroundColor: s.color + '22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 12, color: s.color }}>{s.label}</Text>
              </View>
            );
          })()}
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </View>
    );
  }

  if (erro || !dados) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <Ionicons name="alert-circle-outline" size={40} color={COLORS.textTertiary} />
          <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 15, color: COLORS.text, textAlign: 'center' }}>
            {erro || 'Não foi possível carregar a comanda.'}
          </Text>
          <Pressable
            onPress={() => carregar('inicial')}
            accessibilityRole="button"
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 15, color: '#fff' }}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const itensAtivos = dados.itens.filter((i) => i.status !== 'cancelado');
  const itensCancelados = dados.itens.filter((i) => i.status === 'cancelado');
  const cancelada = dados.status === 'cancelada';
  const aberta = dados.status === 'aberta';
  const desc = dados.desconto;
  const cortesia = desc?.tipo === 'cortesia';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => carregar('refresh')} tintColor={COLORS.primary} />}
      >
        <View style={card}>
          <Text style={titulo}>Dados gerais</Text>
          {linha('Garçom', dados.garcom_nome || 'Não informado')}
          {linha('Aberta em', dataHora(dados.created_at))}
          {!aberta && linha(cancelada ? 'Cancelada em' : 'Encerrada em', dataHora(dados.closed_at))}
          {!!dados.fechado_por_nome && linha('Fechada por', dados.fechado_por_nome)}
        </View>

        <View style={card}>
          <Text style={titulo}>Itens</Text>
          {itensAtivos.length === 0 ? (
            <Text style={rotuloTxt}>Nenhum item vendido nesta comanda.</Text>
          ) : (
            itensAtivos.map((i, idx) => (
              <View
                key={i.id}
                style={{ paddingVertical: 8, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: COLORS.surfaceSecondary }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <Text style={[valorTxt, { flex: 1 }]}>
                    {i.quantidade}x {i.prato_nome}
                  </Text>
                  <Text style={valorTxt}>{formatCurrency(i.quantidade * i.preco_unitario)}</Text>
                </View>
                <Text style={[rotuloTxt, { fontSize: 13 }]}>
                  {formatCurrency(i.preco_unitario)} cada · {STATUS_ITEM[i.status] ?? i.status}
                </Text>
                {!!i.observacao && (
                  <Text style={[rotuloTxt, { fontSize: 13, fontStyle: 'italic' }]}>Obs.: {i.observacao}</Text>
                )}
              </View>
            ))
          )}
        </View>

        {itensCancelados.length > 0 && (
          <View style={card}>
            <Text style={titulo}>Itens cancelados</Text>
            {itensCancelados.map((i, idx) => {
              const c = i.cancelamento;
              const perda = !!c?.apos_inicio;
              return (
                <View
                  key={i.id}
                  style={{ paddingVertical: 8, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: COLORS.surfaceSecondary }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <Text style={[valorTxt, { flex: 1, textDecorationLine: 'line-through', color: COLORS.textSecondary }]}>
                      {i.quantidade}x {i.prato_nome}
                    </Text>
                    <View style={{ backgroundColor: (perda ? '#EF4444' : '#6B7280') + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 11, color: perda ? '#EF4444' : '#6B7280' }}>
                        {perda ? 'Perda' : 'Cancelado'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[rotuloTxt, { fontSize: 13 }]}>{rotuloMotivo(c?.motivo)}</Text>
                  {!!c?.motivo_detalhe && <Text style={[rotuloTxt, { fontSize: 13 }]}>{c.motivo_detalhe}</Text>}
                  <Text style={[rotuloTxt, { fontSize: 12, color: COLORS.textTertiary }]}>
                    {c?.cancelado_por_nome ? `Por ${c.cancelado_por_nome} · ` : ''}
                    {dataHora(c?.cancelado_em)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={card}>
          <Text style={titulo}>Resumo</Text>
          {linha('Subtotal', formatCurrency(dados.subtotal))}
          {!!desc && desc.valor > 0 && (
            <View style={{ paddingVertical: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={rotuloTxt}>{cortesia ? 'Cortesia' : 'Desconto'}</Text>
                <Text style={[valorTxt, { color: '#EF4444' }]}>-{formatCurrency(desc.valor)}</Text>
              </View>
              {!!desc.motivo && (
                <Text style={[rotuloTxt, { fontSize: 13 }]}>
                  Motivo: {desc.motivo}
                  {desc.motivo_detalhe ? ` (${desc.motivo_detalhe})` : ''}
                </Text>
              )}
              {!!desc.autorizado_por && (
                <Text style={[rotuloTxt, { fontSize: 13 }]}>
                  Autorizado por {desc.autorizado_por}
                  {desc.aplicado_por && desc.aplicado_por !== desc.autorizado_por ? `, aplicado por ${desc.aplicado_por}` : ''}
                </Text>
              )}
            </View>
          )}
          {dados.gorjeta > 0 && linha('Gorjeta', formatCurrency(dados.gorjeta))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 6, borderTopWidth: 1, borderTopColor: COLORS.surfaceSecondary }}>
            <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 16, color: COLORS.text }}>Total</Text>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 16, color: COLORS.primary }}>{formatCurrency(dados.total)}</Text>
          </View>
          {aberta && (
            <Text style={[rotuloTxt, { fontSize: 13, marginTop: 8 }]}>Comanda ainda aberta: o total pode mudar.</Text>
          )}
        </View>

        {dados.pagamentos.length > 0 && (
          <View style={card}>
            <Text style={titulo}>Pagamentos</Text>
            {dados.pagamentos.map((p, idx) => (
              <View
                key={p.id}
                style={{ paddingVertical: 8, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: COLORS.surfaceSecondary }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <Text style={valorTxt}>{FORMAS[p.forma_pagamento] ?? p.forma_pagamento}</Text>
                  <Text style={valorTxt}>{formatCurrency(p.valor)}</Text>
                </View>
                <Text style={[rotuloTxt, { fontSize: 13 }]}>
                  {STATUS_PAGAMENTO[p.status] ?? p.status}
                  {p.confirmado_em ? ` · ${dataHora(p.confirmado_em)}` : ''}
                </Text>
                {p.troco > 0 && <Text style={[rotuloTxt, { fontSize: 13 }]}>Troco: {formatCurrency(p.troco)}</Text>}
              </View>
            ))}
          </View>
        )}

        {aberta && (
          <Pressable
            onPress={() => router.push({ pathname: '/comanda/[id]', params: { id: dados.id } } as any)}
            accessibilityRole="button"
            style={{ backgroundColor: COLORS.primary, borderRadius: 16, padding: 16, alignItems: 'center', minHeight: 48 }}
          >
            <Text style={{ fontFamily: 'Outfit_600SemiBold', fontSize: 16, color: '#fff' }}>Abrir comanda</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
