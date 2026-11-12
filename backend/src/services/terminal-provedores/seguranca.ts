// Nada sensível pode ser gravado em dados_provedor nem em retorno_bruto: número completo de cartão,
// trilhas, CVV, senhas, tokens ou chaves. Qualquer campo com esses nomes é descartado.

const NOMES_EXATOS = new Set(["pan", "pin", "cvv", "cvc", "csc", "key", "cvv2", "cvc2"]);
const NOMES_CONTIDOS = [
  "cardnumber", "numerocartao", "numcartao", "cartaonumero", "numerodocartao",
  "track", "trilha", "senha", "password", "passwd", "token", "secret", "segredo",
  "chave", "apikey", "privatekey", "authorization", "codigodeseguranca", "securitycode",
];
const MAX_PROFUNDIDADE = 6;

function normalizar(nome: string): string {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function nomeSensivel(nome: string): boolean {
  const n = normalizar(nome);
  if (NOMES_EXATOS.has(n) || n.endsWith("key")) return true;
  return NOMES_CONTIDOS.some((c) => n.includes(c));
}

export function descartarCamposSensiveis(valor: unknown, profundidade = 0): unknown {
  if (profundidade > MAX_PROFUNDIDADE) return undefined;
  if (Array.isArray(valor)) return valor.map((v) => descartarCamposSensiveis(v, profundidade + 1));
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (nomeSensivel(chave)) continue;
      const limpo = descartarCamposSensiveis(v, profundidade + 1);
      if (limpo !== undefined) saida[chave] = limpo;
    }
    return saida;
  }
  return valor;
}

function luhn(digitos: string): boolean {
  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (dobrar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

function removerNumerosDeCartao(texto: string): string {
  return texto.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const d = m.replace(/[ -]/g, "");
    return d.length >= 13 && d.length <= 19 && luhn(d) ? "[removido]" : m;
  });
}

// retorno_bruto é texto. JSON é limpo campo a campo; outros formatos (query string, texto) têm os
// pares "nome=valor"/"nome: valor" de nomes sensíveis removidos e números de cartão mascarados.
export function sanitizarRetornoBruto(texto: string): string {
  try {
    const json = JSON.parse(texto);
    if (json && typeof json === "object") {
      return removerNumerosDeCartao(JSON.stringify(descartarCamposSensiveis(json)));
    }
  } catch {
    // não é JSON: segue para a limpeza de texto
  }
  const partes = texto.split(/([&\n;,])/);
  const mantidas: string[] = [];
  for (let i = 0; i < partes.length; i += 2) {
    const trecho = partes[i];
    const sep = partes[i + 1] ?? "";
    const m = trecho.match(/^\s*["']?([^=:"']+)["']?\s*[=:]/);
    if (m && nomeSensivel(m[1])) continue;
    mantidas.push(trecho + sep);
  }
  return removerNumerosDeCartao(mantidas.join(""));
}
