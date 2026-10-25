import { Alert } from "react-native";

// Shared paper geometry for Bluetooth text, on-screen paper and device printing.
// 40 colunas com fonte B (menor) causaram papel em branco na impressora testada;
// por isso o padrao agora e 32 colunas sem fonte B.
export const RECEIPT_COLUMNS = 32;
export const RECEIPT_FONT_B = false;
export const RECEIPT_WIDTH_MM = 58;
// Espaco entre linhas em pontos (203 dpi). A letra tem 24 pontos de altura; o padrao da impressora
// costuma ser 30 a 34. Se as linhas encostarem, suba para 26 ou 28. Com 0 o comando nao e enviado.
export const RECEIPT_LINE_SPACING_DOTS = 24;

let ThermalPrinterModule: any = null;

export async function loadPrinterModule() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ThermalPrinterModule = (await import("react-native-thermal-printer" as any)).default;
  } catch (e) {
    console.log("Módulo de impressora não disponível");
  }
}

// Texto para a impressora Bluetooth: ASCII puro (as tabelas de caracteres das termicas imprimem lixo nos acentos).
export function toBluetoothText(text: string): string {
  const plain = String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\n\x20-\x7e]/g, "");
  const spacing = RECEIPT_LINE_SPACING_DOTS > 0 ? "\x1b3" + String.fromCharCode(Math.min(255, RECEIPT_LINE_SPACING_DOTS)) : "";
  return spacing + (RECEIPT_FONT_B ? "\x1bM\x01" : "") + plain;
}

export async function printBluetooth(payload: string): Promise<boolean> {
  try {
    let mod: any = null;
    try {
      mod = (await import("react-native-thermal-printer" as any)).default;
    } catch {
      return false;
    }
    if (!mod || !mod.printBluetooth) return false;
    const config: any = { payload: toBluetoothText(payload), printerWidthMM: RECEIPT_WIDTH_MM };
    if (RECEIPT_FONT_B) config.printerNbrCharactersPerLine = 48;
    await mod.printBluetooth(config);
    return true;
  } catch (err: any) {
    return false;
  }
}

export type ReceiptRestaurante = {
  nome?: string | null; logradouro?: string | null; numero_endereco?: string | null; endereco?: string | null;
  bairro?: string | null; uf?: string | null; cep?: string | null; cnpj?: string | null; telefone?: string | null;
};

export type ReceiptParams = {
  restaurante?: ReceiptRestaurante | null;
  mesa?: number | string;
  rotulo?: string | null;
  abertura?: string | Date | null;
  impressoPor?: string | null;
  itens: { quantidade: number; nome: string; preco: number; precoUnitario?: number }[];
  subtotal: number;
  desconto?: number;
  descontoRotulo?: string;
  gorjeta: number;
  total: number;
  divisao?: { pessoas: number; valorPorPessoa: number } | null;
};

const ascii = (t: any) => String(t ?? "").normalize("NFC").replace(/[\s]+/g, " ").replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "").trim();

const money = (n: number) => {
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dec;
};

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const dataHora = (v: string | Date | null | undefined) => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
};

// Quebra em linhas sem cortar palavras (palavra maior que a largura e dividida, pois nenhuma linha passa do limite).
function wrap(text: string, widthOf: (i: number) => number): string[] {
  const out: string[] = [];
  let cur = "";
  for (let word of text.split(" ").filter(Boolean)) {
    while (word.length > widthOf(out.length)) {
      if (cur) { out.push(cur); cur = ""; }
      const cut = widthOf(out.length);
      out.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const max = widthOf(out.length);
    if (!cur) cur = word;
    else if ((cur + " " + word).length <= max) cur += " " + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}

export function formatReceipt(params: ReceiptParams): string {
  const w = RECEIPT_COLUMNS;
  const lines: string[] = [];
  const center = (text: string) => wrap(ascii(text), () => w).map((l) => " ".repeat(Math.floor((w - l.length) / 2)) + l);
  const eq = () => "=".repeat(w);
  const dash = () => "-".repeat(w);
  const row = (left: string, right: string) => left + " ".repeat(Math.max(1, w - left.length - right.length)) + right;
  const r = params.restaurante || {};
  const digits = (v: any) => String(v ?? "").replace(/\D/g, "");

  lines.push(eq());
  lines.push(...center((ascii(r.nome) || "Cozinha Fast Pro").toLocaleUpperCase("pt-BR")));
  const logr = ascii(r.logradouro) || ascii(r.endereco);
  const num = ascii(r.numero_endereco);
  if (logr) lines.push(...center(ascii(r.logradouro) && num ? logr + ", " + num : logr));
  const bairro = ascii(r.bairro), uf = ascii(r.uf).toLocaleUpperCase("pt-BR");
  if (bairro || uf) lines.push(...center(bairro && uf ? bairro + " - " + uf : bairro || uf));
  const cep = digits(r.cep);
  if (cep.length === 8) lines.push(...center("CEP " + cep.slice(0, 5) + "-" + cep.slice(5)));
  const cnpj = digits(r.cnpj);
  if (cnpj.length === 14) lines.push(...center("CNPJ " + cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")));
  const tel = digits(r.telefone);
  if (tel.length === 11) lines.push(...center("Tel (" + tel.slice(0, 2) + ") " + tel.slice(2, 7) + "-" + tel.slice(7)));
  else if (tel.length === 10) lines.push(...center("Tel (" + tel.slice(0, 2) + ") " + tel.slice(2, 6) + "-" + tel.slice(6)));
  lines.push(eq());
  lines.push(...center("CONFERÊNCIA DE CONTA"));
  lines.push(...center("*** NÃO É DOCUMENTO FISCAL ***"));
  lines.push(eq());

  const ident: string[] = [];
  if (params.mesa !== undefined && params.mesa !== null && String(params.mesa) !== "") ident.push("Mesa: " + ascii(params.mesa));
  if (ascii(params.rotulo)) ident.push("Comanda: " + ascii(params.rotulo));
  const ab = dataHora(params.abertura);
  if (ab) ident.push("Abertura:  " + ab);
  ident.push("Impressão: " + dataHora(new Date()));
  if (ascii(params.impressoPor)) ident.push("Impresso por: " + ascii(params.impressoPor));
  for (const l of ident) {
    if (l.length <= w) lines.push(l);
    else lines.push(...wrap(l, (i) => (i === 0 ? w : w - 2)).map((x, i) => (i === 0 ? x : "  " + x)));
  }
  lines.push(dash());
  lines.push(row("QTD DESCRIÇÃO", "VALOR"));
  lines.push(dash());

  let unidades = 0;
  for (const item of params.itens) {
    const q = item.quantidade || 1;
    unidades += q;
    const prefix = q + "x ";
    const right = money(item.preco);
    const nome = ascii(item.nome) || "Item";
    const parts = wrap(nome, (i) => (i === 0 ? w - prefix.length - right.length - 1 : w - prefix.length));
    const first = parts.shift() || "";
    lines.push(row(prefix + first, right));
    for (const p of parts) lines.push(" ".repeat(prefix.length) + p);
    if (q > 1) lines.push(" ".repeat(prefix.length) + "(" + money(item.precoUnitario ?? item.preco / q) + " cada)");
  }
  lines.push(dash());
  lines.push(unidades + (unidades === 1 ? " item" : " itens"));
  lines.push(row("Subtotal", "R$ " + money(params.subtotal)));
  if (params.desconto && params.desconto > 0) lines.push(row(params.descontoRotulo || "Desconto", "- R$ " + money(params.desconto)));
  if (params.gorjeta > 0) {
    const pct = params.subtotal > 0 ? Math.round((params.gorjeta / params.subtotal) * 1000) / 10 : 0;
    const pctTxt = (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)).replace(".", ",");
    lines.push(row("Gorjeta (" + pctTxt + "%)", "R$ " + money(params.gorjeta)));
  }
  lines.push(eq());
  lines.push(row("TOTAL", "R$ " + money(params.total)));
  lines.push(eq());
  if (params.divisao && params.divisao.pessoas > 1) {
    lines.push(...center("Dividido por " + params.divisao.pessoas + " pessoas"));
    lines.push(...center("R$ " + money(params.divisao.valorPorPessoa) + " por pessoa"));
    lines.push(dash());
  }
  if (params.gorjeta > 0) lines.push(...center("Gorjeta sugerida e opcional."));
  lines.push(...center("Confira os itens antes de pagar."));
  lines.push("");
  lines.push(...center("Obrigado pela visita!"));
  lines.push(...center("Volte sempre!"));
  lines.push("", "", "");

  return lines.join("\n");
}
