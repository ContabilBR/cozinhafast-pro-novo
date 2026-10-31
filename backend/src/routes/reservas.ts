import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, gte, lt, or, ne } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import { sentarReserva } from "../services/sentar-reserva.js";

const PAPEIS_GERENCIAM_RESERVAS = ["administrador", "admin", "gerente", "manager", "superadmin", "super_admin"];
const PAPEIS_CRIAM_EDITAM = ["garcom", "garçom", ...PAPEIS_GERENCIAM_RESERVAS];

// Fuso horário do Brasil
const FUSO_HORAS = -3;
const MS_HORA = 60 * 60 * 1000;

function inicioDoDiaLocal(ano: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes0, dia) - FUSO_HORAS * MS_HORA);
}

function diaLocalDeInstante(instante: Date): { ano: number; mes0: number; dia: number } {
  const ms = instante.getTime() + FUSO_HORAS * MS_HORA;
  const d = new Date(ms);
  return { ano: d.getUTCFullYear(), mes0: d.getUTCMonth(), dia: d.getUTCDate() };
}

function horarioEhValido(dataHora: Date): boolean {
  const agora = new Date();
  const cincoMinutosAtras = new Date(agora.getTime() - 5 * 60 * 1000);
  const noveDiasNoFuturo = new Date(agora.getTime() + 90 * 24 * 60 * 60 * 1000);

  return dataHora >= cincoMinutosAtras && dataHora <= noveDiasNoFuturo;
}

function normalizarTelefone(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 13) {
    return null;
  }
  return digitos;
}

interface CreateReservaBody {
  nome_pessoa: string;
  telefone?: string;
  data_hora: string;
  numero_pessoas: number;
  mesa_id?: string;
  observacao?: string;
}

interface UpdateReservaBody extends CreateReservaBody {}

export function registerReservasRoutes(app: App) {
  // GET /api/reservas - List reservas for a date with optional status filter
  app.fastify.get<{ Querystring: { data?: string; status?: string } }>(
    "/api/reservas",
    {
      schema: {
        description: "List reservas for a date with optional status filter",
        tags: ["reservas"],
        querystring: {
          type: "object",
          properties: {
            data: { type: "string", description: "YYYY-MM-DD format, defaults to today" },
            status: { type: "string", enum: ["confirmada", "sentada", "cancelada", "nao_compareceu"] },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                nome_pessoa: { type: "string" },
                telefone: { type: "string", nullable: true },
                data_hora: { type: "string", format: "date-time" },
                numero_pessoas: { type: "number" },
                mesa: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    numero: { type: "number" },
                  },
                  nullable: true,
                },
                observacao: { type: "string", nullable: true },
                status: { type: "string" },
                duracao: { type: "number" },
                comanda_id: { type: "string", format: "uuid", nullable: true },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { data?: string; status?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const restauranteId = requireTenant(authUser);
        const queryData = request.query.data || new Date().toISOString().split("T")[0];
        const queryStatus = request.query.status;

        // Parse the date (in Brasília timezone)
        const partes = queryData.split("-");
        const ano = parseInt(partes[0]);
        const mes0 = parseInt(partes[1]) - 1;
        const dia = parseInt(partes[2]);

        const inicioData = inicioDoDiaLocal(ano, mes0, dia);
        const fimData = inicioDoDiaLocal(ano, mes0, dia + 1);

        app.logger.info(
          { restauranteId, data: queryData, status: queryStatus },
          "Listing reservas"
        );

        let reservasQuery = app.db
          .select()
          .from(schema.reservas)
          .where(
            and(
              eq(schema.reservas.restauranteId, restauranteId),
              gte(schema.reservas.dataHora, inicioData),
              lt(schema.reservas.dataHora, fimData)
            )
          )
          .orderBy(schema.reservas.dataHora);

        if (queryStatus) {
          reservasQuery = app.db
            .select()
            .from(schema.reservas)
            .where(
              and(
                eq(schema.reservas.restauranteId, restauranteId),
                gte(schema.reservas.dataHora, inicioData),
                lt(schema.reservas.dataHora, fimData),
                eq(schema.reservas.status, queryStatus as any)
              )
            )
            .orderBy(schema.reservas.dataHora);
        }

        const reservas = await reservasQuery;

        // Enriquecer com dados da mesa
        const reservasEnriquecidas = await Promise.all(
          reservas.map(async (res) => {
            let mesa = null;
            if (res.mesaId) {
              const mesaResult = await app.db
                .select()
                .from(schema.mesas)
                .where(eq(schema.mesas.id, res.mesaId as any))
                .limit(1);
              if (mesaResult.length > 0) {
                mesa = { id: mesaResult[0].id, numero: mesaResult[0].numero };
              }
            }

            return {
              id: res.id,
              nome_pessoa: res.nomePessoa,
              telefone: res.telefone || null,
              data_hora: res.dataHora.toISOString(),
              numero_pessoas: res.numeroPessoas,
              mesa,
              observacao: res.observacao || null,
              status: res.status,
              duracao: res.duracao,
              comanda_id: res.comandaId || null,
            };
          })
        );

        app.logger.info({ restauranteId, count: reservasEnriquecidas.length }, "Reservas listed successfully");

        return reservasEnriquecidas;
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list reservas");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/reservas - Create a new reserva
  app.fastify.post<{ Body: CreateReservaBody }>(
    "/api/reservas",
    {
      schema: {
        description: "Create a new reserva (requires garcom/gerente/administrador role)",
        tags: ["reservas"],
        body: {
          type: "object",
          required: ["nome_pessoa", "data_hora", "numero_pessoas"],
          properties: {
            nome_pessoa: { type: "string" },
            telefone: { type: "string" },
            data_hora: { type: "string", format: "date-time" },
            numero_pessoas: { type: "number" },
            mesa_id: { type: "string", format: "uuid" },
            observacao: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              nome_pessoa: { type: "string" },
              data_hora: { type: "string", format: "date-time" },
              numero_pessoas: { type: "number" },
              status: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateReservaBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const restauranteId = requireTenant(authUser);
        const papel = String(authUser.role ?? "").trim().toLowerCase();

        if (!PAPEIS_CRIAM_EDITAM.includes(papel)) {
          app.logger.warn({ userId: authUser.id, papel }, "Acesso negado: criar reserva");
          return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
        }

        const {
          nome_pessoa,
          telefone,
          data_hora,
          numero_pessoas,
          mesa_id,
          observacao,
        } = request.body;

        // Validações
        const nomeTrimado = String(nome_pessoa || "").trim();
        if (nomeTrimado.length === 0 || nomeTrimado.length > 80) {
          return await reply.code(400).send({ error: "Nome deve ter entre 1 e 80 caracteres." });
        }

        let telefoneLimpo: string | null = null;
        if (telefone) {
          telefoneLimpo = normalizarTelefone(telefone);
          if (!telefoneLimpo) {
            return await reply.code(400).send({ error: "Telefone deve ter entre 10 e 13 dígitos." });
          }
        }

        if (!Number.isInteger(numero_pessoas) || numero_pessoas < 1 || numero_pessoas > 50) {
          return await reply.code(400).send({ error: "Número de pessoas deve estar entre 1 e 50." });
        }

        const observacaoTrimada = String(observacao || "").trim();
        if (observacaoTrimada.length > 300) {
          return await reply.code(400).send({ error: "Observação não pode exceder 300 caracteres." });
        }

        const dataHora = new Date(data_hora);
        if (!horarioEhValido(dataHora)) {
          return await reply.code(400).send({
            error: "A data e hora não pode estar mais de 5 minutos no passado nem mais de 90 dias no futuro.",
          });
        }

        // Validar mesa se informada
        let mesaValidada: any = null;
        if (mesa_id) {
          const mesaResult = await app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.id, mesa_id as any),
              eq(schema.mesas.restauranteId, restauranteId)
            ))
            .limit(1);

          if (mesaResult.length === 0) {
            return await reply.code(400).send({ error: "Mesa não encontrada." });
          }
          mesaValidada = mesaResult[0];
        }

        app.logger.info(
          { restauranteId, nomePessoa: nomeTrimado, numeroPessoas: numero_pessoas, mesaId: mesa_id },
          "Creating reserva"
        );

        // Verificar conflito de horário (em transação)
        const resultado = await (app.db as any).transaction(async (tx: any) => {
          // Se tem mesa, travar a mesa e conferir conflito
          if (mesa_id) {
            await tx.execute(
              `SELECT 1 FROM mesas WHERE id = $1 FOR UPDATE`,
              [mesa_id]
            );

            const conflito = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.mesaId, mesa_id as any),
                  or(
                    eq(schema.reservas.status, "confirmada" as any),
                    eq(schema.reservas.status, "sentada" as any)
                  ),
                  // A reserva começa antes de nossa hora de fim E termina depois de nossa hora de início
                  lt(schema.reservas.dataHora, new Date(dataHora.getTime() + 120 * 60 * 1000)),
                  gte(
                    schema.reservas.dataHora,
                    new Date(dataHora.getTime() - 120 * 60 * 1000)
                  )
                )
              )
              .limit(1);

            if (conflito.length > 0) {
              return {
                tipo: "conflito",
                hora_conflito: conflito[0].dataHora.toISOString(),
              };
            }
          }

          // Criar a reserva
          const [novaReserva] = await tx
            .insert(schema.reservas)
            .values({
              id: crypto.randomUUID?.() || require("crypto").randomUUID(),
              restauranteId,
              mesaId: mesa_id || null,
              nomePessoa: nomeTrimado,
              telefone: telefoneLimpo,
              dataHora,
              numeroPessoas: numero_pessoas,
              observacao: observacaoTrimada || null,
              status: "confirmada",
              duracao: 120,
              criadoPor: authUser.id,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          return { tipo: "criada", reserva: novaReserva };
        });

        if (resultado.tipo === "conflito") {
          app.logger.warn(
            { restauranteId, mesaId: mesa_id, horaConflito: resultado.hora_conflito },
            "Conflito de horário ao criar reserva"
          );
          return await reply.code(409).send({
            error: "Já existe uma reserva para esta mesa nesse horário.",
            conflicting_reservation_time: resultado.hora_conflito,
          });
        }

        const reserva = resultado.reserva;

        app.logger.info({ restauranteId, reservaId: reserva.id }, "Reserva created successfully");

        return await reply.code(201).send({
          id: reserva.id,
          nome_pessoa: reserva.nomePessoa,
          data_hora: reserva.dataHora.toISOString(),
          numero_pessoas: reserva.numeroPessoas,
          status: reserva.status,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to create reserva");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // PUT /api/reservas/:id - Update a reserva
  app.fastify.put<{ Params: { id: string }; Body: UpdateReservaBody }>(
    "/api/reservas/:id",
    {
      schema: {
        description: "Update a reserva (requires garcom/gerente/administrador role)",
        tags: ["reservas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["nome_pessoa", "data_hora", "numero_pessoas"],
          properties: {
            nome_pessoa: { type: "string" },
            telefone: { type: "string" },
            data_hora: { type: "string", format: "date-time" },
            numero_pessoas: { type: "number" },
            mesa_id: { type: "string", format: "uuid" },
            observacao: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              nome_pessoa: { type: "string" },
              data_hora: { type: "string", format: "date-time" },
              numero_pessoas: { type: "number" },
              status: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateReservaBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const restauranteId = requireTenant(authUser);
        const papel = String(authUser.role ?? "").trim().toLowerCase();

        if (!PAPEIS_CRIAM_EDITAM.includes(papel)) {
          app.logger.warn({ userId: authUser.id, papel }, "Acesso negado: editar reserva");
          return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
        }

        const { id } = request.params;
        const {
          nome_pessoa,
          telefone,
          data_hora,
          numero_pessoas,
          mesa_id,
          observacao,
        } = request.body;

        // Buscar reserva
        const reservaExistente = await app.db
          .select()
          .from(schema.reservas)
          .where(
            and(
              eq(schema.reservas.id, id as any),
              eq(schema.reservas.restauranteId, restauranteId)
            )
          )
          .limit(1);

        if (reservaExistente.length === 0) {
          return await reply.code(404).send({ error: "Reserva não encontrada." });
        }

        const reserva = reservaExistente[0];

        // Não pode editar se não está mais confirmada
        if (reserva.status !== "confirmada") {
          return await reply.code(409).send({
            error: "Reserva não pode ser editada neste status.",
          });
        }

        // Validações (mesmo que na criação)
        const nomeTrimado = String(nome_pessoa || "").trim();
        if (nomeTrimado.length === 0 || nomeTrimado.length > 80) {
          return await reply.code(400).send({ error: "Nome deve ter entre 1 e 80 caracteres." });
        }

        let telefoneLimpo: string | null = null;
        if (telefone) {
          telefoneLimpo = normalizarTelefone(telefone);
          if (!telefoneLimpo) {
            return await reply.code(400).send({ error: "Telefone deve ter entre 10 e 13 dígitos." });
          }
        }

        if (!Number.isInteger(numero_pessoas) || numero_pessoas < 1 || numero_pessoas > 50) {
          return await reply.code(400).send({ error: "Número de pessoas deve estar entre 1 e 50." });
        }

        const observacaoTrimada = String(observacao || "").trim();
        if (observacaoTrimada.length > 300) {
          return await reply.code(400).send({ error: "Observação não pode exceder 300 caracteres." });
        }

        const dataHora = new Date(data_hora);
        if (!horarioEhValido(dataHora)) {
          return await reply.code(400).send({
            error: "A data e hora não pode estar mais de 5 minutos no passado nem mais de 90 dias no futuro.",
          });
        }

        // Validar mesa se informada
        if (mesa_id) {
          const mesaResult = await app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.id, mesa_id as any),
              eq(schema.mesas.restauranteId, restauranteId)
            ))
            .limit(1);

          if (mesaResult.length === 0) {
            return await reply.code(400).send({ error: "Mesa não encontrada." });
          }
        }

        app.logger.info(
          { restauranteId, reservaId: id, nomePessoa: nomeTrimado },
          "Updating reserva"
        );

        // Verificar conflito de horário (ignorando a própria reserva)
        const resultado = await (app.db as any).transaction(async (tx: any) => {
          if (mesa_id) {
            await tx.execute(
              `SELECT 1 FROM mesas WHERE id = $1 FOR UPDATE`,
              [mesa_id]
            );

            const conflito = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.mesaId, mesa_id as any),
                  ne(schema.reservas.id, id as any),
                  or(
                    eq(schema.reservas.status, "confirmada" as any),
                    eq(schema.reservas.status, "sentada" as any)
                  ),
                  lt(schema.reservas.dataHora, new Date(dataHora.getTime() + 120 * 60 * 1000)),
                  gte(
                    schema.reservas.dataHora,
                    new Date(dataHora.getTime() - 120 * 60 * 1000)
                  )
                )
              )
              .limit(1);

            if (conflito.length > 0) {
              return {
                tipo: "conflito",
                hora_conflito: conflito[0].dataHora.toISOString(),
              };
            }
          }

          // Atualizar a reserva
          const [reservaAtualizada] = await tx
            .update(schema.reservas)
            .set({
              nomePessoa: nomeTrimado,
              telefone: telefoneLimpo,
              dataHora,
              numeroPessoas: numero_pessoas,
              observacao: observacaoTrimada || null,
              mesaId: mesa_id || null,
              updatedAt: new Date(),
            })
            .where(eq(schema.reservas.id, id as any))
            .returning();

          return { tipo: "atualizada", reserva: reservaAtualizada };
        });

        if (resultado.tipo === "conflito") {
          app.logger.warn({ restauranteId, reservaId: id, mesaId: mesa_id }, "Conflito ao atualizar reserva");
          return await reply.code(409).send({
            error: "Já existe uma reserva para esta mesa nesse horário.",
            conflicting_reservation_time: resultado.hora_conflito,
          });
        }

        const reservaAtualizada = resultado.reserva;

        app.logger.info({ restauranteId, reservaId: id }, "Reserva updated successfully");

        return await reply.code(200).send({
          id: reservaAtualizada.id,
          nome_pessoa: reservaAtualizada.nomePessoa,
          data_hora: reservaAtualizada.dataHora.toISOString(),
          numero_pessoas: reservaAtualizada.numeroPessoas,
          status: reservaAtualizada.status,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update reserva");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // PUT /api/reservas/:id/status - Change reserva status
  app.fastify.put<{ Params: { id: string }; Body: { status: string } }>(
    "/api/reservas/:id/status",
    {
      schema: {
        description: "Change reserva status to cancelada or nao_compareceu (requires gerente/administrador role)",
        tags: ["reservas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["cancelada", "nao_compareceu"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              status: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const restauranteId = requireTenant(authUser);
        const papel = String(authUser.role ?? "").trim().toLowerCase();

        if (!PAPEIS_GERENCIAM_RESERVAS.includes(papel)) {
          app.logger.warn({ userId: authUser.id, papel }, "Acesso negado: mudar status de reserva");
          return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
        }

        const { id } = request.params;
        const { status } = request.body;

        // Validar status
        if (!["cancelada", "nao_compareceu"].includes(status)) {
          return await reply.code(400).send({ error: "Status inválido. Deve ser 'cancelada' ou 'nao_compareceu'." });
        }

        // Buscar reserva
        const reservaExistente = await app.db
          .select()
          .from(schema.reservas)
          .where(
            and(
              eq(schema.reservas.id, id as any),
              eq(schema.reservas.restauranteId, restauranteId)
            )
          )
          .limit(1);

        if (reservaExistente.length === 0) {
          return await reply.code(404).send({ error: "Reserva não encontrada." });
        }

        const reserva = reservaExistente[0];

        // Só pode mudar de confirmada
        if (reserva.status !== "confirmada") {
          return await reply.code(409).send({
            error: `Transição inválida: de '${reserva.status}' para '${status}'`,
          });
        }

        app.logger.info({ restauranteId, reservaId: id, novoStatus: status }, "Updating reserva status");

        // Atualizar
        const [reservaAtualizada] = await app.db
          .update(schema.reservas)
          .set({
            status: status as any,
            updatedAt: new Date(),
          })
          .where(eq(schema.reservas.id, id as any))
          .returning();

        app.logger.info({ restauranteId, reservaId: id, status }, "Reserva status updated successfully");

        return await reply.code(200).send({
          id: reservaAtualizada.id,
          status: reservaAtualizada.status,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update reserva status");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );

  // POST /api/reservas/:id/sentar - Seat a reserva (open comanda and mark as seated)
  app.fastify.post<{ Params: { id: string } }>(
    "/api/reservas/:id/sentar",
    {
      schema: {
        description: "Seat a reserva (open comanda and mark as seated)",
        tags: ["reservas"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              comanda_id: { type: "string", format: "uuid" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const restauranteId = requireTenant(authUser);
        const { id } = request.params;

        app.logger.info({ restauranteId, reservaId: id }, "Seating reserva");

        const resultado = await sentarReserva(app, restauranteId, id, authUser.id);

        switch (resultado.tipo) {
          case "sucesso":
            app.logger.info({ restauranteId, reservaId: id, comandaId: resultado.comandaId }, "Reserva seated successfully");
            return await reply.code(200).send({ comanda_id: resultado.comandaId });

          case "reserva_nao_encontrada":
            return await reply.code(404).send({ error: "Reserva não encontrada." });

          case "reserva_nao_confirmada":
            return await reply.code(409).send({
              error: `Reserva não pode ser sentada neste status: ${resultado.detalhes}`,
            });

          case "reserva_sem_mesa":
            return await reply.code(409).send({ error: "Reserva não tem mesa atribuída." });

          case "mesa_nao_encontrada":
            return await reply.code(404).send({ error: "Mesa não encontrada." });

          case "mesa_ja_ocupada":
            return await reply.code(409).send({ error: "Mesa já está ocupada." });

          case "nome_obrigatorio":
            return await reply.code(409).send({ error: "Nome obrigatório no modo de comanda individual." });

          case "nome_muito_longo":
            return await reply.code(409).send({ error: "Nome da comanda muito longo." });

          case "nome_repetido":
            return await reply.code(409).send({ error: "Já existe uma comanda com este nome nesta mesa." });

          default:
            return await reply.code(500).send({ error: "Erro ao sentar reserva." });
        }
      } catch (error) {
        app.logger.error({ err: error }, "Failed to seat reserva");
        return await reply.code(500).send({ error: "Erro interno do servidor" });
      }
    }
  );
}
