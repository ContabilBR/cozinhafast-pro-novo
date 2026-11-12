import * as Linking from "expo-linking";
import type { ExecutorProvedor } from "./tipos";

// Stone (Deeplink): payment-app://pay. Os dados vêm do servidor (mesmos valores do bloco "terminal").
export const executorStone: ExecutorProvedor = {
  nomeExibicao: "Stone",
  mensagemAppNaoEncontrado: "Aplicativo de pagamento da Stone não encontrado neste aparelho. Use o registro manual.",
  abrir: async (t) => {
    const qs = new URLSearchParams();
    qs.set("return_scheme", "cozinhafastpro");
    qs.set("amount", String(t.amount_centavos));
    qs.set("editable_amount", "0");
    qs.set("transaction_type", String(t.transaction_type));
    if (t.installment_type) qs.set("installment_type", String(t.installment_type));
    if (t.installment_count) qs.set("installment_count", String(t.installment_count));
    qs.set("order_id", String(t.order_id));
    const url = "payment-app://pay?" + qs.toString();
    console.log("[Maquininha] Abrindo:", url);
    await Linking.openURL(url);
  },
};
