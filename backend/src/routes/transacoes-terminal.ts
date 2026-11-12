import { eq, and, inArray, desc } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import * as schema from "../db/schema/schema.js";
import { subtotalDaComanda, calcularTotalComandaMesaComDesconto } from "../services/total-comanda.js";
import { obterProvedor, modoDoProvedor, provedorDoRestaurante, PROVEDOR_PADRAO, ProvedorDesconhecidoError } from "../services/terminal-provedores/registro.js";
import type { FormaTerminal, ProvedorTerminal } from "../services/terminal-provedores/tipos.js";
import { descartarCamposSensiveis, sanitizarRetornoBruto } from "../services/terminal-provedores/seguranca.js";

// Pagamento na maquininha. Ciclo de vida da transação no backend, em arquitetura neutra:
//   - camada comum (este arquivo): comanda, valores, travas de banco, pagamento confirmado,
//     isolamento por restaurante e idempotência. Não conhece o vocabulário de nenhum provedor.
//   - um adaptador por provedor (services/terminal-provedores/): traduz a cobrança para o vocabulário
//     do provedor, limita parcelas, monta a instrução de pagamento e valida o retorno. A Stone
//     (Deeplink, "stone_deeplink") é o primeiro; o registro devolve o adaptador pelo nome.
//   - dois modos, declarados pelo adaptador: "aparelho" (o app abre o app de pagamento do aparelho e
//     devolve o resultado) e "nuvem" (o backend manda ao provedor e recebe por webhook/consulta;
//     previsto, ainda sem implementação).
//
// Fluxo (modo "aparelho"):
//   1. O app chama POST /api/comandas/:id/terminal/transacoes. O backend valida a comanda, grava a
//      transação como "iniciada" e devolve a instrução de pagamento ("instrucao_pagamento") e, por
//      compatibilidade, o bloco "terminal" com os mesmos dados (na Stone: valor em centavos, order_id,
//      tipo e parcelamento no vocabulário da Stone).
//   2. O app executa a instrução. Quando o provedor devolve o resultado, o app chama POST .../retorno.
//      Se a transação foi aprovada, o backend grava o pagamento (confirmado, referencia = identificador
//      da transação, "id_externo") na MESMA transação de banco. Cartão já cobrado não pode ser recusado
//      por regra do sistema, então o retorno NÃO valida excesso de valor: ele registra o que aconteceu.
//   3. Se o app não receber retorno (timeout, app fechado), chama POST .../sem-retorno. O retorno
//      ainda pode chegar depois e é aceito enquanto a transação não tiver um desfecho final.
//
// Esta etapa NÃO fecha a comanda sozinha: o retorno informa se a conta foi quitada ("quitada") e
// o fechamento segue pelo /fechar de sempre. Cancelamento e reimpressão ficam para outra etapa.
//
// Segurança: dados_provedor e retorno_bruto nunca guardam número completo de cartão, trilhas, CVV,
// senhas, tokens ou chaves; campos com esses nomes são descartados antes de gravar.
//
// Valores monetários: reais com 2 casas no banco; centavos inteiros só na instrução de pagamento.

const PAPEIS_PAGAMENTO = ["garcom", "gerente", "administrador", "admin"];
const PAPEIS_GESTAO = ["gerente", "administrador", "admin"];

// Limite de tamanho (em caracteres, já em JSON) do objeto dados_provedor
const MAX_DADOS_PROVEDOR = 8000;

const STATUS_FINAIS_NEGATIVOS = ["recusada", "cancelada"];

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function codigoPg(err: any): string | undefined {
  return err?.code ?? err?.cause?.code;
}

// Forma de pagamento do sistema a partir do tipo gravado, pelo adaptador do provedor da transação
function formaDaTransacao(t: any): FormaTerminal | null {
  try {
    return obterProvedor(t.provedor).formaPagamentoDe(t.tipoTransacao);
  } catch {
    return null;
  }
}

function serializar(t: any) {
  return {
    id: t.id,
    order_id: Number(t.orderId),
    comanda_id: t.comandaId,
    pagamento_id: t.pagamentoId ?? null,
    provedor: t.provedor,
    forma_pagamento: formaDaTransacao(t),
    tipo_transacao: t.tipoTransacao,
    tipo_parcelamento: t.tipoParcelamento ?? null,
    parcelas: t.parcelas ?? null,
    valor: Number(t.valor),
    status: t.status,
    atk: t.atk ?? null,
    itk: t.itk ?? null,
    id_externo: t.idExterno ?? null,
    modo_provedor: modoDoProvedor(t.provedor),
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
  id_externo?: string;
  atk?: string; // sinônimo de id_externo (Stone)
  itk?: string;
  retorno_bruto?: string;
  dados_provedor?: Record<string, unknown>;
}

export function registerTransacoesTerminalRoutes(app: App) {
  const db = app.db as any;
  // Limite de parcelas do provedor atual (o schema da rota é montado uma vez, na inicialização)
  const maxParcelasSchema = obterProvedor(PROVEDOR_PADRAO).maxParcelas;

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
            parcelas: { type: "integer", minimum: 1, maximum: maxParcelasSchema },
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

        const provedorNome = provedorDoRestaurante(restauranteId);
        const provedor = obterProvedor(provedorNome);

        const traducao = provedor.traduzirCobranca({ forma_pagamento, parcelas, tipo_parcelamento });
        if (!traducao.ok) {
          return await reply.code(400).send({ error: traducao.erro });
        }
        const cobranca = traducao.cobranca;

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
              provedor: provedorNome,
              tipoTransacao: cobranca.tipoTransacao,
              tipoParcelamento: cobranca.tipoParcelamento,
              parcelas: cobranca.parcelas,
              valor: valorReais.toFixed(2),
              status: "iniciada",
              iniciadaPorId: authUser.id,
              iniciadaPorNome: authUser.name,
            })
            .returning();

          const instrucao = provedor.montarInstrucao({
            valorCentavos: Math.round(valorReais * 100),
            orderId: Number(t.orderId),
            cobranca,
          });

          return {
            status: 201,
            body: {
              transacao: serializar(t),
              // Compatibilidade: mesmos dados que o app já lê (na Stone, os parâmetros da URI do terminal)
              terminal: instrucao.dados,
              // Instrução neutra: provedor, modo e dados para executar
              instrucao_pagamento: instrucao,
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
            id_externo: { type: "string", minLength: 1, maxLength: 100 },
            atk: { type: "string", minLength: 1, maxLength: 100 },
            itk: { type: "string", maxLength: 100 },
            retorno_bruto: { type: "string", maxLength: 8000 },
            dados_provedor: { type: "object" },
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

        const { resultado, itk, dados_provedor } = request.body;
        // id_externo prevalece; atk é aceito como sinônimo (Stone)
        const idExterno = request.body.id_externo?.trim() || request.body.atk?.trim() || undefined;

        // Nada sensível é gravado: campos com nomes de cartão, trilha, CVV, senha, token ou chave são descartados
        const retorno_bruto = request.body.retorno_bruto !== undefined ? sanitizarRetornoBruto(request.body.retorno_bruto) : undefined;
        let dadosProvedor: unknown = undefined;
        if (dados_provedor !== undefined && dados_provedor !== null) {
          if (JSON.stringify(dados_provedor).length > MAX_DADOS_PROVEDOR) {
            return await reply.code(400).send({ error: `dados_provedor excede o limite de ${MAX_DADOS_PROVEDOR} caracteres.` });
          }
          dadosProvedor = descartarCamposSensiveis(dados_provedor);
        }

        const saida: { status: number; body: any } = await db.transaction(async (tx: any) => {
          const encontradas = await tx
            .select()
            .from(schema.transacoesTerminal)
            .where(and(eq(schema.transacoesTerminal.id, request.params.id), eq(schema.transacoesTerminal.restauranteId, restauranteId)))
            .for("update");
          if (!encontradas.length) return { status: 404, body: { error: "Transação não encontrada" } };
          const t = encontradas[0];

          let provedor: ProvedorTerminal;
          try {
            provedor = obterProvedor(t.provedor);
          } catch (e) {
            if (e instanceof ProvedorDesconhecidoError) return { status: 500, body: { error: e.message } };
            throw e;
          }
          const erroRetorno = provedor.validarRetorno({ resultado, idExterno });
          if (erroRetorno) return { status: 400, body: { error: erroRetorno } };
          const legado = provedor.camposLegados({ idExterno, itk });

          // Retorno repetido (o app reenviou): responde o estado atual sem gravar de novo
          if (t.status === "confirmada") {
            if (resultado === "aprovada" && (!t.idExterno || t.idExterno === idExterno)) {
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
                idExterno: idExterno ?? t.idExterno,
                atk: legado.atk ?? t.atk,
                itk: legado.itk ?? t.itk,
                retornoBruto: retorno_bruto ?? t.retornoBruto,
                dadosProvedor: dadosProvedor ?? t.dadosProvedor,
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
                formaPagamento: provedor.formaPagamentoDe(t.tipoTransacao) ?? "cartao_debito",
                status: "confirmado",
                valor: valor.toFixed(2),
                troco: "0",
                referencia: idExterno,
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
              idExterno,
              atk: legado.atk ?? t.atk,
              itk: legado.itk ?? t.itk,
              retornoBruto: retorno_bruto ?? t.retornoBruto,
              dadosProvedor: dadosProvedor ?? t.dadosProvedor,
              retornoEm: agora,
              updatedAt: agora,
            })
            .where(eq(schema.transacoesTerminal.id, t.id))
            .returning();

          if (!comandaAberta) {
            // Cobrança aprovada, mas a comanda já não está aberta (fechada ou arquivada no meio do caminho).
            // A transação fica confirmada com o identificador do provedor para a gestão conciliar ou estornar.
            app.logger.warn({ transacaoId: t.id, comandaId: t.comandaId, idExterno }, "Transação aprovada sem comanda aberta: pagamento não registrado");
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
          // Identificador já usado por outra transação do restaurante (índice único de atk ou de id_externo)
          app.logger.warn({ transacaoId: request.params.id }, "Identificador de transação duplicado ao registrar retorno do terminal");
          return await reply.code(409).send({ error: "Este identificador de transação já está registrado em outra transação." });
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
