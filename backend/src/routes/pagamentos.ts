// force rebuild v2
import { eq, and, inArray } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { subtotalDaComanda } from "../services/total-comanda.js";

// Pagamento de comanda (dinheiro, cartão, Pix) é sempre reconciliado manualmente pelo
// garçom — o restaurante usa a própria maquininha/chave Pix e o app só registra qual
// forma foi usada. Não há integração de pagamento nativa nesta rota; o Asaas só é
// usado para a cobrança da assinatura da plataforma (ver backend/src/routes/assinatura.ts).

export function registerPagamentoRoutes(app: App) {
  const db = app.db as any;

  // POST /api/comandas/:id/pagamentos — registrar pagamento
  app.fastify.post<{ Params: { id: string }; Body: { forma_pagamento: string; valor: number; troco?: number; referencia?: string } }>(
    "/api/comandas/:id/pagamentos",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            forma_pagamento: { type: "string", enum: ["pix", "dinheiro", "cartao_credito", "cartao_debito"] },
            valor: { type: "number", minimum: 0.01 },
            troco: { type: "number", minimum: 0 },
            referencia: { type: "string" },
            gorjeta: { type: "number", minimum: 0 },
          },
          required: ["forma_pagamento", "valor"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { forma_pagamento: string; valor: number; troco?: number; referencia?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, ["garcom", "gerente", "administrador", "admin"], reply))) return;
        const restauranteId = requireTenant(authUser);

        // Verificar se comanda existe e pertence ao tenant
        const comanda = await db.select({ id: schema.comandas.id, status: schema.comandas.status, total: schema.comandas.total, tipo: schema.comandas.tipo }).from(schema.comandas).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        if (!comanda.length) return await reply.code(404).send({ error: "Comanda não encontrada" });
        if (comanda[0].tipo === 'delivery') return await reply.code(400).send({ error: "Este é um pedido de delivery. Use a tela de Delivery." });
        if (comanda[0].status !== "aberta") return await reply.code(400).send({ error: "Comanda não está aberta" });

        const { forma_pagamento, valor, troco, referencia } = request.body;

        if (!isFinite(valor) || valor <= 0) {
          return await reply.code(400).send({ error: "O valor do pagamento deve ser um número maior que zero." });
        }
        if (troco !== undefined && (!isFinite(troco) || troco < 0)) {
          return await reply.code(400).send({ error: "O troco deve ser um número maior ou igual a zero." });
        }
        const _gorjetaCheck = (request.body as any).gorjeta;
        if (_gorjetaCheck !== undefined && (!isFinite(_gorjetaCheck) || _gorjetaCheck < 0)) {
          return await reply.code(400).send({ error: "A gorjeta deve ser um número maior ou igual a zero." });
        }

        // Calcular total já pago
        const pagamentosExistentes = await db.select({ valor: schema.pagamentos.valor }).from(schema.pagamentos).where(and(eq(schema.pagamentos.comandaId, request.params.id), eq(schema.pagamentos.status, "confirmado")));
        const totalPago = pagamentosExistentes.reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);
        const totalComanda = await subtotalDaComanda(db, request.params.id);
        const restante = totalComanda - totalPago;

        // Considerar a gorjeta no cálculo do valor devido, sem persistir no total
        // da comanda. Quem soma a gorjeta ao total, uma única vez, é o /fechar —
        // gravar aqui inflava o total a cada pagamento (e compunha ainda mais em
        // contas divididas entre várias pessoas).
        const gorjetaBody = (request.body as any).gorjeta || 0;
        const totalComandaFinal = totalComanda + gorjetaBody;

        // Only validate overpayment if comanda has a total
        const restanteFinal = totalComandaFinal - totalPago;
        if (totalComandaFinal > 0 && valor > restanteFinal + 0.01) {
          return await reply.code(400).send({ error: `Valor excede o restante da comanda. Restante: R$ ${restanteFinal.toFixed(2)}` });
        }

        // Todas as formas de pagamento (dinheiro, cartão, Pix) são reconciliação manual
        // do garçom e confirmam imediatamente — não há integração de gateway aqui.
        const statusPagamento = "confirmado";
        const confirmadoEm = new Date();

        const [pagamento] = await db.insert(schema.pagamentos).values({
          comandaId: request.params.id,
          formaPagamento: forma_pagamento,
          status: statusPagamento,
          valor: valor.toString(),
          troco: (troco || 0).toString(),
          referencia: referencia || null,
          confirmadoEm,
          restauranteId,
        }).returning();

        return await reply.code(201).send({
          pagamento,
          resumo: { total_comanda: totalComandaFinal, total_pago: totalPago + (statusPagamento === "confirmado" ? valor : 0), restante: restanteFinal - (statusPagamento === "confirmado" ? valor : 0) },
        });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao registrar pagamento");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // GET /api/comandas/:id/pagamentos — listar pagamentos de uma comanda
  app.fastify.get<{ Params: { id: string } }>(
    "/api/comandas/:id/pagamentos",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const comanda = await db.select({ id: schema.comandas.id, tipo: schema.comandas.tipo }).from(schema.comandas).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        if (!comanda.length) return await reply.code(404).send({ error: "Comanda não encontrada" });
        if (comanda[0].tipo === 'delivery') return await reply.code(400).send({ error: "Este é um pedido de delivery. Use a tela de Delivery." });

        const pagamentos = await db.select().from(schema.pagamentos).where(eq(schema.pagamentos.comandaId, request.params.id));

        const totalPago = pagamentos.filter((p: any) => p.status === "confirmado").reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);

        return await reply.code(200).send({ pagamentos, total_pago: totalPago });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao listar pagamentos");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // DELETE /api/pagamentos/:id — cancelar pagamento pendente
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/pagamentos/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, ["garcom", "gerente", "administrador", "admin"], reply))) return;
        const restauranteId = requireTenant(authUser);

        const pagamento = await db.select().from(schema.pagamentos).where(and(eq(schema.pagamentos.id, request.params.id), eq(schema.pagamentos.restauranteId, restauranteId)));
        if (!pagamento.length) return await reply.code(404).send({ error: "Pagamento não encontrado" });
        if (pagamento[0].status === "confirmado") return await reply.code(400).send({ error: "Pagamento já confirmado não pode ser cancelado" });

        await db.update(schema.pagamentos).set({ status: "cancelado" }).where(eq(schema.pagamentos.id, request.params.id));

        return await reply.code(200).send({ success: true, message: "Pagamento cancelado" });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao cancelar pagamento");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/comandas/:id/divisao — calcular divisão da conta
  app.fastify.post<{ Params: { id: string }; Body: { tipo: string; num_pessoas?: number; gorjeta?: number; pessoas?: Array<{ nome: string; pedido_ids: string[] }> } }>(
    "/api/comandas/:id/divisao",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["igual", "por_itens"] },
            num_pessoas: { type: "number", minimum: 2 },
            gorjeta: { type: "number", minimum: 0 },
            pessoas: { type: "array" },
          },
          required: ["tipo"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { tipo: string; num_pessoas?: number; gorjeta?: number; pessoas?: Array<{ nome: string; pedido_ids: string[] }> } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        // Verificar comanda
        const comanda = await db.select({ id: schema.comandas.id, status: schema.comandas.status, total: schema.comandas.total, tipo: schema.comandas.tipo }).from(schema.comandas).where(and(eq(schema.comandas.id, request.params.id), eq(schema.comandas.restauranteId, restauranteId)));
        if (!comanda.length) return await reply.code(404).send({ error: "Comanda não encontrada" });
        if (comanda[0].tipo === 'delivery') return await reply.code(400).send({ error: "Este é um pedido de delivery. Use a tela de Delivery." });

        const totalComanda = await subtotalDaComanda(db, request.params.id);
        const gorjeta = request.body.gorjeta || 0;
        const totalComGorjeta = totalComanda + gorjeta;

        // Buscar pagamentos já feitos
        const pagamentosExistentes = await db.select({ valor: schema.pagamentos.valor }).from(schema.pagamentos).where(and(eq(schema.pagamentos.comandaId, request.params.id), eq(schema.pagamentos.status, "confirmado")));
        const totalPago = pagamentosExistentes.reduce((sum: number, p: any) => sum + parseFloat(p.valor), 0);
        const restante = totalComGorjeta - totalPago;

        // Buscar todos os pedidos da comanda
        const pedidosDaComanda = await db.select({
          id: schema.pedidos.id,
          pratoId: schema.pedidos.pratoId,
          quantidade: schema.pedidos.quantidade,
          precoUnitario: schema.pedidos.precoUnitario,
          observacao: schema.pedidos.observacao,
          status: schema.pedidos.status,
        }).from(schema.pedidos).where(eq(schema.pedidos.comandaId, request.params.id));
        // Itens cancelados não entram na divisão
        const pedidos = pedidosDaComanda.filter((p: any) => p.status !== "cancelado");

        const { tipo } = request.body;

        if (tipo === "igual") {
          // Divisão igualitária
          const numPessoas = request.body.num_pessoas || 2;
          if (numPessoas < 2) return await reply.code(400).send({ error: "Número de pessoas deve ser pelo menos 2" });

          const valorPorPessoa = Math.ceil(restante / numPessoas * 100) / 100;
          const ajuste = Math.round((valorPorPessoa * numPessoas - restante) * 100) / 100;

          const divisao = Array.from({ length: numPessoas }, (_, i) => ({
            pessoa: i + 1,
            valor: i === numPessoas - 1 ? Math.round((valorPorPessoa - ajuste) * 100) / 100 : valorPorPessoa,
          }));

          return await reply.code(200).send({
            tipo: "igual",
            total_comanda: totalComanda,
            gorjeta,
            total_com_gorjeta: totalComGorjeta,
            total_pago: totalPago,
            restante,
            num_pessoas: numPessoas,
            divisao,
          });

        } else if (tipo === "por_itens") {
          // Divisão por itens
          const pessoas = request.body.pessoas;
          if (!pessoas || pessoas.length < 2) return await reply.code(400).send({ error: "Informe pelo menos 2 pessoas com seus pedido_ids" });

          // Mapear pedidos por ID
          const pedidoMap = new Map(pedidos.map((p: any) => [p.id, p]));

          // Calcular valor de cada pessoa
          const divisao = pessoas.map((pessoa: any) => {
            let subtotal = 0;
            const itens: any[] = [];

            for (const pedidoId of pessoa.pedido_ids) {
              const pedido = pedidoMap.get(pedidoId) as any;
              if (pedido) {
                const valor = parseFloat(pedido.precoUnitario) * pedido.quantidade;
                subtotal += valor;
                itens.push({ pedido_id: pedidoId, quantidade: pedido.quantidade, preco_unitario: parseFloat(pedido.precoUnitario), subtotal_item: valor });
              }
            }

            return { nome: pessoa.nome, itens, subtotal };
          });

          // Distribuir gorjeta proporcionalmente
          const totalItensAtribuidos = divisao.reduce((sum: number, d: any) => sum + d.subtotal, 0);
          const itensNaoAtribuidos = totalComanda - totalItensAtribuidos;

          const divisaoFinal = divisao.map((d: any) => {
            const proporcao = totalItensAtribuidos > 0 ? d.subtotal / totalItensAtribuidos : 1 / divisao.length;
            const gorjetaProporcional = Math.round(gorjeta * proporcao * 100) / 100;
            const rateiNaoAtribuido = Math.round(itensNaoAtribuidos * proporcao * 100) / 100;
            return {
              nome: d.nome,
              itens: d.itens,
              subtotal_itens: d.subtotal,
              rateio_itens_nao_atribuidos: rateiNaoAtribuido,
              gorjeta_proporcional: gorjetaProporcional,
              total_a_pagar: Math.round((d.subtotal + gorjetaProporcional + rateiNaoAtribuido) * 100) / 100,
            };
          });

          return await reply.code(200).send({
            tipo: "por_itens",
            total_comanda: totalComanda,
            gorjeta,
            total_com_gorjeta: totalComGorjeta,
            total_pago: totalPago,
            restante,
            itens_nao_atribuidos: itensNaoAtribuidos,
            num_pessoas: pessoas.length,
            divisao: divisaoFinal,
          });

        } else {
          return await reply.code(400).send({ error: "Tipo de divisão inválido. Use 'igual' ou 'por_itens'." });
        }
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao calcular divisão");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );
}
