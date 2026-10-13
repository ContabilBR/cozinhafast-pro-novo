import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, desc, sql, and } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant } from "../utils/auth.js";

export function registerHistoricoRoutes(app: App) {
  // GET /api/historico - Get all archived comandas with their pedidos
  app.fastify.get(
    "/api/historico",
    {
      schema: {
        description: "Get all archived comandas and their order items (requires authentication)",
        tags: ["historico"],
        response: {
          200: {
            description: "List of archived comandas with pedidos",
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                mesa_id: { type: "string", format: "uuid", nullable: true },
                mesa_numero: { type: "integer", nullable: true },
                rotulo: { type: "string", nullable: true },
                garcom_id: { type: "string", nullable: true },
                garcom_nome: { type: "string" },
                fechado_por_id: { type: "string", nullable: true },
                fechado_por_nome: { type: "string", nullable: true },
                fechado_por_role: { type: "string", nullable: true },
                status: { type: "string" },
                total: { type: "string" },
                created_at: { type: "string", format: "date-time" },
                closed_at: { type: "string", format: "date-time", nullable: true },
                archived_at: { type: "string", format: "date-time" },
                pedidos: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      prato_id: { type: "string", format: "uuid", nullable: true },
                      prato_nome: { type: "string", nullable: true },
                      quantidade: { type: "integer" },
                      preco_unitario: { type: "string" },
                      observacao: { type: "string", nullable: true },
                      status: { type: "string" },
                      created_at: { type: "string", format: "date-time" },
                      archived_at: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        const tenantId = requireTenant(authUser);
        app.logger.info({ tenantId }, "Fetching historico");

        // Query comandas_historico filtered by tenant with garcom info
        const comandasQuery = sql`
          SELECT
            ch.id,
            ch.mesa_id,
            ch.mesa_numero,
            ch.rotulo,
            ch.garcom_id,
            ch.status,
            ch.total,
            ch.created_at,
            ch.closed_at,
            ch.archived_at,
            ch.fechado_por_id,
            ch.fechado_por_nome,
            ch.fechado_por_role,
            COALESCE(u.nome, 'Não informado') as garcom_nome
          FROM comandas_historico ch
          LEFT JOIN usuarios u ON u.id::text = ch.garcom_id
          WHERE ch.restaurante_id = ${tenantId}
          ORDER BY ch.archived_at DESC
        `;

        const comandas = await (app.db as any).execute(comandasQuery) as any[];

        app.logger.info({ tenantId, count: comandas.length }, "Archived comandas retrieved");

        // For each comanda, fetch its pedidos from pedidos_historico
        const result = await Promise.all(
          comandas.map(async (comanda: any) => {
            const pedidos = await app.db
              .select()
              .from(schema.pedidosHistorico)
              .where(and(
                eq(schema.pedidosHistorico.comandaId, comanda.id),
                eq(schema.pedidosHistorico.restauranteId, tenantId)
              ))
              .then((allPedidos) =>
                allPedidos
                  .sort((a, b) => {
                    const dateA = new Date(b.archivedAt).getTime();
                    const dateB = new Date(a.archivedAt).getTime();
                    return dateA - dateB;
                  })
              );

            return {
              id: comanda.id,
              mesa_id: comanda.mesa_id,
              mesa_numero: comanda.mesa_numero,
              rotulo: comanda.rotulo ?? null,
              garcom_id: comanda.garcom_id,
              garcom_nome: comanda.garcom_nome || "Não informado",
              fechado_por_id: comanda.fechado_por_id || null,
              fechado_por_nome: comanda.fechado_por_nome || null,
              fechado_por_role: comanda.fechado_por_role || null,
              status: comanda.status,
              total: comanda.total.toString(),
              created_at: new Date(comanda.created_at).toISOString(),
              closed_at: comanda.closed_at ? new Date(comanda.closed_at).toISOString() : null,
              archived_at: new Date(comanda.archived_at).toISOString(),
              pedidos: pedidos.map((p) => ({
                id: p.id,
                prato_id: p.pratoId,
                prato_nome: p.pratoNome,
                quantidade: p.quantidade,
                preco_unitario: p.precoUnitario.toString(),
                observacao: p.observacao,
                status: p.status,
                created_at: p.createdAt.toISOString(),
                archived_at: p.archivedAt.toISOString(),
              })),
            };
          })
        );

        app.logger.info({ tenantId, count: result.length }, "Historico fetched successfully");
        return await reply.code(200).send(result);
      } catch (error) {
        app.logger.error({ err: error }, "Failed to fetch historico");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
