/**
 * Focus NFe API client — helpers compartilhados entre NFC-e, NF-e e NFSe.
 *
 * Extraído de routes/fiscal.ts na Fase 2A (Tier 2B.2).
 * Nenhuma mudança de comportamento vs. original.
 */

export function getFocusToken(): string {
  const token = process.env.FOCUS_NFE_TOKEN
    || process.env.SPECULAR_SECRET_FOCUS_NFE_TOKEN
    || process.env.SECRET_FOCUS_NFE_TOKEN;
  if (!token) throw new Error("FOCUS_NFE_TOKEN não configurada - nenhuma variável encontrada");
  return token;
}

export function getFocusBaseUrl(): string {
  return process.env.FOCUS_NFE_ENV === "production"
    ? "https://api.focusnfe.com.br/v2"
    : "https://homologacao.focusnfe.com.br/v2";
}

export async function focusRequest(method: string, path: string, body?: any): Promise<any> {
  const baseUrl = getFocusBaseUrl();
  const auth = Buffer.from(getFocusToken() + ":").toString("base64");
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": "Basic " + auth },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok && res.status !== 422 && res.status !== 202) {
    throw new Error("Focus NFe error " + res.status + ": " + JSON.stringify(data));
  }
  return { ...data, _httpStatus: res.status };
}
