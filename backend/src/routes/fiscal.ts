import { eq, desc, or, and } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { focusRequest } from "../services/focus.js";

function formatBrazilTime(date: Date): { iso: string; ymd: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo'
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;

  const ymd = `${year}-${month}-${day}`;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;

  return { iso, ymd };
}

export function registerFiscalRoutes(app: App) {
  const db = app.db as any;

  const errorResponse = {
    type: "object",
    properties: {
      error: { type: "string" },
    },
  };

  const notaFiscalResponse = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      comandaHistoricoId: { type: "string", format: "uuid", nullable: true },
      referenciaFocus: { type: "string" },
      status: { type: "string", enum: ["processando", "autorizada", "rejeitada", "cancelada", "erro"] },
      restauranteId: { type: "string" },
      chaveAcesso: { type: "string", nullable: true },
      numeroNota: { type: "integer", nullable: true },
      protocolo: { type: "string", nullable: true },
      mensagemSefaz: { type: "string", nullable: true },
      danfeUrl: { type: "string", nullable: true },
      xmlUrl: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  };

  // POST /api/fiscal/nfsen — Emitir NFSe Nacional
  app.fastify.post(
    "/api/fiscal/nfsen",
    {
      schema: {
        description: "Emit NFSe Nacional (National Service Invoice)",
        tags: ["fiscal"],
        body: {
          type: "object",
          required: ["descricao_servico", "valor_servico"],
          properties: {
            comanda_historico_id: { type: "string", format: "uuid" },
            descricao_servico: { type: "string", description: "Service description" },
            valor_servico: { type: "number", description: "Service amount" },
            cnpj_tomador: { type: "string", description: "Customer CNPJ (for businesses)" },
            cpf_tomador: { type: "string", description: "Customer CPF (for individuals)" },
            razao_social_tomador: { type: "string", description: "Customer legal name" },
            email_tomador: { type: "string", format: "email" },
            telefone_tomador: { type: "string" },
            codigo_tributacao_municipal_iss: { type: "string" },
          },
        },
        response: {
          200: {
            description: "NFSe created successfully",
            ...notaFiscalResponse,
          },
          400: {
            description: "Invalid request",
            ...errorResponse,
          },
          404: {
            description: "Restaurant not found",
            ...errorResponse,
          },
          502: {
            description: "Error communicating with Focus API",
            ...errorResponse,
          },
          500: {
            description: "Internal server error",
            ...errorResponse,
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: {
      comanda_historico_id?: string;
      descricao_servico: string;
      valor_servico: number;
      cnpj_tomador?: string;
      cpf_tomador?: string;
      razao_social_tomador?: string;
      email_tomador?: string;
      telefone_tomador?: string;
      codigo_tributacao_municipal_iss?: string;
    } }>, reply: FastifyReply) => {
      try {
        app.logger.info({ bodyKeys: Object.keys(request.body || {}) }, "POST /api/fiscal/nfsen started");
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const rest = await db.select().from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest.length) {
          app.logger.warn({ restauranteId }, "Restaurant not found");
          return await reply.code(404).send({ error: "Restaurante não encontrado" });
        }
        const restaurante = rest[0];
        if (!restaurante.cnpj) {
          app.logger.warn({ restauranteId }, "Restaurant CNPJ not configured");
          return await reply.code(400).send({ error: "CNPJ do restaurante não cadastrado" });
        }

        const {
          descricao_servico,
          valor_servico,
          comanda_historico_id,
          cnpj_tomador,
          cpf_tomador,
          razao_social_tomador,
          email_tomador,
          telefone_tomador,
          codigo_tributacao_municipal_iss
        } = request.body;

        if (!descricao_servico || !valor_servico) {
          app.logger.warn({ descricao_servico, valor_servico }, "Missing required fields");
          return await reply.code(400).send({ error: "descricao_servico e valor_servico são obrigatórios" });
        }

        const ref = "nfsen-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        const cnpjLimpo = restaurante.cnpj.replace(/[.\-\/]/g, "");

        const brazilTime = formatBrazilTime(new Date());

        const nfsenPayload: any = {
          data_emissao: brazilTime.iso,
          data_competencia: brazilTime.ymd,
          codigo_municipio_emissora: 3304557,
          cnpj_prestador: cnpjLimpo,
          codigo_opcao_simples_nacional: 1,
          regime_especial_tributacao: 0,
          codigo_municipio_prestacao: 3304557,
          codigo_tributacao_nacional_iss: "070101",
          codigo_nbs: "109019900",
          descricao_servico: descricao_servico,
          valor_servico: valor_servico,
          tributacao_iss: 1,
          tipo_retencao_iss: 1,
          situacao_tributaria_pis_cofins: "00",
          percentual_total_tributos_federais: "3.25",
          percentual_total_tributos_estaduais: "0.00",
          percentual_total_tributos_municipais: "5.00",
          indicador_total_tributacao: null
        };

        if (codigo_tributacao_municipal_iss) {
          nfsenPayload.codigo_tributacao_municipal_iss = codigo_tributacao_municipal_iss;
        }

        if (cnpj_tomador) {
          nfsenPayload.cnpj_tomador = cnpj_tomador.replace(/[.\-\/]/g, "");
        } else if (cpf_tomador) {
          nfsenPayload.cpf_tomador = cpf_tomador.replace(/[.\-]/g, "");
        }
        if (razao_social_tomador) nfsenPayload.razao_social_tomador = razao_social_tomador;
        if (email_tomador) nfsenPayload.email_tomador = email_tomador;
        if (telefone_tomador) nfsenPayload.telefone_tomador = telefone_tomador;

        if (nfsenPayload.cnpj_tomador || nfsenPayload.cpf_tomador) {
          nfsenPayload.codigo_municipio_tomador = 3304557;
          nfsenPayload.cep_tomador = "20040020";
          nfsenPayload.logradouro_tomador = razao_social_tomador ? "A INFORMAR" : "CONSUMIDOR NAO IDENTIFICADO";
          nfsenPayload.numero_tomador = "SN";
          nfsenPayload.bairro_tomador = "CENTRO";
        }

        app.logger.debug({ ref, restauranteCnpj: cnpjLimpo }, "Inserting nota fiscal into database");

        const [notaFiscal] = await db.insert(schema.notasFiscais).values({
          comandaHistoricoId: comanda_historico_id || null,
          referenciaFocus: ref,
          status: "processando",
          restauranteId,
        }).returning();

        try {
          const resultado = await focusRequest("POST", "/nfsen?ref=" + ref, nfsenPayload);
          const updateData: any = {};

          if (resultado.status === "autorizado" || resultado._httpStatus === 200) {
            updateData.status = "autorizada";
            updateData.chaveAcesso = resultado.codigo_verificacao || null;
            updateData.numeroNota = resultado.numero ? parseInt(resultado.numero) : null;
            updateData.protocolo = resultado.protocolo || null;
            updateData.mensagemSefaz = resultado.mensagem || "NFSe autorizada";
          } else if (resultado._httpStatus === 202 || resultado.status === "processando_autorizacao") {
            updateData.status = "processando";
            updateData.mensagemSefaz = "Aguardando processamento da prefeitura";
          } else if (resultado.erros || resultado.status === "erro_autorizacao") {
            updateData.status = "rejeitada";
            updateData.mensagemSefaz = JSON.stringify(resultado.erros || resultado.mensagem || resultado);
          } else {
            updateData.status = "processando";
            updateData.mensagemSefaz = JSON.stringify(resultado);
          }

          await db.update(schema.notasFiscais).set(updateData).where(eq(schema.notasFiscais.id, notaFiscal.id));
          app.logger.info({ notaId: notaFiscal.id, status: updateData.status }, "NFSe created successfully");
          return await reply.code(200).send({ ...notaFiscal, ...updateData, ref });

        } catch (focusErr: any) {
          await db.update(schema.notasFiscais).set({
            status: "erro",
            mensagemSefaz: focusErr.message
          }).where(eq(schema.notasFiscais.id, notaFiscal.id));
          app.logger.error({ err: focusErr, notaId: notaFiscal.id }, "Focus API error");
          return await reply.code(502).send({ error: "Erro ao comunicar com Focus NFe", detail: focusErr.message, cnpjUsado: cnpjLimpo, ref, stack: focusErr.stack?.slice(0, 300) });
        }

      } catch (err: any) {
        app.logger.error({ err }, "Failed to create NFSe");
        return await reply.code(500).send({ error: err.message, type: "outer_catch", stack: err.stack?.slice(0, 300) });
      }
    }
  );

  // GET /api/fiscal/nfsen/:ref — Consultar NFSe Nacional
  app.fastify.get(
    "/api/fiscal/nfsen/:ref",
    {
      schema: {
        description: "Query NFSe Nacional status",
        tags: ["fiscal"],
        params: {
          type: "object",
          required: ["ref"],
          properties: {
            ref: { type: "string", description: "NFSe reference" },
          },
        },
        response: {
          200: {
            description: "NFSe status retrieved successfully",
            ...notaFiscalResponse,
          },
          404: {
            description: "NFSe not found",
            ...errorResponse,
          },
          500: {
            description: "Internal server error",
            ...errorResponse,
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { ref: string } }>, reply: FastifyReply) => {
      try {
        app.logger.info({ ref: request.params.ref }, "GET /api/fiscal/nfsen/:ref started");
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        const { ref } = request.params;

        const [nota] = await db.select().from(schema.notasFiscais)
          .where(eq(schema.notasFiscais.referenciaFocus, ref));
        if (!nota || nota.restauranteId !== restauranteId) {
          app.logger.warn({ ref, restauranteId }, "NFSe not found");
          return await reply.code(404).send({ error: "Nota não encontrada" });
        }

        try {
          const consulta = await focusRequest("GET", "/nfsen/" + ref);
          const updateData: any = {};

          if (consulta.status === "autorizado") {
            updateData.status = "autorizada";
            updateData.chaveAcesso = consulta.codigo_verificacao || nota.chaveAcesso;
            updateData.numeroNota = consulta.numero ? parseInt(consulta.numero) : nota.numeroNota;
            updateData.mensagemSefaz = consulta.mensagem || "NFSe autorizada";
            if (consulta.url) updateData.danfeUrl = consulta.url;
            if (consulta.caminho_xml_nota_fiscal) updateData.xmlUrl = consulta.caminho_xml_nota_fiscal;
          } else if (consulta.status === "cancelado") {
            updateData.status = "cancelada";
            updateData.mensagemSefaz = "NFSe cancelada";
          } else if (consulta.status === "erro_autorizacao") {
            updateData.status = "rejeitada";
            updateData.mensagemSefaz = JSON.stringify(consulta.erros || consulta.mensagem);
          }

          if (Object.keys(updateData).length > 0) {
            await db.update(schema.notasFiscais).set(updateData).where(eq(schema.notasFiscais.id, nota.id));
          }

          app.logger.info({ notaId: nota.id, status: updateData.status || nota.status }, "NFSe status updated");
          return await reply.code(200).send({ ...nota, ...updateData, focusResponse: consulta });
        } catch (focusErr: any) {
          app.logger.warn({ err: focusErr, ref }, "Focus query error, returning cached status");
          return await reply.code(200).send({ ...nota, consultaErro: focusErr.message });
        }

      } catch (err: any) {
        app.logger.error({ err }, "Failed to query NFSe");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );

  // DELETE /api/fiscal/nfsen/:ref — Cancelar NFSe Nacional
  app.fastify.delete(
    "/api/fiscal/nfsen/:ref",
    {
      schema: {
        description: "Cancel NFSe Nacional",
        tags: ["fiscal"],
        params: {
          type: "object",
          required: ["ref"],
          properties: {
            ref: { type: "string", description: "NFSe reference" },
          },
        },
        body: {
          type: "object",
          required: ["justificativa"],
          properties: {
            justificativa: { type: "string", minLength: 15, description: "Cancellation justification (min 15 chars)" },
          },
        },
        response: {
          200: {
            description: "NFSe cancelled successfully",
            type: "object",
            properties: {
              status: { type: "string" },
              focusResponse: { type: "object" },
            },
          },
          400: {
            description: "Invalid request",
            ...errorResponse,
          },
          404: {
            description: "NFSe not found",
            ...errorResponse,
          },
          500: {
            description: "Internal server error",
            ...errorResponse,
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { ref: string }; Body: { justificativa: string } }>, reply: FastifyReply) => {
      try {
        app.logger.info({ ref: request.params.ref }, "DELETE /api/fiscal/nfsen/:ref started");
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        const { ref } = request.params;
        const { justificativa } = request.body;

        if (!justificativa || justificativa.length < 15) {
          app.logger.warn({ justificativaLength: justificativa?.length }, "Invalid justification");
          return await reply.code(400).send({ error: "Justificativa deve ter no mínimo 15 caracteres" });
        }

        const [nota] = await db.select().from(schema.notasFiscais)
          .where(eq(schema.notasFiscais.referenciaFocus, ref));
        if (!nota || nota.restauranteId !== restauranteId) {
          app.logger.warn({ ref, restauranteId }, "NFSe not found for cancellation");
          return await reply.code(404).send({ error: "Nota não encontrada" });
        }

        const resultado = await focusRequest("DELETE", "/nfsen/" + ref, {
          justificativa: justificativa
        });

        await db.update(schema.notasFiscais).set({
          status: "cancelada",
          mensagemSefaz: "Cancelada: " + justificativa
        }).where(eq(schema.notasFiscais.id, nota.id));

        app.logger.info({ notaId: nota.id }, "NFSe cancelled successfully");
        return await reply.code(200).send({ status: "cancelada", focusResponse: resultado });

      } catch (err: any) {
        app.logger.error({ err }, "Failed to cancel NFSe");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );

  // GET /api/fiscal/notas — Listar notas do restaurante
  app.fastify.get(
    "/api/fiscal/notas",
    {
      schema: {
        description: "List restaurant notas fiscais",
        tags: ["fiscal"],
        response: {
          200: {
            description: "List of notas fiscais",
            type: "array",
            items: notaFiscalResponse,
          },
          500: {
            description: "Internal server error",
            ...errorResponse,
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        app.logger.info("GET /api/fiscal/notas started");
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const notas = await db.select().from(schema.notasFiscais)
          .where(eq(schema.notasFiscais.restauranteId, restauranteId))
          .orderBy(desc(schema.notasFiscais.createdAt));

        app.logger.info({ count: notas.length }, "Listed notas fiscais");
        return await reply.code(200).send(notas);
      } catch (err: any) {
        app.logger.error({ err }, "Failed to list notas fiscais");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );

  // DELETE /api/fiscal/cleanup — Clean up old test notes
  app.fastify.delete(
    "/api/fiscal/cleanup",
    {
      schema: {
        description: "Delete old test notes with erro or rejeitada status",
        tags: ["fiscal"],
        response: {
          200: {
            description: "Cleanup completed",
            type: "object",
            properties: {
              deletedCount: { type: "number" },
            },
          },
          500: {
            description: "Internal server error",
            ...errorResponse,
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        app.logger.info("DELETE /api/fiscal/cleanup started");
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const result = await db.delete(schema.notasFiscais)
          .where(
            and(
              eq(schema.notasFiscais.restauranteId, restauranteId),
              or(
                eq(schema.notasFiscais.status, "erro"),
                eq(schema.notasFiscais.status, "rejeitada")
              )
            )
          )
          .returning();

        app.logger.info({ deletedCount: result.length }, "Old test notes cleanup completed");
        return await reply.code(200).send({ deletedCount: result.length });
      } catch (err: any) {
        app.logger.error({ err }, "Failed to cleanup old test notes");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );
}
