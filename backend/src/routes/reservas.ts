import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, gte, lt, or, ne, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";
import { sentarReserva } from "../services/sentar-reserva.js";

const PAPEIS_GERENCIAM_RESERVAS = ["administrador", "admin", "gerente", "manager", "superadmin", "super_admin"];
const PAPEIS_CRIAM_EDITAM = ["garcom", "garçom", ...PAPEIS_GERENCIAM_RESERVAS];
const PAPEIS_PODEM_LISTAR_SENTAR = ["garcom", "garçom", ...PAPEIS_GERENCIAM_RESERVAS];
const DURACAO_PADRAO_RESERVA_MIN = 120;

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

function validarDataFormato(dataStr: string): Date | null {
  // Validate format YYYY-MM-DD and that it's a real date
  const match = dataStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  // Check if date is valid (prevents invalid dates like 2024-02-30)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date;
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
            data: { type: "string", description: "YYYY-MM-DD format, defaults to today in Brasília timezone" },
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
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { data?: string; status?: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      const papel = String(authUser.role ?? "").trim().toLowerCase();
      if (!PAPEIS_PODEM_LISTAR_SENTAR.includes(papel)) {
        app.logger.warn({ userId: authUser.id, papel }, "Acesso negado: listar reservas");
        return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
      }

      try {
        const restauranteId = requireTenant(authUser);
        const queryData = request.query.data;
        const queryStatus = request.query.status;

        // Parse and validate the date in Brasília timezone
        let inicioData: Date;
        let fimData: Date;

        if (queryData) {
          // Validate format YYYY-MM-DD
          const match = queryData.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!match) {
            return await reply.code(400).send({ error: "Data inválida." });
          }

          const [, yearStr, monthStr, dayStr] = match;
          const year = parseInt(yearStr, 10);
          const month = parseInt(monthStr, 10);
          const day = parseInt(dayStr, 10);

          // Validate it's a real date (e.g., not 2024-02-30)
          const dateCheck = new Date(Date.UTC(year, month - 1, day));
          if (dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 || dateCheck.getUTCDate() !== day) {
            return await reply.code(400).send({ error: "Data inválida." });
          }

          // Parse directly: início = midnight Brasília = 3:00 UTC
          inicioData = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
          fimData = new Date(inicioData.getTime() + 24 * 60 * 60 * 1000);
        } else {
          // Default to today in Brasília timezone
          const agora = new Date();
          const { ano, mes0, dia } = diaLocalDeInstante(agora);
          inicioData = inicioDoDiaLocal(ano, mes0, dia);
          fimData = inicioDoDiaLocal(ano, mes0, dia + 1);
        }

        app.logger.info(
          { restauranteId, data: queryData, status: queryStatus },
          "Listing reservas"
        );

        // Build query with conditions
        let whereConditions: any[] = [
          eq(schema.reservas.restauranteId, restauranteId),
          gte(schema.reservas.dataHora, inicioData),
          lt(schema.reservas.dataHora, fimData),
        ];

        if (queryStatus) {
          whereConditions.push(eq(schema.reservas.status, queryStatus as any));
        }

        const reservas = await app.db
          .select({
            id: schema.reservas.id,
            nomePessoa: schema.reservas.nomePessoa,
            telefone: schema.reservas.telefone,
            dataHora: schema.reservas.dataHora,
            numeroPessoas: schema.reservas.numeroPessoas,
            observacao: schema.reservas.observacao,
            status: schema.reservas.status,
            duracao: schema.reservas.duracao,
            comandaId: schema.reservas.comandaId,
            mesaId: schema.reservas.mesaId,
            mesaNumero: schema.mesas.numero,
          })
          .from(schema.reservas)
          .leftJoin(schema.mesas, eq(schema.reservas.mesaId, schema.mesas.id))
          .where(and(...whereConditions))
          .orderBy(schema.reservas.dataHora);

        const resultado = reservas.map((res) => ({
          id: res.id,
          nome_pessoa: res.nomePessoa,
          telefone: res.telefone || null,
          data_hora: res.dataHora.toISOString(),
          numero_pessoas: res.numeroPessoas,
          mesa: res.mesaId && res.mesaNumero ? { id: res.mesaId, numero: res.mesaNumero } : null,
          observacao: res.observacao || null,
          status: res.status,
          duracao: res.duracao,
          comanda_id: res.comandaId || null,
        }));

        app.logger.info({ restauranteId, count: resultado.length }, "Reservas listed successfully");

        return resultado;
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
          409: { type: "object", properties: { error: { type: "string" }, conflicting_reservation_time: { type: "string" } } },
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
          { restauranteId, nomePessoa: nomeTrimado, numeroPessoas: numero_pessoas, mesaId: mesa_id },
          "Creating reserva"
        );

        // Verificar conflito de horário (em transação, com travas apropriadas)
        const resultado = await (app.db as any).transaction(async (tx: any) => {
          if (mesa_id) {
            // 1. Trava de leitura no restaurante (FOR SHARE)
            const restLocked = await tx
              .select()
              .from(schema.restaurante)
              .where(eq(schema.restaurante.id, restauranteId))
              .for("share");

            if (restLocked.length === 0) {
              return { tipo: "restaurante_nao_encontrado" };
            }

            // 2. Trava de escrita na mesa (FOR UPDATE com filtro de restaurante)
            const mesaLocked = await tx
              .select()
              .from(schema.mesas)
              .where(
                and(
                  eq(schema.mesas.id, mesa_id as any),
                  eq(schema.mesas.restauranteId, restauranteId)
                )
              )
              .for("update");

            if (mesaLocked.length === 0) {
              return { tipo: "mesa_nao_encontrada" };
            }

            // 3. Verificar conflito: existe reserva que começa ANTES do fim da nova E termina DEPOIS do início da nova?
            // Conflito se: existente.data_hora < fim_nova AND (existente.data_hora + existente.duracao) > dataHora
            // Com comparações estritas: <, >, não <=, >=

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
                  // Existing starts before new ends
                  lt(schema.reservas.dataHora, new Date(dataHora.getTime() + DURACAO_PADRAO_RESERVA_MIN * 60 * 1000)),
                  // Existing ends (data_hora + duracao) after new starts
                  sql`${schema.reservas.dataHora} + INTERVAL '1 minute' * ${schema.reservas.duracao} > ${dataHora.toISOString()}::timestamptz`
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

          // Criar a reserva (banco já gera o id e timestamps)
          const [novaReserva] = await tx
            .insert(schema.reservas)
            .values({
              restauranteId,
              mesaId: mesa_id || null,
              nomePessoa: nomeTrimado,
              telefone: telefoneLimpo,
              dataHora,
              numeroPessoas: numero_pessoas,
              observacao: observacaoTrimada || null,
              status: "confirmada",
              duracao: DURACAO_PADRAO_RESERVA_MIN,
              criadoPor: authUser.id,
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

        if (resultado.tipo === "restaurante_nao_encontrado") {
          return await reply.code(500).send({ error: "Erro interno do servidor" });
        }

        if (resultado.tipo === "mesa_nao_encontrada") {
          return await reply.code(400).send({ error: "Mesa não encontrada." });
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
          409: { type: "object", properties: { error: { type: "string" }, conflicting_reservation_time: { type: "string" } } },
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
            // 1. Trava de leitura no restaurante (FOR SHARE)
            const restLocked = await tx
              .select()
              .from(schema.restaurante)
              .where(eq(schema.restaurante.id, restauranteId))
              .for("share");

            if (restLocked.length === 0) {
              return { tipo: "restaurante_nao_encontrado" };
            }

            // 2. Trava de escrita na mesa (FOR UPDATE com filtro de restaurante)
            const mesaLocked = await tx
              .select()
              .from(schema.mesas)
              .where(
                and(
                  eq(schema.mesas.id, mesa_id as any),
                  eq(schema.mesas.restauranteId, restauranteId)
                )
              )
              .for("update");

            if (mesaLocked.length === 0) {
              return { tipo: "mesa_nao_encontrada" };
            }

            // 3. Relock da reserva dentro da transação
            const reservaLocked = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.id, id as any),
                  eq(schema.reservas.restauranteId, restauranteId)
                )
              )
              .for("update")
              .limit(1);

            if (reservaLocked.length === 0) {
              return { tipo: "reserva_nao_encontrada" };
            }

            // Recheck status is still confirmada
            if (reservaLocked[0].status !== "confirmada") {
              return { tipo: "status_mudou" };
            }

            // Verificar conflito com outras reservas (excluding self)
            // Use the existing reservation's duration for calculating new end time
            const novaFim = new Date(dataHora.getTime() + (reservaLocked[0].duracao || DURACAO_PADRAO_RESERVA_MIN) * 60 * 1000);
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
                  lt(schema.reservas.dataHora, novaFim),
                  sql`${schema.reservas.dataHora} + INTERVAL '1 minute' * ${schema.reservas.duracao} > ${dataHora.toISOString()}::timestamptz`
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

          // Atualizar a reserva filtrando por id, restaurante, e status confirmada
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
            .where(
              and(
                eq(schema.reservas.id, id as any),
                eq(schema.reservas.restauranteId, restauranteId),
                eq(schema.reservas.status, "confirmada" as any)
              )
            )
            .returning();

          if (!reservaAtualizada) {
            return { tipo: "atualizacao_falhou" };
          }

          return { tipo: "atualizada", reserva: reservaAtualizada };
        });

        if (resultado.tipo === "reserva_nao_encontrada") {
          return await reply.code(404).send({ error: "Reserva não encontrada." });
        }

        if (resultado.tipo === "status_mudou" || resultado.tipo === "atualizacao_falhou") {
          return await reply.code(409).send({
            error: "Reserva não pode ser editada neste status.",
          });
        }

        if (resultado.tipo === "conflito") {
          app.logger.warn({ restauranteId, reservaId: id, mesaId: mesa_id }, "Conflito ao atualizar reserva");
          return await reply.code(409).send({
            error: "Já existe uma reserva para esta mesa nesse horário.",
            conflicting_reservation_time: resultado.hora_conflito,
          });
        }

        if (resultado.tipo === "restaurante_nao_encontrado" || resultado.tipo === "mesa_nao_encontrada") {
          return await reply.code(500).send({ error: "Erro interno do servidor" });
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

        app.logger.info({ restauranteId, reservaId: id, novoStatus: status }, "Updating reserva status");

        // Atualizar, filtrando por restaurante e status confirmada
        const [reservaAtualizada] = await app.db
          .update(schema.reservas)
          .set({
            status: status as any,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.reservas.id, id as any),
              eq(schema.reservas.restauranteId, restauranteId),
              eq(schema.reservas.status, "confirmada" as any)
            )
          )
          .returning();

        if (!reservaAtualizada) {
          // Query to determine if not found or invalid status
          const reserva = await app.db
            .select()
            .from(schema.reservas)
            .where(
              and(
                eq(schema.reservas.id, id as any),
                eq(schema.reservas.restauranteId, restauranteId)
              )
            )
            .limit(1);

          if (reserva.length === 0) {
            return await reply.code(404).send({ error: "Reserva não encontrada." });
          }

          return await reply.code(409).send({
            error: `Transição inválida: de '${reserva[0].status}' para '${status}'`,
          });
        }

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
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      const papel = String(authUser.role ?? "").trim().toLowerCase();
      if (!PAPEIS_PODEM_LISTAR_SENTAR.includes(papel)) {
        app.logger.warn({ userId: authUser.id, papel }, "Acesso negado: sentar reserva");
        return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
      }

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

          case "reserva_alterada":
            return await reply.code(409).send({ error: resultado.detalhes || "A reserva foi alterada ou não está mais disponível para sentar." });

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

          case "erro_interno":
            return await reply.code(500).send({ error: "Erro interno do servidor" });

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
