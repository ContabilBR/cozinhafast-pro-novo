import type { FormaTerminal, ProvedorTerminal, ResultadoTraducao } from "./tipos.js";

// Adaptador da Stone (Deeplink, payment-app://pay). Tudo que é específico da Stone fica aqui.
//
// LEGADO: as colunas atk e itk da tabela transacoes_terminal são específicas da Stone e serão
// removidas numa etapa futura; o identificador neutro é id_externo (aqui, o ATK).

const NOME = "stone_deeplink";

// A página de Pagamento da Stone fala em 1 a 12 parcelas; os exemplos divergem (2-18, 2-99).
// Fica o intervalo mais restrito até a confirmação no POS.
const MAX_PARCELAS = 12;

// Vocabulário gravado na tabela (e enviado à Stone em maiúsculas pelo app)
const TIPO_TRANSACAO: Record<FormaTerminal, "credit" | "debit" | "pix"> = {
  cartao_credito: "credit",
  cartao_debito: "debit",
  pix: "pix",
};

const FORMA_PAGAMENTO: Record<string, FormaTerminal> = {
  credit: "cartao_credito",
  debit: "cartao_debito",
  pix: "pix",
};

export const stoneDeeplink: ProvedorTerminal = {
  nome: NOME,
  modo: "aparelho",
  maxParcelas: MAX_PARCELAS,

  traduzirCobranca({ forma_pagamento, parcelas, tipo_parcelamento }): ResultadoTraducao {
    const tipoTransacao = TIPO_TRANSACAO[forma_pagamento];
    // Parcelamento só existe no crédito. Débito e Pix seguem sem parcelas.
    if (forma_pagamento !== "cartao_credito") {
      if ((parcelas !== undefined && parcelas > 1) || tipo_parcelamento !== undefined) {
        return { ok: false, erro: "Parcelamento só é permitido no cartão de crédito." };
      }
      return { ok: true, cobranca: { tipoTransacao, tipoParcelamento: null, parcelas: null } };
    }
    const parcelasFinal = parcelas ?? 1;
    if (parcelasFinal > MAX_PARCELAS) {
      return { ok: false, erro: `O número de parcelas deve ser de 1 a ${MAX_PARCELAS}.` };
    }
    const tipoParcelamento = parcelasFinal === 1 ? "none" : tipo_parcelamento === "emissor" ? "issuer" : "merchant";
    return { ok: true, cobranca: { tipoTransacao, tipoParcelamento, parcelas: parcelasFinal } };
  },

  formaPagamentoDe(tipoTransacao) {
    return FORMA_PAGAMENTO[tipoTransacao] ?? null;
  },

  montarInstrucao({ valorCentavos, orderId, cobranca }) {
    // Parâmetros para o app montar a URI do terminal (payment-app://pay)
    return {
      provedor: NOME,
      modo: "aparelho",
      dados: {
        amount_centavos: valorCentavos,
        order_id: orderId,
        transaction_type: cobranca.tipoTransacao.toUpperCase(),
        installment_type: cobranca.tipoParcelamento ? cobranca.tipoParcelamento.toUpperCase() : null,
        installment_count: cobranca.parcelas,
      },
    };
  },

  validarRetorno({ resultado, idExterno }) {
    if (resultado === "aprovada" && !idExterno) {
      // O ATK é a chave do cancelamento e da reimpressão: sem ele, a aprovação não é utilizável.
      return "Transação aprovada exige o identificador da transação (ATK) devolvido pela maquininha.";
    }
    return null;
  },

  camposLegados({ idExterno, itk }) {
    const campos: { atk?: string; itk?: string } = {};
    if (idExterno !== undefined) campos.atk = idExterno;
    if (itk !== undefined) campos.itk = itk;
    return campos;
  },
};
