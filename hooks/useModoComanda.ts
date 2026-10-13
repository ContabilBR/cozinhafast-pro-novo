import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/utils/api";

export type ModoComanda = "mesa" | "individual";

// Último modo conhecido: só evita o "piscar" na tela. Nunca é a fonte da verdade:
// toda tela que usa o hook confirma o modo no servidor ao abrir.
let ultimoModo: ModoComanda | null = null;

async function buscarModo(): Promise<ModoComanda> {
  const res = await apiGet<any>("/api/restaurante/modo-comanda");
  const modo: ModoComanda = res?.modo_comanda === "individual" ? "individual" : "mesa";
  ultimoModo = modo;
  return modo;
}

export default function useModoComanda() {
  const [modo, setModo] = useState<ModoComanda>(ultimoModo ?? "mesa");
  const [loading, setLoading] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      setModo(await buscarModo());
    } catch {
      // Em caso de erro, assume o modo "mesa" (comportamento antigo) e esquece o último valor
      ultimoModo = null;
      setModo("mesa");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { modo, loading, recarregar };
}
