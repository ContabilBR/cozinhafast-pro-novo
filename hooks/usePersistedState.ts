import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Funciona como useState, mas persiste automaticamente no AsyncStorage
 * (com debounce) e restaura o valor salvo ao montar.
 * O terceiro item do retorno ("hidratado") indica se a restauração já terminou —
 * útil para não renderizar dados desatualizados antes da leitura do storage.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  debounceMs = 400
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(defaultValue);
  const [hidratado, setHidratado] = useState(false);
  const valueRef = useRef(state);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = state;
  }, [state]);

  useEffect(() => {
    let montado = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (montado && raw != null) {
          const restaurado = JSON.parse(raw);
          valueRef.current = restaurado;
          setState(restaurado);
        }
      })
      .catch((err) => console.warn(`[usePersistedState] Falha ao restaurar "${key}":`, err))
      .finally(() => {
        if (montado) setHidratado(true);
      });
    return () => {
      montado = false;
    };
  }, [key]);

  const agendarPersistencia = useCallback(
    (value: T) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        AsyncStorage.setItem(key, JSON.stringify(value)).catch((err) =>
          console.warn(`[usePersistedState] Falha ao salvar "${key}":`, err)
        );
      }, debounceMs);
    },
    [key, debounceMs]
  );

  const setPersistedState = useCallback(
    (value: T | ((prev: T) => T)) => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(valueRef.current) : value;
      valueRef.current = next;
      setState(next);
      if (hidratado) agendarPersistencia(next); // só persiste após restaurar, pra não sobrescrever com o valor padrão
    },
    [hidratado, agendarPersistencia]
  );

  return [state, setPersistedState, hidratado];
}
