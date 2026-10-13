/**
 * NFC-e — extracao das URLs fiscais retornadas pela Focus e geracao do QR Code.
 *
 * A Focus nao documenta com clareza o nome do campo do QR Code no retorno
 * da NFC-e, entao a leitura testa nomes candidatos em cascata e registra
 * as chaves recebidas quando nenhum casa, para diagnostico no log.
 */

import QRCode from "qrcode";

const CAMPOS_QRCODE = [
  "qrcode_url",
  "qrcode",
  "url_qrcode",
  "qr_code_url",
  "qr_code",
  "qrCode",
  "caminho_qrcode",
];

const CAMPOS_CONSULTA = [
  "url_consulta_nf",
  "url_consulta_nfce",
  "url_consulta",
  "caminho_consulta",
];

function primeiroValorTexto(fonte: any, campos: string[]): string | null {
  if (!fonte || typeof fonte !== "object") return null;
  for (const campo of campos) {
    const valor = fonte[campo];
    if (typeof valor === "string" && valor.trim().length > 0) {
      return valor.trim();
    }
  }
  return null;
}

/**
 * Procura as URLs no nivel raiz e em um nivel aninhado comum.
 * Retorna tambem as chaves disponiveis quando nada e encontrado,
 * para que o chamador possa logar e a gente descubra o nome real.
 */
export function extrairUrlsFiscais(resultado: any): {
  qrcodeUrl: string | null;
  urlConsulta: string | null;
  chavesDisponiveis: string[];
} {
  const candidatos: any[] = [resultado];
  if (resultado && typeof resultado === "object") {
    for (const aninhado of ["nfe", "nfce", "dados", "data"]) {
      if (resultado[aninhado] && typeof resultado[aninhado] === "object") {
        candidatos.push(resultado[aninhado]);
      }
    }
  }

  let qrcodeUrl: string | null = null;
  let urlConsulta: string | null = null;

  for (const fonte of candidatos) {
    if (!qrcodeUrl) qrcodeUrl = primeiroValorTexto(fonte, CAMPOS_QRCODE);
    if (!urlConsulta) urlConsulta = primeiroValorTexto(fonte, CAMPOS_CONSULTA);
  }

  const chavesDisponiveis =
    resultado && typeof resultado === "object" ? Object.keys(resultado) : [];

  return { qrcodeUrl, urlConsulta, chavesDisponiveis };
}

/**
 * Gera o QR Code como PNG base64 puro (sem o prefixo "data:image/png;base64,"),
 * seguindo o mesmo padrao que a Asaas usa no Pix — o frontend concatena o prefixo.
 * Retorna null em caso de falha: QR ausente nao deve derrubar a emissao.
 */
export async function gerarQrCodeBase64(
  url: string | null | undefined,
  largura: number = 220
): Promise<string | null> {
  if (!url || typeof url !== "string" || url.trim().length === 0) return null;
  try {
    const dataUrl = await QRCode.toDataURL(url.trim(), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: largura,
    });
    const partes = dataUrl.split(",");
    return partes.length > 1 ? partes[1] : null;
  } catch {
    return null;
  }
}

/** Formata a chave de 44 digitos em grupos de 4, como exige o DANFE NFC-e. */
export function formatarChaveAcesso(chave: string | null | undefined): string | null {
  if (!chave) return null;
  const limpa = chave.replace(/[^0-9]/g, "");
  if (limpa.length !== 44) return chave;
  return (limpa.match(/.{1,4}/g) ?? []).join(" ");
}
