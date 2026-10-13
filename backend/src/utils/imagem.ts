/**
 * Regras para imagens enviadas ao armazenamento (fotos de prato).
 *
 * Por que existe: o tipo do arquivo antes era o que o cliente declarava no cabeçalho
 * (um "text/html" virava ".html"), o limite era de 10 MB, o caminho no armazenamento não
 * dizia de qual restaurante era o arquivo e o campo imagem_url aceitava qualquer texto
 * (inclusive "javascript:" e aspas que quebram o HTML do cardápio público).
 *
 * O que faz:
 *  - detectarImagem: descobre o tipo pelos primeiros bytes do arquivo (JPEG, PNG ou WebP);
 *    qualquer outra coisa (SVG, PDF, HTML, texto) devolve null.
 *  - chaveImagemPrato: monta o caminho no armazenamento com o restaurante dentro.
 *  - resolverImagemUrlEntrada: valida o imagem_url digitado (somente https://).
 */

export const MAX_IMAGEM_BYTES = 5 * 1024 * 1024; // 5 MB

export type TipoImagem = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tipo real da imagem, lido dos bytes. Não confia no Content-Type nem na extensão do cliente. */
export function detectarImagem(buffer: Buffer): TipoImagem | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(ASSINATURA_PNG)) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** Caminho no armazenamento: sempre dentro da pasta do restaurante dono do prato. */
export function chaveImagemPrato(restauranteId: string, pratoId: string, ext: string): string {
  return `restaurantes/${restauranteId}/pratos/${pratoId}-${Date.now()}.${ext}`;
}

const TAMANHO_MAX_URL = 2048;
// Espaços, aspas, menor/maior, crase e barra invertida nunca aparecem numa URL https válida
// (o navegador os codifica como %xx). Barrar aqui impede quebrar atributos HTML.
const CARACTERES_PROIBIDOS = /[\s"'<>`\\]/;

type ResultadoUrl = { ok: true; valor: string } | { ok: false; erro: string };

function validarImagemUrl(texto: string): ResultadoUrl {
  if (texto.length > TAMANHO_MAX_URL) {
    return { ok: false, erro: "imagem_url muito longa (máximo 2048 caracteres)" };
  }
  if (CARACTERES_PROIBIDOS.test(texto)) {
    return { ok: false, erro: "imagem_url contém caracteres inválidos" };
  }
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, erro: "imagem_url inválida" };
  }
  if (url.protocol !== "https:" || !url.hostname) {
    return { ok: false, erro: "imagem_url deve começar com https://" };
  }
  return { ok: true, valor: texto };
}

/**
 * Valida o imagem_url recebido em criar/editar prato.
 *  - vazio, nulo ou ausente: nada a gravar (valor undefined);
 *  - igual ao valor já salvo: aceita sem revalidar (o app reenvia a URL atual a cada edição,
 *    e ela pode ser a URL assinada de um upload antigo);
 *  - qualquer outro valor: precisa ser uma URL https:// válida.
 */
export function resolverImagemUrlEntrada(
  entrada: unknown,
  atual?: string | null
): { ok: true; valor: string | undefined } | { ok: false; erro: string } {
  if (entrada === undefined || entrada === null) return { ok: true, valor: undefined };
  if (typeof entrada !== "string") return { ok: false, erro: "imagem_url deve ser um texto" };
  const texto = entrada.trim();
  if (texto === "") return { ok: true, valor: undefined };
  if (atual && texto === atual) return { ok: true, valor: texto };
  const r = validarImagemUrl(texto);
  return r.ok ? { ok: true, valor: r.valor } : r;
}
