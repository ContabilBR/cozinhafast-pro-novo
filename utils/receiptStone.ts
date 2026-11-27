import type { ReceiptParams } from "./printer";

// Cupom de conferência só para a impressora da Stone: cada linha usa o alinhamento da própria
// impressora (esquerda, centro ou direita), sem colunas montadas com espaços.

export type ItemStone = {
  type: "text";
  content: string;
  align: "left" | "center" | "right";
  size: "small" | "medium" | "big";
};

const LARGURA_SEPARADOR = 32;
const LARGURA_ITEM = 32;

const ascii = (t: any) => String(t ?? "").normalize("NFC").replace(/[\s]+/g, " ").replace(/[^\x20-\x7e -ÿ]/g, "").trim();

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

// Quebra em linhas sem cortar palavras (palavra maior que a largura é dividida)
function quebrar(text: string, largura: number): string[] {
  const out: string[] = [];
  let cur = "";
  // Número seguido de unidade (ex.: "350 ml") vira uma palavra só na quebra, mantendo o espaço normal
  const palavras: string[] = [];
  for (const w of text.split(" ").filter(Boolean)) {
    const ant = palavras[palavras.length - 1];
    if (ant !== undefined && /^(ml|l|g|kg|un|cm|mg)$/i.test(w) && /^\d+([.,]\d+)?$/.test(ant)) {
      palavras[palavras.length - 1] = ant + " " + w;
    } else palavras.push(w);
  }
  for (let word of palavras) {
    while (word.length > largura) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(word.slice(0, largura));
      word = word.slice(largura);
    }
    if (!cur) cur = word;
    else if ((cur + " " + word).length <= largura) cur += " " + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}

export function montarCupomStone(params: ReceiptParams): ItemStone[] {
  const itens: ItemStone[] = [];
  const add = (content: string, align: ItemStone["align"], size: ItemStone["size"] = "medium") =>
    itens.push({ type: "text", content, align, size });
  const sep = () => add("=".repeat(LARGURA_SEPARADOR), "left");
  const centro = (t: string) => add(t, "center");
  const esquerda = (t: string) => add(t, "left");
  const direita = (t: string) => add(t, "right");

  const r = params.restaurante || {};
  const digits = (v: any) => String(v ?? "").replace(/\D/g, "");

  sep();
  centro((ascii(r.nome) || "Cozinha Fast Pro").toLocaleUpperCase("pt-BR"));
  const logr = ascii(r.logradouro) || ascii(r.endereco);
  const num = ascii(r.numero_endereco);
  if (logr) centro(ascii(r.logradouro) && num ? logr + ", " + num : logr);
  const bairro = ascii(r.bairro), uf = ascii(r.uf).toLocaleUpperCase("pt-BR");
  if (bairro || uf) centro(bairro && uf ? bairro + " - " + uf : bairro || uf);
  const cep = digits(r.cep);
  if (cep.length === 8) centro("CEP " + cep.slice(0, 5) + "-" + cep.slice(5));
  const cnpj = digits(r.cnpj);
  if (cnpj.length === 14) centro("CNPJ " + cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"));
  const tel = digits(r.telefone);
  if (tel.length === 11) centro("Tel (" + tel.slice(0, 2) + ") " + tel.slice(2, 7) + "-" + tel.slice(7));
  else if (tel.length === 10) centro("Tel (" + tel.slice(0, 2) + ") " + tel.slice(2, 6) + "-" + tel.slice(6));
  sep();
  centro("CONFERÊNCIA DE CONTA");
  centro("*** NÃO É DOCUMENTO FISCAL ***");
  sep();

  if (params.mesa !== undefined && params.mesa !== null && String(params.mesa) !== "") esquerda("Mesa: " + ascii(params.mesa));
  if (ascii(params.rotulo)) esquerda("Comanda: " + ascii(params.rotulo));
  const ab = dataHora(params.abertura);
  if (ab) esquerda("Abertura: " + ab);
  esquerda("Impressão: " + dataHora(new Date()));
  if (ascii(params.impressoPor)) esquerda("Impresso por: " + ascii(params.impressoPor));
  sep();

  let unidades = 0;
  for (const item of params.itens) {
    const q = item.quantidade || 1;
    unidades += q;
    const nome = ascii(item.nome) || "Item";
    for (const l of quebrar(q + "x " + nome, LARGURA_ITEM)) esquerda(l);
    if (q > 1) {
      const unit = item.precoUnitario ?? item.preco / q;
      direita(q + " x " + money(unit) + " = R$ " + money(item.preco));
    } else {
      direita("R$ " + money(item.preco));
    }
  }
  sep();

  direita(unidades + (unidades === 1 ? " item" : " itens"));
  direita("Subtotal: R$ " + money(params.subtotal));
  if (params.desconto && params.desconto > 0) direita((params.descontoRotulo || "Desconto") + ": - R$ " + money(params.desconto));
  if (params.gorjeta > 0) {
    const pct = params.subtotal > 0 ? Math.round((params.gorjeta / params.subtotal) * 1000) / 10 : 0;
    const pctTxt = (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)).replace(".", ",");
    direita("Gorjeta (" + pctTxt + "%): R$ " + money(params.gorjeta));
  }
  add("TOTAL: R$ " + money(params.total), "right", "medium");
  sep();

  if (params.divisao && params.divisao.pessoas > 1) {
    centro("Dividido por " + params.divisao.pessoas + " pessoas");
    centro("R$ " + money(params.divisao.valorPorPessoa) + " por pessoa");
    sep();
  }

  if (params.gorjeta > 0) centro("Gorjeta sugerida e opcional.");
  centro("Confira os itens antes de pagar.");
  centro(" ");
  centro("Obrigado pela visita!");
  centro("Volte sempre!");
  centro(" ");
  centro(" ");
  centro(" ");

  return itens;
}
