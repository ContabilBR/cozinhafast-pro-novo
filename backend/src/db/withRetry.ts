/**
 * Returns true if the error looks like a transient Postgres connection failure
 * that is safe to retry (the query never reached the DB, or the DB was waking up).
 */
export function isConnectionError(err: any): boolean {
  if (!err) return false;
  const patterns = [
    'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
    'connection terminated', 'connection closed', 'connection refused',
    'connection reset', 'terminating connection',
    'server closed the connection', 'socket hang up',
    'connect econnrefused', 'econnreset', 'timed out', 'timeout',
  ];
  const check = (s: string | undefined) =>
    !!s && patterns.some(p => s.toLowerCase().includes(p.toLowerCase()));

  if (check(err.message) || check(err.code)) return true;
  if (err.cause && (check(err.cause.message) || check(err.cause.code))) return true;
  return false;
}

/**
 * Retries `fn` up to `retries` more times on connection errors.
 * Each retry calls `fn()` fresh — never re-awaits a stale promise.
 */
export function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  return fn().catch(async (err) => {
    if (retries > 0 && isConnectionError(err)) {
      await new Promise(r => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs);
    }
    throw err;
  });
}

/**
 * Methods that are safe to retry automatically (idempotent reads).
 * INSERT / UPDATE / DELETE are intentionally excluded — retrying a write
 * after the DB already executed it could produce duplicates.
 */
const READ_ONLY_METHODS = new Set(['select', 'query', 'findMany', 'findFirst']);

/**
 * Wraps a Drizzle query builder so that when the promise is awaited,
 * the entire chain is replayed from scratch on each retry attempt.
 *
 * `recreateQuery` must return a *new* query builder (e.g. `() => originalSelect(...args)`).
 * `methodChain` accumulates the builder calls (.from, .where, .orderBy, …) for replay.
 */
export function wrapSelectWithRetry(
  queryBuilder: any,
  recreateQuery: () => any,
  methodChain: Array<{ method: string; args: any[] }> = [],
): any {
  return new Proxy(queryBuilder, {
    get(target, prop: string | symbol) {
      const value = target[prop];

      // When the promise is consumed (.then / .catch / .finally), execute with retry.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return function (...promiseArgs: any[]) {
          // Each withRetry attempt calls this fresh — new query, new promise.
          const executeQuery = () => {
            let qb = recreateQuery();
            for (const { method, args } of methodChain) {
              qb = qb[method](...args);
            }
            return qb;
          };
          const retryablePromise = withRetry(executeQuery);
          if (prop === 'then') {
            return retryablePromise.then(...promiseArgs);
          } else if (prop === 'catch') {
            return retryablePromise.catch(...promiseArgs);
          } else {
            return retryablePromise.finally(...promiseArgs);
          }
        };
      }

      // Builder methods (.from, .where, .orderBy, …) — record and continue chain.
      if (typeof value === 'function' && prop !== Symbol.toStringTag) {
        return function (...methodArgs: any[]) {
          const newChain = [...methodChain, { method: prop as string, args: methodArgs }];
          const nextBuilder = value.apply(target, methodArgs);
          return wrapSelectWithRetry(nextBuilder, recreateQuery, newChain);
        };
      }

      return value;
    },
  });
}

/**
 * Patches `db` in-place so that READ_ONLY_METHODS automatically retry on
 * connection errors. Write methods (insert, update, delete) are left untouched —
 * retrying a write risks duplicates if the DB already executed the statement.
 */
export function enableSelectRetry(db: any): void {
  for (const method of READ_ONLY_METHODS) {
    if (typeof db[method] !== 'function') continue;
    const original = db[method].bind(db);
    db[method] = function (...args: any[]) {
      const queryBuilder = original(...args);
      return wrapSelectWithRetry(queryBuilder, () => original(...args), []);
    };
  }
}
