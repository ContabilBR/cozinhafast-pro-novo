import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";

// Aviso por e-mail para a equipe quando um usuário envia uma mensagem de contato.
// A mensagem já está gravada quando este serviço roda: o e-mail é um extra e NUNCA pode
// lançar erro nem atrasar a resposta. O resultado é gravado na própria mensagem.
// Nada de usuário SMTP, senha ou texto da mensagem vai para o log.

const DESTINO_PADRAO = "contato@cozinhafastpro.com.br";
const TEMPO_LIMITE_MS = 10_000;
const ERRO_NAO_CONFIGURADO = "Envio de e-mail não configurado";

const ROTULO_TIPO: Record<string, string> = {
  problema: "Problema",
  sugestao: "Sugestão",
  duvida: "Dúvida",
};

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type DbLike = {
  update: (tabela: typeof schema.mensagensContato) => {
    set: (valores: Record<string, unknown>) => { where: (cond: unknown) => PromiseLike<unknown> };
  };
};

export type DadosAvisoContato = {
  id: string;
  tipo: string;
  restauranteNome: string;
  usuarioNome: string;
  usuarioPapel: string;
  usuarioEmail: string | null; // vem do cadastro do usuário; nunca vai para o log
  versaoApp: string | null;
  plataforma: string | null;
  telaOrigem: string | null;
  mensagem: string;
  criadaEm: Date;
};

let avisouNaoConfigurado = false;

// Lê um segredo no momento do envio (nunca no topo do módulo, o valor ficaria em cache)
function lerSegredo(nome: string): string {
  const valor = process.env[nome] || process.env[`SPECULAR_SECRET_${nome}`] || process.env[`SECRET_${nome}`];
  return (valor ?? "").trim();
}

function tipoDoErro(err: unknown): string {
  const e = err as { code?: unknown; responseCode?: unknown; name?: unknown } | null;
  const partes: string[] = [];
  if (e && typeof e.code === "string") partes.push(e.code);
  if (e && typeof e.responseCode === "number") partes.push(String(e.responseCode));
  if (partes.length === 0 && e && typeof e.name === "string") partes.push(e.name);
  const tipo = partes.join(" ").replace(/[^A-Za-z0-9_. -]/g, "").slice(0, 60) || "desconhecido";
  return `Falha ao enviar e-mail (${tipo})`.slice(0, 200);
}

// Aceita só um endereço simples e seguro (sem espaços, quebras de linha ou vírgulas)
function emailValido(valor: string | null | undefined): valor is string {
  if (typeof valor !== "string") return false;
  const e = valor.trim();
  return e.length > 0 && e.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(e);
}

function montarAssunto(tipo: string, restauranteNome: string): string {
  const rotulo = ROTULO_TIPO[tipo] ?? tipo;
  const assunto = `[Cozinha Fast Pro] ${rotulo}: ${restauranteNome}`.replace(/[\r\n]+/g, " ").trim();
  return assunto.slice(0, 100);
}

function dataHoraBrasilia(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(data);
}

function montarCorpo(d: DadosAvisoContato): string {
  return [
    `Tipo: ${ROTULO_TIPO[d.tipo] ?? d.tipo}`,
    `Restaurante: ${d.restauranteNome}`,
    `Usuário: ${d.usuarioNome} (${d.usuarioPapel})`,
    ...(emailValido(d.usuarioEmail) ? [`E-mail do usuário: ${d.usuarioEmail.trim()}`] : []),
    `Versão do app: ${d.versaoApp ?? "não informada"}`,
    `Plataforma: ${d.plataforma ?? "não informada"}`,
    `Tela de origem: ${d.telaOrigem ?? "não informada"}`,
    `Enviada em: ${dataHoraBrasilia(d.criadaEm)} (horário de Brasília)`,
    `Identificador da mensagem: ${d.id}`,
    "",
    "Mensagem:",
    d.mensagem,
  ].join("\n");
}

async function enviar(d: DadosAvisoContato, usuario: string, senha: string): Promise<void> {
  const remetente = lerSegredo("CONTATO_EMAIL_REMETENTE") || usuario;
  const destino = lerSegredo("CONTATO_EMAIL_DESTINO") || DESTINO_PADRAO;

  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: usuario, pass: senha },
    connectionTimeout: TEMPO_LIMITE_MS,
    greetingTimeout: TEMPO_LIMITE_MS,
    socketTimeout: TEMPO_LIMITE_MS,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), TEMPO_LIMITE_MS);
  });
  try {
    await Promise.race([
      transporte.sendMail({
        from: remetente,
        to: destino,
        ...(emailValido(d.usuarioEmail) ? { replyTo: d.usuarioEmail.trim() } : {}),
        subject: montarAssunto(d.tipo, d.restauranteNome),
        text: montarCorpo(d),
      }),
      limite,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    try { transporte.close(); } catch { /* ignora */ }
  }
}

async function gravarResultado(db: DbLike, id: string, enviado: boolean, erro: string | null): Promise<void> {
  await db
    .update(schema.mensagensContato)
    .set({ emailAvisoEnviado: enviado, emailAvisoErro: erro, updatedAt: new Date() })
    .where(eq(schema.mensagensContato.id, id));
}

// Dispara o aviso. Nunca lança: qualquer falha vira texto curto em email_aviso_erro.
// Quem chama não deve esperar (use `void avisarMensagemContato(...)`).
export async function avisarMensagemContato(db: DbLike, logger: LoggerLike, dados: DadosAvisoContato): Promise<void> {
  try {
    const usuario = lerSegredo("SMTP_USUARIO");
    const senha = lerSegredo("SMTP_SENHA");

    if (!usuario || !senha) {
      if (!avisouNaoConfigurado) {
        avisouNaoConfigurado = true;
        logger.warn({}, "Aviso de contato por e-mail não configurado (faltam segredos SMTP)");
      }
      await gravarResultado(db, dados.id, false, ERRO_NAO_CONFIGURADO);
      return;
    }

    try {
      await enviar(dados, usuario, senha);
    } catch (err) {
      const texto = tipoDoErro(err);
      logger.warn({ mensagemId: dados.id, erro: texto }, "Falha ao enviar aviso de contato por e-mail");
      await gravarResultado(db, dados.id, false, texto);
      return;
    }

    await gravarResultado(db, dados.id, true, null);
  } catch (err) {
    // Última barreira: nem o registro do resultado pode escapar
    try {
      logger.error({ mensagemId: dados.id, erro: tipoDoErro(err) }, "Falha ao registrar resultado do aviso de contato");
    } catch { /* ignora */ }
  }
}
