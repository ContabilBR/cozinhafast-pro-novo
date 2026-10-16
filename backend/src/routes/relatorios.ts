import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sum, count, gte, lt, and, sql, not, gt } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";

type Periodo = "hoje" | "7dias" | "mes" | "personalizado";

// ---------------------------------------------------------------------------
// Períodos do dashboard/relatórios
// ---------------------------------------------------------------------------
// Fuso do negócio: America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
// Todos os "dias" (hoje, 7 dias, mês, personalizado) começam à meia-noite DESTE
// fuso, e não à meia-noite UTC (que cai às 21h no Brasil).
const FUSO_HORAS = -3;
const MS_HORA = 60 * 60 * 1000;

interface DiaLocal {
  ano: number;
  mes0: number; // 0-11
  dia: number;
}

// Meia-noite local do dia informado, expressa como instante UTC.
// Date.UTC normaliza estouros (dia 0 = último dia do mês anterior, dia 32 = dia 1 do seguinte).
function inicioDoDiaLocal(ano: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes0, dia) - FUSO_HORAS * MS_HORA);
}

// Data/hora "de parede" no fuso do negócio (ler o resultado com getUTC*).
function paraLocal(instante: Date): Date {
  return new Date(instante.getTime() + FUSO_HORAS * MS_HORA);
}

function diaLocalDeInstante(instante: Date): DiaLocal {
  const l = paraLocal(instante);
  return { ano: l.getUTCFullYear(), mes0: l.getUTCMonth(), dia: l.getUTCDate() };
}

function formatDiaBR(d: DiaLocal): string {
  const normal = new Date(Date.UTC(d.ano, d.mes0, d.dia));
  const dd = String(normal.getUTCDate()).padStart(2, "0");
  const mm = String(normal.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${normal.getUTCFullYear()}`;
}

// Aceita "YYYY-MM-DD" (formato enviado pelo app) ou uma data/hora ISO (formato antigo).
// No caso ISO, usa o dia civil no fuso do negócio. Retorna null se for inválido.
function lerDiaLocal(valor: string | undefined): DiaLocal | null {
  if (!valor) return null;
  const texto = valor.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (m) {
    const ano = Number(m[1]);
    const mes0 = Number(m[2]) - 1;
    const dia = Number(m[3]);
    const conferido = new Date(Date.UTC(ano, mes0, dia));
    if (
      conferido.getUTCFullYear() !== ano ||
      conferido.getUTCMonth() !== mes0 ||
      conferido.getUTCDate() !== dia
    ) {
      return null;
    }
    return { ano, mes0, dia };
  }
  const instante = new Date(texto);
  if (isNaN(instante.getTime())) return null;
  return diaLocalDeInstante(instante);
}

// Resolve o período pedido num intervalo [inicio, fim) em UTC.
//  - hoje:          do início ao fim do dia de hoje (horário de Brasília)
//  - 7dias:         hoje e os 6 dias anteriores (7 dias corridos, dias completos)
//  - mes:           do dia 1 ao último dia do mês atual
//  - personalizado: do dia inicial ao dia final, ambos inclusos, dias completos
// "agora" só existe para permitir testes; em produção usa o relógio atual.
function resolvePeriodo(
  periodo: string | undefined,
  dataInicio: string | undefined,
  dataFim: string | undefined,
  agora: Date = new Date()
): { inicio: Date; fim: Date; label: string } {
  const hoje = diaLocalDeInstante(agora);

  if (periodo === "personalizado") {
    let di = lerDiaLocal(dataInicio);
    let df = lerDiaLocal(dataFim);
    if (di && df) {
      // Se vierem invertidos, corrige em vez de devolver um período vazio.
      if (Date.UTC(di.ano, di.mes0, di.dia) > Date.UTC(df.ano, df.mes0, df.dia)) {
        [di, df] = [df, di];
      }
      return {
        inicio: inicioDoDiaLocal(di.ano, di.mes0, di.dia),
        fim: inicioDoDiaLocal(df.ano, df.mes0, df.dia + 1),
        label: `${formatDiaBR(di)} – ${formatDiaBR(df)}`,
      };
    }
    // datas ausentes ou inválidas: cai no padrão ("hoje")
  }

  if (periodo === "7dias") {
    return {
      inicio: inicioDoDiaLocal(hoje.ano, hoje.mes0, hoje.dia - 6),
      fim: inicioDoDiaLocal(hoje.ano, hoje.mes0, hoje.dia + 1),
      label: "Últimos 7 dias",
    };
  }

  if (periodo === "mes") {
    return {
      inicio: inicioDoDiaLocal(hoje.ano, hoje.mes0, 1),
      fim: inicioDoDiaLocal(hoje.ano, hoje.mes0 + 1, 1),
      label: "Este mês",
    };
  }

  // padrão: "hoje"
  return {
    inicio: inicioDoDiaLocal(hoje.ano, hoje.mes0, hoje.dia),
    fim: inicioDoDiaLocal(hoje.ano, hoje.mes0, hoje.dia + 1),
    label: "Hoje",
  };
}

export function registerRelatoriosRoutes(app: App) {
  // GET /api/relatorios/resumo - Summary/Dashboard
  app.fastify.get(
    "/api/relatorios/resumo",
    {
      schema: {
        description: "Get summary/dashboard data (requires authentication)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: { type: "string", enum: ["hoje", "7dias", "mes", "personalizado"] },
            dataInicio: { type: "string" },
            dataFim: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              total_mesas: { type: "number" },
              mesas_ocupadas: { type: "number" },
              comandas_abertas: { type: "number" },
              pedidos_pendentes: { type: "number" },
              pedidos_em_preparo: { type: "number" },
              pedidos_atrasados: { type: "number" },
              receita_periodo: { type: "number" },
              periodo_label: { type: "string" },
              total_revenue: { type: "number" },
              comandas_historico: { type: "number" },
              total_orders: { type: "number" },
              open_orders: { type: "number" },
              avg_ticket: { type: "number" },
              total_pratos: { type: "number" },
              top_dishes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dish_name: { type: "string" },
                    quantity_sold: { type: "number" },
                  },
                },
              },
              orders_by_status: {
                type: "object",
                properties: {
                  aberta: { type: "number" },
                  fechada: { type: "number" },
                  cancelada: { type: "number" },
                },
              },
              gorjeta_total: { type: "number" },
              comandas_com_gorjeta: { type: "number" },
              gorjeta_media: { type: "number" },
              vendas_por_canal: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    canal: { type: "string" },
                    faturamento: { type: "number" },
                    quantidade: { type: "number" },
                    taxa_entrega_total: { type: "number" },
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
      // Revenue and business metrics are management-level information —
      // garcom/cozinheiro should not see the restaurant's financials.
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const tenantId = requireTenant(authUser);
        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };
        const { inicio, fim, label: periodoLabel } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);
        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting resumo");

        // Total mesas — estado atual, sem filtro de período
        const totalMesasResult = await app.db
          .select({ count: count() })
          .from(schema.mesas)
          .where(eq(schema.mesas.restauranteId, tenantId as any));
        const totalMesas = totalMesasResult[0]?.count || 0;

        // Mesas ocupadas (status != 'disponivel') — estado atual, sem filtro
        const mesasOcupadasResult = await app.db
          .select({ count: count() })
          .from(schema.mesas)
          .where(and(
            eq(schema.mesas.restauranteId, tenantId as any),
            not(eq(schema.mesas.status, "disponivel"))
          ));
        const mesasOcupadas = mesasOcupadasResult[0]?.count || 0;

        // Comandas abertas — estado atual, sem filtro (excluding delivery)
        const comandasAbertasResult = await app.db
          .select({ count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "aberta"),
            not(eq(schema.comandas.tipo, "delivery"))
          ));
        const comandasAbertas = comandasAbertasResult[0]?.count || 0;

        // Pedidos pendentes (only in open comandas) — estado atual, sem filtro
        const pedidosPendentesResult = await app.db
          .select({ count: count() })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(
            and(
              eq(schema.pedidos.restauranteId, tenantId as any),
              eq(schema.pedidos.status, "pendente"),
              eq(schema.comandas.status, "aberta")
            )
          );
        const pedidosPendentes = pedidosPendentesResult[0]?.count || 0;

        // Pedidos em preparo (status 'em_preparo' em comandas abertas) — snapshot atual, sem filtro
        const pedidosEmPrepareResult = await app.db
          .select({ count: count() })
          .from(schema.pedidos)
          .innerJoin(schema.comandas, eq(schema.pedidos.comandaId, schema.comandas.id))
          .where(
            and(
              eq(schema.pedidos.restauranteId, tenantId as any),
              eq(schema.pedidos.status, "em_preparo"),
              eq(schema.comandas.status, "aberta")
            )
          );
        const pedidosEmPreparo = pedidosEmPrepareResult[0]?.count || 0;

        // Pedidos atrasados (status 'em_preparo' em comandas abertas, com tempo desde iniciado_em > tempo_preparo_min, ou fallback para created_at se iniciado_em for NULL)
        const pedidosAtrasadosResult = await (app.db as any).execute(
          sql`
            SELECT COUNT(*)::integer as count
            FROM pedidos p
            INNER JOIN comandas c ON p.comanda_id = c.id
            LEFT JOIN pratos pr ON p.prato_id = pr.id
            WHERE p.restaurante_id = ${tenantId}
              AND p.status = 'em_preparo'
              AND c.status = 'aberta'
              AND (
                (p.iniciado_em IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - p.iniciado_em)) / 60 > COALESCE(pr.tempo_preparo_min, 15))
                OR
                (p.iniciado_em IS NULL AND EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 60 > COALESCE(pr.tempo_preparo_min, 15))
              )
          `
        ) as any[];
        const pedidosAtrasados = pedidosAtrasadosResult[0]?.count || 0;

        // Receita no período selecionado - sum from both comandas and comandas_historico using total (subtotal + gorjeta)
        const receitaPeriodoComandasResult = await (app.db as any).execute(
          sql`
            SELECT COALESCE(SUM(total), 0)::float AS total
            FROM comandas
            WHERE restaurante_id = ${tenantId}
              AND status = 'fechada'
              AND closed_at >= ${inicio.toISOString()}::timestamptz
              AND closed_at < ${fim.toISOString()}::timestamptz
          `
        ) as any[];

        const receitaPeriodoHistoricoResult = await (app.db as any).execute(
          sql`
            SELECT COALESCE(SUM(total), 0)::float AS total
            FROM comandas_historico
            WHERE restaurante_id = ${tenantId}
              AND status = 'fechada'
              AND closed_at >= ${inicio.toISOString()}::timestamptz
              AND closed_at < ${fim.toISOString()}::timestamptz
          `
        ) as any[];

        const receitaPeriodoCom = receitaPeriodoComandasResult[0]?.total || 0;
        const receitaPeriodoHist = receitaPeriodoHistoricoResult[0]?.total || 0;
        const receitaPeriodo = receitaPeriodoCom + receitaPeriodoHist;

        // Total revenue - sum of all closed comandas from both tables (all-time, sem filtro) using total (subtotal + gorjeta)
        const totalRevenueComandasResult = await (app.db as any).execute(
          sql`
            SELECT COALESCE(SUM(total), 0)::float AS total
            FROM comandas
            WHERE restaurante_id = ${tenantId}
              AND status = 'fechada'
          `
        ) as any[];

        const totalRevenueHistoricoResult = await (app.db as any).execute(
          sql`
            SELECT COALESCE(SUM(total), 0)::float AS total
            FROM comandas_historico
            WHERE restaurante_id = ${tenantId}
              AND status = 'fechada'
          `
        ) as any[];

        const totalRevenueCom = totalRevenueComandasResult[0]?.total || 0;
        const totalRevenueHist = totalRevenueHistoricoResult[0]?.total || 0;
        const totalRevenue = totalRevenueCom + totalRevenueHist;

        // Comandas historico count — all-time, sem filtro
        const comandasHistoricoCountResult = await app.db
          .select({ count: count() })
          .from(schema.comandasHistorico)
          .where(eq(schema.comandasHistorico.restauranteId, tenantId as any));
        const comandasHistoricoCount = comandasHistoricoCountResult[0]?.count || 0;

        // Total orders - count from both pedidos and pedidos_historico (all-time, sem filtro)
        const totalPedidosResult = await app.db
          .select({ count: count() })
          .from(schema.pedidos)
          .where(eq(schema.pedidos.restauranteId, tenantId as any));
        const totalPedidosHist = await app.db
          .select({ count: count() })
          .from(schema.pedidosHistorico)
          .where(eq(schema.pedidosHistorico.restauranteId, tenantId as any));
        const totalOrders = (totalPedidosResult[0]?.count || 0) + (totalPedidosHist[0]?.count || 0);

        // Open orders (same as comandasAbertas - excluding delivery)
        const openOrders = comandasAbertas;

        // Ticket médio no período - baseado nas comandas fechadas dentro do intervalo selecionado
        const totalClosedComandasPeriodoCom = await app.db
          .select({ count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, "fechada"),
            gte(schema.comandas.closedAt, inicio),
            lt(schema.comandas.closedAt, fim),
            gt(schema.comandas.total, "0")
          ));
        const totalClosedComandasPeriodoHist = await app.db
          .select({ count: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            eq(schema.comandasHistorico.status, "fechada"),
            gte(schema.comandasHistorico.closedAt, inicio),
            lt(schema.comandasHistorico.closedAt, fim),
            gt(schema.comandasHistorico.total, "0")
          ));

        const countClosedPeriodoCom = totalClosedComandasPeriodoCom[0]?.count || 0;
        const countClosedPeriodoHist = totalClosedComandasPeriodoHist[0]?.count || 0;
        const totalClosedPeriodoCount = countClosedPeriodoCom + countClosedPeriodoHist;
        const avgTicket = totalClosedPeriodoCount > 0 ? receitaPeriodo / totalClosedPeriodoCount : 0;

        // Top 5 dishes no período - aggregate from both pedidos and pedidos_historico
        let topDishes: Array<{ dish_name: string; quantity_sold: number }> = [];
        try {
          const topDishesFromPedidosResult = await (app.db as any).execute(
            sql`
              SELECT
                pr.nome as dish_name,
                SUM(p.quantidade)::integer as quantity_sold
              FROM pedidos p
              INNER JOIN pratos pr ON p.prato_id = pr.id
              WHERE p.restaurante_id = ${tenantId}
                AND p.created_at >= ${inicio.toISOString()}::timestamptz
                AND p.created_at < ${fim.toISOString()}::timestamptz
              GROUP BY pr.nome
              ORDER BY quantity_sold DESC
            `
          ) as any[];

          const topDishesFromHistoricoResult = await (app.db as any).execute(
            sql`
              SELECT
                prato_nome as dish_name,
                SUM(quantidade)::integer as quantity_sold
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId} AND prato_nome IS NOT NULL
                AND created_at >= ${inicio.toISOString()}::timestamptz
                AND created_at < ${fim.toISOString()}::timestamptz
              GROUP BY prato_nome
              ORDER BY quantity_sold DESC
            `
          ) as any[];

          const dishMap = new Map<string, number>();

          if (Array.isArray(topDishesFromPedidosResult)) {
            for (const d of topDishesFromPedidosResult) {
              const key = d.dish_name || "Unknown";
              const count = parseInt(String(d.quantity_sold || 0));
              dishMap.set(key, (dishMap.get(key) || 0) + count);
            }
          }

          if (Array.isArray(topDishesFromHistoricoResult)) {
            for (const d of topDishesFromHistoricoResult) {
              const key = d.dish_name || "Unknown";
              const count = parseInt(String(d.quantity_sold || 0));
              dishMap.set(key, (dishMap.get(key) || 0) + count);
            }
          }

          topDishes = Array.from(dishMap.entries())
            .map(([dish_name, quantity_sold]) => ({ dish_name, quantity_sold }))
            .sort((a, b) => b.quantity_sold - a.quantity_sold)
            .slice(0, 5);
        } catch (dishError) {
          app.logger.warn({ err: dishError }, "Failed to get top dishes, using empty array");
          topDishes = [];
        }

        // Orders by status no período - from both tables combined
        const comandasStatusResult = await app.db
          .select({ status: schema.comandas.status, count: count() })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            gte(schema.comandas.createdAt, inicio),
            lt(schema.comandas.createdAt, fim)
          ))
          .groupBy(schema.comandas.status);

        const comandasHistoricoStatusResult = await app.db
          .select({ status: schema.comandasHistorico.status, count: count() })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            gte(schema.comandasHistorico.createdAt, inicio),
            lt(schema.comandasHistorico.createdAt, fim)
          ))
          .groupBy(schema.comandasHistorico.status);

        const statusMap = new Map<string, number>();

        for (const row of comandasStatusResult) {
          const status = row.status || "aberta";
          statusMap.set(status, (statusMap.get(status) || 0) + (row.count || 0));
        }

        for (const row of comandasHistoricoStatusResult) {
          const status = row.status || "aberta";
          statusMap.set(status, (statusMap.get(status) || 0) + (row.count || 0));
        }

        const ordersByStatus = {
          aberta: statusMap.get("aberta") || 0,
          fechada: statusMap.get("fechada") || 0,
          cancelada: statusMap.get("cancelada") || 0,
        };

        // Total pratos disponíveis - snapshot at current moment
        const totalPratosResult = await app.db
          .select({ count: count() })
          .from(schema.pratos)
          .where(and(
            eq(schema.pratos.restauranteId, tenantId as any),
            eq(schema.pratos.disponivel, true)
          ));
        const totalPratos = totalPratosResult[0]?.count || 0;

        // Gorjeta no período — comandas_historico
        const gorjetaHistResult = await app.db
          .select({
            gorjeta_total: sql<number>`COALESCE(SUM(COALESCE(${schema.comandasHistorico.gorjeta}, 0)), 0)`,
            comandas_com_gorjeta: sql<number>`COUNT(*) FILTER (WHERE COALESCE(${schema.comandasHistorico.gorjeta}, 0) > 0)`,
          })
          .from(schema.comandasHistorico)
          .where(and(
            eq(schema.comandasHistorico.restauranteId, tenantId as any),
            gte(schema.comandasHistorico.closedAt, inicio),
            lt(schema.comandasHistorico.closedAt, fim),
          ));

        // Gorjeta no período — comandas (status = 'fechada')
        const gorjetaComandasResult = await app.db
          .select({
            gorjeta_total: sql<number>`COALESCE(SUM(COALESCE(${schema.comandas.gorjeta}, 0)), 0)`,
            comandas_com_gorjeta: sql<number>`COUNT(*) FILTER (WHERE COALESCE(${schema.comandas.gorjeta}, 0) > 0)`,
          })
          .from(schema.comandas)
          .where(and(
            eq(schema.comandas.restauranteId, tenantId as any),
            eq(schema.comandas.status, 'fechada'),
            gte(schema.comandas.closedAt, inicio),
            lt(schema.comandas.closedAt, fim),
          ));

        const gorjetaTotal = Number(gorjetaHistResult[0]?.gorjeta_total ?? 0) + Number(gorjetaComandasResult[0]?.gorjeta_total ?? 0);
        const comandasComGorjeta = Number(gorjetaHistResult[0]?.comandas_com_gorjeta ?? 0) + Number(gorjetaComandasResult[0]?.comandas_com_gorjeta ?? 0);
        const gorjetaMedia = comandasComGorjeta > 0 ? gorjetaTotal / comandasComGorjeta : 0;

        // Vendas por canal no período (mesa, balcao, delivery)
        let vendasPorCanal: Array<{
          canal: string;
          faturamento: number;
          quantidade: number;
          taxa_entrega_total?: number;
        }> = [];
        try {
          // Comandas ativas fechadas no período
          const canalAtivasResult = await (app.db as any).execute(
            sql`
              SELECT
                COALESCE(tipo, 'mesa') as canal,
                COALESCE(SUM(total), 0)::float AS faturamento,
                COUNT(*)::integer AS quantidade
              FROM comandas
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
              GROUP BY COALESCE(tipo, 'mesa')
            `
          ) as any[];

          // Comandas históricas fechadas no período (sem coluna tipo — todas são mesa/balcao)
          const canalHistResult = await (app.db as any).execute(
            sql`
              SELECT
                'mesa' as canal,
                COALESCE(SUM(total), 0)::float AS faturamento,
                COUNT(*)::integer AS quantidade
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            `
          ) as any[];

          // Taxa de entrega total para delivery no período
          const taxaEntregaResult = await (app.db as any).execute(
            sql`
              SELECT COALESCE(SUM(CAST(e.taxa_entrega AS DECIMAL(10,2))), 0)::float AS total_taxa
              FROM entregas e
              INNER JOIN comandas c ON e.comanda_id = c.id
              WHERE c.restaurante_id = ${tenantId}
                AND c.status = 'fechada'
                AND c.tipo = 'delivery'
                AND c.closed_at >= ${inicio.toISOString()}::timestamptz
                AND c.closed_at < ${fim.toISOString()}::timestamptz
            `
          ) as any[];
          const totalTaxaEntrega = taxaEntregaResult[0]?.total_taxa || 0;

          // Mesclar resultados
          const canalMap = new Map<string, { faturamento: number; quantidade: number }>();
          for (const row of [...(Array.isArray(canalAtivasResult) ? canalAtivasResult : []), ...(Array.isArray(canalHistResult) ? canalHistResult : [])]) {
            const canal = row.canal || "mesa";
            const existing = canalMap.get(canal) || { faturamento: 0, quantidade: 0 };
            canalMap.set(canal, {
              faturamento: existing.faturamento + (parseFloat(String(row.faturamento)) || 0),
              quantidade: existing.quantidade + (parseInt(String(row.quantidade)) || 0),
            });
          }

          vendasPorCanal = Array.from(canalMap.entries()).map(([canal, data]) => ({
            canal,
            faturamento: data.faturamento,
            quantidade: data.quantidade,
            ...(canal === "delivery" ? { taxa_entrega_total: totalTaxaEntrega } : {}),
          }));
        } catch (canalErr) {
          app.logger.warn({ err: canalErr }, "Failed to get vendas por canal");
          vendasPorCanal = [];
        }

        app.logger.info(
          {
            tenantId, totalMesas, mesasOcupadas, comandasAbertas, pedidosPendentes, pedidosEmPreparo, pedidosAtrasados, receitaPeriodo, periodoLabel,
            totalRevenue, comandasHistoricoCount, totalOrders, openOrders, avgTicket, topDishesCount: topDishes.length, totalPratos
          },
          "Resumo retrieved successfully"
        );

        return await reply.code(200).send({
          total_mesas: totalMesas,
          mesas_ocupadas: mesasOcupadas,
          comandas_abertas: comandasAbertas,
          pedidos_pendentes: pedidosPendentes,
          pedidos_em_preparo: pedidosEmPreparo,
          pedidos_atrasados: pedidosAtrasados,
          receita_periodo: receitaPeriodo,
          periodo_label: periodoLabel,
          total_revenue: totalRevenue,
          comandas_historico: comandasHistoricoCount,
          total_orders: totalOrders,
          open_orders: openOrders,
          avg_ticket: avgTicket,
          total_pratos: totalPratos,
          top_dishes: topDishes,
          orders_by_status: ordersByStatus,
          gorjeta_total: gorjetaTotal,
          comandas_com_gorjeta: comandasComGorjeta,
          gorjeta_media: gorjetaMedia,
          vendas_por_canal: vendasPorCanal,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get resumo");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/relatorios/mesas - Ticket médio e top 3 pratos por mesa, no período
  app.fastify.get(
    "/api/relatorios/mesas",
    {
      schema: {
        description: "Get per-table average ticket and top 3 dishes for a period (requires authentication)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: { type: "string", enum: ["hoje", "7dias", "mes", "personalizado"] },
            dataInicio: { type: "string" },
            dataFim: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              periodo_label: { type: "string" },
              mesas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    mesa_numero: { type: "number" },
                    ticket_medio: { type: "number" },
                    comandas_fechadas: { type: "number" },
                    gorjeta_total: { type: "number" },
                    top_dishes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          dish_name: { type: "string" },
                          quantity_sold: { type: "number" },
                        },
                      },
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
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const tenantId = requireTenant(authUser);
        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };
        const { inicio, fim, label: periodoLabel } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);
        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting relatorio por mesa");

        // Ticket médio e nº de comandas fechadas por mesa, no período (ativas + histórico)
        const ticketPorMesaResult = await (app.db as any).execute(
          sql`
            SELECT mesa_numero, AVG(subtotal)::float AS ticket_medio, COUNT(*)::integer AS comandas_fechadas, COALESCE(SUM(COALESCE(gorjeta_val, 0)), 0)::float AS gorjeta_total
            FROM (
              SELECT mesa_numero, total AS subtotal, COALESCE(gorjeta, 0) AS gorjeta_val FROM comandas
              WHERE restaurante_id = ${tenantId} AND status = 'fechada' AND mesa_numero IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
              UNION ALL
              SELECT mesa_numero, total AS subtotal, COALESCE(gorjeta, 0) AS gorjeta_val FROM comandas_historico
              WHERE restaurante_id = ${tenantId} AND status = 'fechada' AND mesa_numero IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
            ) t
            GROUP BY mesa_numero
            ORDER BY mesa_numero
          `
        ) as any[];

        // Top 3 pratos por mesa, no período (ativos + histórico)
        const topPratosPorMesaResult = await (app.db as any).execute(
          sql`
            WITH itens AS (
              SELECT c.mesa_numero AS mesa_numero, pr.nome AS dish_name, p.quantidade AS quantidade
              FROM pedidos p
              INNER JOIN comandas c ON p.comanda_id = c.id
              INNER JOIN pratos pr ON p.prato_id = pr.id
              WHERE p.restaurante_id = ${tenantId} AND c.mesa_numero IS NOT NULL
                AND p.created_at >= ${inicio.toISOString()}::timestamptz AND p.created_at < ${fim.toISOString()}::timestamptz
              UNION ALL
              SELECT ch.mesa_numero AS mesa_numero, ph.prato_nome AS dish_name, ph.quantidade AS quantidade
              FROM pedidos_historico ph
              INNER JOIN comandas_historico ch ON ph.comanda_id = ch.id
              WHERE ph.restaurante_id = ${tenantId} AND ch.mesa_numero IS NOT NULL AND ph.prato_nome IS NOT NULL
                AND ph.created_at >= ${inicio.toISOString()}::timestamptz AND ph.created_at < ${fim.toISOString()}::timestamptz
            ),
            agregado AS (
              SELECT mesa_numero, dish_name, SUM(quantidade)::integer AS quantidade_total
              FROM itens
              GROUP BY mesa_numero, dish_name
            ),
            ranqueado AS (
              SELECT mesa_numero, dish_name, quantidade_total,
                ROW_NUMBER() OVER (PARTITION BY mesa_numero ORDER BY quantidade_total DESC) AS rn
              FROM agregado
            )
            SELECT mesa_numero, dish_name, quantidade_total
            FROM ranqueado
            WHERE rn <= 3
            ORDER BY mesa_numero, quantidade_total DESC
          `
        ) as any[];

        const pratosPorMesa = new Map<number, { dish_name: string; quantity_sold: number }[]>();
        if (Array.isArray(topPratosPorMesaResult)) {
          for (const row of topPratosPorMesaResult) {
            const mesaNumero = Number(row.mesa_numero);
            const lista = pratosPorMesa.get(mesaNumero) || [];
            lista.push({ dish_name: row.dish_name, quantity_sold: parseInt(String(row.quantidade_total || 0)) });
            pratosPorMesa.set(mesaNumero, lista);
          }
        }

        const mesas = Array.isArray(ticketPorMesaResult)
          ? ticketPorMesaResult.map((row: any) => {
              const mesaNumero = Number(row.mesa_numero);
              return {
                mesa_numero: mesaNumero,
                ticket_medio: parseFloat(String(row.ticket_medio || 0)),
                comandas_fechadas: parseInt(String(row.comandas_fechadas || 0)),
                gorjeta_total: parseFloat(String(row.gorjeta_total ?? 0)),
                top_dishes: pratosPorMesa.get(mesaNumero) || [],
              };
            })
          : [];

        app.logger.info({ tenantId, mesasCount: mesas.length }, "Relatorio por mesa retrieved successfully");

        return await reply.code(200).send({
          periodo_label: periodoLabel,
          mesas,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get relatorio por mesa");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/relatorios/vendas - Sales report with period comparison
  app.fastify.get(
    "/api/relatorios/vendas",
    {
      schema: {
        description: "Get sales report with period comparison (requires authentication)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: { type: "string", enum: ["hoje", "7dias", "mes", "personalizado"] },
            dataInicio: { type: "string" },
            dataFim: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              periodo: {
                type: "object",
                properties: {
                  nome: { type: "string" },
                  inicio: { type: "string" },
                  fim: { type: "string" },
                },
              },
              totais: {
                type: "object",
                properties: {
                  comandas_fechadas: { type: "integer" },
                  comandas_com_consumo: { type: "integer" },
                  faturamento_itens: { type: "number" },
                  gorjeta: { type: "number" },
                  taxa_entrega: { type: "number" },
                  total_recebido: { type: "number" },
                  ticket_medio: { type: "number" },
                },
              },
              por_canal: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    canal: { type: "string", enum: ["mesa", "delivery"] },
                    comandas_fechadas: { type: "integer" },
                    comandas_com_consumo: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    gorjeta: { type: "number" },
                    taxa_entrega: { type: "number" },
                    total_recebido: { type: "number" },
                    ticket_medio: { type: "number" },
                  },
                },
              },
              por_dia: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    data: { type: "string" },
                    comandas_fechadas: { type: "integer" },
                    comandas_com_consumo: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    gorjeta: { type: "number" },
                    taxa_entrega: { type: "number" },
                    total_recebido: { type: "number" },
                    ticket_medio: { type: "number" },
                  },
                },
              },
              comparacao_anterior: {
                type: "object",
                properties: {
                  periodo: {
                    type: "object",
                    properties: {
                      nome: { type: "string" },
                      inicio: { type: "string" },
                      fim: { type: "string" },
                    },
                  },
                  totais: {
                    type: "object",
                    properties: {
                      comandas_fechadas: { type: "integer" },
                      comandas_com_consumo: { type: "integer" },
                      faturamento_itens: { type: "number" },
                      gorjeta: { type: "number" },
                      taxa_entrega: { type: "number" },
                      total_recebido: { type: "number" },
                      ticket_medio: { type: "number" },
                    },
                  },
                  variacao_percentual: {
                    type: "object",
                    properties: {
                      faturamento_itens: { type: ["number", "null"] },
                      total_recebido: { type: ["number", "null"] },
                      ticket_medio: { type: ["number", "null"] },
                    },
                  },
                },
              },
              comandas_inconsistentes: { type: "integer" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const tenantId = requireTenant(authUser);
        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };

        // Resolve current period
        const { inicio, fim, label: periodoLabel } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);

        // Check custom period length (max 366 days)
        if (query.periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting vendas report");

        // Calculate previous period (same number of days)
        const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
        const periodoAnteriorFim = new Date(inicio.getTime());
        const periodoAnteriorInicio = new Date(periodoAnteriorFim.getTime() - daysDiff * 24 * 60 * 60 * 1000);

        app.logger.debug(
          { tenantId, periodoAnteriorInicio, periodoAnteriorFim, daysDiff },
          "Previous period calculated"
        );

        // Format label for previous period
        const periodoAnteriorLabel = `${formatDiaBR(diaLocalDeInstante(periodoAnteriorInicio))} – ${formatDiaBR(diaLocalDeInstante(new Date(periodoAnteriorFim.getTime() - 1)))}`;

        // Fetch sales data for current period (both comandas and comandas_historico)
        const vendasPeriodoResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT
                id,
                restaurante_id,
                tipo::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total,
                NULL::uuid AS entrega_id,
                NULL::numeric AS taxa_entrega
              FROM comandas
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            vendas_historico AS (
              SELECT
                id,
                restaurante_id,
                'mesa'::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total,
                NULL::uuid AS entrega_id,
                NULL::numeric AS taxa_entrega
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais
              UNION ALL
              SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id)
                id,
                restaurante_id,
                CASE
                  WHEN tipo = 'delivery' THEN 'delivery'
                  ELSE 'mesa'
                END AS canal,
                closed_at,
                CAST(subtotal AS DECIMAL(10,2)) AS subtotal,
                CAST(gorjeta AS DECIMAL(10,2)) AS gorjeta,
                CAST(total AS DECIMAL(10,2)) AS total
              FROM todas_vendas
              ORDER BY restaurante_id, id, tipo DESC
            ),
            entregas_por_comanda AS (
              SELECT DISTINCT ON (comanda_id)
                comanda_id,
                CAST(taxa_entrega AS DECIMAL(10,2)) AS taxa_entrega
              FROM entregas
              WHERE comanda_id IN (SELECT id FROM deduplicadas)
              ORDER BY comanda_id, created_at DESC, id DESC
            ),
            vendas_com_taxa AS (
              SELECT
                d.id,
                d.restaurante_id,
                d.canal,
                d.closed_at,
                d.subtotal,
                d.gorjeta,
                d.total,
                COALESCE(e.taxa_entrega, 0) AS taxa_entrega
              FROM deduplicadas d
              LEFT JOIN entregas_por_comanda e ON d.id = e.comanda_id
            )
            SELECT
              COUNT(*) AS total_comandas,
              CAST(SUM(subtotal) AS DECIMAL(10,2)) AS faturamento_itens,
              CAST(SUM(gorjeta) AS DECIMAL(10,2)) AS gorjeta_total,
              CAST(SUM(taxa_entrega) AS DECIMAL(10,2)) AS taxa_entrega_total,
              CAST(SUM(total) AS DECIMAL(10,2)) AS total_recebido,
              canal
            FROM vendas_com_taxa
            GROUP BY canal
          `
        ) as any[];

        // Fetch sales data for previous period
        const vendasAnteriorResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT
                id,
                restaurante_id,
                tipo::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total,
                NULL::uuid AS entrega_id,
                NULL::numeric AS taxa_entrega
              FROM comandas
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${periodoAnteriorInicio.toISOString()}::timestamptz
                AND closed_at < ${periodoAnteriorFim.toISOString()}::timestamptz
            ),
            vendas_historico AS (
              SELECT
                id,
                restaurante_id,
                'mesa'::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total,
                NULL::uuid AS entrega_id,
                NULL::numeric AS taxa_entrega
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${periodoAnteriorInicio.toISOString()}::timestamptz
                AND closed_at < ${periodoAnteriorFim.toISOString()}::timestamptz
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais
              UNION ALL
              SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id)
                id,
                restaurante_id,
                CASE
                  WHEN tipo = 'delivery' THEN 'delivery'
                  ELSE 'mesa'
                END AS canal,
                closed_at,
                CAST(subtotal AS DECIMAL(10,2)) AS subtotal,
                CAST(gorjeta AS DECIMAL(10,2)) AS gorjeta,
                CAST(total AS DECIMAL(10,2)) AS total
              FROM todas_vendas
              ORDER BY restaurante_id, id, tipo DESC
            ),
            entregas_por_comanda AS (
              SELECT DISTINCT ON (comanda_id)
                comanda_id,
                CAST(taxa_entrega AS DECIMAL(10,2)) AS taxa_entrega
              FROM entregas
              WHERE comanda_id IN (SELECT id FROM deduplicadas)
              ORDER BY comanda_id, created_at DESC, id DESC
            ),
            vendas_com_taxa AS (
              SELECT
                d.id,
                d.restaurante_id,
                d.canal,
                d.closed_at,
                d.subtotal,
                d.gorjeta,
                d.total,
                COALESCE(e.taxa_entrega, 0) AS taxa_entrega
              FROM deduplicadas d
              LEFT JOIN entregas_por_comanda e ON d.id = e.comanda_id
            )
            SELECT
              COUNT(*) AS total_comandas,
              CAST(SUM(subtotal) AS DECIMAL(10,2)) AS faturamento_itens,
              CAST(SUM(gorjeta) AS DECIMAL(10,2)) AS gorjeta_total,
              CAST(SUM(taxa_entrega) AS DECIMAL(10,2)) AS taxa_entrega_total,
              CAST(SUM(total) AS DECIMAL(10,2)) AS total_recebido
            FROM vendas_com_taxa
          `
        ) as any[];

        // Fetch daily breakdown for current period
        const vendasPorDiaResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT
                id,
                restaurante_id,
                tipo::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total
              FROM comandas
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            vendas_historico AS (
              SELECT
                id,
                restaurante_id,
                'mesa'::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais
              UNION ALL
              SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id)
                id,
                restaurante_id,
                CASE
                  WHEN tipo = 'delivery' THEN 'delivery'
                  ELSE 'mesa'
                END AS canal,
                closed_at,
                CAST(subtotal AS DECIMAL(10,2)) AS subtotal,
                CAST(gorjeta AS DECIMAL(10,2)) AS gorjeta,
                CAST(total AS DECIMAL(10,2)) AS total
              FROM todas_vendas
              ORDER BY restaurante_id, id, tipo DESC
            ),
            entregas_por_comanda AS (
              SELECT DISTINCT ON (comanda_id)
                comanda_id,
                CAST(taxa_entrega AS DECIMAL(10,2)) AS taxa_entrega
              FROM entregas
              WHERE comanda_id IN (SELECT id FROM deduplicadas)
              ORDER BY comanda_id, created_at DESC, id DESC
            ),
            vendas_com_taxa AS (
              SELECT
                d.id,
                d.restaurante_id,
                d.canal,
                d.closed_at,
                d.subtotal,
                d.gorjeta,
                d.total,
                COALESCE(e.taxa_entrega, 0) AS taxa_entrega
              FROM deduplicadas d
              LEFT JOIN entregas_por_comanda e ON d.id = e.comanda_id
            ),
            por_data AS (
              SELECT
                (closed_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_local,
                COUNT(*) AS total_comandas,
                CAST(SUM(subtotal) AS DECIMAL(10,2)) AS faturamento_itens,
                CAST(SUM(gorjeta) AS DECIMAL(10,2)) AS gorjeta_total,
                CAST(SUM(taxa_entrega) AS DECIMAL(10,2)) AS taxa_entrega_total,
                CAST(SUM(total) AS DECIMAL(10,2)) AS total_recebido
              FROM vendas_com_taxa
              GROUP BY (closed_at AT TIME ZONE 'America/Sao_Paulo')::date
            )
            SELECT
              to_char(data_local, 'YYYY-MM-DD') AS data_local,
              total_comandas,
              faturamento_itens,
              gorjeta_total,
              taxa_entrega_total,
              total_recebido
            FROM por_data
            ORDER BY data_local
          `
        ) as any[];

        // Fetch inconsistent comandas for current period
        const inconsistentesResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT
                id,
                restaurante_id,
                tipo::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total
              FROM comandas
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            vendas_historico AS (
              SELECT
                id,
                restaurante_id,
                'mesa'::text AS tipo,
                closed_at,
                subtotal,
                gorjeta,
                total
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
                AND status = 'fechada'
                AND closed_at IS NOT NULL
                AND total > 0
                AND closed_at >= ${inicio.toISOString()}::timestamptz
                AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais
              UNION ALL
              SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id)
                id,
                restaurante_id,
                CASE
                  WHEN tipo = 'delivery' THEN 'delivery'
                  ELSE 'mesa'
                END AS canal,
                closed_at,
                CAST(subtotal AS DECIMAL(10,2)) AS subtotal,
                CAST(gorjeta AS DECIMAL(10,2)) AS gorjeta,
                CAST(total AS DECIMAL(10,2)) AS total
              FROM todas_vendas
              ORDER BY restaurante_id, id, tipo DESC
            ),
            entregas_por_comanda AS (
              SELECT DISTINCT ON (comanda_id)
                comanda_id,
                CAST(taxa_entrega AS DECIMAL(10,2)) AS taxa_entrega
              FROM entregas
              WHERE comanda_id IN (SELECT id FROM deduplicadas)
              ORDER BY comanda_id, created_at DESC, id DESC
            ),
            vendas_com_taxa AS (
              SELECT
                d.id,
                d.restaurante_id,
                d.canal,
                d.closed_at,
                d.subtotal,
                d.gorjeta,
                d.total,
                COALESCE(e.taxa_entrega, 0) AS taxa_entrega
              FROM deduplicadas d
              LEFT JOIN entregas_por_comanda e ON d.id = e.comanda_id
            )
            SELECT COUNT(*)::integer AS inconsistent_count
            FROM vendas_com_taxa
            WHERE ABS((subtotal + gorjeta + taxa_entrega) - total) > 0.01
          `
        ) as any[];

        // Process results
        const canalMap = new Map<string, {
          comandas_fechadas: number;
          faturamento_itens: number;
          gorjeta: number;
          taxa_entrega: number;
          total_recebido: number;
        }>();

        // Initialize both channels
        canalMap.set("mesa", {
          comandas_fechadas: 0,
          faturamento_itens: 0,
          gorjeta: 0,
          taxa_entrega: 0,
          total_recebido: 0,
        });
        canalMap.set("delivery", {
          comandas_fechadas: 0,
          faturamento_itens: 0,
          gorjeta: 0,
          taxa_entrega: 0,
          total_recebido: 0,
        });

        // Process current period by channel
        if (Array.isArray(vendasPeriodoResult)) {
          for (const row of vendasPeriodoResult) {
            const canal = row.canal || "mesa";
            const existing = canalMap.get(canal) || {
              comandas_fechadas: 0,
              faturamento_itens: 0,
              gorjeta: 0,
              taxa_entrega: 0,
              total_recebido: 0,
            };
            canalMap.set(canal, {
              comandas_fechadas: existing.comandas_fechadas + (parseInt(String(row.total_comandas)) || 0),
              faturamento_itens: existing.faturamento_itens + (parseFloat(String(row.faturamento_itens)) || 0),
              gorjeta: existing.gorjeta + (parseFloat(String(row.gorjeta_total)) || 0),
              taxa_entrega: existing.taxa_entrega + (parseFloat(String(row.taxa_entrega_total)) || 0),
              total_recebido: existing.total_recebido + (parseFloat(String(row.total_recebido)) || 0),
            });
          }
        }

        // Process previous period totals
        let anteriorMetricas = {
          comandas_fechadas: 0,
          faturamento_itens: 0,
          gorjeta: 0,
          taxa_entrega: 0,
          total_recebido: 0,
        };

        if (Array.isArray(vendasAnteriorResult) && vendasAnteriorResult.length > 0) {
          const row = vendasAnteriorResult[0];
          anteriorMetricas = {
            comandas_fechadas: parseInt(String(row.total_comandas)) || 0,
            faturamento_itens: parseFloat(String(row.faturamento_itens)) || 0,
            gorjeta: parseFloat(String(row.gorjeta_total)) || 0,
            taxa_entrega: parseFloat(String(row.taxa_entrega_total)) || 0,
            total_recebido: parseFloat(String(row.total_recebido)) || 0,
          };
        }

        // Calculate totals for current period
        const totalAtual = {
          comandas_fechadas: 0,
          faturamento_itens: 0,
          gorjeta: 0,
          taxa_entrega: 0,
          total_recebido: 0,
        };

        for (const metrics of canalMap.values()) {
          totalAtual.comandas_fechadas += metrics.comandas_fechadas;
          totalAtual.faturamento_itens += metrics.faturamento_itens;
          totalAtual.gorjeta += metrics.gorjeta;
          totalAtual.taxa_entrega += metrics.taxa_entrega;
          totalAtual.total_recebido += metrics.total_recebido;
        }

        // Calculate ticket médio
        totalAtual.faturamento_itens = Math.round(totalAtual.faturamento_itens * 100) / 100;
        totalAtual.gorjeta = Math.round(totalAtual.gorjeta * 100) / 100;
        totalAtual.taxa_entrega = Math.round(totalAtual.taxa_entrega * 100) / 100;
        totalAtual.total_recebido = Math.round(totalAtual.total_recebido * 100) / 100;

        anteriorMetricas.faturamento_itens = Math.round(anteriorMetricas.faturamento_itens * 100) / 100;
        anteriorMetricas.gorjeta = Math.round(anteriorMetricas.gorjeta * 100) / 100;
        anteriorMetricas.taxa_entrega = Math.round(anteriorMetricas.taxa_entrega * 100) / 100;
        anteriorMetricas.total_recebido = Math.round(anteriorMetricas.total_recebido * 100) / 100;

        const ticketMedioAtual = totalAtual.comandas_fechadas > 0 ? totalAtual.faturamento_itens / totalAtual.comandas_fechadas : 0;
        const ticketMedioAnterior = anteriorMetricas.comandas_fechadas > 0 ? anteriorMetricas.faturamento_itens / anteriorMetricas.comandas_fechadas : 0;

        // Process daily breakdown
        const diaMap = new Map<string, {
          comandas_fechadas: number;
          faturamento_itens: number;
          gorjeta: number;
          taxa_entrega: number;
          total_recebido: number;
          ticket_medio: number;
        }>();

        if (Array.isArray(vendasPorDiaResult)) {
          for (const row of vendasPorDiaResult) {
            const data: string = row.data_local;
            const faturamento = parseFloat(String(row.faturamento_itens)) || 0;
            const comandas = parseInt(String(row.total_comandas)) || 0;
            const ticket = comandas > 0 ? faturamento / comandas : 0;

            diaMap.set(data, {
              comandas_fechadas: comandas,
              faturamento_itens: Math.round(faturamento * 100) / 100,
              gorjeta: Math.round((parseFloat(String(row.gorjeta_total)) || 0) * 100) / 100,
              taxa_entrega: Math.round((parseFloat(String(row.taxa_entrega_total)) || 0) * 100) / 100,
              total_recebido: Math.round((parseFloat(String(row.total_recebido)) || 0) * 100) / 100,
              ticket_medio: Math.round(ticket * 100) / 100,
            });
          }
        }

        // Fill missing days with zeros
        const inicioDia = diaLocalDeInstante(inicio);
        const fimDia = diaLocalDeInstante(new Date(fim.getTime() - 1));

        for (let d = new Date(Date.UTC(inicioDia.ano, inicioDia.mes0, inicioDia.dia));
             d <= new Date(Date.UTC(fimDia.ano, fimDia.mes0, fimDia.dia));
             d.setUTCDate(d.getUTCDate() + 1)) {
          const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
          if (!diaMap.has(dateStr)) {
            diaMap.set(dateStr, {
              comandas_fechadas: 0,
              faturamento_itens: 0,
              gorjeta: 0,
              taxa_entrega: 0,
              total_recebido: 0,
              ticket_medio: 0,
            });
          }
        }

        // Build por_dia array sorted by date
        const porDia = Array.from(diaMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([data, metrics]) => ({
            data,
            ...metrics,
          }));

        // Calculate variations
        const calcularVariacao = (atual: number, anterior: number): number | null => {
          if (anterior === 0) {
            return atual === 0 ? null : null;
          }
          return Math.round(((atual - anterior) / anterior) * 10000) / 100;
        };

        const variacaoPercentual = {
          faturamento_itens: calcularVariacao(totalAtual.faturamento_itens, anteriorMetricas.faturamento_itens),
          total_recebido: calcularVariacao(totalAtual.total_recebido, anteriorMetricas.total_recebido),
          ticket_medio: calcularVariacao(ticketMedioAtual, ticketMedioAnterior),
        };

        // Get inconsistent count
        const inconsistentCount = inconsistentesResult?.[0]?.inconsistent_count || 0;

        // Build response
        const porCanalArray = Array.from(canalMap.entries())
          .map(([canal, metrics]) => {
            const ticket = metrics.comandas_fechadas > 0 ? metrics.faturamento_itens / metrics.comandas_fechadas : 0;
            return {
              canal,
              ...metrics,
              ticket_medio: Math.round(ticket * 100) / 100,
            };
          })
          .sort((a, b) => b.faturamento_itens - a.faturamento_itens);

        app.logger.info(
          {
            tenantId,
            totalAtual,
            ticketMedioAtual,
            inconsistentCount,
          },
          "Vendas report retrieved successfully"
        );

        return await reply.code(200).send({
          periodo: {
            nome: periodoLabel,
            inicio: inicio.toISOString(),
            fim: fim.toISOString(),
          },
          totais: {
            ...totalAtual,
            comandas_com_consumo: totalAtual.comandas_fechadas,
            ticket_medio: Math.round(ticketMedioAtual * 100) / 100,
          },
          por_canal: porCanalArray,
          por_dia: porDia,
          comparacao_anterior: {
            periodo: {
              nome: periodoAnteriorLabel,
              inicio: periodoAnteriorInicio.toISOString(),
              fim: periodoAnteriorFim.toISOString(),
            },
            totais: {
              ...anteriorMetricas,
              comandas_com_consumo: anteriorMetricas.comandas_fechadas,
              ticket_medio: Math.round(ticketMedioAnterior * 100) / 100,
            },
            variacao_percentual: variacaoPercentual,
          },
          comandas_inconsistentes: inconsistentCount,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get vendas report");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/relatorios/vendas-detalhe - Detailed sales report with hourly, daily, payment, and staff breakdown
  app.fastify.get(
    "/api/relatorios/vendas-detalhe",
    {
      schema: {
        description: "Get detailed sales report with breakdown by hour, day of week, payment method, and staff (requires authentication)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: { type: "string", enum: ["hoje", "7dias", "mes", "personalizado"] },
            dataInicio: { type: "string" },
            dataFim: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              por_hora: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    hora: { type: "integer" },
                    comandas: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    ticket_medio: { type: "number" },
                  },
                  required: ["hora", "comandas", "faturamento_itens", "ticket_medio"],
                },
              },
              por_dia_semana: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dia_semana: { type: "integer" },
                    nome: { type: "string" },
                    ocorrencias_no_periodo: { type: "integer" },
                    comandas: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    ticket_medio: { type: "number" },
                  },
                  required: ["dia_semana", "nome", "ocorrencias_no_periodo", "comandas", "faturamento_itens", "ticket_medio"],
                },
              },
              formas_pagamento: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    forma: { type: "string", enum: ["pix", "dinheiro", "cartao_credito", "cartao_debito"] },
                    valor_recebido: { type: "number" },
                    quantidade_pagamentos: { type: "integer" },
                    percentual: { type: "number" },
                    troco: { type: "number" },
                  },
                  required: ["forma", "valor_recebido", "quantidade_pagamentos", "percentual", "troco"],
                },
              },
              nao_conciliado: {
                type: "object",
                properties: {
                  comandas_pago_menor: { type: "integer" },
                  valor_faltante: { type: "number" },
                  comandas_pago_maior: { type: "integer" },
                  valor_excedente: { type: "number" },
                },
                required: ["comandas_pago_menor", "valor_faltante", "comandas_pago_maior", "valor_excedente"],
              },
              por_garcom: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    garcom_id: { type: "string", nullable: true },
                    nome: { type: "string" },
                    comandas: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    gorjeta_total: { type: "number" },
                    ticket_medio: { type: "number" },
                    gorjeta_media_por_comanda_com_gorjeta: { type: "number" },
                  },
                  required: ["garcom_id", "nome", "comandas", "faturamento_itens", "gorjeta_total", "ticket_medio", "gorjeta_media_por_comanda_com_gorjeta"],
                },
              },
            },
            required: ["por_hora", "por_dia_semana", "formas_pagamento", "nao_conciliado", "por_garcom"],
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const tenantId = requireTenant(authUser);
        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };

        // Resolve period
        const { inicio, fim } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);

        // Check custom period length (max 366 days)
        if (query.periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting vendas-detalhe report");

        // Fetch hourly breakdown
        const porHoraResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT id, restaurante_id, tipo::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 0 AS prioridade_fonte
              FROM comandas
              WHERE restaurante_id = ${tenantId}
            ),
            vendas_historico AS (
              SELECT id, restaurante_id, 'mesa'::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 1 AS prioridade_fonte
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais UNION ALL SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, tipo, status, closed_at, subtotal, total
              FROM todas_vendas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            base_vendas AS (
              SELECT * FROM deduplicadas
              WHERE status = 'fechada' AND total > 0 AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
            )
            SELECT
              EXTRACT(HOUR FROM (closed_at AT TIME ZONE 'America/Sao_Paulo'))::integer AS hora,
              COUNT(*)::integer AS comandas,
              SUM(subtotal) AS faturamento_itens
            FROM base_vendas
            GROUP BY EXTRACT(HOUR FROM (closed_at AT TIME ZONE 'America/Sao_Paulo'))
          `
        ) as any[];

        // Fetch daily breakdown
        const porDiaSemanaResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT id, restaurante_id, tipo::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 0 AS prioridade_fonte
              FROM comandas
              WHERE restaurante_id = ${tenantId}
            ),
            vendas_historico AS (
              SELECT id, restaurante_id, 'mesa'::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 1 AS prioridade_fonte
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais UNION ALL SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, tipo, status, closed_at, subtotal, total
              FROM todas_vendas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            base_vendas AS (
              SELECT * FROM deduplicadas
              WHERE status = 'fechada' AND total > 0 AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
            )
            SELECT
              EXTRACT(DOW FROM (closed_at AT TIME ZONE 'America/Sao_Paulo'))::integer AS dia_semana,
              COUNT(*)::integer AS comandas,
              SUM(subtotal) AS faturamento_itens
            FROM base_vendas
            GROUP BY EXTRACT(DOW FROM (closed_at AT TIME ZONE 'America/Sao_Paulo'))
          `
        ) as any[];

        // Fetch payment methods and reconciliation (two independent aggregations)
        const formasResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT id, restaurante_id, tipo::text AS tipo, status::text AS status, closed_at, subtotal, total, 0 AS prioridade_fonte
              FROM comandas WHERE restaurante_id = ${tenantId}
            ),
            vendas_historico AS (
              SELECT id, restaurante_id, 'mesa'::text AS tipo, status::text AS status, closed_at, subtotal, total, 1 AS prioridade_fonte
              FROM comandas_historico WHERE restaurante_id = ${tenantId}
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais UNION ALL SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, status, closed_at, subtotal, total
              FROM todas_vendas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            base_vendas_ids AS (
              SELECT id, total FROM deduplicadas
              WHERE status = 'fechada' AND total > 0 AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            pagamentos_atuais AS (
              SELECT id, comanda_id AS comanda, forma_pagamento::text AS forma, status::text AS status, valor, COALESCE(troco, 0) AS troco, 0 AS prioridade_fonte
              FROM pagamentos WHERE restaurante_id = ${tenantId}
            ),
            pagamentos_hist AS (
              SELECT id, comanda_id AS comanda, forma_pagamento::text AS forma, 'confirmado'::text AS status, valor, COALESCE(troco, 0) AS troco, 1 AS prioridade_fonte
              FROM pagamentos_historico WHERE restaurante_id = ${tenantId}
            ),
            pagamentos_uniao AS (
              SELECT * FROM pagamentos_atuais UNION ALL SELECT * FROM pagamentos_hist
            ),
            pagamentos_dedup AS (
              SELECT DISTINCT ON (id) id, comanda, forma, status, valor, troco
              FROM pagamentos_uniao
              ORDER BY id, prioridade_fonte ASC
            ),
            pagamentos_confirmados AS (
              SELECT comanda, forma, valor, troco FROM pagamentos_dedup
              WHERE status = 'confirmado' AND comanda IN (SELECT id FROM base_vendas_ids)
            ),
            formas_agg AS (
              SELECT
                forma,
                SUM(valor) AS valor_recebido,
                COUNT(*) AS quantidade,
                SUM(CASE WHEN forma = 'dinheiro' THEN troco ELSE 0 END) AS troco_total
              FROM pagamentos_confirmados
              GROUP BY forma
            )
            SELECT
              COALESCE((SELECT valor_recebido FROM formas_agg WHERE forma = 'pix'), 0) AS pix_valor,
              COALESCE((SELECT quantidade FROM formas_agg WHERE forma = 'pix'), 0) AS pix_qtd,
              COALESCE((SELECT valor_recebido FROM formas_agg WHERE forma = 'dinheiro'), 0) AS dinheiro_valor,
              COALESCE((SELECT quantidade FROM formas_agg WHERE forma = 'dinheiro'), 0) AS dinheiro_qtd,
              COALESCE((SELECT troco_total FROM formas_agg WHERE forma = 'dinheiro'), 0) AS dinheiro_troco,
              COALESCE((SELECT valor_recebido FROM formas_agg WHERE forma = 'cartao_credito'), 0) AS credito_valor,
              COALESCE((SELECT quantidade FROM formas_agg WHERE forma = 'cartao_credito'), 0) AS credito_qtd,
              COALESCE((SELECT valor_recebido FROM formas_agg WHERE forma = 'cartao_debito'), 0) AS debito_valor,
              COALESCE((SELECT quantidade FROM formas_agg WHERE forma = 'cartao_debito'), 0) AS debito_qtd,
              COALESCE(SUM(valor_recebido), 0) AS total_recebido
            FROM formas_agg
          `
        ) as any[];

        // Fetch reconciliation independently
        const reconcResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT id, restaurante_id, tipo::text AS tipo, status::text AS status, closed_at, subtotal, total, 0 AS prioridade_fonte
              FROM comandas WHERE restaurante_id = ${tenantId}
            ),
            vendas_historico AS (
              SELECT id, restaurante_id, 'mesa'::text AS tipo, status::text AS status, closed_at, subtotal, total, 1 AS prioridade_fonte
              FROM comandas_historico WHERE restaurante_id = ${tenantId}
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais UNION ALL SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, status, closed_at, subtotal, total
              FROM todas_vendas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            base_vendas_ids AS (
              SELECT id, total FROM deduplicadas
              WHERE status = 'fechada' AND total > 0 AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
            ),
            pagamentos_atuais AS (
              SELECT id, comanda_id AS comanda, status::text AS status, valor, 0 AS prioridade_fonte
              FROM pagamentos WHERE restaurante_id = ${tenantId}
            ),
            pagamentos_hist AS (
              SELECT id, comanda_id AS comanda, 'confirmado'::text AS status, valor, 1 AS prioridade_fonte
              FROM pagamentos_historico WHERE restaurante_id = ${tenantId}
            ),
            pagamentos_uniao AS (
              SELECT * FROM pagamentos_atuais UNION ALL SELECT * FROM pagamentos_hist
            ),
            pagamentos_dedup AS (
              SELECT DISTINCT ON (id) id, comanda, status, valor
              FROM pagamentos_uniao
              ORDER BY id, prioridade_fonte ASC
            ),
            pagamentos_confirmados AS (
              SELECT comanda, valor FROM pagamentos_dedup
              WHERE status = 'confirmado' AND comanda IN (SELECT id FROM base_vendas_ids)
            ),
            reconciliacao_por_comanda AS (
              SELECT
                bvi.id,
                bvi.total,
                COALESCE(SUM(pc.valor), 0) AS pago
              FROM base_vendas_ids bvi
              LEFT JOIN pagamentos_confirmados pc ON bvi.id = pc.comanda
              GROUP BY bvi.id, bvi.total
            )
            SELECT
              SUM(CASE WHEN pago < total - 0.01 THEN 1 ELSE 0 END)::integer AS comandas_faltante,
              SUM(CASE WHEN pago < total - 0.01 THEN (total - pago) ELSE 0 END) AS valor_faltante,
              SUM(CASE WHEN pago > total + 0.01 THEN 1 ELSE 0 END)::integer AS comandas_excedente,
              SUM(CASE WHEN pago > total + 0.01 THEN (pago - total) ELSE 0 END) AS valor_excedente
            FROM reconciliacao_por_comanda
          `
        ) as any[];

        // Fetch staff breakdown
        const porGarcomResult = await (app.db as any).execute(
          sql`
            WITH vendas_atuais AS (
              SELECT id, restaurante_id, tipo::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 0 AS prioridade_fonte
              FROM comandas WHERE restaurante_id = ${tenantId}
            ),
            vendas_historico AS (
              SELECT id, restaurante_id, 'mesa'::text AS tipo, status::text AS status, closed_at, subtotal, total, gorjeta, garcom_id, 1 AS prioridade_fonte
              FROM comandas_historico WHERE restaurante_id = ${tenantId}
            ),
            todas_vendas AS (
              SELECT * FROM vendas_atuais UNION ALL SELECT * FROM vendas_historico
            ),
            deduplicadas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, tipo, status, closed_at, subtotal, total, gorjeta, garcom_id
              FROM todas_vendas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            base_vendas AS (
              SELECT * FROM deduplicadas
              WHERE status = 'fechada' AND total > 0 AND closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz AND tipo != 'delivery'
            ),
            perfis_unicos AS (
              SELECT DISTINCT ON (p.user_id) p.user_id AS user_id, NULLIF(BTRIM(p.name), '') AS nome
              FROM profiles p
              WHERE p.restaurante_id = ${tenantId}
              ORDER BY p.user_id, (NULLIF(BTRIM(p.name), '') IS NULL) ASC, p.created_at DESC, p.id DESC
            ),
            garcons_resolvidos AS (
              SELECT bv.garcom_id AS garcom_original, bv.subtotal AS subtotal, bv.gorjeta AS gorjeta,
              COALESCE(NULLIF(BTRIM(u.nome), ''), pu.nome) AS nome_resolvido
              FROM base_vendas bv
              LEFT JOIN usuarios u ON u.id = bv.garcom_id AND u.restaurante_id = ${tenantId}
              LEFT JOIN perfis_unicos pu ON pu.user_id = bv.garcom_id
            ),
            garcons_finais AS (
              SELECT CASE WHEN NULLIF(BTRIM(garcom_original), '') IS NOT NULL AND nome_resolvido IS NOT NULL THEN garcom_original ELSE NULL END AS garcom_id,
              CASE WHEN NULLIF(BTRIM(garcom_original), '') IS NOT NULL AND nome_resolvido IS NOT NULL THEN nome_resolvido ELSE 'Sem garçom identificado' END AS nome,
              subtotal, gorjeta
              FROM garcons_resolvidos
            )
            SELECT gf.garcom_id AS garcom_id, gf.nome AS nome,
            COUNT(*)::integer AS comandas,
            SUM(gf.subtotal) AS faturamento_itens,
            SUM(gf.gorjeta) AS gorjeta_total,
            COUNT(CASE WHEN gf.gorjeta > 0 THEN 1 END)::integer AS comandas_com_gorjeta
            FROM garcons_finais gf
            GROUP BY gf.garcom_id, gf.nome
            ORDER BY faturamento_itens DESC NULLS LAST, gf.nome ASC, gf.garcom_id ASC NULLS LAST
          `
        ) as any[];

        const detalheResult = {
          porHoraResult,
          porDiaSemanaResult,
          formasResult,
          reconcResult,
          porGarcomResult
        };

        // Build hourly data (24 hours)
        const horaMap = new Map<number, { comandas: number; faturamento_itens: number }>();
        for (let h = 0; h < 24; h++) {
          horaMap.set(h, { comandas: 0, faturamento_itens: 0 });
        }
        if (Array.isArray(detalheResult.porHoraResult)) {
          for (const row of detalheResult.porHoraResult) {
            const hora = row.hora;
            horaMap.set(hora, {
              comandas: parseInt(String(row.comandas)) || 0,
              faturamento_itens: Math.round(parseFloat(String(row.faturamento_itens)) * 100) / 100,
            });
          }
        }

        const porHora = Array.from({ length: 24 }, (_, i) => {
          const metrics = horaMap.get(i) || { comandas: 0, faturamento_itens: 0 };
          return {
            hora: i,
            comandas: metrics.comandas,
            faturamento_itens: metrics.faturamento_itens,
            ticket_medio: metrics.comandas > 0 ? Math.round((metrics.faturamento_itens / metrics.comandas) * 100) / 100 : 0,
          };
        });

        // Build day of week data (0-6 with occurrences)
        const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
        const diaMap = new Map<number, { comandas: number; faturamento_itens: number; ocorrencias: number }>();

        for (let d = 0; d < 7; d++) {
          diaMap.set(d, { comandas: 0, faturamento_itens: 0, ocorrencias: 0 });
        }

        // Count occurrences of each day of week in period
        const inicioDia = diaLocalDeInstante(inicio);
        const fimDia = diaLocalDeInstante(new Date(fim.getTime() - 1));
        for (let d = new Date(Date.UTC(inicioDia.ano, inicioDia.mes0, inicioDia.dia));
             d <= new Date(Date.UTC(fimDia.ano, fimDia.mes0, fimDia.dia));
             d.setUTCDate(d.getUTCDate() + 1)) {
          const dayOfWeek = d.getUTCDay();
          const current = diaMap.get(dayOfWeek) || { comandas: 0, faturamento_itens: 0, ocorrencias: 0 };
          diaMap.set(dayOfWeek, { ...current, ocorrencias: current.ocorrencias + 1 });
        }

        if (Array.isArray(detalheResult.porDiaSemanaResult)) {
          for (const row of detalheResult.porDiaSemanaResult) {
            const dia = row.dia_semana;
            const current = diaMap.get(dia) || { comandas: 0, faturamento_itens: 0, ocorrencias: 0 };
            diaMap.set(dia, {
              ocorrencias: current.ocorrencias,
              comandas: parseInt(String(row.comandas)) || 0,
              faturamento_itens: Math.round(parseFloat(String(row.faturamento_itens)) * 100) / 100,
            });
          }
        }

        const porDiaSemana = Array.from({ length: 7 }, (_, i) => {
          const metrics = diaMap.get(i) || { comandas: 0, faturamento_itens: 0, ocorrencias: 0 };
          return {
            dia_semana: i,
            nome: diasSemana[i],
            ocorrencias_no_periodo: metrics.ocorrencias,
            comandas: metrics.comandas,
            faturamento_itens: metrics.faturamento_itens,
            ticket_medio: metrics.comandas > 0 ? Math.round((metrics.faturamento_itens / metrics.comandas) * 100) / 100 : 0,
          };
        });

        // Build payment methods data
        const formas = ["pix", "dinheiro", "cartao_credito", "cartao_debito"];
        const formasMap = new Map<string, { valor_recebido: number; quantidade_pagamentos: number; troco: number }>();
        for (const forma of formas) {
          formasMap.set(forma, { valor_recebido: 0, quantidade_pagamentos: 0, troco: 0 });
        }

        let totalRecebido = 0;
        if (Array.isArray(detalheResult.formasResult) && detalheResult.formasResult.length > 0) {
          const row = detalheResult.formasResult[0];
          formasMap.set("pix", {
            valor_recebido: parseFloat(String(row.pix_valor || 0)),
            quantidade_pagamentos: parseInt(String(row.pix_qtd || 0)) || 0,
            troco: 0,
          });
          formasMap.set("dinheiro", {
            valor_recebido: parseFloat(String(row.dinheiro_valor || 0)),
            quantidade_pagamentos: parseInt(String(row.dinheiro_qtd || 0)) || 0,
            troco: parseFloat(String(row.dinheiro_troco || 0)),
          });
          formasMap.set("cartao_credito", {
            valor_recebido: parseFloat(String(row.credito_valor || 0)),
            quantidade_pagamentos: parseInt(String(row.credito_qtd || 0)) || 0,
            troco: 0,
          });
          formasMap.set("cartao_debito", {
            valor_recebido: parseFloat(String(row.debito_valor || 0)),
            quantidade_pagamentos: parseInt(String(row.debito_qtd || 0)) || 0,
            troco: 0,
          });
          totalRecebido = parseFloat(String(row.total_recebido || 0));
        }

        const formasPagamento = formas.map((forma) => {
          const metrics = formasMap.get(forma) || { valor_recebido: 0, quantidade_pagamentos: 0, troco: 0 };
          const percentual = totalRecebido > 0 ? Math.round((metrics.valor_recebido / totalRecebido) * 10000) / 100 : 0;
          return {
            forma,
            valor_recebido: Math.round(metrics.valor_recebido * 100) / 100,
            quantidade_pagamentos: metrics.quantidade_pagamentos,
            percentual: Math.round(percentual * 100) / 100,
            troco: Math.round(metrics.troco * 100) / 100,
          };
        });

        // Build reconciliation data
        let naoReconciliado = {
          comandas_pago_menor: 0,
          valor_faltante: 0,
          comandas_pago_maior: 0,
          valor_excedente: 0,
        };

        if (Array.isArray(detalheResult.reconcResult) && detalheResult.reconcResult.length > 0) {
          const row = detalheResult.reconcResult[0];
          naoReconciliado = {
            comandas_pago_menor: parseInt(String(row.comandas_faltante || 0)) || 0,
            valor_faltante: Math.round(parseFloat(String(row.valor_faltante || 0)) * 100) / 100,
            comandas_pago_maior: parseInt(String(row.comandas_excedente || 0)) || 0,
            valor_excedente: Math.round(parseFloat(String(row.valor_excedente || 0)) * 100) / 100,
          };
        }

        // Build staff breakdown data
        const porGarcom = [];
        if (Array.isArray(detalheResult.porGarcomResult)) {
          for (const row of detalheResult.porGarcomResult) {
            const faturamento = Math.round(parseFloat(String(row.faturamento_itens || 0)) * 100) / 100;
            const gorjeta = Math.round(parseFloat(String(row.gorjeta_total || 0)) * 100) / 100;
            const comandas = parseInt(String(row.comandas)) || 0;
            const comandasComGorjeta = parseInt(String(row.comandas_com_gorjeta)) || 0;

            porGarcom.push({
              garcom_id: row.garcom_id || null,
              nome: row.nome || "Sem garçom identificado",
              comandas,
              faturamento_itens: faturamento,
              gorjeta_total: gorjeta,
              ticket_medio: comandas > 0 ? Math.round((faturamento / comandas) * 100) / 100 : 0,
              gorjeta_media_por_comanda_com_gorjeta: comandasComGorjeta > 0 ? Math.round((gorjeta / comandasComGorjeta) * 100) / 100 : 0,
            });
          }
        }

        app.logger.info(
          { tenantId, horas: porHora.length, dias: porDiaSemana.length, formas: formasPagamento.length, garcons: porGarcom.length },
          "Vendas-detalhe report retrieved successfully"
        );

        return await reply.code(200).send({
          por_hora: porHora,
          por_dia_semana: porDiaSemana,
          formas_pagamento: formasPagamento,
          nao_conciliado: naoReconciliado,
          por_garcom: porGarcom,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get vendas-detalhe report");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/relatorios/cancelamentos - Cancelation report
  app.fastify.get(
    "/api/relatorios/cancelamentos",
    {
      schema: {
        description: "Get cancellation report with breakdown by reason, responsible, dishes, channel, and day (requires authentication)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: { type: "string", enum: ["hoje", "7dias", "mes", "personalizado"] },
            dataInicio: { type: "string" },
            dataFim: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              totais: {
                type: "object",
                required: [
                  "quantidade_cancelada",
                  "valor_cancelado",
                  "quantidade_antes_preparo",
                  "valor_antes_preparo",
                  "quantidade_perda",
                  "valor_perda",
                  "percentual_cancelamento"
                ],
                properties: {
                  quantidade_cancelada: { type: "number" },
                  valor_cancelado: { type: "number" },
                  quantidade_antes_preparo: { type: "number" },
                  valor_antes_preparo: { type: "number" },
                  quantidade_perda: { type: "number" },
                  valor_perda: { type: "number" },
                  percentual_cancelamento: { type: "number" },
                },
              },
              por_motivo: {
                type: "array",
                items: {
                  type: "object",
                  required: ["codigo", "nome", "quantidade", "valor", "valor_perda"],
                  properties: {
                    codigo: { type: "string" },
                    nome: { type: "string" },
                    quantidade: { type: "number" },
                    valor: { type: "number" },
                    valor_perda: { type: "number" },
                  },
                },
              },
              por_responsavel: {
                type: "array",
                items: {
                  type: "object",
                  required: ["responsavel_id", "nome", "role", "quantidade", "valor", "valor_perda"],
                  properties: {
                    responsavel_id: { type: ["string", "null"] },
                    nome: { type: "string" },
                    role: { type: ["string", "null"] },
                    quantidade: { type: "number" },
                    valor: { type: "number" },
                    valor_perda: { type: "number" },
                  },
                },
              },
              pratos_mais_cancelados: {
                type: "array",
                items: {
                  type: "object",
                  required: ["nome", "quantidade", "valor", "valor_perda"],
                  properties: {
                    nome: { type: "string" },
                    quantidade: { type: "number" },
                    valor: { type: "number" },
                    valor_perda: { type: "number" },
                  },
                },
              },
              por_canal: {
                type: "array",
                items: {
                  type: "object",
                  required: ["canal", "quantidade", "valor", "valor_perda"],
                  properties: {
                    canal: { type: "string", enum: ["mesa", "delivery"] },
                    quantidade: { type: "number" },
                    valor: { type: "number" },
                    valor_perda: { type: "number" },
                  },
                },
              },
              por_dia: {
                type: "array",
                items: {
                  type: "object",
                  required: ["data", "quantidade", "valor", "valor_perda"],
                  properties: {
                    data: { type: "string" },
                    quantidade: { type: "number" },
                    valor: { type: "number" },
                    valor_perda: { type: "number" },
                  },
                },
              },
            },
            required: ["totais", "por_motivo", "por_responsavel", "pratos_mais_cancelados", "por_canal", "por_dia"],
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        const tenantId = requireTenant(authUser);
        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };

        // Resolve period
        const { inicio, fim } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);

        // Check custom period length (max 366 days)
        if (query.periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting cancelamentos report");

        // Main aggregation query for all metrics
        const cancelamentosResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, comanda_id, prato_id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, motivo_cancelamento,
                cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, comanda_id, prato_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, motivo_cancelamento,
                cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id)
                id, comanda_id, prato_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, motivo_cancelamento,
                cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT id, comanda_id, prato_id, quantidade, preco_unitario, cancelado_por_id, cancelado_por_nome,
                cancelado_por_role, motivo_cancelamento, cancelado_apos_inicio
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            )
            SELECT
              SUM(quantidade)::integer AS total_quantidade,
              SUM(CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)))::numeric AS total_valor,
              SUM(CASE WHEN cancelado_apos_inicio = true THEN quantidade ELSE 0 END)::integer AS quantidade_perda,
              SUM(CASE WHEN cancelado_apos_inicio = true THEN CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) ELSE 0 END)::numeric AS valor_perda_total,
              SUM(CASE WHEN cancelado_apos_inicio = false OR cancelado_apos_inicio IS NULL THEN quantidade ELSE 0 END)::integer AS quantidade_antes_preparo,
              SUM(CASE WHEN cancelado_apos_inicio = false OR cancelado_apos_inicio IS NULL THEN CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) ELSE 0 END)::numeric AS valor_antes_preparo
            FROM cancelamentos_filtrados
          `
        ) as any[];

        // Revenue sold (closed orders in period)
        const receitaVendidaResult = await (app.db as any).execute(
          sql`
            WITH comandas_vivas AS (
              SELECT id, restaurante_id, subtotal, status::text AS status, closed_at, 0 AS prioridade_fonte
              FROM comandas
              WHERE restaurante_id = ${tenantId}
            ),
            comandas_hist AS (
              SELECT id, restaurante_id, subtotal, status, closed_at, 1 AS prioridade_fonte
              FROM comandas_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todas_comandas AS (
              SELECT * FROM comandas_vivas UNION ALL SELECT * FROM comandas_hist
            ),
            dedup_comandas AS (
              SELECT DISTINCT ON (restaurante_id, id) id, restaurante_id, subtotal, status, closed_at
              FROM todas_comandas
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            )
            SELECT COALESCE(SUM(CAST(subtotal AS DECIMAL(10,2))), 0) AS receita_vendida_bruta
            FROM dedup_comandas
            WHERE status = 'fechada' AND CAST(subtotal AS DECIMAL(10,2)) > 0 AND
              closed_at >= ${inicio.toISOString()}::timestamptz AND closed_at < ${fim.toISOString()}::timestamptz
          `
        ) as any[];

        // Por motivo
        const porMotivoResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, comanda_id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, motivo_cancelamento, cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, comanda_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, motivo_cancelamento, cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, comanda_id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, motivo_cancelamento, cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT quantidade, preco_unitario, motivo_cancelamento, cancelado_apos_inicio
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            com_motivos AS (
              SELECT
                CASE
                  WHEN NULLIF(BTRIM(COALESCE(motivo_cancelamento, '')), '') IS NULL THEN 'sem_motivo'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%lancamento%' THEN 'erro_lancamento'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%desistiu%' OR LOWER(BTRIM(motivo_cancelamento)) LIKE '%cliente%desistiu%' THEN 'cliente_desistiu'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%falta%' THEN 'item_em_falta'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%demora%' THEN 'demora'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%qualidade%' THEN 'qualidade'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%nao%atend%' OR LOWER(BTRIM(motivo_cancelamento)) LIKE '%cliente%nao%atendeu%' THEN 'cliente_nao_atendeu'
                  WHEN LOWER(BTRIM(motivo_cancelamento)) LIKE '%fora%area%' OR LOWER(BTRIM(motivo_cancelamento)) LIKE '%endereco%' THEN 'endereco_fora_area'
                  ELSE 'outro'
                END AS motivo_codigo,
                quantidade,
                CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cancelado_apos_inicio = true THEN CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados
            )
            SELECT
              motivo_codigo,
              SUM(quantidade)::integer AS quantidade,
              SUM(valor_bruto)::numeric AS valor,
              SUM(valor_perda)::numeric AS valor_perda
            FROM com_motivos
            GROUP BY motivo_codigo
            ORDER BY valor DESC, motivo_codigo ASC
          `
        ) as any[];

        // Por responsável
        const porResponsavelResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, cancelado_por_id, cancelado_por_nome, cancelado_por_role, cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT id, quantidade, preco_unitario, cancelado_por_id, cancelado_por_nome, cancelado_por_role, cancelado_apos_inicio
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            agrupados AS (
              SELECT
                CASE WHEN NULLIF(BTRIM(COALESCE(cancelado_por_id, '')), '') IS NULL THEN NULL ELSE cancelado_por_id END AS identificador,
                MAX(NULLIF(BTRIM(COALESCE(cancelado_por_nome, '')), '')) AS nome_snapshot,
                MAX(NULLIF(BTRIM(COALESCE(cancelado_por_role, '')), '')) AS role_snapshot,
                SUM(quantidade)::integer AS quantidade,
                SUM(CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)))::numeric AS valor,
                SUM(CASE WHEN cancelado_apos_inicio = true THEN CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) ELSE 0 END)::numeric AS valor_perda
              FROM cancelamentos_filtrados
              GROUP BY identificador
            )
            SELECT
              identificador AS responsavel_id,
              CASE WHEN identificador IS NULL THEN 'Não identificado' ELSE COALESCE(nome_snapshot, 'Não identificado') END AS nome,
              role_snapshot AS role,
              quantidade,
              valor,
              valor_perda
            FROM agrupados
            ORDER BY valor DESC, nome ASC, responsavel_id ASC NULLS LAST
          `
        ) as any[];

        // Pratos mais cancelados (TOP 10)
        const pratosMaisCanceladosResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, prato_id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, prato_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, prato_id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT prato_id, quantidade, preco_unitario, cancelado_apos_inicio
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            com_nomes_vivos AS (
              SELECT
                COALESCE(NULLIF(BTRIM(p.nome), ''), 'Prato removido') AS nome,
                cf.quantidade,
                CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cf.cancelado_apos_inicio = true THEN CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados cf
              LEFT JOIN pratos p ON cf.prato_id = p.id AND p.restaurante_id = ${tenantId}
              WHERE cf.prato_id IS NOT NULL
            ),
            agregado AS (
              SELECT nome, SUM(quantidade)::integer AS quantidade, SUM(valor_bruto)::numeric AS valor, SUM(valor_perda)::numeric AS valor_perda
              FROM com_nomes_vivos
              GROUP BY nome
            )
            SELECT nome, quantidade, valor, valor_perda
            FROM agregado
            ORDER BY valor DESC, nome ASC
            LIMIT 10
          `
        ) as any[];

        // Por canal
        const porCanalResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, comanda_id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, comanda_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, comanda_id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT comanda_id, quantidade, preco_unitario, cancelado_apos_inicio
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            com_canal_vivas AS (
              SELECT
                CASE WHEN c.tipo::text = 'delivery' THEN 'delivery' ELSE 'mesa' END AS canal,
                cf.quantidade,
                CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cf.cancelado_apos_inicio = true THEN CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados cf
              LEFT JOIN comandas c ON cf.comanda_id = c.id AND c.restaurante_id = ${tenantId}
            ),
            com_canal_hist AS (
              SELECT
                'mesa' AS canal,
                cf.quantidade,
                CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cf.cancelado_apos_inicio = true THEN CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados cf
              LEFT JOIN comandas_historico ch ON cf.comanda_id = ch.id AND ch.restaurante_id = ${tenantId}
              WHERE NOT EXISTS (SELECT 1 FROM comandas c WHERE c.id = cf.comanda_id AND c.restaurante_id = ${tenantId})
            ),
            agregado AS (
              SELECT canal, SUM(quantidade)::integer AS quantidade, SUM(valor_bruto)::numeric AS valor, SUM(valor_perda)::numeric AS valor_perda
              FROM (SELECT * FROM com_canal_vivas UNION ALL SELECT * FROM com_canal_hist) t
              GROUP BY canal
            )
            SELECT COALESCE(canal, 'mesa') AS canal, COALESCE(quantidade, 0) AS quantidade, COALESCE(valor, 0) AS valor, COALESCE(valor_perda, 0) AS valor_perda
            FROM (SELECT 'mesa' AS canal UNION ALL SELECT 'delivery') canais
            LEFT JOIN agregado a ON canais.canal = a.canal
            ORDER BY canal
          `
        ) as any[];

        // Por dia (with calendar fill)
        const porDiaResult = await (app.db as any).execute(
          sql`
            WITH pedidos_vivos AS (
              SELECT id, quantidade, preco_unitario, restaurante_id, status::text AS status,
                cancelado_em, cancelado_apos_inicio, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_apos_inicio, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, cancelado_apos_inicio
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT
                to_char(cancelado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS data,
                quantidade,
                CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cancelado_apos_inicio = true THEN CAST(quantidade AS DECIMAL(10,2)) * CAST(preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            agregado AS (
              SELECT data, SUM(quantidade)::integer AS quantidade, SUM(valor_bruto)::numeric AS valor, SUM(valor_perda)::numeric AS valor_perda
              FROM cancelamentos_filtrados
              GROUP BY data
            ),
            calendario AS (
              SELECT to_char(d, 'YYYY-MM-DD') AS data
              FROM generate_series(${inicio.toISOString()}::date, (${fim.toISOString()}::date - '1 day'::interval)::date, '1 day'::interval) d
            )
            SELECT c.data, COALESCE(a.quantidade, 0) AS quantidade, COALESCE(a.valor, 0) AS valor, COALESCE(a.valor_perda, 0) AS valor_perda
            FROM calendario c
            LEFT JOIN agregado a ON c.data = a.data
            ORDER BY c.data
          `
        ) as any[];

        // Process totals
        const totalsCancelamentos = cancelamentosResult[0] || {
          total_quantidade: 0,
          total_valor: 0,
          quantidade_perda: 0,
          valor_perda_total: 0,
          quantidade_antes_preparo: 0,
          valor_antes_preparo: 0,
        };

        const receitaVendida = receitaVendidaResult[0]?.receita_vendida_bruta || 0;
        const valorCanceladoBruto = parseFloat(String(totalsCancelamentos.total_valor || 0));
        const denominador = valorCanceladoBruto + parseFloat(String(receitaVendida || 0));
        const percentualCancelamento = denominador > 0 ? (valorCanceladoBruto / denominador) * 100 : 0;

        // Fixed motives (9 total)
        const motivosFixos = [
          { codigo: "erro_lancamento", nome: "Erro de lançamento" },
          { codigo: "cliente_desistiu", nome: "Cliente desistiu" },
          { codigo: "item_em_falta", nome: "Item em falta" },
          { codigo: "demora", nome: "Demora" },
          { codigo: "qualidade", nome: "Qualidade" },
          { codigo: "outro", nome: "Outro" },
          { codigo: "cliente_nao_atendeu", nome: "Cliente não atendeu" },
          { codigo: "endereco_fora_area", nome: "Endereço fora da área" },
          { codigo: "sem_motivo", nome: "Sem motivo informado" },
        ];

        const motivoMap = new Map<string, { quantidade: number; valor: number; valor_perda: number }>();
        for (const m of motivosFixos) {
          motivoMap.set(m.codigo, { quantidade: 0, valor: 0, valor_perda: 0 });
        }

        if (Array.isArray(porMotivoResult)) {
          for (const row of porMotivoResult) {
            const codigo = row.motivo_codigo || "sem_motivo";
            motivoMap.set(codigo, {
              quantidade: parseInt(String(row.quantidade || 0)) || 0,
              valor: Math.round(parseFloat(String(row.valor || 0)) * 100) / 100,
              valor_perda: Math.round(parseFloat(String(row.valor_perda || 0)) * 100) / 100,
            });
          }
        }

        const porMotivo = motivosFixos
          .map(m => ({
            codigo: m.codigo,
            nome: m.nome,
            ...motivoMap.get(m.codigo)!,
          }))
          .sort((a, b) => {
            if (b.valor !== a.valor) return b.valor - a.valor;
            return a.codigo.localeCompare(b.codigo);
          });

        // Process por_responsavel
        const porResponsavel = [];
        if (Array.isArray(porResponsavelResult)) {
          for (const row of porResponsavelResult) {
            porResponsavel.push({
              responsavel_id: row.responsavel_id || null,
              nome: row.nome || "Não identificado",
              role: row.role || null,
              quantidade: parseInt(String(row.quantidade || 0)) || 0,
              valor: Math.round(parseFloat(String(row.valor || 0)) * 100) / 100,
              valor_perda: Math.round(parseFloat(String(row.valor_perda || 0)) * 100) / 100,
            });
          }
        }

        // Process pratos_mais_cancelados
        const pratosMaisCancelados = [];
        if (Array.isArray(pratosMaisCanceladosResult)) {
          for (const row of pratosMaisCanceladosResult) {
            pratosMaisCancelados.push({
              nome: row.nome || "Prato removido",
              quantidade: parseInt(String(row.quantidade || 0)) || 0,
              valor: Math.round(parseFloat(String(row.valor || 0)) * 100) / 100,
              valor_perda: Math.round(parseFloat(String(row.valor_perda || 0)) * 100) / 100,
            });
          }
        }

        // Process por_canal
        const porCanal = [];
        if (Array.isArray(porCanalResult)) {
          for (const row of porCanalResult) {
            porCanal.push({
              canal: row.canal || "mesa",
              quantidade: parseInt(String(row.quantidade || 0)) || 0,
              valor: Math.round(parseFloat(String(row.valor || 0)) * 100) / 100,
              valor_perda: Math.round(parseFloat(String(row.valor_perda || 0)) * 100) / 100,
            });
          }
        }

        // Process por_dia
        const porDia = [];
        if (Array.isArray(porDiaResult)) {
          for (const row of porDiaResult) {
            porDia.push({
              data: row.data || "",
              quantidade: parseInt(String(row.quantidade || 0)) || 0,
              valor: Math.round(parseFloat(String(row.valor || 0)) * 100) / 100,
              valor_perda: Math.round(parseFloat(String(row.valor_perda || 0)) * 100) / 100,
            });
          }
        }

        app.logger.info(
          {
            tenantId,
            quantidade_cancelada: totalsCancelamentos.total_quantidade,
            valor_cancelado: totalsCancelamentos.total_valor,
            percentual_cancelamento: Math.round(percentualCancelamento * 100) / 100,
          },
          "Cancelamentos report retrieved successfully"
        );

        return await reply.code(200).send({
          totais: {
            quantidade_cancelada: parseInt(String(totalsCancelamentos.total_quantidade || 0)) || 0,
            valor_cancelado: Math.round(parseFloat(String(valorCanceladoBruto)) * 100) / 100,
            quantidade_antes_preparo: parseInt(String(totalsCancelamentos.quantidade_antes_preparo || 0)) || 0,
            valor_antes_preparo: Math.round(parseFloat(String(totalsCancelamentos.valor_antes_preparo || 0)) * 100) / 100,
            quantidade_perda: parseInt(String(totalsCancelamentos.quantidade_perda || 0)) || 0,
            valor_perda: Math.round(parseFloat(String(totalsCancelamentos.valor_perda_total || 0)) * 100) / 100,
            percentual_cancelamento: Math.round(percentualCancelamento * 100) / 100,
          },
          por_motivo: porMotivo,
          por_responsavel: porResponsavel,
          pratos_mais_cancelados: pratosMaisCancelados,
          por_canal: porCanal,
          por_dia: porDia,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get cancelamentos report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de cancelamentos." });
      }
    }
  );
}
