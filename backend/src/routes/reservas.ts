import { randomUUID } from "crypto";
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
  mesa_ids?: string[];
  observacao?: string;
}

interface UpdateReservaBody {
  nome_pessoa: string;
  telefone?: string;
  data_hora: string;
  numero_pessoas: number;
  mesa_id?: string | null;
  observacao?: string;
}

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
            grupoId: schema.reservas.grupoId,
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
          grupo_id: res.grupoId || null,
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
            mesa_ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 2, maxItems: 20 },
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
              grupo_id: { type: "string", format: "uuid" },
              reservas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    nome_pessoa: { type: "string" },
                    data_hora: { type: "string", format: "date-time" },
                    numero_pessoas: { type: "number" },
                    status: { type: "string" },
                  },
                },
              },
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
          mesa_ids,
          observacao,
        } = request.body;

        // Validação de conflito: mesa_id e mesa_ids não podem vir juntos
        if (mesa_id && mesa_ids) {
          return await reply.code(400).send({ error: "Não é permitido informar mesa_id e mesa_ids ao mesmo tempo." });
        }

        // Validação de mesa_ids se fornecida
        let mesasDoGrupo: string[] | null = null;
        if (mesa_ids) {
          if (!Array.isArray(mesa_ids) || mesa_ids.length < 2 || mesa_ids.length > 20) {
            return await reply.code(400).send({ error: "Número de mesas deve estar entre 2 e 20." });
          }
          // Normalizar ids: trim e lowercase
          const mesasNormalizadas = mesa_ids.map((id) => String(id).trim().toLowerCase());
          // Checar duplicatas após normalização
          const únicos = new Set(mesasNormalizadas);
          if (únicos.size !== mesasNormalizadas.length) {
            return await reply.code(400).send({ error: "Não é permitido mesas duplicadas na lista." });
          }
          // Sort para garantir ordem ao bloquear
          mesasDoGrupo = mesasNormalizadas.sort();
        }

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

        // Validar mesa única se informada
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
          const mesasParaTravar = mesasDoGrupo || (mesa_id ? [mesa_id] : []);

          if (mesasParaTravar.length > 0) {
            // 1. Trava de leitura no restaurante (FOR SHARE)
            const restLocked = await tx
              .select()
              .from(schema.restaurante)
              .where(eq(schema.restaurante.id, restauranteId))
              .for("share");

            if (restLocked.length === 0) {
              return { tipo: "restaurante_nao_encontrado" };
            }

            // 2. Trava de escrita em TODAS as mesas (em ordem crescente de id)
            for (const mesaParaTravar of mesasParaTravar) {
              const mesaLocked = await tx
                .select()
                .from(schema.mesas)
                .where(
                  and(
                    eq(schema.mesas.id, mesaParaTravar as any),
                    eq(schema.mesas.restauranteId, restauranteId)
                  )
                )
                .for("update");

              if (mesaLocked.length === 0) {
                // Diferenciar erro: grupo vs reserva única
                if (mesasDoGrupo) {
                  return { tipo: "mesa_grupo_nao_encontrada" };
                } else {
                  return { tipo: "mesa_nao_encontrada" };
                }
              }
            }

            // 3. Verificar conflito para CADA mesa
            for (const mesaParaVerificar of mesasParaTravar) {
              const conflito = await tx
                .select()
                .from(schema.reservas)
                .where(
                  and(
                    eq(schema.reservas.mesaId, mesaParaVerificar as any),
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
                if (mesasDoGrupo) {
                  // Para grupo: buscar número da mesa para mensagem
                  const mesaNum = await tx
                    .select({ numero: schema.mesas.numero })
                    .from(schema.mesas)
                    .where(eq(schema.mesas.id, mesaParaVerificar as any))
                    .limit(1);

                  return {
                    tipo: "conflito",
                    mesa_numero: mesaNum[0]?.numero || "?",
                    hora_conflito: conflito[0].dataHora.toISOString(),
                    eh_grupo: true,
                  };
                } else {
                  // Para reserva única: sem número de mesa
                  return {
                    tipo: "conflito",
                    hora_conflito: conflito[0].dataHora.toISOString(),
                    eh_grupo: false,
                  };
                }
              }
            }
          }

          // Gerar grupo_id para reservas múltiplas
          const grupoId = mesasDoGrupo ? randomUUID() : null;

          // Criar as reserva(s) (banco já gera os ids e timestamps)
          if (mesasDoGrupo) {
            // Criar uma linha por mesa do grupo
            const novasReservas = await tx
              .insert(schema.reservas)
              .values(
                mesasDoGrupo.map((mesaId) => ({
                  restauranteId,
                  mesaId: mesaId as any,
                  grupoId: grupoId as any,
                  nomePessoa: nomeTrimado,
                  telefone: telefoneLimpo,
                  dataHora,
                  numeroPessoas: numero_pessoas,
                  observacao: observacaoTrimada || null,
                  status: "confirmada" as any,
                  duracao: DURACAO_PADRAO_RESERVA_MIN,
                  criadoPor: authUser.id,
                }))
              )
              .returning();

            return { tipo: "grupo_criado", grupo_id: grupoId, reservas: novasReservas };
          } else {
            // Reserva única (com ou sem mesa)
            const [novaReserva] = await tx
              .insert(schema.reservas)
              .values({
                restauranteId,
                mesaId: mesa_id ? (mesa_id as any) : null,
                nomePessoa: nomeTrimado,
                telefone: telefoneLimpo,
                dataHora,
                numeroPessoas: numero_pessoas,
                observacao: observacaoTrimada || null,
                status: "confirmada" as any,
                duracao: DURACAO_PADRAO_RESERVA_MIN,
                criadoPor: authUser.id,
              })
              .returning();

            return { tipo: "criada", reserva: novaReserva };
          }
        });

        if (resultado.tipo === "conflito") {
          if (resultado.eh_grupo) {
            app.logger.warn(
              { restauranteId, mesaNumero: resultado.mesa_numero, horaConflito: resultado.hora_conflito },
              "Conflito de horário ao criar reserva de grupo"
            );
            return await reply.code(409).send({
              error: `Já existe uma reserva para a mesa ${resultado.mesa_numero} nesse horário.`,
              conflicting_reservation_time: resultado.hora_conflito,
            });
          } else {
            app.logger.warn(
              { restauranteId, mesaId: mesa_id, horaConflito: resultado.hora_conflito },
              "Conflito de horário ao criar reserva"
            );
            return await reply.code(409).send({
              error: "Já existe uma reserva para esta mesa nesse horário.",
              conflicting_reservation_time: resultado.hora_conflito,
            });
          }
        }

        if (resultado.tipo === "restaurante_nao_encontrado") {
          return await reply.code(500).send({ error: "Erro interno do servidor" });
        }

        if (resultado.tipo === "mesa_nao_encontrada") {
          return await reply.code(400).send({ error: "Mesa não encontrada." });
        }

        if (resultado.tipo === "mesa_grupo_nao_encontrada") {
          return await reply.code(404).send({ error: "Uma ou mais mesas não foram encontradas no restaurante." });
        }

        if (resultado.tipo === "grupo_criado") {
          app.logger.info(
            { restauranteId, grupoId: resultado.grupo_id, count: resultado.reservas.length },
            "Grupo de reservas created successfully"
          );

          return await reply.code(201).send({
            grupo_id: resultado.grupo_id,
            reservas: resultado.reservas.map((res: any) => ({
              id: res.id,
              nome_pessoa: res.nomePessoa,
              data_hora: res.dataHora.toISOString(),
              numero_pessoas: res.numeroPessoas,
              status: res.status,
            })),
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

  // PUT /api/reservas/:id - Update a reserva (or all reservas in grupo if grupo_id exists)
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
            mesa_id: { type: "string", format: "uuid", nullable: true },
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

        // Validação de troca de mesas por tipo de reserva
        const grupoId = reserva.grupoId;
        if (grupoId) {
          // GRUPO: rejeitar mudança de mesas
          const mesaIdNormalizada = mesa_id ? String(mesa_id).trim().toLowerCase() : null;
          const mesaReservaAtualNormalizada = reserva.mesaId ? String(reserva.mesaId).trim().toLowerCase() : null;

          if (mesaIdNormalizada && mesaIdNormalizada !== mesaReservaAtualNormalizada) {
            return await reply.code(400).send({
              error: "Não é permitido alterar as mesas. Para trocar as mesas, cancele a reserva de grupo e crie uma nova.",
            });
          }

          // Rejeitar mesa_ids (buscar no body, se vier como propriedade extra)
          if ((request.body as any).mesa_ids) {
            return await reply.code(400).send({
              error: "Lista de mesas não é permitida na edição. Para alterar as mesas, cancele a reserva de grupo e crie uma nova.",
            });
          }
        } else {
          // RESERVA ÚNICA: rejeitar mesa_ids
          if ((request.body as any).mesa_ids) {
            return await reply.code(400).send({
              error: "Lista de mesas só é permitida na criação de reservas em grupo.",
            });
          }
        }

        // Validar mesa se informada
        let mesaIdAAtualizar: string | null = mesa_id || null;
        if (mesaIdAAtualizar) {
          const mesaResult = await app.db
            .select()
            .from(schema.mesas)
            .where(and(
              eq(schema.mesas.id, mesaIdAAtualizar as any),
              eq(schema.mesas.restauranteId, restauranteId)
            ))
            .limit(1);

          if (mesaResult.length === 0) {
            return await reply.code(400).send({ error: "Mesa não encontrada." });
          }
        }

        app.logger.info(
          { restauranteId, reservaId: id, nomePessoa: nomeTrimado, isGrupo: !!grupoId },
          "Updating reserva"
        );

        // Verificar conflito de horário (em transação com travas apropriadas)
        const resultado = await (app.db as any).transaction(async (tx: any) => {
          if (grupoId) {
            // GRUPO: Lock das mesas e reservas do grupo
            // 1. Trava de leitura no restaurante (FOR SHARE)
            const restLocked = await tx
              .select()
              .from(schema.restaurante)
              .where(eq(schema.restaurante.id, restauranteId))
              .for("share");

            if (restLocked.length === 0) {
              return { tipo: "restaurante_nao_encontrado" };
            }

            // 2. Carregar todas as reservas do grupo (sem lock primeiro)
            const grupoReservas = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.grupoId, grupoId as any),
                  eq(schema.reservas.restauranteId, restauranteId)
                )
              )
              .orderBy(schema.reservas.id);

            if (grupoReservas.length === 0) {
              return { tipo: "grupo_vazio" };
            }

            // Verificar se todas estão confirmadas
            if (grupoReservas.some((r: any) => r.status !== "confirmada")) {
              return { tipo: "status_mudou" };
            }

            // Extrair IDs únicos de mesas e ordenar
            const mesasDoGrupo = Array.from(new Set(grupoReservas.map((r: any) => r.mesaId))).sort() as string[];

            // 2a. Trava de escrita nas mesas do grupo (em ordem crescente)
            for (const mesaId of mesasDoGrupo) {
              const mesaLocked = await tx
                .select()
                .from(schema.mesas)
                .where(
                  and(
                    eq(schema.mesas.id, mesaId as any),
                    eq(schema.mesas.restauranteId, restauranteId)
                  )
                )
                .for("update");

              if (mesaLocked.length === 0) {
                return { tipo: "mesa_nao_encontrada" };
              }
            }

            // 2b. Trava de escrita nas linhas do grupo (em ordem crescente de id)
            const reservasDoGrupo = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.grupoId, grupoId as any),
                  eq(schema.reservas.restauranteId, restauranteId)
                )
              )
              .for("update")
              .orderBy(schema.reservas.id);

            if (reservasDoGrupo.length === 0 || reservasDoGrupo.some((r: any) => r.status !== "confirmada")) {
              return { tipo: "status_mudou" };
            }

            // 3. Verificar conflito para CADA mesa do grupo (excluindo as reservas do grupo)
            for (const mesaId of mesasDoGrupo) {
              const idsDoGrupo = reservasDoGrupo.map((r: any) => r.id);
              const conflito = await tx
                .select()
                .from(schema.reservas)
                .where(
                  and(
                    eq(schema.reservas.mesaId, mesaId as any),
                    eq(schema.reservas.restauranteId, restauranteId),
                    // Excluir as próprias linhas do grupo
                    sql`${schema.reservas.id} NOT IN (${sql.join(idsDoGrupo.map((rid: string) => sql`${rid}::uuid`), sql`, `)})`,
                    or(
                      eq(schema.reservas.status, "confirmada" as any),
                      eq(schema.reservas.status, "sentada" as any)
                    ),
                    lt(schema.reservas.dataHora, new Date(dataHora.getTime() + (reservasDoGrupo[0].duracao || DURACAO_PADRAO_RESERVA_MIN) * 60 * 1000)),
                    sql`${schema.reservas.dataHora} + INTERVAL '1 minute' * ${schema.reservas.duracao} > ${dataHora.toISOString()}::timestamptz`
                  )
                )
                .limit(1);

              if (conflito.length > 0) {
                // Buscar número da mesa para mensagem
                const mesaNum = await tx
                  .select({ numero: schema.mesas.numero })
                  .from(schema.mesas)
                  .where(eq(schema.mesas.id, mesaId as any))
                  .limit(1);

                return {
                  tipo: "conflito",
                  mesa_numero: mesaNum[0]?.numero || "?",
                  hora_conflito: conflito[0].dataHora.toISOString(),
                };
              }
            }

            // Atualizar todas as linhas do grupo (SEM mudar mesaId)
            const idsDoGrupo = reservasDoGrupo.map((r: any) => r.id);
            const reservasAtualizadas = await tx
              .update(schema.reservas)
              .set({
                nomePessoa: nomeTrimado,
                telefone: telefoneLimpo,
                dataHora,
                numeroPessoas: numero_pessoas,
                observacao: observacaoTrimada || null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  sql`${schema.reservas.id} IN (${sql.join(idsDoGrupo.map((rid: string) => sql`${rid}::uuid`), sql`, `)})`,
                  eq(schema.reservas.restauranteId, restauranteId),
                  eq(schema.reservas.status, "confirmada" as any)
                )
              )
              .returning();

            if (reservasAtualizadas.length === 0) {
              return { tipo: "atualizacao_falhou" };
            }

            // Retornar a reserva cujo id foi informado
            const reservaRetorno = reservasAtualizadas.find((r: any) => r.id === id) || reservasAtualizadas[0];
            return { tipo: "atualizada", reserva: reservaRetorno };
          } else {
            // RESERVA ÚNICA
            if (mesaIdAAtualizar) {
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
                    eq(schema.mesas.id, mesaIdAAtualizar as any),
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
              const novaFim = new Date(dataHora.getTime() + (reservaLocked[0].duracao || DURACAO_PADRAO_RESERVA_MIN) * 60 * 1000);
              const conflito = await tx
                .select()
                .from(schema.reservas)
                .where(
                  and(
                    eq(schema.reservas.mesaId, mesaIdAAtualizar as any),
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
                  mesa_id: mesaIdAAtualizar,
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
                mesaId: mesaIdAAtualizar,
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
          }
        });

        if (resultado.tipo === "reserva_nao_encontrada") {
          return await reply.code(404).send({ error: "Reserva não encontrada." });
        }

        if (resultado.tipo === "status_mudou" || resultado.tipo === "atualizacao_falhou" || resultado.tipo === "grupo_vazio") {
          return await reply.code(409).send({
            error: "Reserva não pode ser editada neste status.",
          });
        }

        if (resultado.tipo === "conflito") {
          const logContext: any = { restauranteId, reservaId: id };
          let errorMsg: string;

          if (resultado.mesa_numero !== undefined) {
            // Grupo: tem mesa_numero
            logContext.mesaNumero = resultado.mesa_numero;
            errorMsg = `Já existe uma reserva para a mesa ${resultado.mesa_numero} nesse horário.`;
          } else {
            // Reserva única: tem mesa_id, sem mesa_numero
            logContext.mesaId = resultado.mesa_id;
            errorMsg = "Já existe uma reserva para esta mesa nesse horário.";
          }

          app.logger.warn(logContext, "Conflito ao atualizar reserva");
          return await reply.code(409).send({
            error: errorMsg,
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

  // PUT /api/reservas/:id/status - Change reserva status (or all reservas in grupo if grupo_id exists)
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

        // Buscar reserva para saber se tem grupo_id
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
        const grupoId = reserva.grupoId;

        // Executar em transação
        const resultado = await (app.db as any).transaction(async (tx: any) => {
          if (grupoId) {
            // GRUPO: carregar e atualizar todas as reservas do grupo
            const reservasDoGrupo = await tx
              .select()
              .from(schema.reservas)
              .where(
                and(
                  eq(schema.reservas.grupoId, grupoId as any),
                  eq(schema.reservas.restauranteId, restauranteId)
                )
              )
              .for("update")
              .orderBy(schema.reservas.id);

            if (reservasDoGrupo.length === 0) {
              return { tipo: "grupo_vazio" };
            }

            // Verificar se todas estão confirmadas
            if (reservasDoGrupo.some((r: any) => r.status !== "confirmada")) {
              return { tipo: "status_mudou" };
            }

            // Atualizar todas as linhas do grupo
            const idsDoGrupo = reservasDoGrupo.map((r: any) => r.id);
            const reservasAtualizadas = await tx
              .update(schema.reservas)
              .set({
                status: status as any,
                updatedAt: new Date(),
              })
              .where(
                and(
                  sql`${schema.reservas.id} IN (${sql.join(idsDoGrupo.map((rid: string) => sql`${rid}::uuid`), sql`, `)})`,
                  eq(schema.reservas.restauranteId, restauranteId),
                  eq(schema.reservas.status, "confirmada" as any)
                )
              )
              .returning();

            if (reservasAtualizadas.length === 0) {
              return { tipo: "atualizacao_falhou" };
            }

            // Retornar a reserva cujo id foi informado
            const reservaRetorno = reservasAtualizadas.find((r: any) => r.id === id) || reservasAtualizadas[0];
            return { tipo: "atualizada", reserva: reservaRetorno };
          } else {
            // RESERVA ÚNICA: comportamento original
            const [reservaAtualizada] = await tx
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
              return { tipo: "atualizacao_falhou" };
            }

            return { tipo: "atualizada", reserva: reservaAtualizada };
          }
        });

        if (resultado.tipo === "grupo_vazio" || resultado.tipo === "atualizacao_falhou") {
          return await reply.code(409).send({
            error: `Transição inválida: de '${reserva.status}' para '${status}'`,
          });
        }

        if (resultado.tipo === "status_mudou") {
          return await reply.code(409).send({
            error: `Transição inválida: uma ou mais reservas do grupo já não estão em status confirmada.`,
          });
        }

        const reservaAtualizada = resultado.reserva;

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
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    mesa_id: { type: "string", format: "uuid" },
                    mesa_numero: { type: "number" },
                    comanda_id: { type: "string", format: "uuid" },
                  },
                },
              },
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
            const response: any = { comanda_id: resultado.comandaId };
            if (resultado.comandas && resultado.comandas.length > 0) {
              response.comandas = resultado.comandas;
            }
            return await reply.code(200).send(response);

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
            return await reply.code(404).send({ error: resultado.detalhes || "Mesa não encontrada." });

          case "mesa_nao_livre":
            return await reply.code(409).send({ error: resultado.detalhes || "Mesa não está livre." });

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
