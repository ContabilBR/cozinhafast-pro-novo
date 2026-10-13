import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { formatCurrency } from "@/utils/helpers";

export interface RelatorioResumo {
  total_revenue?: number;
  receita_periodo?: number;
  total_orders?: number;
  open_orders?: number;
  avg_ticket?: number;
  top_dishes?: { dish_name: string; quantity_sold: number }[];
  orders_by_status?: { aberta?: number; fechada?: number; cancelada?: number };
}

export interface MesaResumoExport {
  mesa_numero: number;
  ticket_medio: number;
  comandas_fechadas: number;
  top_dishes: { dish_name: string; quantity_sold: number }[];
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesParaBase64(bytes: Uint8Array): string {
  let resultado = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    resultado += BASE64_CHARS[(triplet >> 18) & 0x3f];
    resultado += BASE64_CHARS[(triplet >> 12) & 0x3f];
    resultado += i + 1 < len ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=";
    resultado += i + 2 < len ? BASE64_CHARS[triplet & 0x3f] : "=";
  }
  return resultado;
}

function formatPct(n: number, total: number): string {
  if (total <= 0) return "0,0%";
  return `${((n / total) * 100).toFixed(1).replace(".", ",")}%`;
}

export async function exportarRelatorioExcel(
  resumo: RelatorioResumo,
  periodoLabel: string,
  mesas: MesaResumoExport[] = []
): Promise<void> {
  const status = resumo.orders_by_status || {};
  const pedidosNoPeriodo = (status.aberta ?? 0) + (status.fechada ?? 0) + (status.cancelada ?? 0);
  const pratos = resumo.top_dishes || [];
  const totalItensVendidos = pratos.reduce((soma, p) => soma + (p.quantity_sold || 0), 0);

  const wb = XLSX.utils.book_new();

  const linhasResumo = [
    ["Relatório — Cozinha Fast Pro"],
    ["Período", periodoLabel],
    ["Emitido em", new Date().toLocaleString("pt-BR")],
    [],
    ["RESUMO DO PERÍODO SELECIONADO", ""],
    ["Faturamento no Período", formatCurrency(resumo.receita_periodo ?? 0)],
    ["Pedidos no Período", pedidosNoPeriodo],
    ["Ticket Médio", formatCurrency(resumo.avg_ticket ?? 0)],
    ["Pedidos Abertos Atualmente", resumo.open_orders ?? 0],
    [],
    ["PEDIDOS POR STATUS NO PERÍODO", "", "% do período"],
    ["Abertas", status.aberta ?? 0, formatPct(status.aberta ?? 0, pedidosNoPeriodo)],
    ["Fechadas", status.fechada ?? 0, formatPct(status.fechada ?? 0, pedidosNoPeriodo)],
    ["Canceladas", status.cancelada ?? 0, formatPct(status.cancelada ?? 0, pedidosNoPeriodo)],
    [],
    ["HISTÓRICO GERAL (desde o início)", ""],
    ["Faturamento Total Histórico", formatCurrency(resumo.total_revenue ?? 0)],
    ["Total de Pedidos Histórico", resumo.total_orders ?? 0],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(linhasResumo);
  wsResumo["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const linhasPratos = [
    ["Prato", "Quantidade Vendida", "% do total de itens"],
    ...pratos.map((p) => [
      p.dish_name,
      p.quantity_sold,
      formatPct(p.quantity_sold, totalItensVendidos),
    ]),
  ];
  if (pratos.length === 0) {
    linhasPratos.push(["Sem dados disponíveis para este período", "", ""]);
  }
  const wsPratos = XLSX.utils.aoa_to_sheet(linhasPratos);
  wsPratos["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsPratos, "Pratos Mais Pedidos");

  const linhasMesas = [
    ["Mesa", "Ticket Médio", "Comandas Fechadas", "Pratos Mais Pedidos"],
    ...mesas.map((m) => [
      `Mesa ${m.mesa_numero}`,
      formatCurrency(m.ticket_medio),
      m.comandas_fechadas,
      m.top_dishes.map((d, i) => `${i + 1}. ${d.dish_name} (${d.quantity_sold}x)`).join("  |  "),
    ]),
  ];
  if (mesas.length === 0) {
    linhasMesas.push(["Nenhuma mesa com comandas fechadas neste período", "", "", ""]);
  }
  const wsMesas = XLSX.utils.aoa_to_sheet(linhasMesas);
  wsMesas["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsMesas, "Por Mesa");

  // XLSX.write com type "array" devolve um ArrayBuffer — não é indexável direto,
  // precisa ser envolvido num Uint8Array antes de percorrer byte a byte.
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const bytes = new Uint8Array(buffer);
  const base64 = bytesParaBase64(bytes);

  const nomeArquivo = `relatorio_${Date.now()}.xlsx`;
  const uri = FileSystem.cacheDirectory + nomeArquivo;

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const disponivel = await Sharing.isAvailableAsync();
  if (!disponivel) {
    throw new Error("Compartilhamento não está disponível neste dispositivo.");
  }

  await Sharing.shareAsync(uri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Compartilhar relatório (Excel)",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
}
