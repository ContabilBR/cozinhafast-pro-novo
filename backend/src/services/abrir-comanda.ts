/**
 * Abertura de comanda em uma mesa (parte que decide e grava a linha da comanda).
 *
 * Regras:
 *  - modo "mesa" (padrão): no máximo UMA comanda aberta por mesa; o nome enviado é ignorado
 *    (a comanda é gravada sem nome) e, se já houver comanda aberta, devolve "mesa_ja_tem_comanda";
 *  - modo "individual": várias comandas abertas por mesa, cada uma com NOME obrigatório.
 *    Sem nome -> "nome_obrigatorio"; nome com mais de 40 caracteres -> "nome_muito_longo";
 *    nome já usado por outra comanda ABERTA da mesma mesa (ignorando maiúsculas, espaços
 *    sobrando e caracteres invisíveis; "JOÃO" e "joão" são o mesmo nome, mas "João" e "Joao"
 *    são diferentes) -> "nome_repetido".
 *
 * Nomes (normalizarNomeComanda e chaveDeNome):
 *  - o texto é normalizado em NFC ("é" digitado e "e" + acento viram o mesmo texto);
 *  - caracteres de controle viram espaço; espaços Unicode (inclusive NBSP) viram espaço comum,
 *    sequências viram um só e as pontas são cortadas;
 *  - caracteres invisíveis (espaço de largura zero U+200B, marcas de direção U+200E/U+200F e
 *    U+202A..U+202E, U+2060..U+2064, U+FEFF, hífen suave, fillers de Hangul etc.) são removidos,
 *    de modo que "João" e "Jo" + U+200B + "ão" passam a ser o mesmo nome;
 *  - o ZWJ (U+200D) e o seletor de emoji (U+FE0F) só ficam no texto exibido quando fazem parte de
 *    um emoji; na chave de comparação todos os invisíveis saem;
 *  - nome que não tenha nenhum caractere visível (só invisíveis, espaços ou marcas de combinação)
 *    é tratado como ausente.
 *
 * Por que trava a mesa: sem a trava, dois garçons abrindo comanda ao mesmo tempo na mesma mesa
 * passariam, os dois, pela conferência ("não existe ainda") e criariam comandas duplicadas
 * (duas comandas no modo mesa, ou o mesmo nome duas vezes no modo individual). A trava
 * (SELECT ... FOR UPDATE na linha da mesa DO RESTAURANTE) faz as aberturas da mesma mesa andarem
 * em fila; a conferência e a gravação acontecem já com a mesa travada.
 *
 * Precisa rodar DENTRO de uma transação (`tx`): fora dela a trava é solta na hora e perde o efeito.
 * Este módulo só grava a linha da comanda. Itens, total e status da mesa continuam com a rota,
 * na mesma transação.
 *
 * DOIS MODOS DE USO:
 *
 * 1. LEGADO (abrirComandaNaMesa): Requer tx fornecido. Não publica eventos.
 *    Callers (e.g., rota de pedidos) abrem a transação, chamam isso, e publicam externamente.
 *    Preserva o comportamento original exatamente.
 *
 * 2. COM PUBLICAÇÃO (abrirComandaNaMesaComPublicacao): API/facade que abre a transação própria,
 *    publica eventos após confirmação, ou usa tx externa sem publicar (deixa para o dono).
 *    Evita duplicação de eventos.
 */
import { and, eq, sql } from "drizzle-orm";
import type { App } from "../index.js";
import * as schema from "../db/schema/schema.js";
import { realtimeHub } from "../realtime/hub.js";

export const TAMANHO_MAXIMO_NOME_COMANDA = 40;

export interface EntradaAbertura {
  restauranteId: string;
  mesaId: string;
  mesaNumero: number | null;
  garcomId: string;
  total: string;
  /** Nome digitado (cru). Só vale no modo individual. */
  rotulo?: unknown;
}

export interface MetadadosAbertura {
  restauranteId: string;
  comandaId: string;
  mesaId: string;
  mesaNumero: number | null;
}

export type ResultadoAbertura =
  | { tipo: "criada"; comanda: any; __metadataParaPublicar?: MetadadosAbertura }
  | { tipo: "mesa_nao_encontrada" }
  | { tipo: "nome_obrigatorio" }
  | { tipo: "nome_muito_longo" }
  | { tipo: "nome_repetido" }
  | { tipo: "mesa_ja_tem_comanda" };

type HubDeEventos = Pick<typeof realtimeHub, "publish">;

function linhasDe(resultado: any): any[] {
  if (Array.isArray(resultado)) return resultado;
  return resultado?.rows ?? [];
}

/**
 * Publica o evento de comanda criada no hub de eventos.
 * Chamado após a transação ser confirmada (modo com transação própria) ou externamente
 * (modo com transação externa, pelo dono da transação).
 */
export function publicarEventoComandaCriada(
  app: App,
  metadata: MetadadosAbertura,
  hub: HubDeEventos = realtimeHub
): void {
  try {
    hub.publish(metadata.restauranteId, {
      type: "comanda.created",
      entityId: metadata.comandaId,
      occurredAt: new Date().toISOString(),
      payload: { mesa_id: metadata.mesaId, mesa_numero: metadata.mesaNumero },
    });
  } catch (err) {
    app.logger.debug({ err }, "Falha ao publicar comanda.created");
  }
}

// --- Normalização de nomes -------------------------------------------------------------------

/** Formatação (Cf) e "ignoráveis por padrão" do Unicode: U+200B..U+200F, U+202A..U+202E, U+2060..U+206F, U+FEFF, U+00AD, fillers de Hangul, seletores de variação etc. */
const RE_INVISIVEIS = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/** Igual a RE_INVISIVEIS, mas poupa o ZWJ (U+200D) e o seletor de emoji (U+FE0F), que podem fazer parte de um emoji. */
const RE_INVISIVEIS_EXCETO_EMOJI = /(?![‍️])[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/** ZWJ que não está entre dois emojis (sozinho, nas pontas, repetido): não liga nada e é invisível. */
const RE_ZWJ_SOLTO =
  /(?<![\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️])‍|‍(?!\p{Extended_Pictographic})/gu;
/** Seletor de emoji que não vem logo depois de um emoji. */
const RE_VS16_SOLTO = /(?<!\p{Extended_Pictographic})️/gu;
/** Espaços de qualquer tipo (Unicode, NBSP, quebras) e o "braille em branco" (U+2800), que parece espaço. */
const RE_ESPACOS = /[\p{Z}\s⠀]+/gu;
/** Pelo menos um caractere que não seja marca de combinação (acento solto não é nome). */
const RE_TEM_BASE_VISIVEL = /[^\p{M}]/u;

/**
 * Normaliza o nome digitado: NFC, controle vira espaço, invisíveis saem, espaços repetidos viram
 * um só e as pontas são cortadas. Devolve null quando não sobra nenhum caractere visível
 * (ou quando não é texto). A operação é idempotente: normalizar duas vezes dá o mesmo resultado.
 */
export function normalizarNomeComanda(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(RE_INVISIVEIS_EXCETO_EMOJI, "")
    .replace(RE_ZWJ_SOLTO, "")
    .replace(RE_VS16_SOLTO, "")
    .replace(RE_ESPACOS, " ")
    .trim();
  return limpo.length > 0 && RE_TEM_BASE_VISIVEL.test(limpo) ? limpo : null;
}

/**
 * Chave de comparação de um nome JÁ normalizado (resultado de normalizarNomeComanda):
 * sem nenhum invisível (nem ZWJ/VS16) e sem diferença de maiúsculas. Mantém os acentos:
 * "João" e "Joao" continuam sendo nomes diferentes.
 *
 * Feita em código (e não com lower() do banco) porque lower() depende do idioma/collation do banco.
 */
export function chaveDeNome(nomeNormalizado: string): string {
  return nomeNormalizado.replace(RE_INVISIVEIS, "").toLowerCase().normalize("NFC");
}

export async function abrirComandaNaMesa(tx: any, entrada: EntradaAbertura): Promise<ResultadoAbertura> {
  const { restauranteId, mesaId } = entrada;

  // 1) Trava a mesa DO RESTAURANTE (sem linha: não existe ou é de outro restaurante)
  const travada = linhasDe(
    await tx.execute(
      sql`SELECT id FROM mesas WHERE id = ${mesaId} AND restaurante_id = ${restauranteId} FOR UPDATE`
    )
  );
  if (travada.length === 0) return { tipo: "mesa_nao_encontrada" };

  // 2) Modo do restaurante, lido já com a mesa travada
  const modos = await tx
    .select({ modoComanda: schema.restaurante.modoComanda })
    .from(schema.restaurante)
    .where(eq(schema.restaurante.id, restauranteId))
    .limit(1);
  const individual = modos[0]?.modoComanda === "individual";

  let rotulo: string | null = null;

  if (individual) {
    rotulo = normalizarNomeComanda(entrada.rotulo);
    if (rotulo === null) return { tipo: "nome_obrigatorio" };
    if (rotulo.length > TAMANHO_MAXIMO_NOME_COMANDA) return { tipo: "nome_muito_longo" };

    // Nomes já gravados podem ter sido normalizados por uma regra mais antiga (sem remover
    // invisíveis); por isso cada nome aberto passa pela normalização atual antes da comparação.
    // São poucas comandas abertas por mesa.
    const abertas = linhasDe(
      await tx.execute(
        sql`SELECT rotulo FROM comandas
            WHERE mesa_id = ${mesaId} AND restaurante_id = ${restauranteId} AND status = 'aberta'
              AND rotulo IS NOT NULL`
      )
    );
    const chave = chaveDeNome(rotulo);
    const repetido = abertas.some((c: any) => {
      const existente = normalizarNomeComanda(c.rotulo);
      return existente !== null && chaveDeNome(existente) === chave;
    });
    if (repetido) return { tipo: "nome_repetido" };
  } else {
    // modo "mesa": uma comanda aberta por mesa; o nome enviado é ignorado
    const jaTem = await tx
      .select({ id: schema.comandas.id })
      .from(schema.comandas)
      .where(
        and(
          eq(schema.comandas.mesaId, mesaId),
          eq(schema.comandas.status, "aberta" as any),
          eq(schema.comandas.restauranteId, restauranteId)
        )
      )
      .limit(1);
    if (jaTem.length > 0) return { tipo: "mesa_ja_tem_comanda" };
  }

  // 3) Grava a comanda
  const [comanda] = await tx
    .insert(schema.comandas)
    .values({
      mesaId,
      mesaNumero: entrada.mesaNumero,
      garcomId: entrada.garcomId,
      status: "aberta",
      total: entrada.total,
      restauranteId,
      rotulo,
    })
    .returning();

  return {
    tipo: "criada",
    comanda,
    __metadataParaPublicar: {
      restauranteId,
      comandaId: comanda.id,
      mesaId,
      mesaNumero: entrada.mesaNumero,
    },
  };
}

/**
 * Abre comanda em uma mesa com suporte a transações externas e publicação de eventos.
 *
 * Modo com transação própria (txExterno não fornecido):
 * - Abre e confirma a transação automaticamente
 * - Publica evento comanda.created após confirmação
 * - Retorna resultado com metadados internos ignorados por callers legados
 *
 * Modo com transação externa (txExterno fornecido):
 * - Executa tudo dentro do txExterno (sem abrir novo, sem commit)
 * - Não publica eventos (deixa para o dono da transação após commit)
 * - Retorna resultado com metadados para o caller publicar após commit
 *
 * LEGADO: A função abrirComandaNaMesa() continua funcionando exatamente igual,
 * aceitando apenas tx e sem publicar eventos (callers históricos lidam com publicação).
 *
 * @param app - Aplicação (com db e logger)
 * @param entrada - Dados de entrada (restaurante, mesa, garcom, total, rotulo)
 * @param txExterno - Transação externa opcional. Se não fornecida, abre a própria.
 * @param hub - Hub de eventos para publicar (padrão: realtimeHub)
 */
export async function abrirComandaNaMesaComPublicacao(
  app: App,
  entrada: EntradaAbertura,
  txExterno?: any,
  hub: HubDeEventos = realtimeHub
): Promise<ResultadoAbertura> {
  // Lógica de núcleo extraída: aceita tx já aberto (externo) ou abre novo (próprio)
  const executarNoTx = (tx: any): Promise<ResultadoAbertura> => {
    return abrirComandaNaMesa(tx, entrada);
  };

  // Modo: tx externo (não publica) ou tx próprio (abre, confirma e publica)
  if (txExterno) {
    return executarNoTx(txExterno);
  }

  const resultado = await (app.db as any).transaction(async (tx: any) => {
    return executarNoTx(tx);
  });

  // Publica evento de comanda criada após transação confirmada
  // (Só acontece em modo com transação própria; modo com tx externo deixa para o dono da tx)
  if (resultado.tipo === "criada" && resultado.__metadataParaPublicar) {
    publicarEventoComandaCriada(app, resultado.__metadataParaPublicar, hub);
  }

  return resultado;
}
