import { AppState, Platform } from "react-native";
import * as Linking from "expo-linking";

// Ajustes para o teste no aparelho
export const TIPO_ITEM_STONE: "line" | "text" = "text";
export const TEXTO_STONE = { size: "medium", align: "left" } as const; // usado só quando o tipo for "text"
export const REMOVER_ACENTOS_STONE = false;

export type ResultadoImpressaoStone =
  | { tipo: "impresso" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "nao_confirmado" }
  | { tipo: "indisponivel" };

const MENSAGENS: [string, string | null][] = [
  ["SUCCESS", null],
  ["PRINTER_OUT_OF_PAPER", "Sem papel ou tampa da bobina aberta."],
  ["PRINTER_INIT_ERROR", "A impressora da maquininha não iniciou."],
  ["PRINTER_LOW_ENERGY", "Bateria da maquininha baixa."],
  ["PRINTER_BUSY", "A impressora está ocupada. Aguarde e tente de novo."],
  ["PRINTER_UNSUPPORTED_FORMAT", "Formato do cupom não aceito pela maquininha."],
  ["PRINTER_INVALID_DATA", "Cupom grande demais para a maquininha."],
  ["PRINTER_OVERHEATING", "Impressora superaquecida. Aguarde alguns minutos."],
  ["PRINTER_PAPER_JAM", "Papel enroscado na bobina."],
  ["PRINTER_PRINT_ERROR", "Erro na impressora da maquininha."],
];

const ESPERA_APOS_VOLTAR_MS = 3000;
const ESPERA_TOTAL_MS = 2 * 60 * 1000;

// Quem está aguardando a resposta da impressão (entregue pela tela app/print.tsx)
let aguardando: ((r: ResultadoImpressaoStone) => void) | null = null;

function interpretar(params: Record<string, string>): ResultadoImpressaoStone {
  const textos: string[] = [];
  for (const [k, v] of Object.entries(params)) { textos.push(String(k)); textos.push(String(v)); }
  for (const [codigo, mensagem] of MENSAGENS) {
    if (textos.some(t => t.includes(codigo))) {
      return mensagem === null ? { tipo: "impresso" } : { tipo: "erro", mensagem };
    }
  }
  return { tipo: "nao_confirmado" };
}

// Chamada pela tela de retorno. Devolve true se alguém estava aguardando.
export function entregarRespostaImpressaoStone(params: Record<string, string>): boolean {
  console.log("[ImpressaoStone] Resposta recebida:", params);
  const espera = aguardando;
  if (!espera) return false;
  espera(interpretar(params));
  return true;
}

function semAcentos(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export async function imprimirNaStone(texto: string): Promise<ResultadoImpressaoStone> {
  if (Platform.OS !== "android") return { tipo: "indisponivel" };

  const linhas = texto.split("\n").map(l => {
    const t = REMOVER_ACENTOS_STONE ? semAcentos(l) : l;
    return t === "" ? " " : t;
  });
  const itens = linhas.map(content =>
    TIPO_ITEM_STONE === "text"
      ? { type: "text", content, align: TEXTO_STONE.align, size: TEXTO_STONE.size }
      : { type: "line", content });

  const parametros: [string, string][] = [
    ["SHOW_FEEDBACK_SCREEN", "true"],
    ["SCHEME_RETURN", "cozinhafastpro"],
    ["PRINTABLE_CONTENT", JSON.stringify(itens)],
  ];
  const url = "printer-app://print?" + parametros.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  console.log("[ImpressaoStone] Abrindo: printer-app://print (" + linhas.length + " linhas)");

  // Registra quem aguarda antes de abrir, para não perder uma resposta rápida
  if (aguardando) aguardando({ tipo: "nao_confirmado" });
  const resposta = new Promise<ResultadoImpressaoStone>(resolve => {
    let timerVolta: ReturnType<typeof setTimeout> | null = null;
    let sub: { remove: () => void } | null = null;
    const timerTotal = setTimeout(() => fim({ tipo: "nao_confirmado" }), ESPERA_TOTAL_MS);
    const fim = (r: ResultadoImpressaoStone) => {
      clearTimeout(timerTotal);
      if (timerVolta) clearTimeout(timerVolta);
      sub?.remove();
      if (aguardando === fim) aguardando = null;
      resolve(r);
    };
    aguardando = fim;
    sub = AppState.addEventListener("change", estado => {
      if (estado === "active") {
        if (!timerVolta) timerVolta = setTimeout(() => fim({ tipo: "nao_confirmado" }), ESPERA_APOS_VOLTAR_MS);
      } else if (timerVolta) {
        clearTimeout(timerVolta);
        timerVolta = null;
      }
    });
  });

  try {
    await Linking.openURL(url);
  } catch (e) {
    console.log("[ImpressaoStone] Não foi possível abrir:", e);
    const espera = aguardando;
    aguardando = null;
    // Encerra a espera sem resultado útil e informa indisponível
    (espera as any)?.({ tipo: "indisponivel" });
    return { tipo: "indisponivel" };
  }
  return resposta;
}
