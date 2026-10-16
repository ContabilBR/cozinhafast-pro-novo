/**
 * Regras de transição de status e de edição de item (pedido).
 *
 * Fecha o contorno descrito na auditoria (A2): antes qualquer usuário do restaurante
 * podia voltar um item "pronto/entregue" para "pendente" (zerando os tempos) e depois
 * cancelá-lo como pendente, sem gestor e sem registrar perda.
 *
 * Fluxo do item: pendente -> em_preparo -> pronto -> entregue.
 *  - Avanço, uma etapa por vez:
 *      pendente -> em_preparo e em_preparo -> pronto: cozinha ou gestão;
 *      pronto -> entregue: garçom ou gestão.
 *  - Retrocesso: só a gestão. Única exceção: a cozinha pode desfazer "pronto" voltando
 *    para "em_preparo" nos primeiros 2 minutos (é o botão "desfazer" da tela da cozinha).
 *  - Mesmo status: sem efeito (toque duplo não gera erro nem mexe nos tempos).
 *  - Cancelar tem rota própria (services/cancelamento-pedido.ts).
 *
 * Edição (quantidade e observação): só enquanto o item está pendente, ou seja, antes de a
 * cozinha iniciar o preparo. Depois disso o item só sai por cancelamento, com motivo.
 *
 * O módulo não conhece HTTP nem banco: são funções puras, o que mantém a regra num só lugar.
 */
import { ROLES_ATENDIMENTO, ehGestor } from "./cancelamento-pedido.js";

export const ROLES_COZINHA = ["cozinheiro", "cozinha", "kitchen"];

/** Prazo para a cozinha desfazer "pronto" (a tela mostra o botão por 5 segundos). */
export const JANELA_DESFAZER_PRONTO_MS = 2 * 60 * 1000;

export const MAX_QUANTIDADE_ITEM = 99;
export const MAX_OBSERVACAO_ITEM = 500;

const ORDEM = ["pendente", "em_preparo", "pronto", "entregue"] as const;

const ROTULO: Record<string, string> = {
  pendente: "pendente",
  em_preparo: "em preparo",
  pronto: "pronto",
  entregue: "entregue",
};

export type AvaliacaoTransicao =
  | { tipo: "permitida"; semMudanca: boolean }
  | { tipo: "recusada"; http: 403 | 409; erro: string };

export interface EntradaTransicao {
  papel: string | null | undefined;
  statusAtual: string;
  novoStatus: string;
  prontoEm: Date | null | undefined;
  agora?: Date;
}

export function avaliarTransicao(entrada: EntradaTransicao): AvaliacaoTransicao {
  const papel = (entrada.papel ?? "").toLowerCase();
  const agora = entrada.agora ?? new Date();

  const de = (ORDEM as readonly string[]).indexOf(entrada.statusAtual);
  const para = (ORDEM as readonly string[]).indexOf(entrada.novoStatus);
  if (de < 0 || para < 0) {
    return { tipo: "recusada", http: 409, erro: "Status inválido para esta operação." };
  }

  if (de === para) {
    return { tipo: "permitida", semMudanca: true };
  }

  const gestor = ehGestor(papel);
  const cozinha = ROLES_COZINHA.includes(papel);
  const atendimento = ROLES_ATENDIMENTO.includes(papel);

  // Avanço: uma etapa por vez
  if (para > de) {
    if (para !== de + 1) {
      return {
        tipo: "recusada",
        http: 409,
        erro: `O item está ${ROTULO[ORDEM[de]]} e precisa passar por cada etapa antes de ficar ${ROTULO[ORDEM[para]]}.`,
      };
    }
    if (ORDEM[para] === "entregue") {
      if (!atendimento) {
        return { tipo: "recusada", http: 403, erro: "Só o garçom ou a gestão marca o item como entregue." };
      }
    } else if (!cozinha && !gestor) {
      return { tipo: "recusada", http: 403, erro: "Só a cozinha ou a gestão altera o preparo do item." };
    }
    return { tipo: "permitida", semMudanca: false };
  }

  // Retrocesso
  if (gestor) {
    return { tipo: "permitida", semMudanca: false };
  }

  if (cozinha && ORDEM[de] === "pronto" && ORDEM[para] === "em_preparo") {
    const prontoEm = entrada.prontoEm ? new Date(entrada.prontoEm) : null;
    if (!prontoEm || isNaN(prontoEm.getTime()) || agora.getTime() - prontoEm.getTime() > JANELA_DESFAZER_PRONTO_MS) {
      return {
        tipo: "recusada",
        http: 409,
        erro: "O prazo para desfazer o \"pronto\" acabou. Peça à gestão para voltar o item.",
      };
    }
    return { tipo: "permitida", semMudanca: false };
  }

  return { tipo: "recusada", http: 403, erro: "Só a gestão volta um item a uma etapa anterior." };
}

export type ValidacaoEdicao =
  | { tipo: "valida"; campos: { quantidade?: number; observacao?: string } }
  | { tipo: "invalida"; erro: string };

/** Valida os campos editáveis do item. Pelo menos um deles precisa vir no corpo. */
export function validarEdicao(entrada: { quantidade?: unknown; observacao?: unknown }): ValidacaoEdicao {
  const campos: { quantidade?: number; observacao?: string } = {};

  if (entrada.quantidade !== undefined) {
    const q = entrada.quantidade;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > MAX_QUANTIDADE_ITEM) {
      return { tipo: "invalida", erro: `A quantidade deve ser um número inteiro entre 1 e ${MAX_QUANTIDADE_ITEM}.` };
    }
    campos.quantidade = q;
  }

  if (entrada.observacao !== undefined) {
    const o = entrada.observacao;
    if (typeof o !== "string" || o.length > MAX_OBSERVACAO_ITEM) {
      return { tipo: "invalida", erro: `A observação pode ter até ${MAX_OBSERVACAO_ITEM} caracteres.` };
    }
    campos.observacao = o;
  }

  if (campos.quantidade === undefined && campos.observacao === undefined) {
    return { tipo: "invalida", erro: "Informe a quantidade ou a observação a alterar." };
  }

  return { tipo: "valida", campos };
}
