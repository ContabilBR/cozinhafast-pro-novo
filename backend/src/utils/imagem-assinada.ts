/**
 * Renovação automática das URLs assinadas das fotos de prato.
 *
 * Problema: ao enviar uma foto, o backend grava em pratos.imagem_url a URL ASSINADA do
 * armazenamento (S3). Essa URL vale só 900 segundos (15 minutos, parâmetro X-Amz-Expires=900).
 * Depois disso o arquivo continua no armazenamento, mas o link salvo no banco deixa de
 * funcionar, e a foto some do app e do cardápio público.
 *
 * Solução: este filtro olha toda resposta de texto/JSON antes de ela sair. Se encontrar
 * uma URL assinada do nosso armazenamento, descobre o caminho do arquivo dentro dela e pede
 * uma URL nova (app.storage.getSignedUrl). O banco não muda, as rotas não mudam, e vale para
 * todas as telas que mostram foto de prato (cardápio, comandas, pedidos, cardápio público).
 *
 *  - URLs que não são do nosso armazenamento (ex.: picsum.photos) passam sem alteração.
 *  - Se não for possível gerar a URL nova, a URL original é mantida (nunca quebra a resposta).
 *  - URLs novas ficam em memória por 10 minutos, para não assinar a mesma foto a cada requisição.
 */
import type { App } from "../index.js";

// https://specular-app-storage-<...>.amazonaws.com/proj_<id>/branch_<id>/<caminho do arquivo>?<assinatura>
const URL_ASSINADA =
  /https:\/\/specular-app-storage[A-Za-z0-9.-]*\.amazonaws\.com\/proj_[A-Za-z0-9]+\/branch_[A-Za-z0-9]+\/[^"\s?\\]+\?[^"\s\\]*/g;
const PARTES_URL = /\/proj_[A-Za-z0-9]+\/branch_[A-Za-z0-9]+\/([^?]+)\?/;

const VALIDADE_CACHE_MS = 10 * 60 * 1000; // URLs duram 15 min; reutilizar por 10 garante folga
const CACHE_MAX_ENTRADAS = 500;

const cache = new Map<string, { url: string; ate: number }>();

/** Caminho do arquivo no armazenamento, extraído da URL assinada. Null se não for reconhecida. */
export function chaveDaUrlAssinada(url: string): string | null {
  const m = PARTES_URL.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

async function urlRenovada(app: App, chave: string): Promise<string | null> {
  const agora = Date.now();
  const emCache = cache.get(chave);
  if (emCache && emCache.ate > agora) return emCache.url;

  try {
    const { url } = await app.storage.getSignedUrl(chave);
    if (!url || typeof url !== "string") return null;

    if (!url.includes(`/${chave}`)) {
      // Se isso aparecer no log, o caminho extraído não é o que o armazenamento espera.
      app.logger.warn({ chave }, "Imagem: URL renovada não contém o caminho esperado");
    }

    if (cache.size >= CACHE_MAX_ENTRADAS) {
      for (const [k, v] of cache) {
        if (v.ate <= agora) cache.delete(k);
      }
      if (cache.size >= CACHE_MAX_ENTRADAS) cache.clear();
    }
    cache.set(chave, { url, ate: agora + VALIDADE_CACHE_MS });
    return url;
  } catch (err) {
    app.logger.warn({ err, chave }, "Imagem: falha ao renovar URL assinada (mantida a original)");
    return null;
  }
}

/** Troca, dentro de um texto, cada URL assinada antiga por uma nova. */
export async function renovarUrlsNoTexto(app: App, texto: string): Promise<string> {
  const encontradas = texto.match(URL_ASSINADA);
  if (!encontradas) return texto;

  const mapa = new Map<string, string>();
  for (const original of new Set(encontradas)) {
    const chave = chaveDaUrlAssinada(original);
    if (!chave) continue;
    const nova = await urlRenovada(app, chave);
    if (nova) mapa.set(original, nova);
  }
  if (mapa.size === 0) return texto;

  return texto.replace(URL_ASSINADA, (original) => mapa.get(original) ?? original);
}

/** Registra o filtro. Chamar ANTES de registrar as rotas. */
export function registerRenovacaoDeImagens(app: App) {
  app.fastify.addHook("onSend", async (_request: any, reply: any, payload: any) => {
    // Só respostas em texto (JSON gerado pelas rotas). Arquivos e streams passam direto.
    if (typeof payload !== "string") return payload;
    if (payload.indexOf(".amazonaws.com/proj_") === -1) return payload;

    const tipo = String(reply.getHeader("content-type") || "");
    if (!tipo.includes("json") && !tipo.includes("text/")) return payload;

    try {
      const novo = await renovarUrlsNoTexto(app, payload);
      if (novo !== payload && reply.hasHeader("content-length")) {
        reply.header("content-length", String(Buffer.byteLength(novo)));
      }
      return novo;
    } catch (err) {
      app.logger.warn({ err }, "Imagem: erro ao renovar URLs (resposta enviada sem alteração)");
      return payload;
    }
  });
}
