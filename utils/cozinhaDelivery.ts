/**
 * Utilitário compartilhado pelas telas da cozinha para tratar delivery e balcão.
 */

export interface EntregaInfo {
  tipo: "mesa" | "delivery" | "balcao" | string;
  entrega_cliente_nome: string | null;
  entrega_bairro: string | null;
  entrega_observacao: string | null;
  entrega_tempo_estimado: number | null;
  entrega_horario_limite: string | null; // ISO 8601
}

export function isDelivery(info: EntregaInfo): boolean {
  return info.tipo === "delivery";
}

export function isBalcao(info: EntregaInfo): boolean {
  return info.tipo === "balcao";
}

/** Título do cartão: "Mesa 5", "Delivery · Maria" ou "Balcão" */
export function tituloCartao(info: EntregaInfo & { mesa_numero?: number | null }): string {
  if (isDelivery(info)) return `Delivery · ${info.entrega_cliente_nome ?? ""}`;
  if (isBalcao(info)) return "Balcão";
  return `Mesa ${info.mesa_numero ?? "?"}`;
}

export interface PrazoDelivery {
  horarioLimite: string;   // "HH:MM"
  minutosRestantes: number; // negativo = atrasado
  atrasado: boolean;
  texto: string; // "Prometido até 20:40 · restam 12 min" ou "Prometido até 20:40 · atrasado há 5 min"
}

/** Calcula o prazo do delivery. Retorna null se não houver horário limite. */
export function calcPrazoDelivery(entrega_horario_limite: string | null): PrazoDelivery | null {
  if (!entrega_horario_limite) return null;
  const limite = new Date(entrega_horario_limite);
  const agora = new Date();
  const diffMs = limite.getTime() - agora.getTime();
  const minutosRestantes = Math.round(diffMs / 60000);
  const atrasado = minutosRestantes < 0;
  const hh = String(limite.getHours()).padStart(2, "0");
  const mm = String(limite.getMinutes()).padStart(2, "0");
  const horarioLimite = `${hh}:${mm}`;
  const texto = atrasado
    ? `Prometido até ${horarioLimite} · atrasado há ${Math.abs(minutosRestantes)} min`
    : `Prometido até ${horarioLimite} · restam ${minutosRestantes} min`;
  return { horarioLimite, minutosRestantes, atrasado, texto };
}

/** Texto do aviso de cancelamento de item para a cozinha */
export function textoAvisoCancelamento(
  comanda_tipo: string | null | undefined,
  entrega_cliente_nome: string | null | undefined,
  mesa_numero: number | null | undefined,
  prato_nome: string | null | undefined
): string {
  const prato = prato_nome ?? "Item";
  if (comanda_tipo === "delivery") {
    return `Delivery (${entrega_cliente_nome ?? ""}): ${prato} foi cancelado.`;
  }
  if (comanda_tipo === "balcao") {
    return `Balcão: ${prato} foi cancelado.`;
  }
  return `Mesa ${mesa_numero ?? "?"}: ${prato} foi cancelado.`;
}
