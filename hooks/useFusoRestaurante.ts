import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPut } from "@/utils/api";
import { FUSO_PADRAO, GRUPOS_FUSO, grupoDoFuso } from "@/utils/fusoHorario";

interface Estado {
  fuso: string;
  confirmado: boolean | null;
}

// Último valor conhecido: só evita o "piscar" na tela. Nunca é a fonte da verdade:
// toda tela que usa o hook confirma no servidor ao abrir.
let ultimo: Estado | null = null;

function lerResposta(res: any): Estado {
  const fuso = typeof res?.fuso_horario === "string" && res.fuso_horario ? res.fuso_horario : FUSO_PADRAO;
  const confirmado = typeof res?.fuso_horario_confirmado === "boolean" ? res.fuso_horario_confirmado : null;
  return { fuso, confirmado };
}

export default function useFusoRestaurante() {
  const [estado, setEstado] = useState<Estado>(ultimo ?? { fuso: FUSO_PADRAO, confirmado: null });
  const [loading, setLoading] = useState(true);

  const aplicar = useCallback((e: Estado) => {
    ultimo = e;
    setEstado(e);
  }, []);

  const recarregar = useCallback(async () => {
    try {
      aplicar(lerResposta(await apiGet<any>("/api/restaurante")));
    } catch {
      ultimo = null;
      setEstado({ fuso: FUSO_PADRAO, confirmado: null });
    } finally {
      setLoading(false);
    }
  }, [aplicar]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  // Em caso de erro, repassa para quem chamou mostrar a mensagem.
  const salvar = useCallback(
    async (nomeIana: string) => {
      const res = await apiPut<any>("/api/restaurante/fuso-horario", { fuso_horario: nomeIana });
      aplicar(lerResposta(res));
    },
    [aplicar]
  );

  const grupo = grupoDoFuso(estado.fuso) ?? GRUPOS_FUSO[0];

  return { fuso: estado.fuso, grupo, confirmado: estado.confirmado, loading, recarregar, salvar };
}
