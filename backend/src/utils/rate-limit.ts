// Rate limit simples em memória, por chave (normalmente IP) e por rota.
// Não usa nenhuma dependência externa — só Map em memória do processo.
//
// Limitação conhecida: não é distribuído. Se o backend rodar em múltiplas
// instâncias, cada uma conta separadamente (ou seja, o limite efetivo vira
// max * número de instâncias). Suficiente para o volume atual de uma única
// instância; se isso mudar, migrar para um contador compartilhado (Redis, etc).

type RateLimitEntry = { count: number; resetAt: number };

const buckets = new Map<string, RateLimitEntry>();

// Limpa entradas expiradas periodicamente para não vazar memória aos poucos.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

export function getClientKey(request: any): string {
  // O tráfego passa por um proxy reverso da plataforma antes de chegar aqui,
  // então priorizamos X-Forwarded-For; se não vier preenchido, caímos para
  // request.ip (que nesse caso provavelmente é o IP do proxy, não do cliente
  // real — ainda assim melhor que nenhum limite).
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return request.ip;
}

/**
 * Retorna true se a requisição pode prosseguir. Se retornar false, já
 * respondeu 429 — o handler deve apenas dar `return` (mesmo padrão do
 * requireAuth em utils/auth.ts).
 */
export function checkRateLimit(
  request: any,
  reply: any,
  options: { routeKey: string; max: number; windowMs: number }
): boolean {
  const clientKey = getClientKey(request);
  const bucketKey = `${options.routeKey}:${clientKey}`;
  const now = Date.now();

  const entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
    return true;
  }

  if (entry.count >= options.max) {
    reply.code(429).send({ error: "Muitas requisições. Tente novamente em instantes." });
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Incrementa o contador de uma chave e retorna o total atual.
 * Não envia resposta — o chamador decide o que fazer.
 */
export function increment(
  bucketKey: string,
  windowMs: number
): number {
  const now = Date.now();
  const entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * Lê o contador atual sem incrementar. Retorna 0 se não existir ou expirado.
 */
export function getCount(bucketKey: string): number {
  const now = Date.now();
  const entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count;
}

/**
 * Zera o contador de uma chave (usado no login bem-sucedido).
 */
export function resetKey(bucketKey: string): void {
  buckets.delete(bucketKey);
}
