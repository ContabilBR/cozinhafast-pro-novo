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
}
