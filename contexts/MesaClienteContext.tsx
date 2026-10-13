import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { getMesaClienteConfig, MesaClienteConfig } from "@/utils/mesaCliente";

type MesaClienteContextType = {
  config: MesaClienteConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const MesaClienteContext = createContext<MesaClienteContextType | undefined>(undefined);

export function MesaClienteProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MesaClienteConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const cfg = await getMesaClienteConfig();
    setConfig(cfg);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <MesaClienteContext.Provider value={{ config, loading, refresh }}>
      {children}
    </MesaClienteContext.Provider>
  );
}

export function useMesaCliente() {
  const ctx = useContext(MesaClienteContext);
  if (!ctx) throw new Error("useMesaCliente must be used within MesaClienteProvider");
  return ctx;
}
