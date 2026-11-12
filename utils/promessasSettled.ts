/**
 * Equivalente seguro de Promise.allSettled (que não existe no Hermes do app).
 * Usa só then/catch em cada promessa e Promise.all por cima, e devolve sempre a mesma forma de resposta.
 */
export type ResultadoPromessa<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

export function aguardarTodas<T extends readonly unknown[] | []>(
  promessas: T,
): Promise<{ -readonly [K in keyof T]: ResultadoPromessa<Awaited<T[K]>> }> {
  const lista = Array.prototype.slice.call(promessas) as unknown[];
  const resultados = lista.map((p) =>
    Promise.resolve(p)
      .then((value): ResultadoPromessa<unknown> => ({ status: 'fulfilled', value }))
      .catch((reason: unknown): ResultadoPromessa<unknown> => ({ status: 'rejected', reason })),
  );
  return Promise.all(resultados) as Promise<{ -readonly [K in keyof T]: ResultadoPromessa<Awaited<T[K]>> }>;
}
