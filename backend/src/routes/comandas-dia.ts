import type { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";
import { obterFusoRestaurante, diaLocalDeInstante, fusoSql } from "../utils/fuso.js";

export function registerComandasDiaRoutes(app: App) {
  // GET /api/comandas-dia - List comandas (mesa) by day
  app.fastify.get(
    "/api/comandas-dia",
    {
      schema: {
        description: "Get all comandas (mesa only) for a specific day, including both live and archived",
        tags: ["comandas-dia"],
        querystring: {
          type: "object",
          properties: {
            data: { type: "string", description: "Date in YYYY-MM-DD format (default: today)" },
            limit: { type: "integer", description: "Max results per page (default: 50, max: 100)" },
            offset: { type: "integer", description: "Skip results (default: 0)" },
          },
        },
        response: {
          200: {
            description: "List of comandas for the day",
            type: "object",
            properties: {
              data: { type: "string" },
              limit: { type: "integer" },
              offset: { type: "integer" },
              total: { type: "integer" },
              resumo: {
                type: "object",
                properties: {
                  abertas: { type: "integer" },
                  fechadas: { type: "integer" },
                  canceladas: { type: "integer" },
                  total_fechadas: { type: "number" },
                },
              },
              comandas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    origem: { type: "string", enum: ["viva", "historico"] },
                    mesa_id: { type: "string", format: "uuid", nullable: true },
                    mesa_numero: { type: "integer", nullable: true },
                    rotulo: { type: "string", nullable: true },
                    garcom_nome: { type: "string" },
                    status: { type: "string" },
                    total: { type: "number" },
                    item_count: { type: "integer" },
                    itens_cancelados: { type: "integer" },
                    created_at: { type: "string", format: "date-time" },
                    closed_at: { type: "string", format: "date-time", nullable: true },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid date format",
            type: "object",
            properties: { error: { type: "string" } },
          },
          401: {
            description: "Unauthorized",
            type: "object",
            properties: { error: { type: "string" } },
          },
          403: {
            description: "Forbidden",
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            description: "Internal server error",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { data?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente", "admin"], reply))) return;

      const tenantId = requireTenant(authUser);
      const fuso = await obterFusoRestaurante(app, tenantId);

      try {
        app.logger.info(
          { tenantId, queryData: request.query.data, limit: request.query.limit, offset: request.query.offset },
          "Fetching comandas by day"
        );

        // Parse date parameter (YYYY-MM-DD), default to today in the restaurant timezone
        let targetDate: string;
        if (request.query.data) {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(request.query.data)) {
            return reply.status(400).send({ error: "Data inválida. Use o formato AAAA-MM-DD." });
          }
          // Validate that the date exists (e.g., not Feb 30)
          const testDate = new Date(request.query.data + "T00:00:00Z");
          const [year, month, day] = request.query.data.split("-").map(Number);
          if (
            testDate.getUTCFullYear() !== year ||
            testDate.getUTCMonth() + 1 !== month ||
            testDate.getUTCDate() !== day
          ) {
            return reply.status(400).send({ error: "Data inválida. Use o formato AAAA-MM-DD." });
          }
          targetDate = request.query.data;
        } else {
          // Get today in the restaurant timezone
          const hoje = diaLocalDeInstante(new Date(), fuso);
          targetDate = `${String(hoje.ano).padStart(4, "0")}-${String(hoje.mes0 + 1).padStart(2, "0")}-${String(hoje.dia).padStart(2, "0")}`;
        }

        // Parse limit and offset
        let limit = 50;
        let offset = 0;

        if (request.query.limit) {
          const parsedLimit = parseInt(request.query.limit, 10);
          if (!isNaN(parsedLimit) && parsedLimit >= 1) {
            limit = Math.min(parsedLimit, 100);
          }
        }

        if (request.query.offset) {
          const parsedOffset = parseInt(request.query.offset, 10);
          if (!isNaN(parsedOffset) && parsedOffset >= 0) {
            offset = parsedOffset;
          }
        }

        // Query union of live (viva, tipo='mesa', NOT in historico) and archived (historico) comandas
        // Filter by date of creation (created_at AT TIME ZONE <restaurant timezone>)::date = targetDate
        const unionQuery = sql`
          WITH filtered_comandas AS (
            -- Live comandas (tipo = 'mesa', not archived)
            SELECT
              c.id,
              'viva'::text as origem,
              c.mesa_id,
              c.mesa_numero,
              c.rotulo,
              c.garcom_id,
              c.status::text as status,
              c.total,
              c.created_at,
              c.closed_at,
              c.restaurante_id
            FROM comandas c
            WHERE
              c.restaurante_id = ${tenantId}
              AND c.tipo = 'mesa'
              AND (c.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
              AND NOT EXISTS (
                SELECT 1 FROM comandas_historico ch
                WHERE ch.id = c.id AND ch.restaurante_id = ${tenantId}
              )
            UNION ALL
            -- Archived comandas (historico)
            SELECT
              ch.id,
              'historico'::text as origem,
              ch.mesa_id,
              ch.mesa_numero,
              ch.rotulo,
              ch.garcom_id,
              ch.status,
              ch.total,
              ch.created_at,
              ch.closed_at,
              ch.restaurante_id
            FROM comandas_historico ch
            WHERE
              ch.restaurante_id = ${tenantId}
              AND (ch.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
          ),
          paginated AS (
            SELECT * FROM filtered_comandas
            ORDER BY created_at DESC, id DESC
            LIMIT ${limit}
            OFFSET ${offset}
          ),
          with_items AS (
            SELECT
              p.id,
              p.origem,
              p.mesa_id,
              p.mesa_numero,
              p.rotulo,
              p.garcom_id,
              p.status,
              p.total,
              p.created_at,
              p.closed_at,
              COALESCE(
                CASE WHEN p.origem = 'viva'
                  THEN (SELECT COALESCE(SUM(pd.quantidade), 0)::int FROM pedidos pd WHERE pd.comanda_id = p.id AND pd.restaurante_id = ${tenantId} AND pd.status::text <> 'cancelado')
                  ELSE (SELECT COALESCE(SUM(pdh.quantidade), 0)::int FROM pedidos_historico pdh WHERE pdh.comanda_id = p.id AND pdh.restaurante_id = ${tenantId} AND pdh.status <> 'cancelado')
                END,
                0
              )::int as item_count,
              COALESCE(
                CASE WHEN p.origem = 'viva'
                  THEN (SELECT COALESCE(SUM(pd.quantidade), 0)::int FROM pedidos pd WHERE pd.comanda_id = p.id AND pd.restaurante_id = ${tenantId} AND pd.status::text = 'cancelado')
                  ELSE (SELECT COALESCE(SUM(pdh.quantidade), 0)::int FROM pedidos_historico pdh WHERE pdh.comanda_id = p.id AND pdh.restaurante_id = ${tenantId} AND pdh.status = 'cancelado')
                END,
                0
              )::int as itens_cancelados
            FROM paginated p
          )
          SELECT
            w.id,
            w.origem,
            w.mesa_id,
            w.mesa_numero,
            w.rotulo,
            w.garcom_id,
            w.status,
            w.total,
            w.created_at,
            w.closed_at,
            w.item_count,
            w.itens_cancelados,
            COALESCE(u.nome, 'Não informado') as garcom_nome
          FROM with_items w
          LEFT JOIN usuarios u ON u.id::text = w.garcom_id AND u.restaurante_id = ${tenantId}
          ORDER BY w.created_at DESC, w.id DESC
        `;

        const comandas = await (app.db as any).execute(unionQuery);

        // Query total count (for pagination info)
        const countQuery = sql`
          SELECT COUNT(*)::int as total
          FROM (
            SELECT c.id FROM comandas c
            WHERE
              c.restaurante_id = ${tenantId}
              AND c.tipo = 'mesa'
              AND (c.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
              AND NOT EXISTS (
                SELECT 1 FROM comandas_historico ch
                WHERE ch.id = c.id AND ch.restaurante_id = ${tenantId}
              )
            UNION ALL
            SELECT ch.id FROM comandas_historico ch
            WHERE
              ch.restaurante_id = ${tenantId}
              AND (ch.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
          ) AS all_comandas
        `;

        const countResult = await (app.db as any).execute(countQuery);
        const total = countResult[0]?.total || 0;

        // Query resumo (summary) for the entire day
        const resumoQuery = sql`
          SELECT
            COALESCE(SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END), 0)::int as abertas,
            COALESCE(SUM(CASE WHEN status = 'fechada' THEN 1 ELSE 0 END), 0)::int as fechadas,
            COALESCE(SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END), 0)::int as canceladas,
            COALESCE(SUM(CASE WHEN status = 'fechada' THEN total ELSE 0 END), 0)::numeric as total_fechadas
          FROM (
            SELECT c.status::text as status, c.total FROM comandas c
            WHERE
              c.restaurante_id = ${tenantId}
              AND c.tipo = 'mesa'
              AND (c.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
              AND NOT EXISTS (
                SELECT 1 FROM comandas_historico ch
                WHERE ch.id = c.id AND ch.restaurante_id = ${tenantId}
              )
            UNION ALL
            SELECT ch.status, ch.total FROM comandas_historico ch
            WHERE
              ch.restaurante_id = ${tenantId}
              AND (ch.created_at AT TIME ZONE ${fusoSql(fuso)})::date = ${targetDate}::date
          ) AS all_comandas
        `;

        const resumoResult = await (app.db as any).execute(resumoQuery);
        const resumo = resumoResult[0] || {
          abertas: 0,
          fechadas: 0,
          canceladas: 0,
          total_fechadas: 0,
        };

        const result = {
          data: targetDate,
          limit,
          offset,
          total,
          resumo: {
            abertas: resumo.abertas,
            fechadas: resumo.fechadas,
            canceladas: resumo.canceladas,
            total_fechadas: Number(resumo.total_fechadas),
          },
          comandas: (comandas as any[]).map((c) => ({
            id: c.id,
            origem: c.origem,
            mesa_id: c.mesa_id,
            mesa_numero: c.mesa_numero,
            rotulo: c.rotulo,
            garcom_nome: c.garcom_nome,
            status: c.status,
            total: Number(c.total),
            item_count: c.item_count,
            itens_cancelados: c.itens_cancelados,
            created_at: new Date(c.created_at).toISOString(),
            closed_at: c.closed_at ? new Date(c.closed_at).toISOString() : null,
          })),
        };

        app.logger.info(
          { tenantId, data: targetDate, count: result.comandas.length, total },
          "Comandas-dia fetched successfully"
        );

        return reply.status(200).send(result);
      } catch (error) {
        app.logger.error({ err: error, tenantId }, "Failed to fetch comandas-dia");
        return reply.status(500).send({ error: "Não foi possível carregar as comandas do dia. Tente novamente." });
      }
    }
  );

  // GET /api/comandas-dia/:id - Get single comanda by ID with full details
  app.fastify.get(
    "/api/comandas-dia/:id",
    {
      schema: {
        description: "Get a single comanda with full details including items and payments",
        tags: ["comandas-dia"],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid", description: "Comanda ID" },
          },
        },
        response: {
          200: {
            description: "Comanda details",
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              origem: { type: "string", enum: ["viva", "historico"] },
              mesa_numero: { type: "integer", nullable: true },
              rotulo: { type: "string", nullable: true },
              garcom_nome: { type: "string" },
              fechado_por_nome: { type: "string", nullable: true },
              status: { type: "string" },
              subtotal: { type: "number" },
              gorjeta: { type: "number" },
              total: { type: "number" },
              desconto: {
                type: "object",
                nullable: true,
                properties: {
                  valor: { type: "number" },
                  tipo: { type: "string", nullable: true },
                  motivo: { type: "string", nullable: true },
                  motivo_detalhe: { type: "string", nullable: true },
                  autorizado_por: { type: "string", nullable: true },
                  aplicado_por: { type: "string", nullable: true },
                },
              },
              created_at: { type: "string", format: "date-time" },
              closed_at: { type: "string", format: "date-time", nullable: true },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    prato_nome: { type: "string" },
                    quantidade: { type: "integer" },
                    preco_unitario: { type: "number" },
                    observacao: { type: "string", nullable: true },
                    status: { type: "string" },
                    cancelamento: {
                      type: "object",
                      nullable: true,
                      properties: {
                        cancelado_em: { type: "string", format: "date-time" },
                        cancelado_por_nome: { type: "string", nullable: true },
                        motivo: { type: "string", nullable: true },
                        motivo_detalhe: { type: "string", nullable: true },
                        apos_inicio: { type: "boolean" },
                      },
                    },
                  },
                },
              },
              pagamentos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    forma_pagamento: { type: "string" },
                    valor: { type: "number" },
                    troco: { type: "number" },
                    status: { type: "string" },
                    confirmado_em: { type: "string", format: "date-time", nullable: true },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid ID format",
            type: "object",
            properties: { error: { type: "string" } },
          },
          401: {
            description: "Unauthorized",
            type: "object",
            properties: { error: { type: "string" } },
          },
          403: {
            description: "Forbidden",
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            description: "Not found",
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            description: "Internal server error",
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["administrador", "gerente", "admin"], reply))) return;

      const tenantId = requireTenant(authUser);
      const { id } = request.params;

      try {
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
          return reply.status(400).send({ error: "Identificador de comanda inválido." });
        }

        app.logger.info({ tenantId, comandaId: id }, "Fetching comanda-dia details");

        // Try to find in historico first
        const historicoQuery = sql`
          SELECT
            ch.id,
            'historico'::text as origem,
            ch.mesa_numero,
            ch.rotulo,
            ch.garcom_id,
            ch.fechado_por_nome,
            ch.status,
            ch.subtotal,
            ch.gorjeta,
            ch.total,
            ch.desconto_valor,
            ch.desconto_tipo,
            ch.desconto_motivo,
            ch.desconto_motivo_detalhe,
            ch.desconto_por_nome,
            ch.desconto_aplicado_por_nome,
            ch.created_at,
            ch.closed_at,
            COALESCE(u.nome, 'Não informado') as garcom_nome
          FROM comandas_historico ch
          LEFT JOIN usuarios u ON u.id::text = ch.garcom_id AND u.restaurante_id = ${tenantId}
          WHERE ch.id = ${id}::uuid AND ch.restaurante_id = ${tenantId}
        `;

        let comandaResult = await (app.db as any).execute(historicoQuery);

        let comanda = comandaResult?.[0];
        let origem = "historico";

        // If not found in historico, try viva
        if (!comanda) {
          const vivaQuery = sql`
            SELECT
              c.id,
              'viva'::text as origem,
              c.mesa_numero,
              c.rotulo,
              c.garcom_id,
              NULL as fechado_por_nome,
              c.status::text as status,
              c.subtotal,
              c.gorjeta,
              c.total,
              c.desconto_valor,
              c.desconto_tipo,
              c.desconto_motivo,
              c.desconto_motivo_detalhe,
              c.desconto_por_nome,
              c.desconto_aplicado_por_nome,
              c.created_at,
              c.closed_at,
              COALESCE(u.nome, 'Não informado') as garcom_nome
            FROM comandas c
            LEFT JOIN usuarios u ON u.id::text = c.garcom_id AND u.restaurante_id = ${tenantId}
            WHERE c.id = ${id}::uuid AND c.restaurante_id = ${tenantId} AND c.tipo = 'mesa'
          `;

          comandaResult = await (app.db as any).execute(vivaQuery);
          comanda = comandaResult?.[0];
          origem = "viva";
        }

        if (!comanda) {
          return reply.status(404).send({ error: "Comanda não encontrada." });
        }

        // Fetch items
        let itensResult: any[] = [];
        if (origem === "historico") {
          const itensHistoricoQuery = sql`
            SELECT
              pdh.id,
              COALESCE(pdh.prato_nome, 'Item removido do cardápio') as prato_nome,
              pdh.quantidade,
              pdh.preco_unitario,
              pdh.observacao,
              pdh.status,
              pdh.cancelado_em,
              pdh.cancelado_por_nome,
              pdh.motivo_cancelamento,
              pdh.motivo_cancelamento_detalhe,
              pdh.cancelado_apos_inicio
            FROM pedidos_historico pdh
            WHERE pdh.comanda_id = ${id}::uuid AND pdh.restaurante_id = ${tenantId}
            ORDER BY pdh.created_at ASC, pdh.id ASC
          `;
          itensResult = await (app.db as any).execute(itensHistoricoQuery);
        } else {
          const itensVivaQuery = sql`
            SELECT
              pd.id,
              COALESCE(pr.nome, 'Item removido do cardápio') as prato_nome,
              pd.quantidade,
              pd.preco_unitario,
              pd.observacao,
              pd.status::text as status,
              pd.cancelado_em,
              pd.cancelado_por_nome,
              pd.motivo_cancelamento,
              pd.motivo_cancelamento_detalhe,
              pd.cancelado_apos_inicio
            FROM pedidos pd
            LEFT JOIN pratos pr ON pr.id = pd.prato_id AND pr.restaurante_id = ${tenantId}
            WHERE pd.comanda_id = ${id}::uuid AND pd.restaurante_id = ${tenantId}
            ORDER BY pd.created_at ASC, pd.id ASC
          `;
          itensResult = await (app.db as any).execute(itensVivaQuery);
        }

        // Fetch payments
        let pagamentosResult: any[] = [];
        if (origem === "historico") {
          const pagHistoricoQuery = sql`
            SELECT
              ph.id,
              ph.forma_pagamento,
              ph.valor,
              ph.troco,
              ph.status,
              ph.confirmado_em
            FROM pagamentos_historico ph
            WHERE ph.comanda_id = ${id}::uuid AND ph.restaurante_id = ${tenantId}
            ORDER BY ph.created_at ASC
          `;
          pagamentosResult = await (app.db as any).execute(pagHistoricoQuery);
        } else {
          const pagVivaQuery = sql`
            SELECT
              p.id,
              p.forma_pagamento::text as forma_pagamento,
              p.valor,
              p.troco,
              p.status::text as status,
              p.confirmado_em
            FROM pagamentos p
            WHERE p.comanda_id = ${id}::uuid AND p.restaurante_id = ${tenantId}
            ORDER BY p.created_at ASC
          `;
          pagamentosResult = await (app.db as any).execute(pagVivaQuery);
        }

        const result = {
          id: comanda.id,
          origem,
          mesa_numero: comanda.mesa_numero,
          rotulo: comanda.rotulo,
          garcom_nome: comanda.garcom_nome,
          fechado_por_nome: comanda.fechado_por_nome || null,
          status: comanda.status,
          subtotal: Number(comanda.subtotal),
          gorjeta: Number(comanda.gorjeta),
          total: Number(comanda.total),
          desconto:
            Number(comanda.desconto_valor) > 0 || comanda.desconto_tipo
              ? {
                  valor: Number(comanda.desconto_valor),
                  tipo: comanda.desconto_tipo || null,
                  motivo: comanda.desconto_motivo || null,
                  motivo_detalhe: comanda.desconto_motivo_detalhe || null,
                  autorizado_por: comanda.desconto_por_nome || null,
                  aplicado_por: comanda.desconto_aplicado_por_nome || null,
                }
              : null,
          created_at: new Date(comanda.created_at).toISOString(),
          closed_at: comanda.closed_at ? new Date(comanda.closed_at).toISOString() : null,
          itens: itensResult.map((item: any) => ({
            id: item.id,
            prato_nome: item.prato_nome,
            quantidade: item.quantidade,
            preco_unitario: Number(item.preco_unitario),
            observacao: item.observacao,
            status: item.status,
            cancelamento:
              item.status === "cancelado"
                ? {
                    cancelado_em: new Date(item.cancelado_em).toISOString(),
                    cancelado_por_nome: item.cancelado_por_nome || null,
                    motivo: item.motivo_cancelamento || null,
                    motivo_detalhe: item.motivo_cancelamento_detalhe || null,
                    apos_inicio: item.cancelado_apos_inicio || false,
                  }
                : null,
          })),
          pagamentos: pagamentosResult.map((pag: any) => ({
            id: pag.id,
            forma_pagamento: pag.forma_pagamento,
            valor: Number(pag.valor),
            troco: Number(pag.troco),
            status: pag.status,
            confirmado_em: pag.confirmado_em ? new Date(pag.confirmado_em).toISOString() : null,
          })),
        };

        app.logger.info(
          { tenantId, comandaId: id, origem },
          "Comanda-dia details fetched successfully"
        );

        return reply.status(200).send(result);
      } catch (error) {
        app.logger.error({ err: error, tenantId, comandaId: id }, "Failed to fetch comanda-dia details");
        return reply.status(500).send({ error: "Não foi possível carregar a comanda. Tente novamente." });
      }
    }
  );
}
