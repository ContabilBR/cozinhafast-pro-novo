import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

// Enums
export const mesaStatusEnum = pgEnum("mesa_status", ["disponivel", "ocupada", "reservada"]);
export const comandaStatusEnum = pgEnum("comanda_status", ["aberta", "fechada", "cancelada"]);
export const tipoComandaEnum = pgEnum("tipo_comanda", ["mesa", "delivery", "balcao"]);
export const entregaStatusEnum = pgEnum("entrega_status", ["pendente", "preparando", "saiu_entrega", "entregue", "cancelada"]);
export const pedidoStatusEnum = pgEnum("pedido_status", [
  "pendente",
  "em_preparo",
  "pronto",
  "entregue",
  "cancelado",
]);
export const formaPagamentoEnum = pgEnum("forma_pagamento", ["pix", "dinheiro", "cartao_credito", "cartao_debito"]);
export const pagamentoStatusEnum = pgEnum("pagamento_status", ["pendente", "confirmado", "cancelado"]);
export const nfceStatusEnum = pgEnum("nfce_status", ["pendente", "processando", "autorizada", "rejeitada", "cancelada", "erro"]);
export const unidadeMedidaEnum = pgEnum("unidade_medida", ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"]);
export const movimentacaoTipoEnum = pgEnum("movimentacao_tipo", ["entrada", "saida", "ajuste"]);
export const tipoDocumentoFiscalEnum = pgEnum("tipo_documento_fiscal", ["nfce", "nfe", "nfse"]);
export const regimeTributarioEnum = pgEnum("regime_tributario", ["simples_nacional", "simples_excesso", "regime_normal", "mei"]);
export const planoEnum = pgEnum("plano", ["trial", "basico", "profissional", "enterprise"]);
export const assinaturaStatusEnum = pgEnum("assinatura_status", ["trial", "ativa", "inadimplente", "cancelada", "expirada"]);
export const modoComandaEnum = pgEnum("modo_comanda", ["mesa", "individual"]);

// Restaurante (Restaurant information) - Define early since many tables reference it
export const restaurante = pgTable("restaurante", {
  // O id do restaurante É o CNPJ (14 dígitos, sem pontuação). Exceção: a plataforma interna
  // usa o id fixo "00000000000000" (não é um CNPJ válido, então nunca colide com um real).
  id: text("id").primaryKey(),
  nome: text("nome").notNull(),
  filial: text("filial"),
  endereco: text("endereco"),
  cnpj: text("cnpj"),
  plano: planoEnum("plano").default("trial").notNull(),
  assinaturaStatus: assinaturaStatusEnum("assinatura_status").default("trial").notNull(),
  assinaturaAsaasId: text("assinatura_asaas_id"),
  trialExpiraEm: timestamp("trial_expira_em", { withTimezone: true }),
  // === Dados fiscais (Tier 2B.1) ===
  inscricaoEstadual: text("inscricao_estadual"),
  inscricaoMunicipal: text("inscricao_municipal"),
  regimeTributario: regimeTributarioEnum("regime_tributario"),
  cnaePrincipal: text("cnae_principal"),
  cscToken: text("csc_token"),
  cscId: text("csc_id"),
  ambienteFocus: integer("ambiente_focus").default(2).notNull(),
  ncmPadrao: text("ncm_padrao").default("21069090").notNull(),
  // === Endereço estruturado (Tier 2B.1) ===
  cep: text("cep"),
  logradouro: text("logradouro"),
  numeroEndereco: text("numero_endereco"),
  complemento: text("complemento"),
  bairro: text("bairro"),
  codigoMunicipioIbge: integer("codigo_municipio_ibge"),
  uf: text("uf"),
  telefone: text("telefone"),
  email: text("email"),
  ativo: boolean("ativo").default(true).notNull(),
  // Como o restaurante controla o consumo: "mesa" (uma comanda por mesa) ou "individual" (várias comandas por mesa, cada uma com nome)
  modoComanda: modoComandaEnum("modo_comanda").default("mesa").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Mesas (Tables)
export const mesas = pgTable("mesas", {
  id: uuid("id").primaryKey().defaultRandom(),
  numero: integer("numero").notNull(),
  status: mesaStatusEnum("status").default("disponivel").notNull(),
  capacidade: integer("capacidade").default(4).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
}, (table) => ({
  unqNumeroRestaurante: unique().on(table.numero, table.restauranteId),
}));

// Categorias
export const categorias = pgTable("categorias", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Categoria Pratos (Dish Categories)
export const categoriaPratos = pgTable("categoria_pratos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Pratos (Dishes)
export const pratos = pgTable("pratos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  preco: numeric("preco", { precision: 10, scale: 2 }).notNull(),
  categoriaId: uuid("categoria_id").references(() => categorias.id, { onDelete: "set null" }),
  imagemUrl: text("imagem_url"),
  disponivel: boolean("disponivel").default(true).notNull(),
  tempoPreparoMinutos: integer("tempo_preparo_min"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // === Campos fiscais (Tier 2B.1) ===
  ncm: text("ncm"),
  cfop: text("cfop").default("5102").notNull(),
  cest: text("cest"),
  unidadeComercial: text("unidade_comercial").default("UN").notNull(),
  origemMercadoria: integer("origem_mercadoria").default(0).notNull(),
  csosn: text("csosn"),
  cstIcms: text("cst_icms"),
  aliquotaIcms: numeric("aliquota_icms", { precision: 5, scale: 2 }),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Comandas (Orders/Bills)
export const comandas = pgTable("comandas", {
  id: uuid("id").primaryKey().defaultRandom(),
  mesaId: uuid("mesa_id").references(() => mesas.id, { onDelete: "restrict" }),
  tipo: tipoComandaEnum("tipo").default("mesa").notNull(),
  mesaNumero: integer("mesa_numero"),
  garcomId: text("garcom_id"),
  status: comandaStatusEnum("status").default("aberta").notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).default("0").notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).default("0").notNull(),
  gorjeta: numeric("gorjeta", { precision: 10, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
  // Nome da comanda (modo individual). Nulo no modo "mesa".
  rotulo: text("rotulo"),
});

// Pedidos (Order Items)
export const pedidos = pgTable("pedidos", {
  id: uuid("id").primaryKey().defaultRandom(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id, { onDelete: "cascade" }),
  pratoId: uuid("prato_id").references(() => pratos.id, { onDelete: "set null" }),
  quantidade: integer("quantidade").default(1).notNull(),
  precoUnitario: numeric("preco_unitario", { precision: 10, scale: 2 }).notNull(),
  observacao: text("observacao"),
  status: pedidoStatusEnum("status").default("pendente").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
  // Cancelamento do item: preenchido só quando status = 'cancelado'.
  // canceladoAposInicio = true quando o item já estava em preparo ou pronto (conta como perda, não como venda).
  canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
  canceladoPorId: text("cancelado_por_id"),
  canceladoPorNome: text("cancelado_por_nome"),
  canceladoPorRole: text("cancelado_por_role"),
  motivoCancelamento: text("motivo_cancelamento"),
  motivoCancelamentoDetalhe: text("motivo_cancelamento_detalhe"),
  canceladoAposInicio: boolean("cancelado_apos_inicio"),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }),
  prontoEm: timestamp("pronto_em", { withTimezone: true }),
});

// Pagamentos (Payments)
export const pagamentos = pgTable("pagamentos", {
  id: uuid("id").primaryKey().defaultRandom(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id, { onDelete: "cascade" }),
  formaPagamento: formaPagamentoEnum("forma_pagamento").notNull(),
  status: pagamentoStatusEnum("status").default("pendente").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  troco: numeric("troco", { precision: 10, scale: 2 }).default("0").notNull(),
  pixTxId: text("pix_tx_id"),
  pixQrCode: text("pix_qr_code"),
  pixQrCodeBase64: text("pix_qr_code_base64"),
  referencia: text("referencia"),
  confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Profiles for users
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("garcom"),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Usuarios (App-level user management, separate from auth users)
export const usuarios = pgTable("usuarios", {
  id: text("id").primaryKey(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash"),
  role: text("role").notNull().default("garcom"),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

// Usuarios Session (for custom auth token management)
export const usuariosSession = pgTable("usuarios_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// Password Reset Tokens (for password reset flow)
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: text("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Comandas Historico (Archived Orders)
export const comandasHistorico = pgTable("comandas_historico", {
  id: uuid("id").primaryKey(),
  mesaId: uuid("mesa_id"),
  mesaNumero: integer("mesa_numero"),
  garcomId: text("garcom_id"),
  status: text("status").notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).default("0").notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).default("0").notNull(),
  gorjeta: numeric("gorjeta", { precision: 10, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow().notNull(),
  fechadoPorId: text("fechado_por_id"),
  fechadoPorNome: text("fechado_por_nome"),
  fechadoPorRole: text("fechado_por_role"),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
  // Nome da comanda (modo individual). Nulo no modo "mesa".
  rotulo: text("rotulo"),
});

// Pedidos Historico (Archived Order Items)
export const pedidosHistorico = pgTable("pedidos_historico", {
  id: uuid("id").primaryKey(),
  comandaId: uuid("comanda_id").notNull(),
  pratoId: uuid("prato_id"),
  pratoNome: text("prato_nome"),
  quantidade: integer("quantidade").notNull(),
  precoUnitario: numeric("preco_unitario", { precision: 10, scale: 2 }).notNull(),
  observacao: text("observacao"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
  canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
  canceladoPorId: text("cancelado_por_id"),
  canceladoPorNome: text("cancelado_por_nome"),
  canceladoPorRole: text("cancelado_por_role"),
  motivoCancelamento: text("motivo_cancelamento"),
  motivoCancelamentoDetalhe: text("motivo_cancelamento_detalhe"),
  canceladoAposInicio: boolean("cancelado_apos_inicio"),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }),
  prontoEm: timestamp("pronto_em", { withTimezone: true }),
});

// Pagamentos Historico (Archived Payments)
export const pagamentosHistorico = pgTable("pagamentos_historico", {
  id: uuid("id").primaryKey(),
  comandaId: uuid("comanda_id").notNull(),
  formaPagamento: text("forma_pagamento").notNull(),
  status: text("status").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  troco: numeric("troco", { precision: 10, scale: 2 }).default("0").notNull(),
  pixTxId: text("pix_tx_id"),
  referencia: text("referencia"),
  confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

export const notasFiscais = pgTable("notas_fiscais", {
  id: uuid("id").primaryKey().defaultRandom(),
  comandaHistoricoId: uuid("comanda_historico_id"),
  referenciaFocus: text("referencia_focus").notNull(),
  status: nfceStatusEnum("status").default("pendente").notNull(),
  // === Polimorfismo por tipo de documento (Tier 2B.1) ===
  tipoDocumento: tipoDocumentoFiscalEnum("tipo_documento").default("nfse").notNull(),
  modelo: text("modelo"),
  ambiente: integer("ambiente"),
  destinatarioSnapshot: jsonb("destinatario_snapshot"),
  valorTotal: numeric("valor_total", { precision: 10, scale: 2 }),
  emitidaEm: timestamp("emitida_em", { withTimezone: true }),
  // === Campos comuns ===
  chaveAcesso: text("chave_acesso"),
  numeroNota: integer("numero_nota"),
  serie: integer("serie"),
  xmlUrl: text("xml_url"),
  danfeUrl: text("danfe_url"),
  qrcodeUrl: text("qrcode_url"),
  urlConsulta: text("url_consulta"),
  protocolo: text("protocolo"),
  mensagemSefaz: text("mensagem_sefaz"),
  motivoCancelamento: text("motivo_cancelamento"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
}, (table) => ({
  idxRestauranteTipo: index("idx_notas_fiscais_restaurante_tipo").on(table.restauranteId, table.tipoDocumento),
  idxReferenciaFocus: index("idx_notas_fiscais_referencia_focus").on(table.referenciaFocus),
  idxRestauranteStatus: index("idx_notas_fiscais_restaurante_status").on(table.restauranteId, table.status),
}));

// === ESTOQUE ===
export const insumos = pgTable("insumos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  unidade: unidadeMedidaEnum("unidade").notNull(),
  estoqueAtual: numeric("estoque_atual", { precision: 10, scale: 3 }).default("0").notNull(),
  estoqueMinimo: numeric("estoque_minimo", { precision: 10, scale: 3 }).default("0").notNull(),
  custoUnitario: numeric("custo_unitario", { precision: 10, scale: 2 }).default("0").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

export const movimentacoesEstoque = pgTable("movimentacoes_estoque", {
  id: uuid("id").primaryKey().defaultRandom(),
  insumoId: uuid("insumo_id").notNull().references(() => insumos.id, { onDelete: "restrict" }),
  tipo: movimentacaoTipoEnum("tipo").notNull(),
  quantidade: numeric("quantidade", { precision: 10, scale: 3 }).notNull(),
  estoqueAnterior: numeric("estoque_anterior", { precision: 10, scale: 3 }).notNull(),
  estoqueNovo: numeric("estoque_novo", { precision: 10, scale: 3 }).notNull(),
  motivo: text("motivo"),
  usuarioId: text("usuario_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

export const pratoInsumos = pgTable("prato_insumos", {
  id: uuid("id").primaryKey().defaultRandom(),
  pratoId: uuid("prato_id").notNull().references(() => pratos.id, { onDelete: "cascade" }),
  insumoId: uuid("insumo_id").notNull().references(() => insumos.id, { onDelete: "cascade" }),
  quantidadeUsada: numeric("quantidade_usada", { precision: 10, scale: 3 }).notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});

export const entregas = pgTable("entregas", {
  id: uuid("id").primaryKey().defaultRandom(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id, { onDelete: "cascade" }),
  status: entregaStatusEnum("status").default("pendente").notNull(),
  clienteNome: text("cliente_nome").notNull(),
  clienteTelefone: text("cliente_telefone").notNull(),
  endereco: text("endereco").notNull(),
  complemento: text("complemento"),
  bairro: text("bairro"),
  cidade: text("cidade"),
  cep: text("cep"),
  referencia: text("referencia"),
  taxaEntrega: numeric("taxa_entrega", { precision: 10, scale: 2 }).default("0").notNull(),
  tempoEstimado: integer("tempo_estimado"),
  entregadorNome: text("entregador_nome"),
  entregadorTelefone: text("entregador_telefone"),
  observacao: text("observacao"),
  saiuEm: timestamp("saiu_em", { withTimezone: true }),
  entregueEm: timestamp("entregue_em", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  restauranteId: text("restaurante_id").notNull().references(() => restaurante.id, { onDelete: "restrict" }),
});
