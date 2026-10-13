export type UserRole = 'garcom' | 'cozinheiro' | 'gerente' | 'administrador' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Categoria {
  id: string;
  nome: string;
  descricao?: string;
}

export interface Prato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  categoria_id?: string;
  categoria?: Categoria;
  imagem_url?: string;
  tempo_preparo?: number;
  disponivel: boolean;
  restricoes?: string;
  adicionais?: string;
}

export interface Mesa {
  id: string;
  numero: number;
  capacidade: number;
  status: 'livre' | 'ocupada' | 'reservada' | 'aguardando_pedido' | 'em_preparacao' | 'pedido_pronto' | 'finalizada';
  garcom_id?: string;
  garcom?: User;
  comanda_id?: string;
}

export interface ItemPedido {
  id: string;
  pedido_id: string;
  prato_id: string;
  prato?: Prato;
  quantidade: number;
  preco_unitario: number;
  observacoes?: string;
}

export type PedidoStatus = 'pendente' | 'recebido' | 'em_preparacao' | 'pronto' | 'entregue' | 'cancelado';

export interface Pedido {
  id: string;
  comanda_id: string;
  prato_id?: string;
  prato?: Prato;
  mesa_id?: string;
  mesa_numero?: number;
  mesa?: Mesa;
  garcom_id?: string;
  garcom?: User;
  quantidade?: number;
  preco_unitario?: number;
  status: PedidoStatus;
  observacao?: string;
  observacoes?: string;
  sent_at?: string;
  created_at?: string;
  received_at?: string;
  started_at?: string;
  ready_at?: string;
  delivered_at?: string;
  itens?: ItemPedido[];
}

export type ComandaStatus = 'aberta' | 'fechada' | 'cancelada';

export interface Comanda {
  id: string;
  mesa_id: string;
  mesa?: Mesa;
  garcom_id?: string;
  garcom_nome?: string;
  garcom?: User;
  status: ComandaStatus;
  total: number;
  opened_at?: string;
  created_at?: string;
  closed_at?: string;
  pedidos?: Pedido[];
}

export interface Usuario {
  id: string;
  nome: string;
  name?: string;
  email: string;
  role: 'admin' | 'gerente' | 'garcom' | 'cozinheiro' | 'administrador';
}

export interface RelatorioResumo {
  total_mesas: number;
  mesas_ocupadas: number;
  comandas_abertas: number;
  pedidos_pendentes: number;
  pedidos_em_preparo?: number;
  pedidos_atrasados?: number;
  receita_periodo: number;
  periodo_label: string;
  avg_ticket?: number;
  total_pratos?: number;
  top_dishes?: Array<{ dish_name: string; quantity_sold: number }>;
  orders_by_status?: {
    aberta: number;
    fechada: number;
    cancelada: number;
  };
}

// Legacy types kept for backward compat with existing components
export type UserRole_Legacy = UserRole;
export type TableStatus = 'livre' | 'ocupada' | 'reservada' | 'fechando';
export type OrderStatus = 'aberta' | 'fechando' | 'fechada' | 'cancelada';
export type ItemStatus = 'pendente' | 'recebido' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelado';

export interface Category {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  active: boolean;
}

export interface Dish {
  id: string;
  name: string;
  description?: string;
  category_id: string;
  category?: Category;
  price: number;
  image_url?: string;
  prep_time_minutes: number;
  active: boolean;
}

export interface Table {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  location?: string;
  active: boolean;
  current_order_id?: string;
}

export interface Order {
  id: string;
  table_id: string;
  table?: Table;
  waiter_id: string;
  waiter?: User;
  status: OrderStatus;
  customer_count: number;
  notes?: string;
  opened_at: string;
  closed_at?: string;
  total_amount: number;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  dish_id: string;
  dish?: Dish;
  quantity: number;
  unit_price: number;
  notes?: string;
  status: ItemStatus;
  requested_at: string;
  received_at?: string;
  started_at?: string;
  ready_at?: string;
  delivered_at?: string;
}

export interface KitchenQueueItem {
  item_id: string;
  order_id: string;
  table_number: number;
  waiter_name?: string;
  dish_name: string;
  dish_image_url?: string;
  quantity: number;
  notes?: string;
  status: ItemStatus;
  requested_at: string;
  started_at?: string;
}
