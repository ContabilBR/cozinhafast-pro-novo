import { printBluetooth } from "./printer";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ViaEntregaParams {
  restaurante: string;
  codigo: string;
  criadoEm: string;
  horarioLimite?: string;
  clienteNome: string;
  clienteTelefone?: string;
  endereco?: string;
  bairro?: string;
  complemento?: string;
  cep?: string;
  referencia?: string;
  observacaoGeral?: string;
  itens: {
    quantidade: number;
    nome: string;
    preco: number;
    observacao?: string;
    cancelado?: boolean;
  }[];
  subtotal: number;
  taxaEntrega: number;
  total: number;
  pagamento: {
    jaFoiPago: boolean;
    forma: string;
    trocoParaRef?: string;
    troco?: number;
  };
  entregadorNome?: string;
  saiuEm?: string;
}

export interface EtiquetaParams {
  codigo: string;
  clienteNome: string;
  bairro?: string;
  pagamento: { jaFoiPago: boolean; total: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const W = 32;

function removeAcentos(text: string): string {
  return text
    .replace(/[áàãâä]/g, "a")
    .replace(/[ÁÀÃÂÄ]/g, "A")
    .replace(/[éèêë]/g, "e")
    .replace(/[ÉÈÊË]/g, "E")
    .replace(/[íìîï]/g, "i")
    .replace(/[ÍÌÎÏ]/g, "I")
    .replace(/[óòõôö]/g, "o")
    .replace(/[ÓÒÕÔÖ]/g, "O")
    .replace(/[úùûü]/g, "u")
    .replace(/[ÚÙÛÜ]/g, "U")
    .replace(/[ç]/g, "c")
    .replace(/[Ç]/g, "C")
    .replace(/[ñ]/g, "n")
    .replace(/[Ñ]/g, "N");
}

function center(text: string): string {
  const t = removeAcentos(text).slice(0, W);
  const pad = Math.max(0, Math.floor((W - t.length) / 2));
  return " ".repeat(pad) + t;
}

function row(left: string, right: string): string {
  const l = removeAcentos(left);
  const r = removeAcentos(right);
  const space = Math.max(1, W - l.length - r.length);
  return l + " ".repeat(space) + r;
}

function sep(): string {
  return "-".repeat(W);
}

function sepDouble(): string {
  return "=".repeat(W);
}

function formatMoney(value: number): string {
  return "R$ " + Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

function formaLabel(forma: string): string {
  const map: Record<string, string> = {
    pix: "Pix",
    dinheiro: "Dinheiro",
    "cartao de credito": "Cartao de credito",
    "cartao de debito": "Cartao de debito",
    credito: "Cartao de credito",
    debito: "Cartao de debito",
  };
  const key = removeAcentos(forma.toLowerCase());
  return map[key] || removeAcentos(forma);
}

// ─── formatViaEntrega ─────────────────────────────────────────────────────────

export function formatViaEntrega(params: ViaEntregaParams): string {
  console.log("[deliveryPrinter] formatViaEntrega called for codigo:", params.codigo);
  const lines: string[] = [];

  // 1. Cabeçalho
  lines.push(center(params.restaurante));
  lines.push(center("DELIVERY"));
  lines.push(sep());

  // 2. Pedido
  lines.push(center("PEDIDO #" + params.codigo.toUpperCase()));
  lines.push(removeAcentos(formatDateTime(params.criadoEm)));
  if (params.horarioLimite) {
    lines.push(removeAcentos("Entrega ate " + params.horarioLimite));
  }

  // 3. Cliente e endereço
  lines.push(sep());
  lines.push(removeAcentos("CLIENTE E ENDERECO:"));
  lines.push(removeAcentos(params.clienteNome));
  if (params.clienteTelefone) lines.push(removeAcentos(params.clienteTelefone));
  if (params.endereco) lines.push(removeAcentos(params.endereco));
  if (params.bairro) lines.push(removeAcentos(params.bairro));
  if (params.complemento) lines.push(removeAcentos(params.complemento));
  if (params.cep) lines.push(removeAcentos("CEP: " + params.cep));
  if (params.referencia) lines.push(removeAcentos("Ref: " + params.referencia));
  if (params.observacaoGeral) {
    lines.push(removeAcentos("** OBS: " + params.observacaoGeral + " **"));
  }

  // 4. Itens
  lines.push(sep());
  lines.push("ITENS:");
  const itensAtivos = params.itens.filter((i) => !i.cancelado);
  for (const item of itensAtivos) {
    const nomeMax = removeAcentos(item.nome).slice(0, 20);
    const qtdPrefix = item.quantidade + "x " + nomeMax;
    const precoTotal = item.preco * item.quantidade;
    lines.push(row(qtdPrefix, formatMoney(precoTotal)));
    if (item.observacao) {
      lines.push(removeAcentos("  > " + item.observacao));
    }
  }

  // 5. Totais
  lines.push(sep());
  lines.push(row("Subtotal:", formatMoney(params.subtotal)));
  lines.push(row("Taxa de entrega:", formatMoney(params.taxaEntrega)));
  lines.push(row("TOTAL:", formatMoney(params.total)));

  // 6. Pagamento
  lines.push(sepDouble());
  const pag = params.pagamento;
  const forma = formaLabel(pag.forma);
  if (pag.jaFoiPago) {
    lines.push(center("JA PAGO"));
    lines.push(center(forma));
    lines.push(center("NAO COBRAR NA ENTREGA"));
  } else {
    lines.push(center("COBRAR NA ENTREGA:"));
    lines.push(center(formatMoney(params.total)));
    const formaLower = removeAcentos(pag.forma.toLowerCase());
    if (formaLower === "dinheiro") {
      lines.push(center("Forma: Dinheiro"));
      if (pag.trocoParaRef) {
        // Parse "Troco para R$ X,XX" or "Troco para R$ X.XX"
        const match = pag.trocoParaRef.match(/[\d.,]+/);
        const trocoParaVal = match ? parseFloat(match[0].replace(",", ".")) : 0;
        const trocoDevolver = trocoParaVal > 0 ? trocoParaVal - params.total : 0;
        lines.push(removeAcentos("Cliente paga com " + formatMoney(trocoParaVal)));
        if (trocoDevolver > 0) {
          lines.push(removeAcentos("Levar troco de " + formatMoney(trocoDevolver)));
        } else {
          lines.push(center("Levar troco"));
        }
      }
    } else if (formaLower === "pix") {
      lines.push(center("Forma: Pix"));
      lines.push(center("Cliente paga por Pix"));
    } else {
      lines.push(center("Forma: " + forma));
      lines.push(center("Levar a maquininha"));
    }
  }

  // 7. Entregador
  lines.push(sep());
  lines.push("ENTREGADOR:");
  if (params.entregadorNome) {
    lines.push(removeAcentos(params.entregadorNome));
    if (params.saiuEm) {
      lines.push(removeAcentos("Saiu: " + formatHHMM(params.saiuEm)));
    }
  } else {
    lines.push("Nome: ____________________");
  }

  // 8. Rodapé
  lines.push(sep());
  lines.push(removeAcentos("Conferido por: _______________"));
  lines.push("");
  const primeiroNome = removeAcentos(params.clienteNome.split(" ")[0] || params.clienteNome);
  lines.push(center("Bom apetite, " + primeiroNome + "!"));
  lines.push("");
  lines.push(center("Documento sem valor fiscal"));
  lines.push("");
  lines.push("");
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

// ─── formatEtiquetaLacre ──────────────────────────────────────────────────────

export function formatEtiquetaLacre(params: EtiquetaParams): string {
  console.log("[deliveryPrinter] formatEtiquetaLacre called for codigo:", params.codigo);
  const lines: string[] = [];

  lines.push(sepDouble());
  lines.push(center("PEDIDO #" + params.codigo.toUpperCase()));
  lines.push(center(params.clienteNome));
  if (params.bairro) {
    lines.push(center(params.bairro));
  }
  if (params.pagamento.jaFoiPago) {
    lines.push(center("** PAGO **"));
  } else {
    lines.push(center("COBRAR " + formatMoney(params.pagamento.total)));
  }
  lines.push(sepDouble());
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

// ─── imprimirViaDelivery ──────────────────────────────────────────────────────

export async function imprimirViaDelivery(texto: string): Promise<"bluetooth" | "fallback" | "erro"> {
  console.log("[deliveryPrinter] imprimirViaDelivery called, platform:", Platform.OS);
  try {
    if (Platform.OS !== "web") {
      console.log("[deliveryPrinter] Attempting Bluetooth print");
      const ok = await printBluetooth(texto);
      if (ok) {
        console.log("[deliveryPrinter] Bluetooth print succeeded");
        return "bluetooth";
      }
      console.log("[deliveryPrinter] Bluetooth print failed, falling back to PDF");

      // Native fallback: PDF file + sharing
      const escaped = texto
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="font-family:monospace;font-size:13px;line-height:1.4;white-space:pre;width:280px;background:#fff;color:#000;padding:8px;margin:0;">${escaped}</body></html>`;
      const { uri: tempUri } = await Print.printToFileAsync({ html, base64: false });
      console.log("[deliveryPrinter] PDF generated at:", tempUri);
      const dest = (FileSystem.cacheDirectory ?? "") + "via_delivery_" + Date.now() + ".pdf";
      await FileSystem.copyAsync({ from: tempUri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: "application/pdf", dialogTitle: "Via de entrega" });
      console.log("[deliveryPrinter] PDF shared successfully");
      return "fallback";
    } else {
      // Web: use browser print dialog directly
      console.log("[deliveryPrinter] Web platform — using browser print dialog");
      const escaped = texto
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="font-family:monospace;font-size:13px;line-height:1.4;white-space:pre;width:280px;background:#fff;color:#000;padding:8px;margin:0;">${escaped}</body></html>`;
      await Print.printAsync({ html });
      console.log("[deliveryPrinter] Browser print dialog opened");
      return "fallback";
    }
  } catch (err) {
    console.error("[deliveryPrinter] imprimirViaDelivery error:", err);
    return "erro";
  }
}
