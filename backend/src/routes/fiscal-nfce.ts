/**
 * POST /api/fiscal/nfce — emissao de cupom fiscal eletronico (modelo 65).
 * GET  /api/fiscal/nfce/:ref — consulta status e devolve payload de impressao.
 *
 * Orquestra nfce-data (carga), nfce-builder (montagem),
 * nfce-qrcode (QR Code) e focus (envio).
 */

import { eq, and } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth, requireTenant } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { focusRequest } from "../services/focus.js";
import {
  buildNfcePayload,
  validarRestauranteParaNfce,
  limparDocumento,
} from "../utils/fiscal-payloads.js";
import type { DestinatarioInput } from "../utils/fiscal-payloads.js";
import {
  isoBrasilia,
  montarRestauranteInput,
  montarFormasPagamento,
  ajustarFormasPagamento,
  montarItensFiscais,
  calcularValorItens,
} from "../services/nfce-builder.js";
import {
  carregarComandaFiscal,
  carregarPagamentosFiscais,
  carregarPedidosFiscais,
  carregarPratosMap,
  buscarNfceBloqueante,
  proximoNumeroNfce,
} from "../services/nfce-data.js";
import {
  extrairUrlsFiscais,
  gerarQrCodeBase64,
  formatarChaveAcesso,
} from "../services/nfce-qrcode.js";

function focusHost(): string {
  return process.env.FOCUS_NFE_ENV === "production"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br";
}

function absolutizar(caminho: any): string | null {
  if (typeof caminho === "string" && caminho.startsWith("/")) {
    return focusHost() + caminho;
  }
  return caminho ?? null;
}

/**
 * Traduz o retorno da Focus em campos de atualizacao da nota.
 * Compartilhado entre POST e GET para que ambos interpretem igual.
 */
function aplicarResultadoFocus(
  resultado: any,
  ctx: { numeroNf?: number; serieNota?: number },
  logger: any
): any {
  const updateData: any = {};

  if (resultado.status === "autorizado") {
    updateData.status = "autorizada";
    updateData.chaveAcesso = resultado.chave_nfe ?? null;
    updateData.numeroNota = resultado.numero
      ? parseInt(resultado.numero)
      : ctx.numeroNf ?? null;
    updateData.serie = resultado.serie
      ? parseInt(resultado.serie)
      : ctx.serieNota ?? null;
    updateData.protocolo = resultado.protocolo ?? null;
    updateData.danfeUrl = absolutizar(resultado.caminho_danfe);
    updateData.xmlUrl = absolutizar(resultado.caminho_xml_nota_fiscal);
    updateData.mensagemSefaz = resultado.mensagem_sefaz ?? "NFC-e autorizada";
    updateData.emitidaEm = new Date();
  } else if (
    resultado._httpStatus === 202 ||
    resultado.status === "processando_autorizacao"
  ) {
    updateData.status = "processando";
    updateData.mensagemSefaz = "Aguardando autorizacao da SEFAZ";
  } else if (resultado.status === "erro_autorizacao" || resultado.erros) {
    updateData.status = "rejeitada";
    updateData.mensagemSefaz = JSON.stringify(
      resultado.erros ?? resultado.mensagem_sefaz ?? resultado.mensagem ?? resultado
    );
  } else if (resultado.status === "cancelado") {
    updateData.status = "cancelada";
    updateData.mensagemSefaz = resultado.mensagem_sefaz ?? "NFC-e cancelada";
  } else {
    updateData.status = "processando";
    updateData.mensagemSefaz = JSON.stringify(resultado);
  }

  const { qrcodeUrl, urlConsulta, chavesDisponiveis } = extrairUrlsFiscais(resultado);
  if (qrcodeUrl) updateData.qrcodeUrl = qrcodeUrl;
  if (urlConsulta) updateData.urlConsulta = urlConsulta;

  if (!qrcodeUrl && updateData.status === "autorizada") {
    logger.warn(
      { chavesDisponiveis },
      "QR Code nao encontrado no retorno da Focus — verificar nome do campo"
    );
  }

  return updateData;
}

export function registerFiscalNfceRoutes(app: App) {
  const db = app.db as any;

  const errorResponse = {
    type: "object",
    additionalProperties: true,
    properties: {
      error: { type: "string" },
      detail: { type: "string" },
      campos_faltantes: { type: "array", items: { type: "string" } },
    },
  };

  // ==================== POST /api/fiscal/nfce ====================
  app.fastify.post(
    "/api/fiscal/nfce",
    {
      schema: {
        description: "Emitir NFC-e (cupom fiscal eletronico, modelo 65) para uma comanda",
        tags: ["fiscal"],
        body: {
          type: "object",
          required: ["comanda_id"],
          properties: {
            comanda_id: { type: "string", format: "uuid" },
            cpf_destinatario: { type: "string", description: "CPF do consumidor (opcional)" },
            nome_destinatario: { type: "string" },
            email_destinatario: { type: "string" },
            serie: { type: "integer" },
            presenca_comprador: { type: "integer" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { description: "Requisicao invalida", ...errorResponse },
          404: { description: "Recurso nao encontrado", ...errorResponse },
          409: { description: "NFC-e ja emitida para esta comanda", ...errorResponse },
          502: { description: "Erro na comunicacao com Focus NFe", ...errorResponse },
          500: { description: "Erro interno", ...errorResponse },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          comanda_id: string;
          cpf_destinatario?: string;
          nome_destinatario?: string;
          email_destinatario?: string;
          serie?: number;
          presenca_comprador?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const {
          comanda_id,
          cpf_destinatario,
          nome_destinatario,
          email_destinatario,
          serie,
          presenca_comprador,
        } = request.body;

        app.logger.info({ comandaId: comanda_id, restauranteId }, "POST /api/fiscal/nfce iniciado");

        // 1. Restaurante + validacao fiscal
        const restRows = await db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, restauranteId));
        if (!restRows.length) {
          return await reply.code(404).send({ error: "Restaurante nao encontrado" });
        }
        const restaurante = restRows[0];
        const restauranteInput = montarRestauranteInput(restaurante);

        const validacao = validarRestauranteParaNfce(restauranteInput);
        if (!validacao.ok) {
          app.logger.warn(
            { restauranteId, campos: validacao.camposFaltantes },
            "Restaurante sem dados fiscais completos"
          );
          return await reply.code(400).send({
            error: "Restaurante sem dados fiscais completos para emitir NFC-e",
            campos_faltantes: validacao.camposFaltantes,
          });
        }

        // 2. Comanda (viva ou arquivada)
        const encontrada = await carregarComandaFiscal(db, comanda_id, restauranteId);
        if (!encontrada) {
          return await reply.code(404).send({ error: "Comanda nao encontrada neste restaurante" });
        }
        const { arquivada } = encontrada;

        // Bloquear NFC-e para delivery
        const tipoComanda = (encontrada as any).comanda?.tipo || (encontrada as any).tipo;
        if (tipoComanda === "delivery") {
          return await reply.code(400).send({ error: "A nota fiscal de delivery será implementada em uma etapa própria." });
        }

        // 3. Idempotencia
        const bloqueante = await buscarNfceBloqueante(db, comanda_id, restauranteId);
        if (bloqueante) {
          return await reply.code(409).send({
            error: "Ja existe NFC-e " + bloqueante.status + " para esta comanda",
            referencia_focus: bloqueante.referenciaFocus,
            nota_id: bloqueante.id,
          });
        }

        // 4. Pagamentos confirmados
        const pagRows = await carregarPagamentosFiscais(db, comanda_id, restauranteId, arquivada);
        const confirmados = pagRows.filter((p: any) => p.status === "confirmado");
        if (confirmados.length === 0) {
          app.logger.warn({ comandaId: comanda_id }, "NFC-e recusada: sem pagamento confirmado");
          return await reply.code(400).send({
            error: "Nenhum pagamento confirmado nesta comanda. Confirme o pagamento antes de emitir a NFC-e.",
          });
        }

        const formasBrutas = montarFormasPagamento(confirmados);
        if (formasBrutas.length === 0) {
          return await reply.code(400).send({ error: "Valor liquido dos pagamentos confirmados e zero" });
        }

        // 5. Itens
        const pedidoRows = await carregarPedidosFiscais(db, comanda_id, restauranteId, arquivada);
        const pedidosValidos = pedidoRows.filter((p: any) => p.status !== "cancelado");
        if (pedidosValidos.length === 0) {
          return await reply.code(400).send({ error: "Comanda sem itens validos para emissao" });
        }

        const pratoIds = Array.from(
          new Set(pedidosValidos.map((p: any) => p.pratoId).filter(Boolean))
        ) as string[];
        const pratoMap = await carregarPratosMap(db, pratoIds, restauranteId);

        const itens = montarItensFiscais(pedidosValidos, pratoMap, restaurante);
        const valorItens = calcularValorItens(itens);
        if (valorItens <= 0) {
          return await reply.code(400).send({ error: "Valor total dos itens e zero" });
        }

        const formasPagamento = ajustarFormasPagamento(formasBrutas, valorItens);

        // 6. Numeracao e ambiente
        const numeroNf = await proximoNumeroNfce(db, restauranteId);
        const ambiente: "producao" | "homologacao" =
          restaurante.ambienteFocus === 1 ? "producao" : "homologacao";
        const serieNota = serie ?? 1;

        // 7. Destinatario opcional — apenas CPF.
        // NFC-e para CNPJ e vedada (Ajuste SINIEF 11/2025); use NF-e modelo 55.
        let destinatario: DestinatarioInput | undefined;
        if (cpf_destinatario) {
          destinatario = {
            cpf: limparDocumento(cpf_destinatario),
            indicador_ie: 9,
          };
          if (nome_destinatario) destinatario.razao_social = nome_destinatario;
          if (email_destinatario) destinatario.email = email_destinatario;
        }

        // 8. Payload
        let payload: any;
        try {
          payload = buildNfcePayload(
            restauranteInput,
            itens,
            formasPagamento,
            {
              ambiente,
              serie: serieNota,
              data_emissao_iso: isoBrasilia(new Date()),
              presenca_comprador: presenca_comprador ?? 1,
            },
            destinatario,
            numeroNf
          );
        } catch (buildErr: any) {
          app.logger.warn({ err: buildErr, comandaId: comanda_id }, "Falha ao montar payload NFC-e");
          return await reply.code(400).send({ error: buildErr.message });
        }

        // 9. Persiste e envia
        const ref = "nfce-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

        const inserted = await db
          .insert(schema.notasFiscais)
          .values({
            comandaHistoricoId: comanda_id,
            referenciaFocus: ref,
            status: "processando",
            tipoDocumento: "nfce",
            modelo: "65",
            ambiente: restaurante.ambienteFocus,
            serie: serieNota,
            valorTotal: valorItens.toFixed(2),
            destinatarioSnapshot: destinatario ?? null,
            restauranteId,
          })
          .returning();
        const notaFiscal = inserted[0];

        try {
          const resultado = await focusRequest("POST", "/nfce?ref=" + ref, payload);
          const updateData = aplicarResultadoFocus(
            resultado,
            { numeroNf, serieNota },
            app.logger
          );

          await db
            .update(schema.notasFiscais)
            .set(updateData)
            .where(eq(schema.notasFiscais.id, notaFiscal.id));

          const qrCodeBase64 = await gerarQrCodeBase64(updateData.qrcodeUrl);

          app.logger.info(
            { notaId: notaFiscal.id, status: updateData.status, ref, numeroNf, temQr: !!qrCodeBase64 },
            "NFC-e processada"
          );

          return await reply.code(200).send({
            ...notaFiscal,
            ...updateData,
            ref,
            qrCodeBase64,
            chaveAcessoFormatada: formatarChaveAcesso(updateData.chaveAcesso),
            valor_produtos: valorItens,
            quantidade_itens: itens.length,
          });
        } catch (focusErr: any) {
          await db
            .update(schema.notasFiscais)
            .set({ status: "erro", mensagemSefaz: String(focusErr.message).slice(0, 500) })
            .where(eq(schema.notasFiscais.id, notaFiscal.id));

          app.logger.error({ err: focusErr, notaId: notaFiscal.id, ref }, "Erro Focus NFe na NFC-e");
          return await reply.code(502).send({
            error: "Erro ao comunicar com Focus NFe",
            detail: focusErr.message,
            ref,
          });
        }
      } catch (err: any) {
        app.logger.error({ err }, "Falha ao emitir NFC-e");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );

  // ==================== GET /api/fiscal/nfce/:ref ====================
  app.fastify.get(
    "/api/fiscal/nfce/:ref",
    {
      schema: {
        description: "Consultar NFC-e e obter payload de impressao (QR Code em base64)",
        tags: ["fiscal"],
        params: {
          type: "object",
          required: ["ref"],
          properties: { ref: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { description: "Nota nao encontrada", ...errorResponse },
          502: { description: "Erro na comunicacao com Focus NFe", ...errorResponse },
          500: { description: "Erro interno", ...errorResponse },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { ref: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await requireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const { ref } = request.params;

        const rows = await db
          .select()
          .from(schema.notasFiscais)
          .where(
            and(
              eq(schema.notasFiscais.referenciaFocus, ref),
              eq(schema.notasFiscais.restauranteId, restauranteId),
              eq(schema.notasFiscais.tipoDocumento, "nfce")
            )
          );
        if (!rows.length) {
          return await reply.code(404).send({ error: "NFC-e nao encontrada" });
        }
        let nota = rows[0];

        // Se ainda esta processando, consulta a Focus e atualiza
        if (nota.status === "processando") {
          try {
            const resultado = await focusRequest("GET", "/nfce/" + ref);
            const updateData = aplicarResultadoFocus(
              resultado,
              { numeroNf: nota.numeroNota ?? undefined, serieNota: nota.serie ?? undefined },
              app.logger
            );

            await db
              .update(schema.notasFiscais)
              .set(updateData)
              .where(eq(schema.notasFiscais.id, nota.id));

            nota = { ...nota, ...updateData };
            app.logger.info({ ref, status: updateData.status }, "NFC-e atualizada via consulta");
          } catch (focusErr: any) {
            app.logger.error({ err: focusErr, ref }, "Erro ao consultar NFC-e na Focus");
            return await reply.code(502).send({
              error: "Erro ao consultar Focus NFe",
              detail: focusErr.message,
              nota,
            });
          }
        }

        const qrCodeBase64 = await gerarQrCodeBase64(nota.qrcodeUrl);

        return await reply.code(200).send({
          ...nota,
          qrCodeBase64,
          chaveAcessoFormatada: formatarChaveAcesso(nota.chaveAcesso),
          imprimivel: nota.status === "autorizada",
        });
      } catch (err: any) {
        app.logger.error({ err }, "Falha ao consultar NFC-e");
        return await reply.code(500).send({ error: err.message });
      }
    }
  );
}
