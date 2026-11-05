import { eq, and, inArray, desc } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { subtotalDaComanda, calcularTotalComandaMesaComDesconto } from "../services/total-comanda.js";

// Pagamento na maquininha (Stone, Deeplink). Etapa 2: ciclo de vida da transação no backend.
//
// Fluxo:
//   1. O app chama POST /api/comandas/:id/terminal/transacoes. O backend valida a comanda, grava a
//      transação como "iniciada" e devolve os parâmetros para o app montar a URI do terminal
//      (valor em centavos, order_id, tipo e parcelamento no vocabulário da Stone).
//   2. O app abre a Stone. Quando ela devolve o resultado, o app chama POST .../retorno.
//      Se a transação foi aprovada, o backend grava o pagamento (confirmado, referencia = ATK)
//      na MESMA transação de banco. Cartão já cobrado não pode ser recusado por regra do sistema,
//      então o retorno NÃO valida excesso de valor: ele registra o que aconteceu.
//   3. Se o app não receber retorno (timeout, app fechado), chama POST .../sem-retorno. O retorno
//      ainda pode chegar depois e é aceito enquanto a transação não tiver um desfecho final.
//
// Esta etapa NÃO fecha a comanda sozinha: o retorno informa se a conta foi quitada ("quitada") e
// o fechamento segue pelo /fechar de sempre. Cancelamento e reimpressão ficam para outra etapa.
//
// Valores monetários: reais com 2 casas no banco; centavos inteiros só na resposta de "iniciar".

const PAPEIS_PAGAMENTO = ["garcom", "gerente", "administrador", "admin"];
const PAPEIS_GESTAO = ["gerente", "administrador", "admin"];

type FormaTerminal = "cartao_credito" | "cartao_debito" | "pix";

// Vocabulário gravado na tabela (e enviado à Stone em maiúsculas pelo app)
const TIPO_TRANSACAO: Record<FormaTerminal, "credit" | "debit" | "pix"> = {
  cartao_credito: "credit",
  cartao_debito: "debit",
  pix: "pix",
};

const FORMA_PAGAMENTO: Record<string, FormaTerminal> = {
  credit: "cartao_credito",
  debit: "cartao_debito",
  pix: "pix",
};

// A página de Pagamento da Stone fala em 1 a 12 parcelas; os exemplos divergem (2-18, 2-99).
// Fica o intervalo mais restrito até a confirmação no POS.
const MAX_PARCELAS = 12;

const STATUS_FINAIS_NEGATIVOS = ["recusada", "cancelada"];

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function codigoPg(err: any): string | undefined {
  return err?.code ?? err?.cause?.code;
}

function serializar(t: any) {
  return {
    id: t.id,
    order_id: Number(t.orderId),
    comanda_id: t.comandaId,
    pagamento_id: t.pagamentoId ?? null,
    provedor: t.provedor,
    forma_pagamento: FORMA_PAGAMENTO[t.tipoTransacao] ?? null,
    tipo_transacao: t.tipoTransacao,
    tipo_parcelamento: t.tipoParcelamento ?? null,
    parcelas: t.parcelas ?? null,
    valor: Number(t.valor),
    status: t.status,
    atk: t.atk ?? null,
    itk: t.itk ?? null,
    retorno_em: t.retornoEm ?? null,
    iniciada_por_id: t.iniciadaPorId ?? null,
    iniciada_por_nome: t.iniciadaPorNome ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

interface IniciarBody {
  forma_pagamento: FormaTerminal;
  valor: number;
  parcelas?: number;
  tipo_parcelamento?: "lojista" | "emissor";
  gorjeta?: number;
}

interface RetornoBody {
  resultado: "aprovada" | "recusada" | "cancelada";
  atk?: string;
  itk?: string;
  retorno_bruto?: string;
}

export function registerTransacoesTerminalRoutes(app: App) {
  const db = app.db as any;

  // POST /api/comandas/:id/terminal/transacoes — iniciar cobrança na maquininha
  app.fastify.post<{ Params: { id: string }; Body: IniciarBody }>(
    "/api/comandas/:id/terminal/transacoes",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            forma_pagamento: { type: "string", enum: ["cartao_credito", "cartao_debito", "pix"] },
            valor: { type: "number", minimum: 0.01 },
            parcelas: { type: "integer", minimum: 1, maximum: MAX_PARCELAS },
            tipo_parcelamento: { type: "string", enum: ["lojista", "emissor"] },
            gorjeta: { type: "number", minimum: 0 },
          },
          required: ["forma_pagamento", "valor"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: IniciarBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_PAGAMENTO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const { forma_pagamento, valor, parcelas, tipo_parcelamento, gorjeta } = request.body;

        if (!Number.isFinite(valor) || valor <= 0) {
          return await reply.code(400).send({ error: "O valor da cobrança deve ser um número maior que zero." });
        }
        if (gorjeta !== undefined && (!Number.isFinite(gorjeta) || gorjeta < 0)) {
          return await reply.code(400).send({ error: "A gorjeta deve ser um número maior ou igual a zero." });
        }

        // Parcelamento só existe no crédito. Débito e Pix seguem sem parcelas.
        let tipoParcelamentoStone: "none" | "merchant" | "issuer" | null = null;
        let parcelasFinal: number | null = null;
        if (forma_pagamento === "cartao_credito") {
          parcelasFinal = parcelas ?? 1;
          if (parcelasFinal === 1) {
            tipoParcelamentoStone = "none";
          } else {
            tipoParcelamentoStone = tipo_parcelamento === "emissor" ? "issuer" : "merchant";
          }
        } else if ((parcelas !== undefined && parcelas > 1) || tipo_parcelamento !== undefined) {
          return await reply.code(400).send({ error: "Parcelamento só é permitido no cartão de crédito." });
        }

        const valorReais = arredondar(valor);

        const resultado: { status: number; body: any } = await db.transaction(async (tx: any) => {
          const comanda = await tx
            .select({
              id: schema.comandas.id,
              status: schema.comandas.status,
              tipo: schema.comandas.tipo,
              descontoTipo: schema.comandas.descontoTipo,
              descontoValor: schema.comandas.descontoValor,
            })
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)))
            .for("update");

          if (!comanda.length) return { status: 404, body: { error: "Comanda não encontrada" } };
          if (comanda[0].tipo === "delivery") {
            return { status: 400, body: { error: "Este é um pedido de delivery. Use a tela de Delivery." } };
          }
          if (comanda[0].status !== "aberta") return { status: 400, body: { error: "Comanda não está aberta" } };

          const pagos = await tx
            .select({ valor: schema.pagamentos.valor })
            .from(schema.pagamentos)
            .where(and(eq(schema.pagamentos.comandaId, request.params.id), eq(schema.pagamentos.status, "confirmado")));
          const totalPago = pagos.reduce((s: number, p: any) => s + parseFloat(p.valor), 0);

          const subtotal = await subtotalDaComanda(tx, request.params.id);
          const { total: totalComanda } = calcularTotalComandaMesaComDesconto(
            subtotal,
            gorjeta ?? 0,
            comanda[0].descontoTipo,
            comanda[0].descontoValor
          );
          const restante = arredondar(totalComanda - totalPago);

          if (totalComanda <= 0) {
            return { status: 400, body: { error: "A comanda não tem valor a cobrar." } };
          }
          if (valorReais > restante + 0.01) {
            return { status: 400, body: { error: `Valor excede o restante da comanda. Restante: R$ ${restante.toFixed(2)}` } };
          }

          const [t] = await tx
            .insert(schema.transacoesTerminal)
            .values({
              restauranteId,
              comandaId: request.params.id,
              provedor: "stone_deeplink",
              tipoTransacao: TIPO_TRANSACAO[forma_pagamento],
              tipoParcelamento: tipoParcelamentoStone,
              parcelas: parcelasFinal,
              valor: valorReais.toFixed(2),
              status: "iniciada",
              iniciadaPorId: authUser.id,
              iniciadaPorNome: authUser.name,
            })
            .returning();

          return {
            status: 201,
            body: {
              transacao: serializar(t),
              // Parâmetros para o app montar a URI do terminal (payment-app://pay)
              terminal: {
                amount_centavos: Math.round(valorReais * 100),
                order_id: Number(t.orderId),
                transaction_type: TIPO_TRANSACAO[forma_pagamento].toUpperCase(),
                installment_type: tipoParcelamentoStone ? tipoParcelamentoStone.toUpperCase() : null,
                installment_count: parcelasFinal,
              },
              restante_antes: restante,
            },
          };
        });

        return await reply.code(resultado.status).send(resultado.body);
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao iniciar transação de terminal");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/terminal/transacoes/:id/retorno — resultado devolvido pela maquininha
  app.fastify.post<{ Params: { id: string }; Body: RetornoBody }>(
    "/api/terminal/transacoes/:id/retorno",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            resultado: { type: "string", enum: ["aprovada", "recusada", "cancelada"] },
            atk: { type: "string", minLength: 1, maxLength: 100 },
            itk: { type: "string", maxLength: 100 },
            retorno_bruto: { type: "string", maxLength: 8000 },
          },
          required: ["resultado"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: RetornoBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_PAGAMENTO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const { resultado, itk, retorno_bruto } = request.body;
        const atk = request.body.atk?.trim() || undefined;

        if (resultado === "aprovada" && !atk) {
          // O ATK é a chave do cancelamento e da reimpressão: sem ele, a aprovação não é utilizável.
          return await reply.code(400).send({ error: "Transação aprovada exige o ATK devolvido pela maquininha." });
        }

        const saida: { status: number; body: any } = await db.transaction(async (tx: any) => {
          const encontradas = await tx
            .select()
            .from(schema.transacoesTerminal)
            .where(and(eq(schema.transacoesTerminal.id, request.params.id), eq(schema.transacoesTerminal.restauranteId, restauranteId)))
            .for("update");
          if (!encontradas.length) return { status: 404, body: { error: "Transação não encontrada" } };
          const t = encontradas[0];

          // Retorno repetido (o app reenviou): responde o estado atual sem gravar de novo
          if (t.status === "confirmada") {
            if (resultado === "aprovada" && (!t.atk || t.atk === atk)) {
              return { status: 200, body: { transacao: serializar(t), repetido: true } };
            }
            app.logger.warn({ transacaoId: t.id, resultado }, "Retorno conflitante para transação já confirmada");
            return { status: 409, body: { error: "Esta transação já foi confirmada.", transacao: serializar(t) } };
          }
          if (STATUS_FINAIS_NEGATIVOS.includes(t.status)) {
            if (t.status === resultado) {
              return { status: 200, body: { transacao: serializar(t), repetido: true } };
            }
            app.logger.warn({ transacaoId: t.id, statusAtual: t.status, resultado }, "Retorno conflitante para transação já encerrada");
            return { status: 409, body: { error: "Esta transação já foi encerrada com outro resultado.", transacao: serializar(t) } };
          }

          const agora = new Date();

          if (resultado !== "aprovada") {
            const [atualizada] = await tx
              .update(schema.transacoesTerminal)
              .set({
                status: resultado,
                atk: atk ?? t.atk,
                itk: itk ?? t.itk,
                retornoBruto: retorno_bruto ?? t.retornoBruto,
                retornoEm: agora,
                updatedAt: agora,
              })
              .where(eq(schema.transacoesTerminal.id, t.id))
              .returning();
            return { status: 200, body: { transacao: serializar(atualizada) } };
          }

          // Aprovada: o cartão já foi cobrado. Registra o pagamento sem recusar por excesso.
          const valor = parseFloat(t.valor);
          const comanda = await tx
            .select({
              id: schema.comandas.id,
              status: schema.comandas.status,
              descontoTipo: schema.comandas.descontoTipo,
              descontoValor: schema.comandas.descontoValor,
            })
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, t.comandaId), eq(schema.comandas.restauranteId, restauranteId)))
            .for("update");

          const comandaAberta = comanda.length > 0 && comanda[0].status === "aberta";

          let pagamentoId: string | null = null;
          let resumo: any = null;

          if (comandaAberta) {
            const [pagamento] = await tx
              .insert(schema.pagamentos)
              .values({
                comandaId: t.comandaId,
                formaPagamento: FORMA_PAGAMENTO[t.tipoTransacao] ?? "cartao_debito",
                status: "confirmado",
                valor: valor.toFixed(2),
                troco: "0",
                referencia: atk,
                confirmadoEm: agora,
                restauranteId,
              })
              .returning();
            pagamentoId = pagamento.id;

            const pagos = await tx
              .select({ valor: schema.pagamentos.valor })
              .from(schema.pagamentos)
              .where(and(eq(schema.pagamentos.comandaId, t.comandaId), eq(schema.pagamentos.status, "confirmado")));
            const totalPago = pagos.reduce((s: number, p: any) => s + parseFloat(p.valor), 0);
            const subtotal = await subtotalDaComanda(tx, t.comandaId);
            // A gorjeta só entra no fechamento; aqui "quitada" considera subtotal e desconto.
            const { total: totalComanda } = calcularTotalComandaMesaComDesconto(subtotal, 0, comanda[0].descontoTipo, comanda[0].descontoValor);
            const restante = arredondar(totalComanda - totalPago);
            resumo = {
              total_comanda: totalComanda,
              total_pago: arredondar(totalPago),
              restante,
              quitada: totalComanda > 0.01 && restante <= 0.01,
            };
          }

          const [atualizada] = await tx
            .update(schema.transacoesTerminal)
            .set({
              status: "confirmada",
              pagamentoId,
              atk,
              itk: itk ?? t.itk,
              retornoBruto: retorno_bruto ?? t.retornoBruto,
              retornoEm: agora,
              updatedAt: agora,
            })
            .where(eq(schema.transacoesTerminal.id, t.id))
            .returning();

          if (!comandaAberta) {
            // Cobrança aprovada, mas a comanda já não está aberta (fechada ou arquivada no meio do caminho).
            // A transação fica confirmada com o ATK para a gestão conciliar ou estornar.
            app.logger.warn({ transacaoId: t.id, comandaId: t.comandaId, atk }, "Transação aprovada sem comanda aberta: pagamento não registrado");
            return {
              status: 200,
              body: {
                transacao: serializar(atualizada),
                pagamento_registrado: false,
                aviso: "A cobrança foi aprovada na maquininha, mas a comanda não está mais aberta. O pagamento não foi registrado: avise a gerência para conciliar ou estornar.",
              },
            };
          }

          return { status: 200, body: { transacao: serializar(atualizada), pagamento_registrado: true, resumo } };
        });

        return await reply.code(saida.status).send(saida.body);
      } catch (err) {
        if (codigoPg(err) === "23505") {
          // ATK já usado por outra transação do restaurante
          app.logger.warn({ transacaoId: request.params.id }, "ATK duplicado ao registrar retorno do terminal");
          return await reply.code(409).send({ error: "Este ATK já está registrado em outra transação." });
        }
        app.logger.error({ error: (err as any).message }, "Erro ao registrar retorno do terminal");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/terminal/transacoes/:id/sem-retorno — o app não recebeu resposta da maquininha
  app.fastify.post<{ Params: { id: string } }>(
    "/api/terminal/transacoes/:id/sem-retorno",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_PAGAMENTO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const saida: { status: number; body: any } = await db.transaction(async (tx: any) => {
          const encontradas = await tx
            .select()
            .from(schema.transacoesTerminal)
            .where(and(eq(schema.transacoesTerminal.id, request.params.id), eq(schema.transacoesTerminal.restauranteId, restauranteId)))
            .for("update");
          if (!encontradas.length) return { status: 404, body: { error: "Transação não encontrada" } };
          const t = encontradas[0];

          // Só "iniciada" vira "sem_retorno". Qualquer outro estado já tem desfecho e é devolvido como está.
          if (t.status !== "iniciada") return { status: 200, body: { transacao: serializar(t) } };

          const [atualizada] = await tx
            .update(schema.transacoesTerminal)
            .set({ status: "sem_retorno", updatedAt: new Date() })
            .where(eq(schema.transacoesTerminal.id, t.id))
            .returning();
          return { status: 200, body: { transacao: serializar(atualizada) } };
        });

        return await reply.code(saida.status).send(saida.body);
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao marcar transação sem retorno");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // GET /api/terminal/transacoes/:id — consultar uma transação
  app.fastify.get<{ Params: { id: string } }>(
    "/api/terminal/transacoes/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_PAGAMENTO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const t = await db
          .select()
          .from(schema.transacoesTerminal)
          .where(and(eq(schema.transacoesTerminal.id, request.params.id), eq(schema.transacoesTerminal.restauranteId, restauranteId)));
        if (!t.length) return await reply.code(404).send({ error: "Transação não encontrada" });

        return await reply.code(200).send({ transacao: serializar(t[0]) });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao consultar transação de terminal");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // GET /api/comandas/:id/terminal/transacoes — transações de terminal de uma comanda
  app.fastify.get<{ Params: { id: string } }>(
    "/api/comandas/:id/terminal/transacoes",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_PAGAMENTO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const lista = await db
          .select()
          .from(schema.transacoesTerminal)
          .where(and(eq(schema.transacoesTerminal.comandaId, request.params.id), eq(schema.transacoesTerminal.restauranteId, restauranteId)))
          .orderBy(desc(schema.transacoesTerminal.createdAt));

        return await reply.code(200).send({ transacoes: lista.map(serializar) });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao listar transações de terminal da comanda");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // GET /api/terminal/transacoes/pendentes — "iniciada" e "sem_retorno" para a gestão conciliar
  app.fastify.get(
    "/api/terminal/transacoes/pendentes",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, PAPEIS_GESTAO, reply))) return;
        const restauranteId = requireTenant(authUser);

        const lista = await db
          .select()
          .from(schema.transacoesTerminal)
          .where(and(
            eq(schema.transacoesTerminal.restauranteId, restauranteId),
            inArray(schema.transacoesTerminal.status, ["iniciada", "sem_retorno"])
          ))
          .orderBy(desc(schema.transacoesTerminal.createdAt))
          .limit(100);

        return await reply.code(200).send({ transacoes: lista.map(serializar) });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao listar transações pendentes de terminal");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );
}
