import type { InterpretadorProvedor } from "./tipos";

// Retorno da Stone (cozinhafastpro://pay-response). Regras:
//  - aprovada: code = 0 E atk preenchido
//  - recusada: code diferente de 0 E (reason presente OU success = false)
//  - qualquer outro caso é inconclusivo (nunca vira cancelada nem recusada)
// Privacidade: pan e cardholder_name nunca saem daqui.
const CAMPOS_DADOS = ["code", "reason", "message", "brand", "authorization_code", "installment_count", "type", "entry_mode", "authorization_date_time"];
const CAMPOS_PRIVADOS = ["pan", "cardholder_name"];

const vazio = (v: string | undefined) => v === undefined || v.trim() === "";

export const interpretarRetornoStone: InterpretadorProvedor = (params) => {
  const limpos: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (CAMPOS_PRIVADOS.includes(k.toLowerCase())) continue;
    limpos[k] = v;
  }

  const dadosProvedor: Record<string, string> = {};
  for (const k of CAMPOS_DADOS) {
    if (!vazio(limpos[k])) dadosProvedor[k] = limpos[k].trim();
  }

  const temCode = !vazio(limpos.code);
  const code = temCode ? Number(limpos.code) : NaN;
  const atk = vazio(limpos.atk) ? undefined : limpos.atk.trim();
  const itk = vazio(limpos.itk) ? undefined : limpos.itk.trim();

  let resultado: "aprovada" | "recusada" | "inconclusivo" = "inconclusivo";
  if (temCode && code === 0 && atk) resultado = "aprovada";
  else if (temCode && Number.isFinite(code) && code !== 0 && (!vazio(limpos.reason) || String(limpos.success).trim().toLowerCase() === "false")) {
    resultado = "recusada";
  }

  let retornoBruto = JSON.stringify(limpos);
  if (retornoBruto.length > 8000) retornoBruto = JSON.stringify(dadosProvedor);

  return {
    resultado,
    idExterno: atk,
    itk,
    dadosProvedor,
    mensagem: vazio(limpos.message) ? undefined : limpos.message.trim(),
    retornoBruto,
  };
};
