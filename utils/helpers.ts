import { ItemStatus, TableStatus, UserRole, PedidoStatus, Mesa } from '@/types';

export function formatCurrency(value: number | string | undefined | null): string {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

export function formatElapsed(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min`;
}

export function getItemStatusLabel(status: ItemStatus): string {
  const labels: Record<ItemStatus, string> = {
    pendente: 'Pendente',
    recebido: 'Recebido',
    em_preparo: 'Em Preparo',
    pronto: 'Pronto',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  };
  return labels[status] || status;
}

export function getPedidoStatusLabel(status: PedidoStatus | string): string {
  const labels: Record<string, string> = {
    pendente: 'Pendente',
    recebido: 'Recebido',
    em_preparacao: 'Em Preparo',
    em_preparo: 'Em Preparo',
    pronto: 'Pronto',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  };
  return labels[status] || status;
}

export function getPedidoStatusColor(status: PedidoStatus | string): string {
  const map: Record<string, string> = {
    pendente: '#94A3B8',
    recebido: '#3B82F6',
    em_preparacao: '#F59E0B',
    em_preparo: '#F59E0B',
    pronto: '#22C55E',
    entregue: '#0D9488',
    cancelado: '#EF4444',
  };
  return map[status] || '#94A3B8';
}

export function getMesaStatusLabel(status: Mesa['status'] | string): string {
  const labels: Record<string, string> = {
    livre: 'Livre',
    ocupada: 'Ocupada',
    reservada: 'Reservada',
    aguardando_pedido: 'Aguardando',
    em_preparacao: 'Em Preparo',
    pedido_pronto: 'Pronto',
    finalizada: 'Finalizada',
  };
  return labels[status] || String(status);
}

export function getMesaStatusColor(status: Mesa['status'] | string): string {
  const map: Record<string, string> = {
    livre: '#22C55E',
    ocupada: '#E8521A',
    reservada: '#F59E0B',
    aguardando_pedido: '#F59E0B',
    em_preparacao: '#3B82F6',
    pedido_pronto: '#8B5CF6',
    finalizada: '#94A3B8',
  };
  return map[status] || '#94A3B8';
}

export function getTableStatusLabel(status: TableStatus): string {
  const labels: Record<TableStatus, string> = {
    livre: 'Livre',
    ocupada: 'Ocupada',
    reservada: 'Reservada',
    fechando: 'Fechando',
  };
  return labels[status] || status;
}

export function getRoleLabel(role: UserRole | string | undefined | null): string {
  const labels: Record<string, string> = {
    garcom: 'Garçom',
    administrador: 'Administrador',
    admin: 'Administrador',
    gerente: 'Gerente',
    cozinheiro: 'Cozinheiro',
  };
  if (!role) return 'Usuário';
  return labels[role] || String(role);
}

export function getInitials(name: string | undefined | null): string {
  if (!name || !name.trim()) return '?';
  return name
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export function isAdmin(role: UserRole | string | undefined | null): boolean {
  return role === 'gerente' || role === 'administrador' || role === 'admin';
}

/**
 * Parse a Brazilian-formatted monetary string typed by the user.
 * Accepts: "174,90" "174.90" "1.234,50" "R$ 50" "50"
 * Returns the numeric value rounded to 2 decimal places, or undefined if empty/invalid.
 */
export function parseBRL(text: string): number | undefined {
  if (!text) return undefined;
  // Remove R$, spaces
  let s = text.replace(/R\$\s*/g, "").trim();
  if (!s) return undefined;
  // If there's a comma, treat comma as decimal separator and dots as thousand separators
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // Otherwise dots are decimal separators (e.g. "174.90")
  const n = parseFloat(s);
  if (isNaN(n)) return undefined;
  return Math.round(n * 100) / 100;
}
