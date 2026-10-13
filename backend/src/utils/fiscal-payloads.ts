/**
 * Fiscal Payload Builder Utility
 * Pure utility module for building Focus NFe API payloads
 * No side effects, no HTTP calls, no database access - fully testable in isolation
 */

// ==================== Types & Interfaces ====================

export interface EnderecoInput {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigo_municipio_ibge: number;
  uf: string;
}

export interface DestinatarioInput {
  cpf?: string;
  cnpj?: string;
  razao_social?: string;
  email?: string;
  telefone?: string;
  inscricao_estadual?: string;
  indicador_ie?: 1 | 2 | 9;
  endereco?: EnderecoInput;
}

export interface ItemFiscal {
  numero: number;
  codigo_produto: string;
  descricao: string;
  quantidade: number;
  preco_unitario: number;
  ncm: string;
  cfop: string;
  cest?: string;
  unidade_comercial: string;
  origem_mercadoria: number;
  csosn?: string; // For Simples Nacional/MEI
  cst_icms?: string; // For normal regime
  aliquota_icms?: number; // For normal regime
}

export interface FormaPagamentoBanco {
  formaPagamento: 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito';
  valor: number;
}

export interface OpcoesEmissaoNfce {
  ambiente: 'producao' | 'homologacao';
  serie?: number;
  data_emissao_iso: string;
  presenca_comprador?: number;
}

export interface ValidacaoResult {
  ok: boolean;
  camposFaltantes: string[];
}

export interface RestauranteInput {
  cnpj: string;
  nome: string;
  inscricaoEstadual: string;
  regimeTributario: 'simples_nacional' | 'simples_excesso' | 'regime_normal' | 'mei';
  cscToken: string;
  cscId: string;
  cnaePrincipal: string;
  cep: string;
  logradouro: string;
  numeroEndereco: string;
  bairro: string;
  codigoMunicipioIbge: number;
  uf: string;
  complemento?: string;
}

// ==================== Utility Functions ====================

/**
 * Remove dots, dashes, slashes, and spaces from document strings
 */
export function limparDocumento(documento: string): string {
  return documento.replace(/[\.\-\s\/]/g, '');
}

/**
 * Round to 2 decimal places
 */
export function arredondarDuasDecimais(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Validate that a restaurant has all required fiscal fields
 */
export function validarRestauranteParaNfce(restaurante: Partial<RestauranteInput>): ValidacaoResult {
  const camposObrigatorios: (keyof RestauranteInput)[] = [
    'cnpj',
    'nome',
    'inscricaoEstadual',
    'regimeTributario',
    'cscToken',
    'cscId',
    'cnaePrincipal',
    'cep',
    'logradouro',
    'numeroEndereco',
    'bairro',
    'codigoMunicipioIbge',
    'uf',
  ];

  const camposFaltantes: string[] = [];

  for (const campo of camposObrigatorios) {
    const valor = restaurante[campo];
    if (valor === undefined || valor === null || valor === '') {
      camposFaltantes.push(campo);
    }
  }

  return {
    ok: camposFaltantes.length === 0,
    camposFaltantes,
  };
}

/**
 * Map payment form strings to SEFAZ codes
 */
export function mapearFormaPagamento(forma: 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix'): string {
  const mapeamento: Record<string, string> = {
    dinheiro: '01',
    cartao_credito: '03',
    cartao_debito: '04',
    pix: '17',
  };

  if (!mapeamento[forma]) {
    throw new Error(`Forma de pagamento não mapeada: ${forma}`);
  }

  return mapeamento[forma];
}

/**
 * Map tax regime strings to codes
 */
export function mapearRegimeTributario(
  regime: 'simples_nacional' | 'simples_excesso' | 'regime_normal' | 'mei'
): number {
  const mapeamento: Record<string, number> = {
    simples_nacional: 1,
    simples_excesso: 2,
    regime_normal: 3,
    mei: 4,
  };

  if (!(regime in mapeamento)) {
    throw new Error(`Regime tributário não mapeado: ${regime}`);
  }

  return mapeamento[regime];
}

// ==================== Payload Builder ====================

export interface NfcePayload {
  modelo: number;
  serie: number;
  numero_nf: number;
  tipo_documento: number;
  natureza_operacao: string;
  descricao_abrev: string;
  finalidade_emissao: number;
  local_destino: number;
  consumidor_final: number;
  presenca_comprador: number;
  emitter: {
    cpf?: string;
    cnpj: string;
    xNome: string;
    xFant?: string;
    inscricaoEstadual: string;
    regimeTributario: number;
    cnaePrincipal: string;
    endereco: {
      cep: string;
      logradouro: string;
      numero: string;
      complemento?: string;
      bairro: string;
      codigo_municipio_ibge: number;
      uf: string;
    };
  };
  destinatario?: {
    cpf?: string;
    cnpj?: string;
    razaoSocial?: string;
    indicadorIe?: number;
    inscricaoEstadual?: string;
    email?: string;
    telefone?: string;
    endereco?: {
      cep: string;
      logradouro: string;
      numero: string;
      complemento?: string;
      bairro: string;
      codigo_municipio_ibge: number;
      uf: string;
    };
  };
  itens: Array<{
    numero: number;
    codigo_produto: string;
    descricao: string;
    ncm: string;
    cfop: string;
    cest?: string;
    unidade_comercial: string;
    quantidade: number;
    preco_unitario: number;
    valor_bruto: number;
    desconto?: number;
    valor_liquido: number;
    origem_mercadoria: number;
    icms: {
      csosn?: string;
      cst?: string;
      aliquota?: number;
    };
    pis: {
      situacao_tributaria: string;
    };
    cofins: {
      situacao_tributaria: string;
    };
  }>;
  total: {
    valor_produtos: number;
    valor_frete: number;
    valor_desconto: number;
    valor_outras_despesas: number;
    valor_nf: number;
    valor_tributos_aprox: number;
  };
  transporte: {
    modalidade_frete: number;
  };
  formas_pagamento: Array<{
    forma_pagamento: string;
    valor: number;
  }>;
  informacoes_adicionais: {
    infCpl?: string;
    infIntermed?: string;
  };
  csc?: {
    token: string;
    id: string;
  };
  data_emissao: string;
  ambiente: 'producao' | 'homologacao';
}

/**
 * Build a complete NFC-e payload for the Focus NFe API
 * Translates restaurant, items, and payment data into format ready for SEFAZ submission
 */
export function buildNfcePayload(
  restaurante: RestauranteInput,
  itens: ItemFiscal[],
  formasPagamento: FormaPagamentoBanco[],
  opcoes: OpcoesEmissaoNfce,
  destinatario?: DestinatarioInput,
  numeroNf: number = 1
): NfcePayload {
  // Validate restaurant
  const validacao = validarRestauranteParaNfce(restaurante);
  if (!validacao.ok) {
    throw new Error(`Restaurante inválido para NFC-e. Campos faltantes: ${validacao.camposFaltantes.join(', ')}`);
  }

  // Calculate totals and process items
  let valorProdutos = 0;
  const itensProcessados = itens.map((item) => {
    const valorBruto = arredondarDuasDecimais(item.quantidade * item.preco_unitario);
    valorProdutos += valorBruto;

    const itemProcessado: NfcePayload['itens'][0] = {
      numero: item.numero,
      codigo_produto: item.codigo_produto,
      descricao: item.descricao,
      ncm: item.ncm,
      cfop: item.cfop,
      unidade_comercial: item.unidade_comercial,
      quantidade: item.quantidade,
      preco_unitario: arredondarDuasDecimais(item.preco_unitario),
      valor_bruto: valorBruto,
      valor_liquido: valorBruto,
      origem_mercadoria: item.origem_mercadoria,
      icms: {
        csosn: item.csosn,
        cst: item.cst_icms,
        aliquota: item.aliquota_icms,
      },
      pis: {
        situacao_tributaria: '07',
      },
      cofins: {
        situacao_tributaria: '07',
      },
    };

    if (item.cest) {
      itemProcessado.cest = item.cest;
    }

    return itemProcessado;
  });

  // Calculate payment total
  const valorTotal = arredondarDuasDecimais(
    formasPagamento.reduce((sum, fp) => sum + fp.valor, 0)
  );

  // Process payment forms
  const formasProcessadas = formasPagamento.map((fp) => ({
    forma_pagamento: mapearFormaPagamento(fp.formaPagamento),
    valor: arredondarDuasDecimais(fp.valor),
  }));

  // Build destinatario if provided
  let destinatarioProcessado: NfcePayload['destinatario'] | undefined;
  if (destinatario) {
    destinatarioProcessado = {
      email: destinatario.email,
      telefone: destinatario.telefone,
    };

    if (destinatario.cpf) {
      destinatarioProcessado.cpf = limparDocumento(destinatario.cpf);
    }

    if (destinatario.cnpj) {
      destinatarioProcessado.cnpj = limparDocumento(destinatario.cnpj);
    }

    if (destinatario.razao_social) {
      destinatarioProcessado.razaoSocial = destinatario.razao_social;
    }

    if (destinatario.inscricao_estadual) {
      destinatarioProcessado.inscricaoEstadual = destinatario.inscricao_estadual;
    }

    if (destinatario.indicador_ie !== undefined) {
      destinatarioProcessado.indicadorIe = destinatario.indicador_ie;
    }

    if (destinatario.endereco) {
      destinatarioProcessado.endereco = {
        cep: destinatario.endereco.cep,
        logradouro: destinatario.endereco.logradouro,
        numero: destinatario.endereco.numero,
        complemento: destinatario.endereco.complemento,
        bairro: destinatario.endereco.bairro,
        codigo_municipio_ibge: destinatario.endereco.codigo_municipio_ibge,
        uf: destinatario.endereco.uf,
      };
    }
  }

  const regimeTributario = mapearRegimeTributario(restaurante.regimeTributario);

  const payload: NfcePayload = {
    modelo: 65,
    serie: opcoes.serie || 1,
    numero_nf: numeroNf,
    tipo_documento: 1,
    natureza_operacao: 'Venda ao consumidor',
    descricao_abrev: restaurante.nome.substring(0, 60),
    finalidade_emissao: 1,
    local_destino: 1,
    consumidor_final: 1,
    presenca_comprador: opcoes.presenca_comprador || 1,
    emitter: {
      cnpj: limparDocumento(restaurante.cnpj),
      xNome: restaurante.nome,
      inscricaoEstadual: limparDocumento(restaurante.inscricaoEstadual),
      regimeTributario,
      cnaePrincipal: restaurante.cnaePrincipal,
      endereco: {
        cep: restaurante.cep,
        logradouro: restaurante.logradouro,
        numero: restaurante.numeroEndereco,
        complemento: restaurante.complemento,
        bairro: restaurante.bairro,
        codigo_municipio_ibge: restaurante.codigoMunicipioIbge,
        uf: restaurante.uf,
      },
    },
    itens: itensProcessados,
    total: {
      valor_produtos: arredondarDuasDecimais(valorProdutos),
      valor_frete: 0,
      valor_desconto: 0,
      valor_outras_despesas: 0,
      valor_nf: valorTotal,
      valor_tributos_aprox: 0,
    },
    transporte: {
      modalidade_frete: 9,
    },
    formas_pagamento: formasProcessadas,
    informacoes_adicionais: {},
    csc: {
      token: restaurante.cscToken,
      id: restaurante.cscId,
    },
    data_emissao: opcoes.data_emissao_iso,
    ambiente: opcoes.ambiente,
  };

  if (destinatarioProcessado) {
    payload.destinatario = destinatarioProcessado;
  }

  return payload;
}
