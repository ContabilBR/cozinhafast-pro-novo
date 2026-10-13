import { eq, and, ne } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
// A tabela de autenticação (user/session) não é reexportada por schema.js
import { user as authUserTable, session as authSessionTable } from "../db/schema/auth-schema.js";

export function registerLgpdRoutes(app: App) {
  const db = app.db as any;

  // GET /api/lgpd/meus-dados — exportar todos os dados pessoais do usuário
  app.fastify.get("/api/lgpd/meus-dados", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      const restauranteId = requireTenant(authUser);

      const [usuario] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, authUser.id));
      const [rest] = await db.select({ nome: schema.restaurante.nome, cnpj: schema.restaurante.cnpj, plano: schema.restaurante.plano, createdAt: schema.restaurante.createdAt }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));

      const comandas = await db.select().from(schema.comandasHistorico).where(eq(schema.comandasHistorico.restauranteId, restauranteId));
      const pagamentos = await db.select().from(schema.pagamentosHistorico).where(eq(schema.pagamentosHistorico.restauranteId, restauranteId));
      const notas = await db.select().from(schema.notasFiscais).where(eq(schema.notasFiscais.restauranteId, restauranteId));

      const exportData = {
        exportado_em: new Date().toISOString(),
        usuario: usuario ? { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role, criado_em: usuario.createdAt } : null,
        restaurante: rest || null,
        historico_comandas: comandas.length,
        historico_pagamentos: pagamentos.length,
        notas_fiscais: notas.length,
        dados_completos: { comandas, pagamentos, notas },
      };

      reply.header("Content-Disposition", "attachment; filename=meus-dados-lgpd.json");
      return await reply.code(200).send(exportData);
    } catch (err) {
      app.logger.error({ error: (err as any).message }, "Erro ao exportar dados LGPD");
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // DELETE /api/lgpd/meus-dados — solicitar exclusão de dados pessoais
  app.fastify.delete("/api/lgpd/meus-dados", {
    schema: {
      description: "Request deletion of personal data (LGPD right to be forgotten)",
      tags: ["lgpd"],
      response: {
        200: {
          description: "Personal data anonymized successfully",
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
        400: {
          description: "Cannot delete user data (e.g., only admin)",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        409: {
          description: "Conflict — garçom still has open comandas",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        404: {
          description: "User not found",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        401: {
          description: "Unauthorized",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        500: {
          description: "Internal server error",
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      // Exclusão de conta: qualquer papel exclui a PRÓPRIA conta (exigência Apple/Google).
      // A rota só age sobre o usuário autenticado; ninguém exclui a conta de outra pessoa por aqui.
      const restauranteId = requireTenant(authUser);
      const mensagemSucesso =
        "Seus dados pessoais foram anonimizados e sua sessão encerrada. Você não conseguirá mais fazer login com esta conta.";

      // Try to find usuario in usuarios table, but handle Better Auth users gracefully
      const usuariosResult = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, authUser.id));
      const [usuario] = usuariosResult;

      // Garçom com comanda de mesa aberta sob o nome dele não pode excluir a conta
      // (a comanda ficaria com um garçom anonimizado). Delivery não conta.
      const papel = String(usuario?.role ?? authUser.role ?? "").toLowerCase();
      if (papel === "garcom") {
        const comandasAbertas = await db
          .select({ id: schema.comandas.id })
          .from(schema.comandas)
          .where(
            and(
              eq(schema.comandas.garcomId, authUser.id),
              eq(schema.comandas.restauranteId, restauranteId),
              eq(schema.comandas.status, "aberta"),
              ne(schema.comandas.tipo, "delivery")
            )
          )
          .limit(1);
        if (comandasAbertas.length > 0) {
          return await reply.code(409).send({
            error: "Você tem comandas abertas. Feche ou transfira todas antes de excluir sua conta.",
          });
        }
      }

      if (!usuario) {
        // Usuário só da autenticação (sem registro em usuarios): anonimiza de verdade, sem apagar linhas.
        app.logger.info({ userId: authUser.id, restauranteId }, "Better Auth user requesting LGPD deletion (no usuarios record)");
        await db.transaction(async (tx: any) => {
          await tx
            .update(authUserTable)
            .set({ name: "Usuário removido", email: "removido_" + Date.now() + "_" + authUser.id + "@excluido.lgpd" })
            .where(eq(authUserTable.id, authUser.id));
          await tx.update(schema.profiles).set({ name: "Usuário removido" }).where(eq(schema.profiles.userId, authUser.id));
          await tx.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, authUser.id.toString()));
          await tx.delete(authSessionTable).where(eq(authSessionTable.userId, authUser.id.toString()));
        });
        app.logger.info({ userId: authUser.id, restauranteId }, "Better Auth user anonymized via LGPD");
        return await reply.code(200).send({ success: true, message: mensagemSucesso });
      }

      if (usuario.role === "administrador") {
        // Conta só OUTROS administradores do restaurante que estejam ativos e não tenham sido
        // anonimizados (uma conta já excluída continua com o papel, mas não administra ninguém).
        const usuarios = await db
          .select({ id: schema.usuarios.id, role: schema.usuarios.role, ativo: schema.usuarios.ativo, email: schema.usuarios.email })
          .from(schema.usuarios)
          .where(eq(schema.usuarios.restauranteId, restauranteId));
        const outrosAdmins = usuarios.filter(
          (u: any) =>
            u.id !== authUser.id &&
            String(u.role ?? "").toLowerCase() === "administrador" &&
            u.ativo !== false &&
            !String(u.email ?? "").endsWith("@excluido.lgpd")
        );

        if (outrosAdmins.length === 0) {
          return await reply.code(400).send({
            error: "Você é o único administrador. A exclusão apagaria todo o restaurante. Transfira a administração para outro usuário antes ou solicite a exclusão completa do restaurante pelo suporte.",
          });
        }
      }

      await db.transaction(async (tx: any) => {
        await tx.update(schema.usuarios).set({ nome: "Usuário removido", email: "removido_" + Date.now() + "@excluido.lgpd", senhaHash: "REMOVED" }).where(eq(schema.usuarios.id, authUser.id));
        await tx.delete(schema.usuariosSession).where(eq(schema.usuariosSession.userId, authUser.id.toString()));
        await tx.delete(authSessionTable).where(eq(authSessionTable.userId, authUser.id.toString()));
      });

      app.logger.info({ userId: authUser.id, restauranteId }, "Dados pessoais anonimizados via LGPD");

      return await reply.code(200).send({ success: true, message: mensagemSucesso });
    } catch (err) {
      app.logger.error({ err: (err as any).message }, "Erro ao excluir dados LGPD");
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // GET /api/lgpd/politica — retornar política de privacidade
  app.fastify.get("/api/lgpd/politica", async (_request: FastifyRequest, reply: FastifyReply) => {
    return await reply.code(200).send({
      politica: {
        titulo: "Política de Privacidade - Cozinha Fast Pro",
        versao: "1.0",
        atualizado_em: "2026-07-28",
        resumo: "Coletamos apenas os dados necessários para operar o sistema de gestão do seu restaurante. Seus dados não são vendidos a terceiros. Você pode exportar ou solicitar a exclusão dos seus dados a qualquer momento.",
        seus_direitos: [
          "Acessar seus dados pessoais (GET /api/lgpd/meus-dados)",
          "Solicitar exclusão dos seus dados (DELETE /api/lgpd/meus-dados)",
          "Solicitar correção de dados incorretos (PUT /api/usuarios/:id)",
          "Revogar consentimento a qualquer momento",
        ],
        dados_coletados: [
          "Nome e email do usuário",
          "CNPJ e dados do restaurante",
          "Histórico de comandas e pagamentos",
          "Notas fiscais emitidas",
        ],
        contato_dpo: "privacidade@cozinhafastpro.com.br",
      },
    });
  });
}
