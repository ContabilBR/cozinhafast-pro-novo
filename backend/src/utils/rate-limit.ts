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

let jaFezDiagnostico = false;

export function getClientKey(request: any): string {
  // O tráfego passa por um proxy reverso da plataforma antes de chegar aqui.
  // O proxy confiável ADICIONA o IP real no FINAL de X-Forwarded-For.
  // Usamos TRUSTED_PROXY_HOPS para contar quantos proxys há antes de nós;
  // daí pegamos a entrada contada a partir do fim da lista.

  const trustedProxyHopsStr = (process.env.TRUSTED_PROXY_HOPS || "").trim();
  let trustedProxyHops = 1;
  if (/^[1-5]$/.test(trustedProxyHopsStr)) {
    trustedProxyHops = parseInt(trustedProxyHopsStr, 10);
  }

  const forwarded = request.headers["x-forwarded-for"];
  let xffEntries = 0;
  let chaveIgualAoIpDaConexao = true;

  if (forwarded) {
    // Se for array, juntar com ","
    let xffString = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;

    if (typeof xffString === "string" && xffString.length > 0) {
      const entries = xffString.split(",").map(e => e.trim()).filter(e => e.length > 0);
      xffEntries = entries.length;

      if (entries.length >= trustedProxyHops) {
        const index = entries.length - trustedProxyHops;
        const chaveCandidata = entries[index].slice(0, 100);

        if (chaveCandidata.length > 0) {
          chaveIgualAoIpDaConexao = false;
          try {
            if (!jaFezDiagnostico) {
              jaFezDiagnostico = true;
              request.log?.info(
                { xffEntries, trustedProxyHops, chaveIgualAoIpDaConexao },
                "rate-limit: diagnostico de IP do cliente"
              );
            }
          } catch (_) {
            // Ignorar qualquer erro de logging
          }
          return chaveCandidata;
        }
      }
    }
  }

  try {
    if (!jaFezDiagnostico) {
      jaFezDiagnostico = true;
      request.log?.info(
        { xffEntries, trustedProxyHops, chaveIgualAoIpDaConexao },
        "rate-limit: diagnostico de IP do cliente"
      );
    }
  } catch (_) {
    // Ignorar qualquer erro de logging
  }

  return String(request.ip || "").slice(0, 100);
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
