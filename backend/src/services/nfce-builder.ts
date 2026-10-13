/**
 * NFC-e — funcoes puras de montagem de dados fiscais.
 * Sem acesso a banco, sem HTTP. Totalmente testavel em isolamento.
 */

import { arredondarDuasDecimais } from "../utils/fiscal-payloads.js";
import type {
  ItemFiscal,
  FormaPagamentoBanco,
  RestauranteInput,
} from "../utils/fiscal-payloads.js";

/** Data/hora de Brasilia (UTC-3) no formato exigido pela SEFAZ. */
export function isoBrasilia(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Sao_Paulo",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return get("year") + "-" + get("month") + "-" + get("day") + "T" +
    get("hour") + ":" + get("minute") + ":" + get("second") + "-03:00";
}

/** Remove mascara de codigos fiscais (2106.90.90 -> 21069090). */
export function limparCodigoFiscal(
  valor: string | null | undefined,
  fallback: string
): string {
  const bruto = (valor ?? "").replace(/[^0-9]/g, "");
  if (bruto.length > 0) return bruto;
  return (fallback ?? "").replace(/[^0-9]/g, "");
}

/** Converte a linha do restaurante no formato esperado por buildNfcePayload. */
export function montarRestauranteInput(restaurante: any): RestauranteInput {
  return {
    cnpj: restaurante.cnpj ?? "",
    nome: restaurante.nome,
    inscricaoEstadual: restaurante.inscricaoEstadual ?? "",
    regimeTributario: restaurante.regimeTributario,
    cscToken: restaurante.cscToken ?? "",
    cscId: restaurante.cscId ?? "",
    cnaePrincipal: limparCodigoFiscal(restaurante.cnaePrincipal, ""),
    cep: limparCodigoFiscal(restaurante.cep, ""),
    logradouro: restaurante.logradouro ?? "",
    numeroEndereco: restaurante.numeroEndereco ?? "",
    bairro: restaurante.bairro ?? "",
    codigoMunicipioIbge: restaurante.codigoMunicipioIbge ?? undefined,
    uf: restaurante.uf ?? "",
    complemento: restaurante.complemento ?? undefined,
  } as RestauranteInput;
}

/** Troco nao compoe o valor da venda — subtraido aqui. */
export function montarFormasPagamento(pagamentosConfirmados: any[]): FormaPagamentoBanco[] {
  return pagamentosConfirmados
    .map((p: any) => ({
      formaPagamento: p.formaPagamento,
      valor: arredondarDuasDecimais(
        parseFloat(p.valor) - parseFloat(p.troco ?? "0")
      ),
    }))
    .filter((f: FormaPagamentoBanco) => f.valor > 0);
}

/**
 * Rateia as formas de pagamento para somarem exatamente o valor alvo.
 * Necessario porque gorjeta entra no pagamento mas nao e mercadoria —
 * a SEFAZ rejeita se a soma de formas_pagamento != valor_nf.
 */
export function ajustarFormasPagamento(
  formas: FormaPagamentoBanco[],
  alvo: number
): FormaPagamentoBanco[] {
  const totalOriginal = formas.reduce((s, f) => s + f.valor, 0);
  if (totalOriginal <= 0 || formas.length === 0) return formas;

  const fator = alvo / totalOriginal;
  const ajustadas = formas.map((f) => ({
    formaPagamento: f.formaPagamento,
    valor: arredondarDuasDecimais(f.valor * fator),
  }));

  const somaAjustada = arredondarDuasDecimais(
    ajustadas.reduce((s, f) => s + f.valor, 0)
  );
  const residuo = arredondarDuasDecimais(alvo - somaAjustada);
  if (residuo !== 0) {
    const ultima = ajustadas[ajustadas.length - 1];
    ultima.valor = arredondarDuasDecimais(ultima.valor + residuo);
  }
  return ajustadas;
}

/**
 * Consolida pedidos por prato + preco unitario e aplica os dados
 * fiscais do prato com fallback no cadastro do restaurante.
 */
export function montarItensFiscais(
  pedidosValidos: any[],
  pratoMap: Map<string, any>,
  restaurante: any
): ItemFiscal[] {
  const consolidado = new Map<string, any>();

  for (const ped of pedidosValidos) {
    const prato = ped.pratoId ? pratoMap.get(ped.pratoId) : undefined;
    const preco = arredondarDuasDecimais(parseFloat(ped.precoUnitario));
    const base = ped.pratoId ?? "avulso:" + (ped.pratoNome ?? ped.id);
    const chave = base + "|" + preco.toFixed(2);

    const atual = consolidado.get(chave);
    if (atual) {
      atual.quantidade += ped.quantidade;
    } else {
      consolidado.set(chave, {
        prato,
        pratoId: ped.pratoId ?? null,
        descricao: prato?.nome ?? ped.pratoNome ?? "Item",
        quantidade: ped.quantidade,
        preco,
      });
    }
  }

  const regime = restaurante.regimeTributario as string;
  const usaCsosn =
    regime === "simples_nacional" || regime === "simples_excesso" || regime === "mei";
  const ncmPadrao = restaurante.ncmPadrao ?? "21069090";

  return Array.from(consolidado.values()).map((c: any, idx: number) => {
    const prato = c.prato;
    const item: ItemFiscal = {
      numero: idx + 1,
      codigo_produto: (c.pratoId
        ? c.pratoId.replace(/-/g, "").slice(0, 12)
        : "AVULSO"
      ).toUpperCase(),
      descricao: String(c.descricao).slice(0, 120),
      quantidade: c.quantidade,
      preco_unitario: c.preco,
      ncm: limparCodigoFiscal(prato?.ncm, ncmPadrao),
      cfop: limparCodigoFiscal(prato?.cfop, "5102"),
      unidade_comercial: prato?.unidadeComercial ?? "UN",
      origem_mercadoria:
        prato?.origemMercadoria !== undefined && prato?.origemMercadoria !== null
          ? prato.origemMercadoria
          : 0,
    };

    const cest = limparCodigoFiscal(prato?.cest, "");
    if (cest) item.cest = cest;

    if (usaCsosn) {
      item.csosn = prato?.csosn ?? "102";
    } else {
      item.cst_icms = prato?.cstIcms ?? "00";
      item.aliquota_icms =
        prato?.aliquotaIcms !== undefined && prato?.aliquotaIcms !== null
          ? parseFloat(prato.aliquotaIcms)
          : 0;
    }

    return item;
  });
}

export function calcularValorItens(itens: ItemFiscal[]): number {
  return arredondarDuasDecimais(
    itens.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0)
  );
}
