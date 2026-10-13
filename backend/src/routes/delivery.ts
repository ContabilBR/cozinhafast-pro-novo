import { eq, and, desc, sql } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { realtimeHub } from "../realtime/hub.js";
import { totalDelivery, subtotalDaComanda } from "../services/total-comanda.js";

// Normaliza formas curtas enviadas pelo frontend para os valores aceitos pelo banco
const FORMA_PAGAMENTO_MAP: Record<string, string> = {
  credito: "cartão de crédito",
  debito: "cartão de débito",
  pix: "pix",
  dinheiro: "dinheiro",
  "cartão de crédito": "cartão de crédito",
  "cartão de débito": "cartão de débito",
};
function normalizarForma(forma: string): string {
  return FORMA_PAGAMENTO_MAP[forma] ?? forma;
}

// Calcula se o pedido está pronto para despacho
function calcProntoParaDespachar(itens: { status: string }[], entregaStatus: string): boolean {
  const itens_ativos = itens.filter((i) => i.status !== "cancelado").length;
  const itens_prontos = itens.filter((i) => i.status === "pronto").length;
  return itens_ativos > 0 && itens_prontos === itens_ativos && ["pendente", "preparando"].includes(entregaStatus);
}

// Calcula a etapa (estado visual) de uma entrega
function calcEtapa(itens: { status: string }[], entregaStatus: string): string {
  if (entregaStatus === "cancelada") return "cancelada";
  if (calcProntoParaDespachar(itens, entregaStatus)) return "pronto_para_despachar";
  return entregaStatus;
}

interface DeliveryBody {
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  cep?: string;
  referencia?: string;
  taxa_entrega?: number;
  tempo_estimado?: number;
  observacao?: string;
  pagamento: {
    momento: "ja_pago" | "na_entrega";
    forma: "pix" | "credito" | "debito" | "dinheiro" | "cartão de crédito" | "cartão de débito";
    troco_para?: number;
  };
  itens: Array<{ prato_id: string; quantidade: number; observacao?: string }>;
}

export function registerDeliveryRoutes(app: App) {
  const db = app.db as any;

  // POST /api/delivery/pedidos — criar pedido delivery
  app.fastify.post<{ Body: DeliveryBody }>(
    "/api/delivery/pedidos",
    {
      schema: {
        description: "Create a new delivery order",
        tags: ["delivery"],
        body: {
          type: "object",
          required: ["cliente_nome", "cliente_telefone", "endereco", "itens", "pagamento"],
          properties: {
            cliente_nome: { type: "string" },
            cliente_telefone: { type: "string" },
            endereco: { type: "string" },
            complemento: { type: "string" },
            bairro: { type: "string" },
            cidade: { type: "string" },
            cep: { type: "string" },
            referencia: { type: "string" },
            taxa_entrega: { type: "number" },
            tempo_estimado: { type: "integer" },
            observacao: { type: "string" },
            pagamento: {
              type: "object",
              required: ["momento", "forma"],
              properties: {
                momento: { type: "string", enum: ["ja_pago", "na_entrega"] },
                forma: { type: "string", enum: ["pix", "credito", "debito", "dinheiro", "cartão de crédito", "cartão de débito"] },
                troco_para: { type: "number" },
              },
            },
            itens: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["prato_id", "quantidade"],
                properties: {
                  prato_id: { type: "string", format: "uuid" },
                  quantidade: { type: "integer", minimum: 1 },
                  observacao: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              comanda: { type: "object" },
              entrega: { type: "object" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: DeliveryBody }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, ["garcom", "gerente", "administrador", "admin", "superadmin", "super_admin"], reply))) return;
        const restauranteId = requireTenant(authUser);
        const body = request.body;

        if (!body.cliente_nome || !body.cliente_telefone || !body.endereco) {
          return await reply.code(400).send({ error: "cliente_nome, cliente_telefone e endereco são obrigatórios" });
        }
        if (!body.itens || body.itens.length === 0) {
          return await reply.code(400).send({ error: "Informe pelo menos um item" });
        }

        const result = await (db as any).transaction(async (tx: any) => {
          // Validações de campos numéricos opcionais
          if (body.taxa_entrega !== undefined && body.taxa_entrega < 0) {
            throw new Error("VALIDATION: A taxa de entrega não pode ser negativa.");
          }
          if (body.tempo_estimado !== undefined && body.tempo_estimado < 0) {
            throw new Error("VALIDATION: O tempo estimado não pode ser negativo.");
          }
          if (body.pagamento && body.pagamento.troco_para !== undefined && body.pagamento.troco_para < 0) {
            throw new Error("VALIDATION: O valor para troco não pode ser negativo.");
          }

          // Buscar preços dos pratos
          let subtotal = 0;
          const itensPedido: any[] = [];
          for (const item of body.itens) {
            const [prato] = await tx.select({ id: schema.pratos.id, preco: schema.pratos.preco, nome: schema.pratos.nome, disponivel: schema.pratos.disponivel }).from(schema.pratos).where(and(eq(schema.pratos.id, item.prato_id), eq(schema.pratos.restauranteId, restauranteId)));
            if (!prato) return { error: "Prato não encontrado: " + item.prato_id };
            if (prato.disponivel === false) {
              throw new Error("VALIDATION: Prato indisponível: " + prato.nome + ".");
            }
            if (item.quantidade > 99) {
              throw new Error("VALIDATION: Quantidade máxima por item é 99.");
            }
            const precoUnit = parseFloat(prato.preco);
            subtotal += precoUnit * item.quantidade;
            itensPedido.push({ pratoId: item.prato_id, quantidade: item.quantidade, precoUnitario: prato.preco, observacao: item.observacao || null });
          }

          const taxaEntrega = body.taxa_entrega || 0;
          const total = subtotal + taxaEntrega;

          // Criar comanda tipo delivery (sem mesa)
          const [comanda] = await tx.insert(schema.comandas).values({
            tipo: "delivery",
            mesaId: null,
            mesaNumero: null,
            garcomId: authUser.id,
            status: "aberta",
            subtotal: subtotal.toString(),
            total: total.toString(),
            restauranteId,
          }).returning();

          // Inserir pedidos
          for (const item of itensPedido) {
            await tx.insert(schema.pedidos).values({
              comandaId: comanda.id,
              pratoId: item.pratoId,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario,
              observacao: item.observacao,
              status: "pendente",
              restauranteId,
            });
          }

          // Criar entrega
          const [entrega] = await tx.insert(schema.entregas).values({
            comandaId: comanda.id,
            clienteNome: body.cliente_nome,
            clienteTelefone: body.cliente_telefone,
            endereco: body.endereco,
            complemento: body.complemento || null,
            bairro: body.bairro || null,
            cidade: body.cidade || null,
            cep: body.cep || null,
            referencia: body.referencia || null,
            taxaEntrega: taxaEntrega.toString(),
            tempoEstimado: body.tempo_estimado || null,
            observacao: body.observacao || null,
            restauranteId,
          }).returning();

          // Criar pagamento
          const totalPedido = await totalDelivery(tx, comanda.id);

          if (body.pagamento.momento === "na_entrega" && body.pagamento.forma === "dinheiro" && body.pagamento.troco_para !== undefined) {
            const trocoPara = body.pagamento.troco_para;
            if (Math.round(trocoPara * 100) < Math.round(totalPedido * 100)) {
              throw new Error(`TROCO_INSUFICIENTE: O valor de troco (R$ ${trocoPara.toFixed(2)}) é menor que o total do pedido (R$ ${totalPedido.toFixed(2)}).`);
            }
          }

          const referenciaPag = body.pagamento.momento === "na_entrega" && body.pagamento.forma === "dinheiro" && body.pagamento.troco_para !== undefined
            ? `Troco para R$ ${body.pagamento.troco_para.toFixed(2)}`
            : null;

          // Bug 3: normalizar forma antes de gravar
          const formaGravar = normalizarForma(body.pagamento.forma);

          await tx.insert(schema.pagamentos).values({
            comandaId: comanda.id,
            restauranteId: restauranteId as any,
            valor: totalPedido.toFixed(2),
            formaPagamento: formaGravar as any,
            status: body.pagamento.momento === "ja_pago" ? "confirmado" : "pendente",
            confirmadoEm: body.pagamento.momento === "ja_pago" ? new Date() : null,
            referencia: referenciaPag,
            troco: "0.00",
          });

          return { comanda, entrega };
        });

        if (result.error) return await reply.code(400).send({ error: result.error });

        // Publicar evento realtime para a cozinha
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.criado",
            entityId: result.comanda.id,
            occurredAt: new Date().toISOString(),
            payload: {
              comanda_id: result.comanda.id,
              tipo: "delivery",
              status: result.entrega.status,
              cliente_nome: result.entrega.clienteNome,
            },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery.criado event");
        }

        return await reply.code(201).send({ comanda: result.comanda, entrega: result.entrega });
      } catch (err) {
        if ((err as any)?.message?.startsWith("TROCO_INSUFICIENTE:")) {
          return await reply.code(400).send({ error: (err as any).message.replace("TROCO_INSUFICIENTE:", "").trim() });
        }
        if ((err as any)?.message?.startsWith("VALIDATION:")) {
          return await reply.code(400).send({ error: (err as any).message.replace("VALIDATION:", "").trim() });
        }
        app.logger.error({ error: (err as any).message }, "Erro ao criar pedido delivery");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // GET /api/delivery/pedidos — listar pedidos delivery
  app.fastify.get(
    "/api/delivery/pedidos",
    {
      schema: {
        description: "List delivery orders",
        tags: ["delivery"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              pedidos: {
                type: "array",
                items: { type: "object", additionalProperties: true },
              },
              total: { type: "number" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(401).send({ error: "Nenhum restaurante associado" });
        }

        const statusFiltro = (request.query as any)?.status;
        let entregas;
        if (statusFiltro) {
          entregas = await db.select().from(schema.entregas).where(and(eq(schema.entregas.restauranteId, restauranteId), eq(schema.entregas.status, statusFiltro))).orderBy(desc(schema.entregas.createdAt));
        } else {
          entregas = await db.select().from(schema.entregas).where(eq(schema.entregas.restauranteId, restauranteId)).orderBy(desc(schema.entregas.createdAt));
        }

        // Buscar comandas e itens para cada entrega, com prato_nome e status
        const pedidos = [];
        for (const entrega of entregas) {
          const [comanda] = await db.select().from(schema.comandas).where(eq(schema.comandas.id, entrega.comandaId));
          const itensRaw = await db
            .select({
              id: schema.pedidos.id,
              quantidade: schema.pedidos.quantidade,
              precoUnitario: schema.pedidos.precoUnitario,
              observacao: schema.pedidos.observacao,
              pratoId: schema.pedidos.pratoId,
              status: schema.pedidos.status,
              prato_nome: schema.pratos.nome,
            })
            .from(schema.pedidos)
            .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
            .where(eq(schema.pedidos.comandaId, entrega.comandaId));

          const itens_ativos = itensRaw.filter((i: any) => i.status !== "cancelado").length;
          const itens_prontos = itensRaw.filter((i: any) => i.status === "pronto").length;
          const etapa = calcEtapa(itensRaw, entrega.status);
          const pronto_para_despachar = etapa === "pronto_para_despachar";

          pedidos.push({
            entrega: {
              id: entrega.id,
              status: entrega.status,
              etapa,
              cliente_nome: entrega.clienteNome,
              cliente_telefone: entrega.clienteTelefone,
              endereco: entrega.endereco,
              complemento: entrega.complemento,
              bairro: entrega.bairro,
              cidade: entrega.cidade,
              cep: entrega.cep,
              referencia: entrega.referencia,
              taxa_entrega: entrega.taxaEntrega,
              tempo_estimado: entrega.tempoEstimado,
              observacao: entrega.observacao,
              entregador_nome: entrega.entregadorNome,
              entregador_telefone: entrega.entregadorTelefone,
              saiu_em: entrega.saiuEm,
              entregue_em: entrega.entregueEm,
              created_at: entrega.createdAt,
              itens_ativos,
              itens_prontos,
              pronto_para_despachar,
            },
            comanda,
            itens: itensRaw.map((i: any) => ({
              id: i.id,
              quantidade: i.quantidade,
              preco_unitario: i.precoUnitario,
              observacao: i.observacao,
              prato_id: i.pratoId,
              status: i.status,
              prato_nome: i.prato_nome,
            })),
          });
        }

        return await reply.code(200).send({ pedidos, total: pedidos.length });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao listar delivery");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // GET /api/delivery/pedidos/:id — detalhes de um pedido delivery
  app.fastify.get<{ Params: { id: string } }>(
    "/api/delivery/pedidos/:id",
    {
      schema: {
        description: "Get delivery order details by ID",
        tags: ["delivery"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              entrega: {
                type: "object",
                properties: {
                  itens_ativos: { type: "number" },
                  itens_prontos: { type: "number" },
                  etapa: { type: "string" },
                  pronto_para_despachar: { type: "boolean" },
                },
                additionalProperties: true,
              },
              comanda: { type: "object", additionalProperties: true },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    prato_nome: { type: "string" },
                    status: { type: "string" },
                  },
                  additionalProperties: true,
                },
              },
              pagamentos: { type: "array" },
              pode_cancelar: { type: "boolean" },
              exige_estorno: { type: "boolean" },
              valor_estorno: { type: "number" },
              forma_pagamento_original: { type: "string" },
            },
            additionalProperties: true,
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);

        const [entrega] = await db.select().from(schema.entregas).where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)));
        if (!entrega) return await reply.code(404).send({ error: "Pedido não encontrado" });

        const [comanda] = await db.select().from(schema.comandas).where(eq(schema.comandas.id, entrega.comandaId));
        const itensRaw = await db
          .select({
            id: schema.pedidos.id,
            quantidade: schema.pedidos.quantidade,
            precoUnitario: schema.pedidos.precoUnitario,
            observacao: schema.pedidos.observacao,
            pratoId: schema.pedidos.pratoId,
            status: schema.pedidos.status,
            canceladoEm: schema.pedidos.canceladoEm,
            canceladoPorId: schema.pedidos.canceladoPorId,
            canceladoPorNome: schema.pedidos.canceladoPorNome,
            canceladoPorRole: schema.pedidos.canceladoPorRole,
            motivoCancelamento: schema.pedidos.motivoCancelamento,
            motivoCancelamentoDetalhe: schema.pedidos.motivoCancelamentoDetalhe,
            canceladoAposInicio: schema.pedidos.canceladoAposInicio,
            prato_nome: schema.pratos.nome,
          })
          .from(schema.pedidos)
          .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
          .where(eq(schema.pedidos.comandaId, entrega.comandaId));
        const pagamentos = await db.select().from(schema.pagamentos).where(eq(schema.pagamentos.comandaId, entrega.comandaId));

        const itens_ativos = itensRaw.filter((i: any) => i.status !== "cancelado").length;
        const itens_prontos = itensRaw.filter((i: any) => i.status === "pronto").length;
        const etapa = calcEtapa(itensRaw, entrega.status);
        const pronto_para_despachar = etapa === "pronto_para_despachar";

        // Informações de cancelamento (vêm dos itens cancelados com registro)
        let cancelamento_info: any = null;
        if (entrega.status === "cancelada") {
          const itemCancelado = itensRaw.find((i: any) => i.canceladoPorId || i.cancelado_por_id);
          if (itemCancelado) {
            cancelamento_info = {
              cancelado_por_nome: itemCancelado.canceladoPorNome || itemCancelado.cancelado_por_nome || null,
              cancelado_por_role: itemCancelado.canceladoPorRole || itemCancelado.cancelado_por_role || null,
              cancelado_em: itemCancelado.canceladoEm || itemCancelado.cancelado_em || null,
              motivo_cancelamento: itemCancelado.motivoCancelamento || itemCancelado.motivo_cancelamento || null,
              motivo_cancelamento_detalhe: itemCancelado.motivoCancelamentoDetalhe || itemCancelado.motivo_cancelamento_detalhe || null,
              houve_perda: itensRaw.some((i: any) => i.canceladoAposInicio || i.cancelado_apos_inicio),
            };
          }
          // Extrair estorno_info do pagamento cancelado
          const pagCancelado = pagamentos.find((p: any) => p.status === "cancelado" && p.referencia?.includes("ESTORNO MANUAL"));
          if (pagCancelado?.referencia) {
            cancelamento_info = cancelamento_info || {};
            cancelamento_info.estorno_info = {
              referencia_completa: pagCancelado.referencia,
              valor: parseFloat(pagCancelado.valor || "0"),
              forma_pagamento: pagCancelado.formaPagamento,
            };
          }
        }

        // Calcular pode_cancelar e motivo_nao_pode_cancelar para o usuário atual
        const userRole = (authUser.role || "").toLowerCase();
        const ehGestorAtual = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"].includes(userRole);
        const ehCozinheiro = ["cozinheiro", "kitchen"].includes(userRole);

        let pode_cancelar = false;
        let motivo_nao_pode_cancelar: string | null = null;
        let exige_estorno = false;
        let valor_estorno: number | null = null;
        let forma_pagamento_original: string | null = null;

        if (ehCozinheiro) {
          motivo_nao_pode_cancelar = "Cozinheiro não pode cancelar pedidos de delivery.";
        } else if (entrega.status === "entregue") {
          motivo_nao_pode_cancelar = "Não é possível cancelar uma entrega já entregue.";
        } else if (entrega.status === "cancelada") {
          motivo_nao_pode_cancelar = "Esta entrega já foi cancelada.";
        } else if (pagamentos.some((p: any) => p.status === "confirmado")) {
          if (ehGestorAtual) {
            // Gestor pode cancelar, mas exige estorno
            const pagConf = pagamentos.find((p: any) => p.status === "confirmado");
            pode_cancelar = true;
            exige_estorno = true;
            valor_estorno = parseFloat(pagConf?.valor || "0");
            forma_pagamento_original = pagConf?.formaPagamento || null;
          } else {
            motivo_nao_pode_cancelar = "Este pedido já foi pago. Só gerente ou administrador pode cancelar e registrar o estorno.";
          }
        } else {
          const itensAtivosLocal = itensRaw.filter((i: any) => i.status !== "cancelado");
          const itensIniciadosLocal = itensAtivosLocal.filter((i: any) => i.status === "em_preparo" || i.status === "pronto");
          const entregaSaiuLocal = entrega.status === "saiu_entrega";

          if (!ehGestorAtual && entregaSaiuLocal) {
            motivo_nao_pode_cancelar = "Só gerente ou administrador pode cancelar um pedido que já saiu para entrega.";
          } else if (!ehGestorAtual && itensIniciadosLocal.length > 0) {
            motivo_nao_pode_cancelar = "Só gerente ou administrador pode cancelar um pedido que já está em preparo.";
          } else {
            pode_cancelar = true;
          }
        }

        return await reply.code(200).send({
          entrega: {
            id: entrega.id,
            status: entrega.status,
            etapa,
            cliente_nome: entrega.clienteNome,
            cliente_telefone: entrega.clienteTelefone,
            endereco: entrega.endereco,
            complemento: entrega.complemento,
            bairro: entrega.bairro,
            cidade: entrega.cidade,
            cep: entrega.cep,
            referencia: entrega.referencia,
            taxa_entrega: entrega.taxaEntrega,
            tempo_estimado: entrega.tempoEstimado,
            observacao: entrega.observacao,
            entregador_nome: entrega.entregadorNome,
            entregador_telefone: entrega.entregadorTelefone,
            saiu_em: entrega.saiuEm,
            entregue_em: entrega.entregueEm,
            created_at: entrega.createdAt,
            itens_ativos,
            itens_prontos,
            pronto_para_despachar,
            cancelamento_info,
          },
          comanda,
          itens: itensRaw.map((i: any) => ({
            id: i.id,
            quantidade: i.quantidade,
            preco_unitario: i.precoUnitario,
            observacao: i.observacao,
            prato_id: i.pratoId,
            status: i.status,
            prato_nome: i.prato_nome,
            cancelado_em: i.canceladoEm,
            cancelado_por_id: i.canceladoPorId,
            cancelado_por_nome: i.canceladoPorNome,
            cancelado_por_role: i.canceladoPorRole,
            motivo_cancelamento: i.motivoCancelamento,
            motivo_cancelamento_detalhe: i.motivoCancelamentoDetalhe,
            cancelado_apos_inicio: i.canceladoAposInicio,
          })),
          pagamentos: pagamentos.map((p: any) => ({
            id: p.id,
            valor: p.valor,
            forma_pagamento: p.formaPagamento,
            status: p.status,
            troco: p.troco,
            referencia: p.referencia,
            confirmado_em: p.confirmadoEm,
          })),
          pode_cancelar,
          motivo_nao_pode_cancelar,
          exige_estorno,
          valor_estorno,
          forma_pagamento_original,
        });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao consultar delivery");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // PUT /api/delivery/pedidos/:id/status — atualizar status da entrega
  app.fastify.put<{ Params: { id: string }; Body: { status: string; entregador_nome?: string; entregador_telefone?: string } }>(
    "/api/delivery/pedidos/:id/status",
    {
      schema: {
        description: "Update delivery order status",
        tags: ["delivery"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["saiu_entrega"] },
            entregador_nome: { type: "string" },
            entregador_telefone: { type: "string" },
          },
          required: ["status"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              entrega: { type: "object" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { status: string; entregador_nome?: string; entregador_telefone?: string } }>, reply: FastifyReply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        if (!(await requireRole(authUser, ["garcom", "gerente", "administrador", "admin", "superadmin", "super_admin"], reply))) return;
        const restauranteId = requireTenant(authUser);

        if (request.body.status === "entregue") {
          return await reply.code(409).send({ error: "Para confirmar a entrega use PUT /api/delivery/pedidos/:id/confirmar-entrega (registra o pagamento e fecha a comanda)." });
        }

        const [entrega] = await db.select().from(schema.entregas)
          .where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)));
        if (!entrega) return await reply.code(404).send({ error: "Entrega não encontrada" });

        const { status, entregador_nome, entregador_telefone } = request.body;

        if (status === "cancelada") {
          return await reply.code(409).send({ error: "Para cancelar um pedido de delivery use PUT /api/delivery/pedidos/:id/cancelar (motivo obrigatório)." });
        }

        // Bug 1: para saiu_entrega, aceitar tanto "pendente" quanto "preparando" como status atual
        if (status === "saiu_entrega") {
          if (!["pendente", "preparando"].includes(entrega.status)) {
            return await reply.code(409).send({ error: `Não é possível despachar uma entrega com status "${entrega.status}". O pedido precisa estar em "pendente" ou "preparando".` });
          }

          if (!entregador_nome?.trim()) {
            return await reply.code(400).send({ error: "O nome de quem vai entregar é obrigatório para despachar." });
          }
          const itens = await db.select({ status: schema.pedidos.status })
            .from(schema.pedidos)
            .where(eq(schema.pedidos.comandaId, entrega.comandaId));
          const ativos = itens.filter((i: any) => i.status !== "cancelado");
          const prontos = ativos.filter((i: any) => i.status === "pronto");
          if (ativos.length === 0) {
            return await reply.code(409).send({ error: "Não há itens ativos neste pedido." });
          }
          if (prontos.length < ativos.length) {
            return await reply.code(409).send({ error: `Ainda há itens em preparo. ${prontos.length} de ${ativos.length} itens prontos.` });
          }
        } else {
          // Para outros status futuros, manter verificação de sequência
          const SEQUENCIA = ["pendente", "preparando", "saiu_entrega", "entregue"];
          const idxAtual = SEQUENCIA.indexOf(entrega.status);
          const idxNovo = SEQUENCIA.indexOf(status);
          if (idxNovo === -1) return await reply.code(400).send({ error: "Status inválido." });
          if (idxNovo !== idxAtual + 1) {
            return await reply.code(409).send({ error: `Não é possível passar de "${entrega.status}" para "${status}". A sequência correta é: ${SEQUENCIA.join(" → ")}.` });
          }
        }

        const updateData: any = { status };
        if (status === "saiu_entrega") {
          updateData.saiuEm = new Date();
          updateData.entregadorNome = entregador_nome!.trim();
          if (entregador_telefone) updateData.entregadorTelefone = entregador_telefone;
        }
        if (status === "entregue") {
          updateData.entregueEm = new Date();
        }

        await db.update(schema.entregas).set(updateData).where(eq(schema.entregas.id, request.params.id));
        const [entregaAtualizada] = await db.select().from(schema.entregas).where(eq(schema.entregas.id, request.params.id));

        // Publicar evento realtime
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.status_changed",
            entityId: entrega.comandaId,
            occurredAt: new Date().toISOString(),
            payload: { comanda_id: entrega.comandaId, tipo: "delivery", status, cliente_nome: entrega.clienteNome },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery event");
        }

        return await reply.code(200).send({ entrega: entregaAtualizada });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao atualizar status delivery");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // PUT /api/delivery/pedidos/:id/cancelar — cancelar pedido de delivery com motivo
  app.fastify.put<{ Params: { id: string }; Body: { motivo: string; detalhe?: string; confirmar_estorno?: boolean; forma_devolucao?: string; detalhe_devolucao?: string; observacao_estorno?: string } }>(
    "/api/delivery/pedidos/:id/cancelar",
    {
      schema: {
        description: "Cancelar pedido de delivery com motivo",
        tags: ["delivery"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["motivo"],
          properties: {
            motivo: { type: "string" },
            detalhe: { type: "string", maxLength: 300 },
            confirmar_estorno: { type: "boolean" },
            forma_devolucao: { type: "string", enum: ["pix", "dinheiro", "estorno_cartao", "outra"] },
            detalhe_devolucao: { type: "string", maxLength: 300 },
            observacao_estorno: { type: "string", maxLength: 300 },
          },
        },
        response: {
          200: { type: "object", properties: { ok: { type: "boolean" }, houve_perda: { type: "boolean" }, houve_estorno: { type: "boolean" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const restauranteId = requireTenant(authUser);
        const { motivo, detalhe } = request.body;
        const entregaId = request.params.id;

        const MOTIVOS_VALIDOS = [
          "erro_lancamento", "cliente_desistiu", "item_em_falta", "demora",
          "qualidade", "outro", "cliente_nao_atendeu", "endereco_fora_area",
        ];
        if (!MOTIVOS_VALIDOS.includes(motivo)) {
          return await reply.code(400).send({ error: "Motivo inválido." });
        }
        if (motivo === "outro" && (!detalhe || !detalhe.trim())) {
          return await reply.code(400).send({ error: "O detalhe é obrigatório quando o motivo é 'outro'." });
        }

        // Cozinheiro nunca cancela
        const role = (authUser.role || "").toLowerCase();
        if (["cozinheiro", "kitchen"].includes(role)) {
          return await reply.code(403).send({ error: "Cozinheiro não pode cancelar pedidos de delivery." });
        }

        const ehGestor = ["gerente", "administrador", "admin", "manager", "superadmin", "super_admin"].includes(role);

        // Tudo dentro de uma transação
        const resultado = await (db as any).transaction(async (tx: any) => {
          // 1) Buscar e travar a entrega
          const [entrega] = await tx.select()
            .from(schema.entregas)
            .where(and(eq(schema.entregas.id, entregaId), eq(schema.entregas.restauranteId, restauranteId)))
            .for("update");
          if (!entrega) return { erro: "Entrega não encontrada", code: 404 };

          // 2) Verificar estado da entrega
          if (entrega.status === "entregue") {
            return { erro: "Não é possível cancelar uma entrega já entregue.", code: 409 };
          }
          if (entrega.status === "cancelada") {
            return { erro: "Esta entrega já foi cancelada.", code: 409 };
          }

          // 3) Buscar e travar a comanda
          const [comanda] = await tx.select()
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, entrega.comandaId), eq(schema.comandas.restauranteId, restauranteId)))
            .for("update");
          if (!comanda) return { erro: "Pedido não encontrado", code: 404 };

          // 4) Verificar pagamento confirmado
          const pagamentos = await tx.select()
            .from(schema.pagamentos)
            .where(eq(schema.pagamentos.comandaId, comanda.id));
          const pagsConfirmados = pagamentos.filter((p: any) => p.status === "confirmado");
          if (pagsConfirmados.length > 0) {
            // Garçom nunca pode cancelar pedido pago
            if (!ehGestor) {
              return { erro: "Este pedido já foi pago. Só gerente ou administrador pode cancelar e registrar o estorno.", code: 403 };
            }
            // Gestor precisa confirmar o estorno explicitamente
            const { confirmar_estorno, forma_devolucao, detalhe_devolucao } = (request as any).body;
            if (!confirmar_estorno) {
              return { erro: "Este pedido já foi pago. Para cancelar, confirme que o valor será devolvido ao cliente (campo confirmar_estorno: true).", code: 409 };
            }
            if (!forma_devolucao) {
              return { erro: "Informe como o valor será devolvido ao cliente (campo forma_devolucao).", code: 400 };
            }
            if (forma_devolucao === "outra" && (!detalhe_devolucao || !detalhe_devolucao.trim())) {
              return { erro: "O detalhe da devolução é obrigatório quando a forma for 'outra'.", code: 400 };
            }
          }

          // 5) Buscar todos os itens
          const itens = await tx.select()
            .from(schema.pedidos)
            .where(eq(schema.pedidos.comandaId, comanda.id));

          // 6) Verificar se algum item já foi entregue
          const itemEntregue = itens.find((i: any) => i.status === "entregue");
          if (itemEntregue) {
            return { erro: "Não é possível cancelar: um ou mais itens já foram entregues.", code: 409 };
          }

          // 7) Verificar permissão por momento
          const itensAtivos = itens.filter((i: any) => i.status !== "cancelado");
          const itensIniciados = itensAtivos.filter((i: any) => i.status === "em_preparo" || i.status === "pronto");
          const entregaSaiu = entrega.status === "saiu_entrega";

          if (!ehGestor) {
            // Garçom só pode cancelar se tudo pendente e entrega não saiu
            if (entregaSaiu) {
              return { erro: "Só gerente ou administrador pode cancelar um pedido que já saiu para entrega.", code: 403 };
            }
            if (itensIniciados.length > 0) {
              return { erro: "Só gerente ou administrador pode cancelar um pedido que já está em preparo.", code: 403 };
            }
          }

          // 8) Cancelar todos os itens ativos
          const agora = new Date();
          let houvePerda = false;
          for (const item of itensAtivos) {
            const aposInicio = item.status === "em_preparo" || item.status === "pronto" || entregaSaiu;
            if (aposInicio) houvePerda = true;
            await tx.update(schema.pedidos)
              .set({
                status: "cancelado",
                canceladoEm: agora,
                canceladoPorId: authUser.id,
                canceladoPorNome: ((authUser as any).name || (authUser as any).nome || "Desconhecido") as string,
                canceladoPorRole: authUser.role,
                motivoCancelamento: motivo as any,
                motivoCancelamentoDetalhe: detalhe || null,
                canceladoAposInicio: aposInicio,
              })
              .where(eq(schema.pedidos.id, item.id));
          }

          // 9) Marcar entrega como cancelada
          await tx.update(schema.entregas)
            .set({ status: "cancelada" as any })
            .where(eq(schema.entregas.id, entregaId));

          // 10) Marcar comanda como cancelada e zerar totais
          await tx.update(schema.comandas)
            .set({ status: "cancelada" as any, subtotal: "0.00", total: "0.00" })
            .where(eq(schema.comandas.id, comanda.id));

          // 11) Cancelar pagamento pendente (se houver)
          await tx.update(schema.pagamentos)
            .set({ status: "cancelado" as any })
            .where(and(
              eq(schema.pagamentos.comandaId, comanda.id),
              eq(schema.pagamentos.status, "pendente" as any)
            ));

          // 12) Registrar estorno manual nos pagamentos confirmados (se houver)
          const { confirmar_estorno, forma_devolucao, detalhe_devolucao, observacao_estorno } = (request as any).body;
          if (pagsConfirmados.length > 0 && confirmar_estorno) {
            const agora12 = new Date();
            const autorNome = (authUser as any).name || (authUser as any).nome || "Desconhecido";
            const autorRole = authUser.role || "";
            const FORMA_LABEL: Record<string, string> = {
              pix: "Pix", dinheiro: "Dinheiro", estorno_cartao: "Estorno no cartão", outra: detalhe_devolucao || "Outra forma",
            };
            const formaLabel = FORMA_LABEL[forma_devolucao] || forma_devolucao;

            for (const pag of pagsConfirmados) {
              const valorStr = parseFloat(pag.valor || "0").toFixed(2);
              const refEstorno = [
                `ESTORNO MANUAL — R$ ${valorStr} via ${formaLabel}`,
                observacao_estorno ? `Obs: ${observacao_estorno}` : null,
                `Autorizado por: ${autorNome} (${autorRole}) em ${agora12.toLocaleString("pt-BR")}`,
              ].filter(Boolean).join(" | ");

              const refFinal = pag.referencia
                ? `${pag.referencia} | ${refEstorno}`
                : refEstorno;

              await tx.update(schema.pagamentos)
                .set({ status: "cancelado" as any, referencia: refFinal })
                .where(eq(schema.pagamentos.id, pag.id));
            }

            app.logger.info({
              autorId: authUser.id,
              autorNome,
              autorRole,
              comandaId: comanda.id,
              valor: pagsConfirmados.map((p: any) => p.valor).join(", "),
              formaDevolucao: forma_devolucao,
            }, "Estorno manual registrado no cancelamento de delivery");
          }

          return { ok: true, houvePerda, houve_estorno: pagsConfirmados.length > 0, clienteNome: entrega.clienteNome, comandaId: comanda.id };
        });

        if (resultado.erro) {
          return await reply.code(resultado.code).send({ error: resultado.erro });
        }

        // Publicar evento realtime após a transação
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.cancelado",
            entityId: resultado.comandaId,
            occurredAt: new Date().toISOString(),
            payload: {
              comanda_id: resultado.comandaId,
              tipo: "delivery",
              status: "cancelada",
              cliente_nome: resultado.clienteNome,
              houve_item_iniciado: resultado.houvePerda,
            },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery.cancelado event");
        }

        return await reply.code(200).send({ ok: true, houve_perda: resultado.houvePerda, houve_estorno: resultado.houve_estorno ?? false });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao cancelar delivery");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // PUT /api/delivery/pedidos/:id/confirmar-entrega — confirmar entrega, cobrar e fechar comanda
  app.fastify.put<{
    Params: { id: string };
    Body: { forma_pagamento?: string; valor_recebido?: number };
  }>(
    "/api/delivery/pedidos/:id/confirmar-entrega",
    {
      schema: {
        description: "Confirmar entrega, cobrar e fechar a comanda",
        tags: ["delivery"],
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            forma_pagamento: { type: "string", enum: ["pix", "credito", "debito", "dinheiro", "cartão de crédito", "cartão de débito"] },
            valor_recebido: { type: "number" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
            additionalProperties: true,
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      try {
        const authUser = await customRequireAuth(app, request, reply);
        if (!authUser) return;
        const role = (authUser.role || "").toLowerCase();
        if (["cozinheiro", "kitchen"].includes(role)) {
          return await reply.code(403).send({ error: "Cozinheiro não pode confirmar entregas." });
        }
        const restauranteId = requireTenant(authUser);
        const { forma_pagamento, valor_recebido } = request.body;

        let troco: number | null = null;

        const resultado = await (db as any).transaction(async (tx: any) => {
          // 1) Travar entrega
          const [entrega] = await tx.select()
            .from(schema.entregas)
            .where(and(eq(schema.entregas.id, request.params.id), eq(schema.entregas.restauranteId, restauranteId)))
            .for("update");
          if (!entrega) return { erro: "Entrega não encontrada", code: 404 };

          if (entrega.status === "entregue") {
            return { erro: "Esta entrega já foi confirmada.", code: 409 };
          }
          if (entrega.status !== "saiu_entrega") {
            return { erro: `Só é possível confirmar a entrega quando o status é 'saiu_entrega'. Status atual: '${entrega.status}'.`, code: 409 };
          }

          // 2) Travar comanda
          const [comanda] = await tx.select()
            .from(schema.comandas)
            .where(and(eq(schema.comandas.id, entrega.comandaId), eq(schema.comandas.restauranteId, restauranteId)))
            .for("update");
          if (!comanda) return { erro: "Pedido não encontrado", code: 404 };

          // 3) Calcular total
          const totalDue = await totalDelivery(tx, comanda.id);
          const subtotal = await subtotalDaComanda(tx, comanda.id);

          // 4) Buscar pagamento pendente
          const [pagPendente] = await tx.select()
            .from(schema.pagamentos)
            .where(and(
              eq(schema.pagamentos.comandaId, comanda.id),
              eq(schema.pagamentos.status, "pendente" as any)
            ));

          // 5) Processar pagamento
          if (pagPendente) {
            const formaReal = normalizarForma(forma_pagamento || pagPendente.formaPagamento);
            if (formaReal === "dinheiro") {
              if (valor_recebido === undefined || valor_recebido === null) {
                return { erro: "Informe o valor recebido do cliente para pagamento em dinheiro.", code: 400 };
              }
              if (Math.round(valor_recebido * 100) < Math.round(totalDue * 100)) {
                return { erro: `Valor recebido (R$ ${valor_recebido.toFixed(2)}) é menor que o total (R$ ${totalDue.toFixed(2)}).`, code: 400 };
              }
              troco = Math.round((valor_recebido - totalDue) * 100) / 100;
            }
            await tx.update(schema.pagamentos)
              .set({
                status: "confirmado" as any,
                formaPagamento: formaReal as any,
                valor: totalDue.toFixed(2),
                confirmadoEm: new Date(),
                referencia: troco !== null && troco > 0 ? `Troco: R$ ${troco.toFixed(2)}` : null,
              })
              .where(eq(schema.pagamentos.id, pagPendente.id));
          } else {
            // Verificar se já está pago
            const [pagConfirmado] = await tx.select()
              .from(schema.pagamentos)
              .where(and(
                eq(schema.pagamentos.comandaId, comanda.id),
                eq(schema.pagamentos.status, "confirmado" as any)
              ));
            if (!pagConfirmado) {
              return { erro: "O pedido não está pago. Registre o pagamento antes de confirmar a entrega.", code: 409 };
            }
            // Bug 5: verificar se o valor pago bate com o total atual
            const valorPago = parseFloat(pagConfirmado.valor);
            if (Math.abs(valorPago - totalDue) > 0.01) {
              return { erro: `O valor pago (R$ ${valorPago.toFixed(2)}) difere do total atual do pedido (R$ ${totalDue.toFixed(2)}). Verifique com o gerente antes de confirmar a entrega.`, code: 409 };
            }
          }

          // 6) Marcar entrega como entregue
          await tx.update(schema.entregas)
            .set({ status: "entregue" as any, entregueEm: new Date() })
            .where(eq(schema.entregas.id, request.params.id));

          // 7) Marcar itens ativos como entregues
          await tx.update(schema.pedidos)
            .set({ status: "entregue" as any })
            .where(and(
              eq(schema.pedidos.comandaId, comanda.id),
              sql`${schema.pedidos.status} <> 'cancelado'`
            ));

          // 8) Fechar comanda
          await tx.update(schema.comandas)
            .set({
              status: "fechada" as any,
              closedAt: new Date(),
              subtotal: subtotal.toFixed(2),
              total: totalDue.toFixed(2),
              gorjeta: "0.00",
            })
            .where(eq(schema.comandas.id, comanda.id));

          return { ok: true, comandaId: comanda.id, clienteNome: entrega.clienteNome };
        });

        if (resultado.erro) {
          return await reply.code(resultado.code).send({ error: resultado.erro });
        }

        // Publicar evento realtime
        try {
          realtimeHub.publish(restauranteId, {
            type: "delivery.status_changed",
            entityId: resultado.comandaId,
            occurredAt: new Date().toISOString(),
            payload: {
              comanda_id: resultado.comandaId,
              tipo: "delivery",
              status: "entregue",
              cliente_nome: resultado.clienteNome,
            },
          });
        } catch (pubErr) {
          app.logger.error({ err: pubErr }, "Failed to publish delivery.status_changed (entregue) event");
        }

        return await reply.code(200).send({ ok: true, troco });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro ao confirmar entrega");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );
}
