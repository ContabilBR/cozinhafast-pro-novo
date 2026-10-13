import React from 'react';
import { View, Text } from 'react-native';
import { COLORS } from '@/constants/Colors';
import { ItemStatus, TableStatus, OrderStatus } from '@/types';
import { getItemStatusLabel, getTableStatusLabel } from '@/utils/helpers';

interface StatusBadgeProps {
  status: ItemStatus | TableStatus | OrderStatus;
  type: 'item' | 'table' | 'order';
  size?: 'sm' | 'md';
}

function getItemStatusColor(status: ItemStatus): string {
  const map: Record<ItemStatus, string> = {
    pendente: COLORS.statusPendente,
    recebido: COLORS.statusRecebido,
    em_preparo: COLORS.statusEmPreparo,
    pronto: COLORS.statusPronto,
    entregue: COLORS.statusEntregue,
    cancelado: COLORS.statusCancelado,
  };
  return map[status] || COLORS.textSecondary;
}

function getTableStatusColor(status: TableStatus): string {
  const map: Record<TableStatus, string> = {
    livre: COLORS.statusLivre,
    ocupada: COLORS.statusOcupada,
    reservada: COLORS.statusReservada,
    fechando: COLORS.statusFechando,
  };
  return map[status] || COLORS.textSecondary;
}

function getOrderStatusColor(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    aberta: COLORS.statusLivre,
    fechando: COLORS.statusFechando,
    fechada: COLORS.statusEntregue,
    cancelada: COLORS.statusCancelado,
  };
  return map[status] || COLORS.textSecondary;
}

function getOrderStatusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    aberta: 'Aberta',
    fechando: 'Fechando',
    fechada: 'Fechada',
    cancelada: 'Cancelada',
  };
  return map[status] || status;
}

export function StatusBadge({ status, type, size = 'md' }: StatusBadgeProps) {
  let color = COLORS.textSecondary;
  let label: string = status;

  if (type === 'item') {
    color = getItemStatusColor(status as ItemStatus);
    label = getItemStatusLabel(status as ItemStatus);
  } else if (type === 'table') {
    color = getTableStatusColor(status as TableStatus);
    label = getTableStatusLabel(status as TableStatus);
  } else if (type === 'order') {
    color = getOrderStatusColor(status as OrderStatus);
    label = getOrderStatusLabel(status as OrderStatus);
  }

  const fontSize = size === 'sm' ? 10 : 12;
  const paddingH = size === 'sm' ? 6 : 8;
  const paddingV = size === 'sm' ? 2 : 3;

  return (
    <View
      style={{
        backgroundColor: color + '20',
        borderRadius: 20,
        paddingHorizontal: paddingH,
        paddingVertical: paddingV,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color,
          fontSize,
          fontFamily: 'Outfit_600SemiBold',
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
