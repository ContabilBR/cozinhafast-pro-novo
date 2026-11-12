import { eq, and, desc } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { increment } from "../utils/rate-limit.js";
import * as schema from "../db/schema/schema.js";
import { avisarMensagemContato } from "../services/aviso-contato.js";

// Mensagens de contato (problema, sugestão ou dúvida) enviadas por quem está logado no app.
// Restaurante, usuário, nome, papel e nome do restaurante vêm SEMPRE da sessão e do banco, nunca do
// corpo da requisição. O texto da mensagem nunca vai para o log (só o id).

const PAPEIS_CONTATO = ["garcom", "cozinheiro", "gerente", "administrador", "admin"];
const TIPOS = ["problema", "sugestao", "duvida"] as const;
const PLATAFORMAS = ["android", "ios"] as const;
const MIN_MENSAGEM = 10;
const MAX_MENSAGEM = 2000;
const LIMITE_ENVIOS = 5;
const JANELA_MS = 60 * 60 * 1000;
const LIMITE_LISTA = 20;

type EnviarBody = {
  tipo?: unknown;
  mensagem?: unknown;
  versao_app?: unknown;
  plataforma?: unknown;
  tela?: unknown;
};

export function registerMensagensContatoRoutes(app: App) {
  app.fastify.post<{ Body: EnviarBody }>(
    "/api/mensagens-contato",
    async (request: FastifyRequest<{ Body: EnviarBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_CONTATO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const body = (request.body ?? {}) as EnviarBody;

        if (typeof body.tipo !== "string" || !(TIPOS as readonly string[]).includes(body.tipo)) {
          return await reply.code(400).send({ error: "Tipo inválido. Escolha problema, sugestão ou dúvida." });
        }
        if (typeof body.mensagem !== "string") {
          return await reply.code(400).send({ error: "Escreva a mensagem." });
        }
        const mensagem = body.mensagem.trim();
        if (mensagem.length < MIN_MENSAGEM) {
          return await reply.code(400).send({ error: `A mensagem precisa ter pelo menos ${MIN_MENSAGEM} caracteres.` });
        }
        if (mensagem.length > MAX_MENSAGEM) {
          return await reply.code(400).send({ error: `A mensagem pode ter no máximo ${MAX_MENSAGEM} caracteres.` });
        }

        let versaoApp: string | null = null;
        if (body.versao_app !== undefined && body.versao_app !== null) {
          if (typeof body.versao_app !== "string" || body.versao_app.length > 20) {
            return await reply.code(400).send({ error: "A versão do app pode ter no máximo 20 caracteres." });
          }
          versaoApp = body.versao_app.trim() || null;
        }

        let plataforma: string | null = null;
        if (body.plataforma !== undefined && body.plataforma !== null) {
          if (typeof body.plataforma !== "string" || !(PLATAFORMAS as readonly string[]).includes(body.plataforma)) {
            return await reply.code(400).send({ error: "Plataforma inválida. Use android ou ios." });
          }
          plataforma = body.plataforma;
        }

        let tela: string | null = null;
        if (body.tela !== undefined && body.tela !== null) {
          if (typeof body.tela !== "string" || body.tela.length > 80) {
            return await reply.code(400).send({ error: "O nome da tela pode ter no máximo 80 caracteres." });
          }
          tela = body.tela.trim() || null;
        }

        // Nome, papel e restaurante vêm do banco; o usuário precisa existir na tabela de usuários
        const usuarios = await app.db
          .select({ id: schema.usuarios.id, nome: schema.usuarios.nome, role: schema.usuarios.role })
          .from(schema.usuarios)
          .where(and(eq(schema.usuarios.id, authUser.id), eq(schema.usuarios.restauranteId, restauranteId)))
          .limit(1);
        if (usuarios.length === 0) {
          return await reply.code(403).send({ error: "Não foi possível identificar seu usuário neste restaurante." });
        }
        const restaurantes = await app.db
          .select({ nome: schema.restaurante.nome })
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, restauranteId))
          .limit(1);
        if (restaurantes.length === 0) {
          return await reply.code(403).send({ error: "Restaurante não encontrado." });
        }

        // Limite: 5 envios por hora por usuário (só conta pedidos válidos)
        const total = increment(`mensagens-contato:${restauranteId}:${authUser.id}`, JANELA_MS);
        if (total > LIMITE_ENVIOS) {
          return await reply.code(429).send({
            error: "Você já enviou muitas mensagens nesta hora. Tente novamente mais tarde.",
          });
        }

        const [criada] = await app.db
          .insert(schema.mensagensContato)
          .values({
            restauranteId,
            usuarioId: usuarios[0].id,
            usuarioNome: usuarios[0].nome,
            usuarioPapel: usuarios[0].role,
            restauranteNome: restaurantes[0].nome,
            tipo: body.tipo,
            mensagem,
            versaoApp,
            plataforma,
            telaOrigem: tela,
          })
          .returning({
            id: schema.mensagensContato.id,
            status: schema.mensagensContato.status,
            createdAt: schema.mensagensContato.createdAt,
          });

        app.logger.info({ mensagemId: criada.id, restauranteId }, "Mensagem de contato recebida");
        // Aviso por e-mail para a equipe: não espera o resultado e nunca deixa uma falha escapar.
        // O resultado é gravado na própria mensagem (email_aviso_enviado / email_aviso_erro).
        void avisarMensagemContato(app.db as any, app.logger, {
          id: criada.id,
          tipo: body.tipo,
          restauranteNome: restaurantes[0].nome,
          usuarioNome: usuarios[0].nome,
          usuarioPapel: usuarios[0].role,
          versaoApp,
          plataforma,
          telaOrigem: tela,
          mensagem,
          criadaEm: criada.createdAt,
        }).catch(() => undefined);

        return await reply.code(201).send({ id: criada.id, status: criada.status });
      } catch (error) {
        app.logger.error({ err: error }, "Falha ao registrar mensagem de contato");
        return await reply.code(500).send({ error: "Não foi possível enviar a mensagem. Tente novamente em instantes." });
      }
    }
  );

  app.fastify.get(
    "/api/mensagens-contato/minhas",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_CONTATO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const linhas = await app.db
          .select({
            id: schema.mensagensContato.id,
            tipo: schema.mensagensContato.tipo,
            mensagem: schema.mensagensContato.mensagem,
            status: schema.mensagensContato.status,
            createdAt: schema.mensagensContato.createdAt,
          })
          .from(schema.mensagensContato)
          .where(and(
            eq(schema.mensagensContato.restauranteId, restauranteId),
            eq(schema.mensagensContato.usuarioId, authUser.id),
          ))
          .orderBy(desc(schema.mensagensContato.createdAt))
          .limit(LIMITE_LISTA);

        return await reply.send(linhas.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          mensagem: m.mensagem,
          status: m.status,
          created_at: m.createdAt,
        })));
      } catch (error) {
        app.logger.error({ err: error }, "Falha ao listar mensagens de contato");
        return await reply.code(500).send({ error: "Não foi possível carregar suas mensagens." });
      }
    }
  );
}
