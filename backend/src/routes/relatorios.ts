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
  // GET /api/relatorios/mix-pratos - Dish mix analysis (ABC classification)
  app.fastify.get(
    "/api/relatorios/mix-pratos",
    {
      schema: {
        description: "Get dish mix analysis with ABC classification (requires authentication and admin/manager role)",
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
            required: ["totais", "pratos", "resumo_abc", "por_categoria", "mais_vendidos_quantidade", "sem_vendas"],
            properties: {
              totais: {
                type: "object",
                required: ["pratos_distintos", "quantidade_vendida", "faturamento_itens"],
                properties: {
                  pratos_distintos: { type: "number" },
                  quantidade_vendida: { type: "number" },
                  faturamento_itens: { type: "number" },
                },
              },
              pratos: {
                type: "array",
                items: {
                  type: "object",
                  required: ["posicao", "prato_id", "nome", "categoria", "quantidade_vendida", "faturamento", "preco_medio", "percentual_faturamento", "percentual_acumulado", "classe_abc"],
                  properties: {
                    posicao: { type: "number" },
                    prato_id: { type: "string", nullable: true },
                    nome: { type: "string" },
                    categoria: { type: "string" },
                    quantidade_vendida: { type: "number" },
                    faturamento: { type: "number" },
                    preco_medio: { type: "number" },
                    percentual_faturamento: { type: "number" },
                    percentual_acumulado: { type: "number" },
                    classe_abc: { type: "string" },
                  },
                },
              },
              resumo_abc: {
                type: "array",
                items: {
                  type: "object",
                  required: ["classe", "quantidade_pratos", "faturamento", "percentual_faturamento"],
                  properties: {
                    classe: { type: "string" },
                    quantidade_pratos: { type: "number" },
                    faturamento: { type: "number" },
                    percentual_faturamento: { type: "number" },
                  },
                },
              },
              por_categoria: {
                type: "array",
                items: {
                  type: "object",
                  required: ["categoria", "quantidade_vendida", "faturamento", "percentual_faturamento"],
                  properties: {
                    categoria: { type: "string" },
                    quantidade_vendida: { type: "number" },
                    faturamento: { type: "number" },
                    percentual_faturamento: { type: "number" },
                  },
                },
              },
              mais_vendidos_quantidade: {
                type: "array",
                items: {
                  type: "object",
                  required: ["nome", "categoria", "quantidade_vendida", "faturamento"],
                  properties: {
                    nome: { type: "string" },
                    categoria: { type: "string" },
                    quantidade_vendida: { type: "number" },
                    faturamento: { type: "number" },
                  },
                },
              },
              sem_vendas: {
                type: "array",
                items: {
                  type: "object",
                  required: ["prato_id", "nome", "categoria"],
                  properties: {
                    prato_id: { type: "string" },
                    nome: { type: "string" },
                    categoria: { type: "string" },
                  },
                },
              },
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
        const { inicio, fim, label: periodoLabel } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);

        // Check custom period length (max 366 days)
        if (query.periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        app.logger.info({ tenantId, periodo: query.periodo, inicio, fim }, "Getting mix-pratos report");

        // Base CTE reused in both queries - deduplicates items and comandas, filters by period eligibility
        const baseVendidos = sql`
WITH itens_fontes AS (
 SELECT p.id AS id,p.restaurante_id AS restaurante_id,p.comanda_id AS comanda_id,p.prato_id AS prato_id,NULL::text AS prato_nome_gravado,p.quantidade AS quantidade,p.preco_unitario AS preco_unitario,p.status::text AS status,0 AS prioridade
 FROM pedidos p WHERE p.restaurante_id=${tenantId}
 UNION ALL
 SELECT ph.id AS id,ph.restaurante_id AS restaurante_id,ph.comanda_id AS comanda_id,ph.prato_id AS prato_id,ph.prato_nome AS prato_nome_gravado,ph.quantidade AS quantidade,ph.preco_unitario AS preco_unitario,ph.status::text AS status,1 AS prioridade
 FROM pedidos_historico ph WHERE ph.restaurante_id=${tenantId}
), itens_unicos AS (
 SELECT DISTINCT ON (i.restaurante_id,i.id) i.id AS id,i.restaurante_id AS restaurante_id,i.comanda_id AS comanda_id,i.prato_id AS prato_id,i.prato_nome_gravado AS prato_nome_gravado,i.quantidade AS quantidade,i.preco_unitario AS preco_unitario,i.status AS status
 FROM itens_fontes i ORDER BY i.restaurante_id,i.id,i.prioridade ASC
), comandas_fontes AS (
 SELECT c.id AS id,c.restaurante_id AS restaurante_id,c.status::text AS status,c.total AS total,c.closed_at AS closed_at,0 AS prioridade
 FROM comandas c WHERE c.restaurante_id=${tenantId}
 UNION ALL
 SELECT ch.id AS id,ch.restaurante_id AS restaurante_id,ch.status::text AS status,ch.total AS total,ch.closed_at AS closed_at,1 AS prioridade
 FROM comandas_historico ch WHERE ch.restaurante_id=${tenantId}
), comandas_unicas AS (
 SELECT DISTINCT ON (c.restaurante_id,c.id) c.id AS id,c.restaurante_id AS restaurante_id,c.status AS status,c.total AS total,c.closed_at AS closed_at
 FROM comandas_fontes c ORDER BY c.restaurante_id,c.id,c.prioridade ASC
), comandas_elegiveis AS (
 SELECT c.id AS id,c.restaurante_id AS restaurante_id FROM comandas_unicas c
 WHERE c.status='fechada' AND c.total>0 AND c.closed_at>=${inicio.toISOString()}::timestamptz AND c.closed_at<${fim.toISOString()}::timestamptz
), itens_vendidos AS (
 SELECT i.prato_id AS prato_id,i.restaurante_id AS restaurante_id,i.prato_nome_gravado AS prato_nome_gravado,i.quantidade AS quantidade,i.preco_unitario AS preco_unitario
 FROM itens_unicos i INNER JOIN comandas_elegiveis c ON c.id=i.comanda_id AND c.restaurante_id=i.restaurante_id
 WHERE i.status<>'cancelado'
)`;

        // Query 1: Get sold dishes with aggregation and metrics
        const query1Result = await (app.db as any).execute(
          sql`${baseVendidos}, pratos_resolvidos AS (
 SELECT CASE WHEN i.prato_id IS NOT NULL THEN 'id:'||i.prato_id::text ELSE 'nome:'||COALESCE(NULLIF(BTRIM(i.prato_nome_gravado),''),'Prato removido') END AS chave,
 i.prato_id AS prato_id,
 COALESCE(NULLIF(BTRIM(p.nome),''),NULLIF(BTRIM(i.prato_nome_gravado),''),'Prato removido') AS nome,
 COALESCE(NULLIF(BTRIM(c.nome),''),'Sem categoria') AS categoria,
 i.quantidade AS quantidade,i.preco_unitario AS preco_unitario
 FROM itens_vendidos i
 LEFT JOIN pratos p ON p.id=i.prato_id AND p.restaurante_id=i.restaurante_id AND p.restaurante_id=${tenantId}
 LEFT JOIN categorias c ON c.id=p.categoria_id AND c.restaurante_id=p.restaurante_id AND c.restaurante_id=${tenantId}
)
SELECT r.chave AS chave,MAX(r.prato_id::text) AS prato_id,MAX(r.nome) AS nome,MAX(r.categoria) AS categoria,SUM(r.quantidade) AS quantidade_vendida,SUM(r.quantidade::numeric*r.preco_unitario) AS faturamento
FROM pratos_resolvidos r GROUP BY r.chave`
        ) as any[];

        // Adjustment 1: Guard - validate query1Result is Array
        if (!Array.isArray(query1Result)) {
          app.logger.error({ tenantId, query: 'pratos_vendidos', resultType: typeof query1Result }, "Query 1 result is not an array");
          return await reply.code(500).send({ error: "Não foi possível gerar o relatório de mix de pratos: resultado inválido na consulta de pratos vendidos." });
        }

        // Query 2: Get dishes with no sales
        const query2Result = await (app.db as any).execute(
          sql`${baseVendidos}
SELECT p.id AS prato_id,p.nome AS nome,COALESCE(NULLIF(BTRIM(c.nome),''),'Sem categoria') AS categoria
FROM pratos p LEFT JOIN categorias c ON c.id=p.categoria_id AND c.restaurante_id=p.restaurante_id AND c.restaurante_id=${tenantId}
WHERE p.restaurante_id=${tenantId} AND p.disponivel=true
AND NOT EXISTS (SELECT 1 FROM itens_vendidos i WHERE i.prato_id=p.id AND i.restaurante_id=p.restaurante_id)
ORDER BY p.nome ASC,p.id ASC LIMIT 50`
        ) as any[];

        // Adjustment 1: Guard - validate query2Result is Array
        if (!Array.isArray(query2Result)) {
          app.logger.error({ tenantId, query: 'sem_vendas', resultType: typeof query2Result }, "Query 2 result is not an array");
          return await reply.code(500).send({ error: "Não foi possível gerar o relatório de mix de pratos: resultado inválido na consulta de pratos sem vendas." });
        }

        // Process Query 1 results: build raw pratos array
        const pratosRaw: Array<{
          chave: string;
          prato_id: string | null;
          nome: string;
          categoria: string;
          quantidade_bruta: number;
          faturamento_bruto: number;
        }> = [];

        for (const row of query1Result) {
          pratosRaw.push({
            chave: row.chave || '',
            prato_id: row.prato_id || null,
            nome: row.nome || '',
            categoria: row.categoria || '',
            quantidade_bruta: Number(row.quantidade_vendida) || 0,
            faturamento_bruto: Number(row.faturamento) || 0,
          });
        }

        // Adjustment 2: Sort pratosRaw before calculations by faturamento_bruto desc, nome asc, chave asc
        pratosRaw.sort((a, b) => {
          if (b.faturamento_bruto !== a.faturamento_bruto) {
            return b.faturamento_bruto - a.faturamento_bruto;
          }
          if (a.nome !== b.nome) {
            return a.nome.localeCompare(b.nome);
          }
          return a.chave.localeCompare(b.chave);
        });

        // Calculate total faturamento for percentual calculations
        const totalFaturamento = pratosRaw.reduce((sum, p) => sum + p.faturamento_bruto, 0);

        // Build pratos array with all calculations
        let acumuladoFaturamento = 0;
        const pratos = pratosRaw
          .map((prato, index) => {
            const anteriorPercentual = acumuladoFaturamento / (totalFaturamento || 1) * 100;
            acumuladoFaturamento += prato.faturamento_bruto;
            const percentualAcumulado = totalFaturamento > 0 ? (acumuladoFaturamento / totalFaturamento) * 100 : 0;

            let classe = 'A';
            if (index !== 0) {
              if (anteriorPercentual >= 80 && anteriorPercentual < 95) {
                classe = 'B';
              } else if (anteriorPercentual >= 95) {
                classe = 'C';
              }
            }

            return {
              posicao: index + 1,
              prato_id: prato.prato_id,
              nome: prato.nome,
              categoria: prato.categoria,
              quantidade_vendida: prato.quantidade_bruta,
              faturamento: Number(prato.faturamento_bruto.toFixed(2)),
              preco_medio: prato.quantidade_bruta !== 0 ? Number((prato.faturamento_bruto / prato.quantidade_bruta).toFixed(2)) : 0,
              percentual_faturamento: totalFaturamento > 0 ? Number(((prato.faturamento_bruto / totalFaturamento) * 100).toFixed(2)) : 0,
              percentual_acumulado: Number(percentualAcumulado.toFixed(2)),
              classe_abc: classe,
            };
          });

        // Build totais
        const pratos_distintos = pratosRaw.length;
        const quantidade_vendida = pratosRaw.reduce((sum, p) => sum + p.quantidade_bruta, 0);
        const faturamento_itens = Number(totalFaturamento.toFixed(2));

        const totais = {
          pratos_distintos,
          quantidade_vendida,
          faturamento_itens,
        };

        // Build resumo_abc (always 3 items)
        const abcMap = new Map<string, { quantidade_pratos: number; faturamento_bruto: number }>();
        abcMap.set('A', { quantidade_pratos: 0, faturamento_bruto: 0 });
        abcMap.set('B', { quantidade_pratos: 0, faturamento_bruto: 0 });
        abcMap.set('C', { quantidade_pratos: 0, faturamento_bruto: 0 });

        // Adjustment 3: Loop using pratosRaw by index, using class from pratos[index] but sum raw faturamento_bruto
        for (let index = 0; index < pratosRaw.length; index++) {
          const pratoRaw = pratosRaw[index];
          const pratoCalculated = pratos[index];
          const entry = abcMap.get(pratoCalculated.classe_abc) || { quantidade_pratos: 0, faturamento_bruto: 0 };
          entry.quantidade_pratos++;
          entry.faturamento_bruto += pratoRaw.faturamento_bruto;
          abcMap.set(pratoCalculated.classe_abc, entry);
        }

        const resumo_abc = ['A', 'B', 'C'].map(classe => {
          const entry = abcMap.get(classe) || { quantidade_pratos: 0, faturamento_bruto: 0 };
          return {
            classe,
            quantidade_pratos: entry.quantidade_pratos,
            faturamento: Number(entry.faturamento_bruto.toFixed(2)),
            percentual_faturamento: totalFaturamento > 0 ? Number(((entry.faturamento_bruto / totalFaturamento) * 100).toFixed(2)) : 0,
          };
        });

        // Build por_categoria
        const categoriaMap = new Map<string, { quantidade_bruta: number; faturamento_bruto: number }>();
        for (const prato of pratosRaw) {
          const entry = categoriaMap.get(prato.categoria) || { quantidade_bruta: 0, faturamento_bruto: 0 };
          entry.quantidade_bruta += prato.quantidade_bruta;
          entry.faturamento_bruto += prato.faturamento_bruto;
          categoriaMap.set(prato.categoria, entry);
        }

        // Adjustment 4: Sort entries by faturamento_bruto desc, categoria asc BEFORE mapping
        const por_categoria = Array.from(categoriaMap.entries())
          .sort(([catA, dataA], [catB, dataB]) => {
            if (dataB.faturamento_bruto !== dataA.faturamento_bruto) {
              return dataB.faturamento_bruto - dataA.faturamento_bruto;
            }
            return catA.localeCompare(catB);
          })
          .map(([categoria, data]) => ({
            categoria,
            quantidade_vendida: data.quantidade_bruta,
            faturamento: Number(data.faturamento_bruto.toFixed(2)),
            percentual_faturamento: totalFaturamento > 0 ? Number(((data.faturamento_bruto / totalFaturamento) * 100).toFixed(2)) : 0,
          }));

        // Build mais_vendidos_quantidade (top 10 by quantity)
        const mais_vendidos_quantidade = [...pratosRaw]
          .sort((a, b) => b.quantidade_bruta - a.quantidade_bruta || b.faturamento_bruto - a.faturamento_bruto || a.nome.localeCompare(b.nome))
          .slice(0, 10)
          .map(p => ({
            nome: p.nome,
            categoria: p.categoria,
            quantidade_vendida: p.quantidade_bruta,
            faturamento: Number(p.faturamento_bruto.toFixed(2)),
          }));

        // Build sem_vendas from Query 2
        const sem_vendas: Array<{ prato_id: string; nome: string; categoria: string }> = [];
        if (Array.isArray(query2Result)) {
          for (const row of query2Result) {
            sem_vendas.push({
              prato_id: row.prato_id || '',
              nome: row.nome || '',
              categoria: row.categoria || '',
            });
          }
        }

        const resultData = {
          totais,
          pratos,
          resumo_abc,
          por_categoria,
          mais_vendidos_quantidade,
          sem_vendas,
        };

        app.logger.info(
          {
            tenantId,
            pratos_distintos: totais.pratos_distintos,
            quantidade_vendida: totais.quantidade_vendida,
            faturamento_itens: totais.faturamento_itens,
          },
          "Mix-pratos report retrieved successfully"
        );

        return await reply.code(200).send(resultData);
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get mix-pratos report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de mix de pratos." });
      }
    }
  );

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

        // Top 5 dishes no período - single aggregated query
        let topDishes: Array<{ dish_name: string; quantity_sold: number }> = [];
        try {
          const topDishesResult = await (app.db as any).execute(
            sql`
WITH itens_fontes AS (
 SELECT p.id AS id, p.restaurante_id AS restaurante_id, p.comanda_id AS comanda_id, p.prato_id AS prato_id, NULL::text AS prato_nome_gravado, p.quantidade AS quantidade, p.status::text AS status, 0 AS prioridade_fonte
 FROM pedidos p WHERE p.restaurante_id = ${tenantId}
 UNION ALL
 SELECT ph.id AS id, ph.restaurante_id AS restaurante_id, ph.comanda_id AS comanda_id, ph.prato_id AS prato_id, ph.prato_nome AS prato_nome_gravado, ph.quantidade AS quantidade, ph.status::text AS status, 1 AS prioridade_fonte
 FROM pedidos_historico ph WHERE ph.restaurante_id = ${tenantId}
),
itens_unicos AS (
 SELECT DISTINCT ON (i.restaurante_id,i.id)
 i.id AS id,i.restaurante_id AS restaurante_id,i.comanda_id AS comanda_id,i.prato_id AS prato_id,i.prato_nome_gravado AS prato_nome_gravado,i.quantidade AS quantidade,i.status AS status
 FROM itens_fontes i ORDER BY i.restaurante_id,i.id,i.prioridade_fonte ASC
),
comandas_fontes AS (
 SELECT c.id AS id,c.restaurante_id AS restaurante_id,c.status::text AS status,c.total AS total,c.closed_at AS closed_at,0 AS prioridade_fonte
 FROM comandas c WHERE c.restaurante_id = ${tenantId}
 UNION ALL
 SELECT ch.id AS id,ch.restaurante_id AS restaurante_id,ch.status::text AS status,ch.total AS total,ch.closed_at AS closed_at,1 AS prioridade_fonte
 FROM comandas_historico ch WHERE ch.restaurante_id = ${tenantId}
),
comandas_unicas AS (
 SELECT DISTINCT ON (c.restaurante_id,c.id) c.id AS id,c.restaurante_id AS restaurante_id,c.status AS status,c.total AS total,c.closed_at AS closed_at
 FROM comandas_fontes c ORDER BY c.restaurante_id,c.id,c.prioridade_fonte ASC
),
comandas_elegiveis AS (
 SELECT c.id AS id,c.restaurante_id AS restaurante_id FROM comandas_unicas c
 WHERE c.status='fechada' AND c.total>0
 AND c.closed_at>=${inicio.toISOString()}::timestamptz AND c.closed_at<${fim.toISOString()}::timestamptz
),
itens_vendidos AS (
 SELECT i.prato_id AS prato_id,i.prato_nome_gravado AS prato_nome_gravado,i.quantidade AS quantidade,i.restaurante_id AS restaurante_id
 FROM itens_unicos i
 INNER JOIN comandas_elegiveis c ON c.id=i.comanda_id AND c.restaurante_id=i.restaurante_id
 WHERE i.status<>'cancelado'
),
pratos_resolvidos AS (
 SELECT
 CASE WHEN i.prato_id IS NOT NULL THEN 'id:' || i.prato_id::text ELSE 'nome:' || COALESCE(NULLIF(BTRIM(i.prato_nome_gravado),''),'Prato removido') END AS chave_prato,
 COALESCE(NULLIF(BTRIM(p.nome),''),NULLIF(BTRIM(i.prato_nome_gravado),''),'Prato removido') AS nome_exibido,
 i.quantidade AS quantidade
 FROM itens_vendidos i
 LEFT JOIN pratos p ON p.id=i.prato_id AND p.restaurante_id=i.restaurante_id AND p.restaurante_id=${tenantId}
),
pratos_agrupados AS (
 SELECT p.chave_prato AS chave_prato,MAX(p.nome_exibido) AS dish_name,SUM(p.quantidade) AS quantity_sold
 FROM pratos_resolvidos p GROUP BY p.chave_prato
)
SELECT p.dish_name AS dish_name,p.quantity_sold AS quantity_sold
FROM pratos_agrupados p
ORDER BY p.quantity_sold DESC,p.dish_name ASC,p.chave_prato ASC
LIMIT 5
            `
          ) as any[];

          if (Array.isArray(topDishesResult)) {
            topDishes = topDishesResult.map((row) => ({
              dish_name: row.dish_name || "Unknown",
              quantity_sold: parseInt(String(row.quantity_sold || 0)),
            }));
          }
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
              CASE WHEN identificador IS NULL THEN NULL ELSE role_snapshot END AS role,
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
                cancelado_em, cancelado_apos_inicio, NULL::text AS prato_nome, 0 AS prioridade_fonte
              FROM pedidos
              WHERE restaurante_id = ${tenantId}
            ),
            pedidos_hist AS (
              SELECT id, prato_id, quantidade, preco_unitario, restaurante_id, status,
                cancelado_em, cancelado_apos_inicio, prato_nome AS prato_nome, 1 AS prioridade_fonte
              FROM pedidos_historico
              WHERE restaurante_id = ${tenantId}
            ),
            todos_pedidos AS (
              SELECT * FROM pedidos_vivos UNION ALL SELECT * FROM pedidos_hist
            ),
            dedup_pedidos AS (
              SELECT DISTINCT ON (restaurante_id, id) id, prato_id, quantidade, preco_unitario, restaurante_id,
                status, cancelado_em, cancelado_apos_inicio, prato_nome
              FROM todos_pedidos
              ORDER BY restaurante_id, id, prioridade_fonte ASC
            ),
            cancelamentos_filtrados AS (
              SELECT prato_id, quantidade, preco_unitario, cancelado_apos_inicio, prato_nome
              FROM dedup_pedidos
              WHERE status = 'cancelado' AND cancelado_em >= ${inicio.toISOString()}::timestamptz AND
                cancelado_em < ${fim.toISOString()}::timestamptz
            ),
            com_nomes AS (
              SELECT
                COALESCE(NULLIF(BTRIM(cf.prato_nome),''), NULLIF(BTRIM(p.nome),''), 'Prato removido') AS nome,
                cf.quantidade,
                CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cf.cancelado_apos_inicio = true THEN CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados cf
              LEFT JOIN pratos p ON cf.prato_id = p.id AND p.restaurante_id = ${tenantId}
            ),
            agregado AS (
              SELECT nome, SUM(quantidade)::integer AS quantidade, SUM(valor_bruto)::numeric AS valor, SUM(valor_perda)::numeric AS valor_perda
              FROM com_nomes
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
            com_canal AS (
              SELECT CASE WHEN c.tipo::text = 'delivery' THEN 'delivery' ELSE 'mesa' END AS canal,
                cf.quantidade AS quantidade,
                CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) AS valor_bruto,
                CASE WHEN cf.cancelado_apos_inicio = true THEN CAST(cf.quantidade AS DECIMAL(10,2)) * CAST(cf.preco_unitario AS DECIMAL(10,2)) ELSE 0 END AS valor_perda
              FROM cancelamentos_filtrados cf
              LEFT JOIN comandas c ON cf.comanda_id = c.id AND c.restaurante_id = ${tenantId}
            ),
            agregado AS (
              SELECT cc.canal AS canal, SUM(cc.quantidade)::integer AS quantidade, SUM(cc.valor_bruto)::numeric AS valor, SUM(cc.valor_perda)::numeric AS valor_perda
              FROM com_canal cc GROUP BY cc.canal
            ),
            canais AS (
              SELECT 'mesa'::text AS canal, 0 AS ordem
              UNION ALL SELECT 'delivery'::text AS canal, 1 AS ordem
            )
            SELECT canais.canal AS canal,
              COALESCE(a.quantidade,0) AS quantidade,
              COALESCE(a.valor,0) AS valor,
              COALESCE(a.valor_perda,0) AS valor_perda
            FROM canais LEFT JOIN agregado a ON canais.canal=a.canal
            ORDER BY canais.ordem
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

  // =========================================================================
  // GET /api/relatorios/cozinha-tempos
  // =========================================================================
  app.fastify.get(
    "/api/relatorios/cozinha-tempos",
    {
      schema: {
        description: "Get kitchen timing analytics (preparation times and percentiles)",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: {
              type: "string",
              enum: ["hoje", "7dias", "mes", "personalizado"],
              description: "Period filter",
            },
            dataInicio: { type: "string", description: "Start date for custom period (ISO 8601)" },
            dataFim: { type: "string", description: "End date for custom period (ISO 8601)" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["totais", "por_prato", "por_hora"],
            properties: {
              totais: {
                type: "object",
                required: [
                  "itens_medidos",
                  "itens_sem_medicao",
                  "comandas_medidas",
                  "tempo_medio_item_min",
                  "mediana_item_min",
                  "p90_item_min",
                  "tempo_medio_pedido_min",
                  "mediana_pedido_min",
                  "p90_pedido_min",
                ],
                properties: {
                  itens_medidos: { type: "integer" },
                  itens_sem_medicao: { type: "integer" },
                  comandas_medidas: { type: "integer" },
                  tempo_medio_item_min: { type: "number" },
                  mediana_item_min: { type: ["number", "null"] },
                  p90_item_min: { type: ["number", "null"] },
                  tempo_medio_pedido_min: { type: "number" },
                  mediana_pedido_min: { type: ["number", "null"] },
                  p90_pedido_min: { type: ["number", "null"] },
                },
              },
              por_prato: {
                type: "array",
                items: {
                  type: "object",
                  required: ["prato_id", "nome", "categoria", "itens_medidos", "tempo_medio_min", "p90_min", "meta_min", "percentual_dentro_meta"],
                  properties: {
                    prato_id: { type: ["string", "null"] },
                    nome: { type: "string" },
                    categoria: { type: ["string", "null"] },
                    itens_medidos: { type: "integer" },
                    tempo_medio_min: { type: "number" },
                    p90_min: { type: ["number", "null"] },
                    meta_min: { type: ["integer", "null"] },
                    percentual_dentro_meta: { type: ["number", "null"] },
                  },
                },
              },
              por_hora: {
                type: "array",
                items: {
                  type: "object",
                  required: ["hora", "itens_medidos", "tempo_medio_min"],
                  properties: {
                    hora: { type: "integer" },
                    itens_medidos: { type: "integer" },
                    tempo_medio_min: { type: "number" },
                  },
                },
              },
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

      const tenantId = requireTenant(authUser);
      const { periodo, dataInicio, dataFim } = request.query as {
        periodo?: Periodo;
        dataInicio?: string;
        dataFim?: string;
      };

      app.logger.info({ tenantId, periodo }, "Fetching cozinha-tempos report");

      try {
        // Validate period and get date range
        const { inicio, fim } = resolvePeriodo(periodo, dataInicio, dataFim);

        // Check custom period length (max 366 days)
        if (periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        // Base SQL fragment with 9 CTEs for deduplication and filtering
        const baseComun = sql`
          WITH comandas_fontes AS (
            SELECT c.id, c.restaurante_id, c.status::text AS status, c.total, c.closed_at, 0 AS prioridade_fonte
            FROM comandas c
            WHERE c.restaurante_id = ${tenantId}
            UNION ALL
            SELECT ch.id, ch.restaurante_id, ch.status::text AS status, ch.total, ch.closed_at, 1 AS prioridade_fonte
            FROM comandas_historico ch
            WHERE ch.restaurante_id = ${tenantId}
          ),
          comandas_unicas AS (
            SELECT DISTINCT ON (cf.restaurante_id, cf.id)
              cf.id, cf.restaurante_id, cf.status, cf.total, cf.closed_at
            FROM comandas_fontes cf
            ORDER BY cf.restaurante_id, cf.id, cf.prioridade_fonte ASC
          ),
          comandas_elegiveis AS (
            SELECT cu.id, cu.restaurante_id
            FROM comandas_unicas cu
            WHERE cu.status = 'fechada' AND cu.total > 0
              AND cu.closed_at >= ${inicio.toISOString()}::timestamptz
              AND cu.closed_at < ${fim.toISOString()}::timestamptz
          ),
          itens_fontes AS (
            SELECT p.id, p.restaurante_id, p.comanda_id, p.prato_id, p.status::text AS status, p.iniciado_em, p.pronto_em,
              NULL::text AS prato_nome_historico, 0 AS prioridade_fonte
            FROM pedidos p
            WHERE p.restaurante_id = ${tenantId}
            UNION ALL
            SELECT ph.id, ph.restaurante_id, ph.comanda_id, ph.prato_id, ph.status::text AS status, ph.iniciado_em, ph.pronto_em,
              ph.prato_nome AS prato_nome_historico, 1 AS prioridade_fonte
            FROM pedidos_historico ph
            WHERE ph.restaurante_id = ${tenantId}
          ),
          itens_unicos AS (
            SELECT DISTINCT ON (ifn.restaurante_id, ifn.id)
              ifn.id, ifn.restaurante_id, ifn.comanda_id, ifn.prato_id, ifn.status,
              ifn.iniciado_em, ifn.pronto_em, ifn.prato_nome_historico
            FROM itens_fontes ifn
            ORDER BY ifn.restaurante_id, ifn.id, ifn.prioridade_fonte ASC
          ),
          itens_elegiveis AS (
            SELECT iu.id, iu.restaurante_id, iu.comanda_id, iu.prato_id, iu.status, iu.iniciado_em, iu.pronto_em, iu.prato_nome_historico
            FROM itens_unicos iu
            INNER JOIN comandas_elegiveis ce ON iu.comanda_id = ce.id AND iu.restaurante_id = ce.restaurante_id
            WHERE iu.status <> 'cancelado'
          ),
          itens_medidos AS (
            SELECT ie.id, ie.restaurante_id, ie.comanda_id, ie.prato_id,
              EXTRACT(EPOCH FROM (ie.pronto_em - ie.iniciado_em))::double precision / 60.0 AS duracao_min,
              ie.iniciado_em, ie.pronto_em, ie.prato_nome_historico,
              EXTRACT(HOUR FROM ie.iniciado_em AT TIME ZONE 'America/Sao_Paulo')::integer AS hora
            FROM itens_elegiveis ie
            WHERE ie.iniciado_em IS NOT NULL AND ie.pronto_em IS NOT NULL AND ie.pronto_em >= ie.iniciado_em
          ),
          pratos_resolvidos AS (
            SELECT
              COALESCE(im.prato_id::text, 'historico:' || NULLIF(im.prato_nome_historico, ''), 'Prato removido') AS chave,
              im.id, im.comanda_id, im.duracao_min, im.hora, im.prato_nome_historico,
              p.id AS prato_id_catalog, p.nome, NULLIF(p.tempo_preparo_min, 0) AS meta_min,
              cat.nome AS categoria
            FROM itens_medidos im
            LEFT JOIN pratos p ON p.id = im.prato_id AND p.restaurante_id = im.restaurante_id AND p.restaurante_id = ${tenantId}
            LEFT JOIN categorias cat ON cat.id = p.categoria_id AND cat.restaurante_id = im.restaurante_id AND cat.restaurante_id = ${tenantId}
          ),
          itens_prato_meta AS (
            SELECT pr.chave, pr.prato_id_catalog, pr.nome, pr.prato_nome_historico, pr.categoria, pr.duracao_min, pr.meta_min,
              CASE WHEN pr.meta_min IS NULL THEN NULL WHEN pr.duracao_min <= pr.meta_min THEN 1 ELSE 0 END AS dentro_meta
            FROM pratos_resolvidos pr
          ),
          medidos_por_pedido AS (
            SELECT im.comanda_id, MAX(im.duracao_min) AS duracao_pedido_min
            FROM itens_medidos im
            GROUP BY im.comanda_id
          )
        `;

        // Query 1: Item totals
        const itemTotaisResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT COUNT(*)::integer AS itens_medidos,
              (SELECT COUNT(*)::integer FROM itens_elegiveis ie WHERE ie.iniciado_em IS NULL OR ie.pronto_em IS NULL OR ie.pronto_em < ie.iniciado_em) AS itens_sem_medicao,
              COALESCE(AVG(im.duracao_min), 0)::double precision AS tempo_medio_item_min,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY im.duracao_min) AS mediana_item_min,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY im.duracao_min) AS p90_item_min
            FROM itens_medidos im
          `
        ) as any[];

        // Validate Q1 result
        if (!Array.isArray(itemTotaisResult)) {
          app.logger.error({ tenantId, resultType: typeof itemTotaisResult }, "Query 1 (item totals) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de itens: resultado inválido." });
        }
        if (itemTotaisResult.length === 0) {
          app.logger.error({ tenantId }, "Query 1 (item totals) returned empty array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de itens: resultado vazio." });
        }

        // Query 2: Order totals
        const orderTotaisResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT
              COUNT(*)::integer AS comandas_medidas,
              COALESCE(AVG(mpp.duracao_pedido_min), 0)::double precision AS tempo_medio_pedido_min,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mpp.duracao_pedido_min) AS mediana_pedido_min,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mpp.duracao_pedido_min) AS p90_pedido_min
            FROM medidos_por_pedido mpp
          `
        ) as any[];

        // Validate Q2 result
        if (!Array.isArray(orderTotaisResult)) {
          app.logger.error({ tenantId, resultType: typeof orderTotaisResult }, "Query 2 (order totals) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de pedidos: resultado inválido." });
        }
        if (orderTotaisResult.length === 0) {
          app.logger.error({ tenantId }, "Query 2 (order totals) returned empty array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de pedidos: resultado vazio." });
        }

        // Query 3: Per-dish breakdown
        const porPratoResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT
              MAX(ipm.prato_id_catalog::text) AS prato_id,
              COALESCE(MAX(ipm.nome), MAX(NULLIF(ipm.prato_nome_historico, '')), 'Prato removido') AS nome,
              MAX(ipm.categoria) AS categoria,
              COUNT(*)::integer AS itens_medidos,
              AVG(ipm.duracao_min)::double precision AS tempo_medio_min,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ipm.duracao_min) AS p90_min,
              MAX(ipm.meta_min)::integer AS meta_min,
              CASE WHEN MAX(ipm.meta_min) IS NULL THEN NULL ELSE 100.0 * SUM(ipm.dentro_meta) / COUNT(*) END AS percentual_dentro_meta
            FROM itens_prato_meta ipm
            GROUP BY ipm.chave
            ORDER BY AVG(ipm.duracao_min) DESC, COALESCE(MAX(ipm.nome), MAX(NULLIF(ipm.prato_nome_historico, '')), 'Prato removido') ASC, ipm.chave ASC
            LIMIT 30
          `
        ) as any[];

        // Validate Q3 result
        if (!Array.isArray(porPratoResult)) {
          app.logger.error({ tenantId, resultType: typeof porPratoResult }, "Query 3 (per-dish) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de pratos: resultado inválido." });
        }

        // Query 4: Per-hour breakdown
        const porHoraResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT
              im.hora::integer AS hora,
              COUNT(*)::integer AS itens_medidos,
              AVG(im.duracao_min)::double precision AS tempo_medio_min
            FROM itens_medidos im
            GROUP BY im.hora
            ORDER BY im.hora ASC
          `
        ) as any[];

        // Validate Q4 result
        if (!Array.isArray(porHoraResult)) {
          app.logger.error({ tenantId, resultType: typeof porHoraResult }, "Query 4 (per-hour) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de horas: resultado inválido." });
        }

        // Process totals
        const itemRow = itemTotaisResult[0];
        const orderRow = orderTotaisResult[0];

        const totais = {
          itens_medidos: parseInt(String(itemRow.itens_medidos || 0)) || 0,
          itens_sem_medicao: parseInt(String(itemRow.itens_sem_medicao || 0)) || 0,
          comandas_medidas: parseInt(String(orderRow.comandas_medidas || 0)) || 0,
          tempo_medio_item_min: Number(Number(parseFloat(String(itemRow.tempo_medio_item_min || 0))).toFixed(2)),
          mediana_item_min: itemRow.mediana_item_min !== null ? Number(Number(parseFloat(String(itemRow.mediana_item_min))).toFixed(2)) : null,
          p90_item_min: itemRow.p90_item_min !== null ? Number(Number(parseFloat(String(itemRow.p90_item_min))).toFixed(2)) : null,
          tempo_medio_pedido_min: Number(Number(parseFloat(String(orderRow.tempo_medio_pedido_min || 0))).toFixed(2)),
          mediana_pedido_min: orderRow.mediana_pedido_min !== null ? Number(Number(parseFloat(String(orderRow.mediana_pedido_min))).toFixed(2)) : null,
          p90_pedido_min: orderRow.p90_pedido_min !== null ? Number(Number(parseFloat(String(orderRow.p90_pedido_min))).toFixed(2)) : null,
        };

        // Process per-dish data
        const porPrato = [];
        for (const row of porPratoResult) {
          porPrato.push({
            prato_id: row.prato_id || null,
            nome: row.nome || "Prato removido",
            categoria: row.categoria || null,
            itens_medidos: parseInt(String(row.itens_medidos || 0)) || 0,
            tempo_medio_min: Number(Number(parseFloat(String(row.tempo_medio_min || 0))).toFixed(2)),
            p90_min: row.p90_min !== null ? Number(Number(parseFloat(String(row.p90_min))).toFixed(2)) : null,
            meta_min: row.meta_min !== null ? parseInt(String(row.meta_min)) : null,
            percentual_dentro_meta: row.percentual_dentro_meta !== null ? Number(Number(parseFloat(String(row.percentual_dentro_meta))).toFixed(2)) : null,
          });
        }

        // Process per-hour data
        const porHora = [];
        for (const row of porHoraResult) {
          porHora.push({
            hora: parseInt(String(row.hora || 0)) || 0,
            itens_medidos: parseInt(String(row.itens_medidos || 0)) || 0,
            tempo_medio_min: Number(Number(parseFloat(String(row.tempo_medio_min || 0))).toFixed(2)),
          });
        }

        app.logger.info(
          {
            tenantId,
            itens_medidos: totais.itens_medidos,
            itens_sem_medicao: totais.itens_sem_medicao,
            comandas_medidas: totais.comandas_medidas,
          },
          "Cozinha-tempos report retrieved successfully"
        );

        return await reply.code(200).send({
          totais,
          por_prato: porPrato,
          por_hora: porHora,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get cozinha-tempos report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de tempos de cozinha." });
      }
    }
  );

  // =========================================================================
  // GET /api/relatorios/delivery-bairros
  // =========================================================================
  app.fastify.get(
    "/api/relatorios/delivery-bairros",
    {
      schema: {
        description: "Get delivery analytics by neighborhood",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            periodo: {
              type: "string",
              enum: ["hoje", "7dias", "mes", "personalizado"],
              description: "Period filter",
            },
            dataInicio: { type: "string", description: "Start date for custom period (ISO 8601)" },
            dataFim: { type: "string", description: "End date for custom period (ISO 8601)" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["totais", "por_bairro"],
            properties: {
              totais: {
                type: "object",
                required: [
                  "pedidos",
                  "faturamento_itens",
                  "taxa_entrega",
                  "total_recebido",
                  "ticket_medio",
                  "tempo_medio_entrega_min",
                  "pedidos_com_tempo",
                ],
                properties: {
                  pedidos: { type: "integer" },
                  faturamento_itens: { type: "number" },
                  taxa_entrega: { type: "number" },
                  total_recebido: { type: "number" },
                  ticket_medio: { type: "number" },
                  tempo_medio_entrega_min: { type: ["number", "null"] },
                  pedidos_com_tempo: { type: "integer" },
                },
              },
              por_bairro: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "bairro",
                    "pedidos",
                    "faturamento_itens",
                    "taxa_entrega",
                    "total_recebido",
                    "ticket_medio",
                    "taxa_media",
                    "tempo_medio_entrega_min",
                    "tempo_estimado_medio_min",
                    "percentual_pedidos",
                    "percentual_total_recebido",
                  ],
                  properties: {
                    bairro: { type: "string" },
                    pedidos: { type: "integer" },
                    faturamento_itens: { type: "number" },
                    taxa_entrega: { type: "number" },
                    total_recebido: { type: "number" },
                    ticket_medio: { type: "number" },
                    taxa_media: { type: "number" },
                    tempo_medio_entrega_min: { type: ["number", "null"] },
                    tempo_estimado_medio_min: { type: ["number", "null"] },
                    percentual_pedidos: { type: "number" },
                    percentual_total_recebido: { type: "number" },
                  },
                },
              },
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

      const tenantId = requireTenant(authUser);
      const { periodo, dataInicio, dataFim } = request.query as {
        periodo?: Periodo;
        dataInicio?: string;
        dataFim?: string;
      };

      app.logger.info({ tenantId, periodo }, "Fetching delivery-bairros report");

      try {
        // Validate period and get date range
        const { inicio, fim } = resolvePeriodo(periodo, dataInicio, dataFim);

        // Check custom period length (max 366 days)
        if (periodo === "personalizado") {
          const daysDiff = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 366) {
            app.logger.warn({ tenantId, daysDiff }, "Custom period exceeds 366 days");
            return await reply.code(400).send({ error: "O período personalizado não pode ultrapassar 366 dias." });
          }
        }

        // Base SQL with common CTEs
        const baseComun = sql`
          WITH comandas_fontes AS (
            SELECT c.id AS id, c.restaurante_id AS restaurante_id, c.status::text AS status, c.tipo::text AS tipo, c.subtotal AS subtotal, c.total AS total, c.closed_at AS closed_at, 0 AS prioridade_fonte
            FROM comandas c
            WHERE c.restaurante_id = ${tenantId}
            UNION ALL
            SELECT ch.id AS id, ch.restaurante_id AS restaurante_id, ch.status::text AS status, NULL::text AS tipo, ch.subtotal AS subtotal, ch.total AS total, ch.closed_at AS closed_at, 1 AS prioridade_fonte
            FROM comandas_historico ch
            WHERE ch.restaurante_id = ${tenantId}
          ),
          comandas_unicas AS (
            SELECT DISTINCT ON (cf.restaurante_id, cf.id)
              cf.id, cf.restaurante_id, cf.status, cf.tipo, cf.subtotal, cf.total, cf.closed_at, cf.prioridade_fonte
            FROM comandas_fontes cf
            ORDER BY cf.restaurante_id, cf.id, cf.prioridade_fonte ASC
          ),
          entregas_recentes AS (
            SELECT DISTINCT ON (e.restaurante_id, e.comanda_id)
              e.id, e.restaurante_id, e.comanda_id, e.bairro, e.taxa_entrega, e.tempo_estimado, e.saiu_em, e.entregue_em
            FROM entregas e
            WHERE e.restaurante_id = ${tenantId}
            ORDER BY e.restaurante_id, e.comanda_id, e.created_at DESC, e.id DESC
          ),
          elegiveis AS (
            SELECT cu.id, cu.restaurante_id, cu.subtotal AS faturamento_itens, cu.total AS total_recebido,
              COALESCE(er.taxa_entrega, 0) AS taxa_entrega,
              er.tempo_estimado AS tempo_estimado_min,
              CASE WHEN er.saiu_em IS NOT NULL AND er.entregue_em IS NOT NULL AND er.entregue_em >= er.saiu_em
                THEN EXTRACT(EPOCH FROM (er.entregue_em - er.saiu_em))::double precision / 60.0 ELSE NULL END AS tempo_entrega_min,
              CASE WHEN er.id IS NULL THEN 'Sem dados de entrega' ELSE COALESCE(NULLIF(BTRIM(er.bairro), ''), 'Sem bairro') END AS bairro_nome,
              CASE WHEN er.id IS NULL THEN 'sem-entrega:' ELSE 'bairro:' || LOWER(COALESCE(NULLIF(BTRIM(er.bairro), ''), 'Sem bairro')) END AS bairro_chave
            FROM comandas_unicas cu
            LEFT JOIN entregas_recentes er ON er.comanda_id = cu.id AND er.restaurante_id = cu.restaurante_id AND er.restaurante_id = ${tenantId}
            WHERE cu.status = 'fechada' AND cu.total > 0
              AND cu.closed_at >= ${inicio.toISOString()}::timestamptz
              AND cu.closed_at < ${fim.toISOString()}::timestamptz
              AND (cu.tipo::text = 'delivery' OR (cu.prioridade_fonte = 1 AND er.id IS NOT NULL))
          )
        `;

        // Query 1: Totals
        const totaisResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT
              COUNT(*)::integer AS pedidos,
              COALESCE(SUM(e.faturamento_itens), 0)::double precision AS faturamento_itens,
              COALESCE(SUM(e.taxa_entrega), 0)::double precision AS taxa_entrega,
              COALESCE(SUM(e.total_recebido), 0)::double precision AS total_recebido,
              COALESCE(AVG(e.total_recebido), 0)::double precision AS ticket_medio,
              AVG(e.tempo_entrega_min)::double precision AS tempo_medio_entrega_min,
              COUNT(e.tempo_entrega_min)::integer AS pedidos_com_tempo
            FROM elegiveis e
          `
        ) as any[];

        // Validate Q1 result
        if (!Array.isArray(totaisResult)) {
          app.logger.error({ tenantId, resultType: typeof totaisResult }, "Query 1 (totals) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de entrega: resultado inválido." });
        }
        if (totaisResult.length === 0) {
          app.logger.error({ tenantId }, "Query 1 (totals) returned empty array");
          return await reply.code(500).send({ error: "Falha na consulta de totais de entrega: resultado vazio." });
        }

        // Query 2: Per-neighborhood breakdown
        const porBairroResult = await (app.db as any).execute(
          sql`
            ${baseComun}
            SELECT
              MODE() WITHIN GROUP (ORDER BY e.bairro_nome) AS bairro,
              COUNT(*)::integer AS pedidos,
              COALESCE(SUM(e.faturamento_itens), 0)::double precision AS faturamento_itens,
              COALESCE(SUM(e.taxa_entrega), 0)::double precision AS taxa_entrega,
              COALESCE(SUM(e.total_recebido), 0)::double precision AS total_recebido,
              COALESCE(AVG(e.total_recebido), 0)::double precision AS ticket_medio,
              COALESCE(AVG(e.taxa_entrega), 0)::double precision AS taxa_media,
              AVG(e.tempo_entrega_min)::double precision AS tempo_medio_entrega_min,
              AVG(e.tempo_estimado_min)::double precision AS tempo_estimado_medio_min
            FROM elegiveis e
            GROUP BY e.bairro_chave
            ORDER BY SUM(e.total_recebido) DESC, MODE() WITHIN GROUP (ORDER BY e.bairro_nome) ASC, e.bairro_chave ASC
            LIMIT 50
          `
        ) as any[];

        // Validate Q2 result
        if (!Array.isArray(porBairroResult)) {
          app.logger.error({ tenantId, resultType: typeof porBairroResult }, "Query 2 (per-neighborhood) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de bairros: resultado inválido." });
        }

        // Process totals
        const totalRow = totaisResult[0];
        const totalPedidos = parseInt(String(totalRow.pedidos || 0)) || 0;
        const totalRecebido = parseFloat(String(totalRow.total_recebido || 0));

        const totais = {
          pedidos: totalPedidos,
          faturamento_itens: Number(Number(parseFloat(String(totalRow.faturamento_itens || 0))).toFixed(2)),
          taxa_entrega: Number(Number(parseFloat(String(totalRow.taxa_entrega || 0))).toFixed(2)),
          total_recebido: Number(Number(parseFloat(String(totalRow.total_recebido || 0))).toFixed(2)),
          ticket_medio: Number(Number(parseFloat(String(totalRow.ticket_medio || 0))).toFixed(2)),
          tempo_medio_entrega_min: totalRow.tempo_medio_entrega_min !== null ? Number(Number(parseFloat(String(totalRow.tempo_medio_entrega_min))).toFixed(2)) : null,
          pedidos_com_tempo: parseInt(String(totalRow.pedidos_com_tempo || 0)) || 0,
        };

        // Process per-neighborhood data
        const porBairro = [];
        for (const row of porBairroResult) {
          const pedidosBairro = parseInt(String(row.pedidos || 0)) || 0;
          const totalRecebidoBairro = parseFloat(String(row.total_recebido || 0));

          porBairro.push({
            bairro: row.bairro || "Sem bairro",
            pedidos: pedidosBairro,
            faturamento_itens: Number(Number(parseFloat(String(row.faturamento_itens || 0))).toFixed(2)),
            taxa_entrega: Number(Number(parseFloat(String(row.taxa_entrega || 0))).toFixed(2)),
            total_recebido: Number(Number(parseFloat(String(row.total_recebido || 0))).toFixed(2)),
            ticket_medio: Number(Number(parseFloat(String(row.ticket_medio || 0))).toFixed(2)),
            taxa_media: Number(Number(parseFloat(String(row.taxa_media || 0))).toFixed(2)),
            tempo_medio_entrega_min: row.tempo_medio_entrega_min !== null ? Number(Number(parseFloat(String(row.tempo_medio_entrega_min))).toFixed(2)) : null,
            tempo_estimado_medio_min: row.tempo_estimado_medio_min !== null ? Number(Number(parseFloat(String(row.tempo_estimado_medio_min))).toFixed(2)) : null,
            percentual_pedidos: totalPedidos > 0 ? Number(Number((100 * pedidosBairro / totalPedidos)).toFixed(2)) : 0,
            percentual_total_recebido: totalRecebido > 0 ? Number(Number((100 * totalRecebidoBairro / totalRecebido)).toFixed(2)) : 0,
          });
        }

        app.logger.info(
          {
            tenantId,
            pedidos: totais.pedidos,
            total_recebido: totais.total_recebido,
          },
          "Delivery-bairros report retrieved successfully"
        );

        return await reply.code(200).send({
          totais,
          por_bairro: porBairro,
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get delivery-bairros report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de delivery por bairro." });
      }
    }
  );

  // =========================================================================
  // GET /api/relatorios/fechamento-dia
  // =========================================================================
  app.fastify.get(
    "/api/relatorios/fechamento-dia",
    {
      schema: {
        description: "Get daily closing report",
        tags: ["relatorios"],
        querystring: {
          type: "object",
          properties: {
            data: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Date in YYYY-MM-DD format" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["data", "eh_hoje", "vendas", "pagamentos", "cancelamentos", "pendencias"],
            properties: {
              data: { type: "string" },
              eh_hoje: { type: "boolean" },
              vendas: {
                type: "object",
                required: ["comandas_fechadas", "faturamento_itens", "gorjeta", "taxa_entrega", "total_recebido", "ticket_medio", "por_canal"],
                properties: {
                  comandas_fechadas: { type: "integer" },
                  faturamento_itens: { type: "number" },
                  gorjeta: { type: "number" },
                  taxa_entrega: { type: "number" },
                  total_recebido: { type: "number" },
                  ticket_medio: { type: "number" },
                  por_canal: {
                    type: "object",
                    properties: {
                      mesa: { type: "object", properties: { comandas_fechadas: { type: "integer" }, total_recebido: { type: "number" } } },
                      delivery: { type: "object", properties: { comandas_fechadas: { type: "integer" }, total_recebido: { type: "number" } } },
                    },
                  },
                },
              },
              pagamentos: {
                type: "object",
                required: ["formas", "total_liquido", "dinheiro_em_caixa", "conciliacao", "comandas_sem_pagamento"],
                properties: {
                  formas: {
                    type: "object",
                    properties: {
                      dinheiro: { type: "object", properties: { quantidade: { type: "integer" }, valor_entregue: { type: "number" }, troco: { type: "number" }, valor_liquido: { type: "number" } } },
                      pix: { type: "object", properties: { quantidade: { type: "integer" }, valor_entregue: { type: "number" }, troco: { type: "number" }, valor_liquido: { type: "number" } } },
                      cartao_debito: { type: "object", properties: { quantidade: { type: "integer" }, valor_entregue: { type: "number" }, troco: { type: "number" }, valor_liquido: { type: "number" } } },
                      cartao_credito: { type: "object", properties: { quantidade: { type: "integer" }, valor_entregue: { type: "number" }, troco: { type: "number" }, valor_liquido: { type: "number" } } },
                    },
                  },
                  total_liquido: { type: "number" },
                  dinheiro_em_caixa: { type: "number" },
                  conciliacao: { type: "object", properties: { comandas_pago_menor: { type: "integer" }, valor_faltante: { type: "number" }, comandas_pago_maior: { type: "integer" }, valor_excedente: { type: "number" } } },
                  comandas_sem_pagamento: { type: "integer" },
                },
              },
              cancelamentos: {
                type: "object",
                required: ["quantidade", "valor", "quantidade_perda", "valor_perda"],
                properties: {
                  quantidade: { type: "integer" },
                  valor: { type: "number" },
                  quantidade_perda: { type: "integer" },
                  valor_perda: { type: "number" },
                },
              },
              pendencias: {
                type: "object",
                required: ["disponivel", "total_comandas_abertas", "valor_parcial_total", "comandas_abertas", "entregas_em_andamento"],
                properties: {
                  disponivel: { type: "boolean" },
                  total_comandas_abertas: { type: "integer" },
                  valor_parcial_total: { type: "number" },
                  comandas_abertas: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        comanda_id: { type: "string" },
                        tipo: { type: "string", enum: ["mesa", "delivery"] },
                        mesa_numero: { type: ["integer", "null"] },
                        rotulo: { type: ["string", "null"] },
                        aberta_em: { type: "string" },
                        subtotal_parcial: { type: "number" },
                      },
                    },
                  },
                  entregas_em_andamento: { type: "integer" },
                },
              },
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

      const tenantId = requireTenant(authUser);
      const queryData = request.query as { data?: string };

      app.logger.info({ tenantId, data: queryData.data }, "Fetching fechamento-dia report");

      try {
        // Validate and parse date parameter
        let targetDate: Date;
        let ehHoje = false;

        if (queryData.data) {
          // Strict validation
          if (typeof queryData.data !== "string") {
            app.logger.warn({ tenantId, dataType: typeof queryData.data }, "Data parameter is not a string");
            return await reply.code(400).send({ error: "Parâmetro 'data' deve ser uma string no formato YYYY-MM-DD." });
          }

          const dataRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dataRegex.test(queryData.data)) {
            app.logger.warn({ tenantId, data: queryData.data }, "Data parameter does not match YYYY-MM-DD format");
            return await reply.code(400).send({ error: "Data deve estar no formato YYYY-MM-DD." });
          }

          const parts = queryData.data.split("-");
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const day = parseInt(parts[2], 10);

          // Check valid civil date
          const testDate = new Date(Date.UTC(year, month - 1, day));
          if (testDate.getUTCFullYear() !== year || testDate.getUTCMonth() !== month - 1 || testDate.getUTCDate() !== day) {
            app.logger.warn({ tenantId, data: queryData.data }, "Invalid civil date");
            return await reply.code(400).send({ error: "Data inválida." });
          }

          targetDate = testDate;

          // Check not future
          const localToday = diaLocalDeInstante(new Date());
          const todayUtc = new Date(Date.UTC(localToday.ano, localToday.mes0, localToday.dia));
          if (targetDate > todayUtc) {
            app.logger.warn({ tenantId, data: queryData.data }, "Data is in the future");
            return await reply.code(400).send({ error: "Data não pode ser no futuro." });
          }

          ehHoje = targetDate.getTime() === todayUtc.getTime();
        } else {
          // Default to today
          const localToday = diaLocalDeInstante(new Date());
          targetDate = new Date(Date.UTC(localToday.ano, localToday.mes0, localToday.dia));
          ehHoje = true;
        }

        // Format date for response
        const dateStr = `${String(targetDate.getUTCFullYear()).padStart(4, "0")}-${String(targetDate.getUTCMonth() + 1).padStart(2, "0")}-${String(targetDate.getUTCDate()).padStart(2, "0")}`;

        // Get date range (00:00 local to 00:00 next day local)
        const inicio = inicioDoDiaLocal(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate());
        const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);

        // Common base for deduped sold comandas
        const baseComandas = sql`
          WITH comandas_fontes AS (
            SELECT c.id AS id, c.restaurante_id AS restaurante_id, c.status::text AS status, c.tipo::text AS tipo, c.subtotal AS subtotal, c.gorjeta AS gorjeta, c.total AS total, c.closed_at AS closed_at, 0 AS prioridade_fonte
            FROM comandas c
            WHERE c.restaurante_id = ${tenantId}
            UNION ALL
            SELECT ch.id AS id, ch.restaurante_id AS restaurante_id, ch.status::text AS status, NULL::text AS tipo, ch.subtotal AS subtotal, ch.gorjeta AS gorjeta, ch.total AS total, ch.closed_at AS closed_at, 1 AS prioridade_fonte
            FROM comandas_historico ch
            WHERE ch.restaurante_id = ${tenantId}
          ),
          comandas_unicas AS (
            SELECT DISTINCT ON (cf.restaurante_id, cf.id)
              cf.id, cf.restaurante_id, cf.status, cf.tipo, cf.subtotal, cf.gorjeta, cf.total, cf.closed_at, cf.prioridade_fonte
            FROM comandas_fontes cf
            ORDER BY cf.restaurante_id, cf.id, cf.prioridade_fonte ASC
          ),
          vendidas AS (
            SELECT cu.id, cu.restaurante_id, cu.status, cu.tipo, cu.subtotal, cu.gorjeta, cu.total, cu.closed_at, cu.prioridade_fonte
            FROM comandas_unicas cu
            WHERE cu.status = 'fechada' AND cu.total > 0
              AND cu.closed_at >= ${inicio.toISOString()}::timestamptz
              AND cu.closed_at < ${fim.toISOString()}::timestamptz
          ),
          entregas_por_comanda AS (
            SELECT e.restaurante_id, e.comanda_id, SUM(e.taxa_entrega) AS taxa_entrega
            FROM entregas e
            WHERE e.restaurante_id = ${tenantId}
            GROUP BY e.restaurante_id, e.comanda_id
          )
        `;

        // Query 1: Sales totals with taxa and channel breakdown
        const vendidosResult = await (app.db as any).execute(
          sql`
            ${baseComandas}
            SELECT
              COUNT(*)::integer AS comandas_fechadas,
              COALESCE(SUM(v.subtotal), 0)::double precision AS faturamento_itens,
              COALESCE(SUM(v.gorjeta), 0)::double precision AS gorjeta,
              COALESCE(SUM(epc.taxa_entrega), 0)::double precision AS taxa_entrega,
              COALESCE(SUM(v.total), 0)::double precision AS total_recebido,
              COUNT(*) FILTER (WHERE COALESCE(v.tipo,'mesa') = 'mesa')::integer AS mesa_comandas,
              COALESCE(SUM(v.total) FILTER (WHERE COALESCE(v.tipo,'mesa') = 'mesa'),0)::double precision AS mesa_total,
              COUNT(*) FILTER (WHERE COALESCE(v.tipo,'mesa') = 'delivery')::integer AS delivery_comandas,
              COALESCE(SUM(v.total) FILTER (WHERE COALESCE(v.tipo,'mesa') = 'delivery'),0)::double precision AS delivery_total
            FROM vendidas v
            LEFT JOIN entregas_por_comanda epc ON epc.comanda_id = v.id AND epc.restaurante_id = v.restaurante_id AND epc.restaurante_id = ${tenantId}
          `
        ) as any[];

        if (!Array.isArray(vendidosResult)) {
          app.logger.error({ tenantId, resultType: typeof vendidosResult }, "Query 1 (sales totals) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de vendas: resultado inválido." });
        }
        if (vendidosResult.length === 0) {
          app.logger.error({ tenantId }, "Query 1 (sales totals) returned empty array");
          return await reply.code(500).send({ error: "Falha na consulta de vendas: resultado vazio." });
        }

        // Query 3: Confirmed payments
        const pagamentosResult = await (app.db as any).execute(
          sql`
            ${baseComandas},
            pagamentos_fontes AS (
              SELECT p.id AS id, p.restaurante_id AS restaurante_id, p.forma_pagamento::text AS forma, p.valor AS valor, p.troco AS troco, p.comanda_id AS comanda_id, 0 AS prioridade_fonte
              FROM pagamentos p
              WHERE p.restaurante_id = ${tenantId} AND p.status::text = 'confirmado'
              UNION ALL
              SELECT ph.id AS id, ph.restaurante_id AS restaurante_id, ph.forma_pagamento::text AS forma, ph.valor AS valor, COALESCE(ph.troco, 0) AS troco, ph.comanda_id AS comanda_id, 1 AS prioridade_fonte
              FROM pagamentos_historico ph
              WHERE ph.restaurante_id = ${tenantId} AND ph.status::text = 'confirmado'
            ),
            pagamentos_unicos AS (
              SELECT DISTINCT ON (pf.restaurante_id, pf.id)
                pf.id, pf.restaurante_id, pf.forma, pf.valor, pf.troco, pf.comanda_id
              FROM pagamentos_fontes pf
              ORDER BY pf.restaurante_id, pf.id, pf.prioridade_fonte ASC
            ),
            confirmados_unidos AS (
              SELECT pu.forma, pu.valor, pu.troco
              FROM pagamentos_unicos pu
              INNER JOIN vendidas v ON pu.comanda_id = v.id AND pu.restaurante_id = v.restaurante_id AND pu.restaurante_id = ${tenantId}
            )
            SELECT
              c.forma,
              COUNT(*)::integer AS quantidade,
              COALESCE(SUM(c.valor), 0)::double precision AS valor_entregue,
              COALESCE(SUM(c.troco), 0)::double precision AS troco
            FROM confirmados_unidos c
            GROUP BY c.forma
          `
        ) as any[];

        if (!Array.isArray(pagamentosResult)) {
          app.logger.error({ tenantId, resultType: typeof pagamentosResult }, "Query 3 (payments) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de pagamentos: resultado inválido." });
        }

        // Query 4: Cancelamentos
        const cancelamentosResult = await (app.db as any).execute(
          sql`
            WITH pedidos_fontes AS (
              SELECT p.id AS id, p.restaurante_id AS restaurante_id, p.quantidade AS quantidade, p.preco_unitario AS preco, p.cancelado_apos_inicio AS apos_inicio, p.cancelado_em AS cancelado_em, 0 AS prioridade_fonte
              FROM pedidos p
              WHERE p.restaurante_id = ${tenantId} AND p.status = 'cancelado'
              UNION ALL
              SELECT ph.id AS id, ph.restaurante_id AS restaurante_id, ph.quantidade AS quantidade, ph.preco_unitario AS preco, ph.cancelado_apos_inicio AS apos_inicio, ph.cancelado_em AS cancelado_em, 1 AS prioridade_fonte
              FROM pedidos_historico ph
              WHERE ph.restaurante_id = ${tenantId} AND ph.status = 'cancelado'
            ),
            pedidos_unicos AS (
              SELECT DISTINCT ON (pf.restaurante_id, pf.id)
                pf.id, pf.restaurante_id, pf.quantidade, pf.preco, pf.apos_inicio, pf.cancelado_em
              FROM pedidos_fontes pf
              ORDER BY pf.restaurante_id, pf.id, pf.prioridade_fonte ASC
            ),
            cancelados_dia AS (
              SELECT pu.quantidade, pu.preco, pu.apos_inicio
              FROM pedidos_unicos pu
              WHERE pu.cancelado_em >= ${inicio.toISOString()}::timestamptz AND pu.cancelado_em < ${fim.toISOString()}::timestamptz
            )
            SELECT
              COALESCE(SUM(c.quantidade),0)::integer AS quantidade,
              COALESCE(SUM(CAST(c.quantidade AS DECIMAL(10,2)) * CAST(c.preco AS DECIMAL(10,2))), 0)::double precision AS valor,
              COALESCE(SUM(CASE WHEN c.apos_inicio = true THEN c.quantidade ELSE 0 END),0)::integer AS quantidade_perda,
              COALESCE(SUM(CASE WHEN c.apos_inicio = true THEN CAST(c.quantidade AS DECIMAL(10,2)) * CAST(c.preco AS DECIMAL(10,2)) ELSE 0 END), 0)::double precision AS valor_perda
            FROM cancelados_dia c
          `
        ) as any[];

        if (!Array.isArray(cancelamentosResult)) {
          app.logger.error({ tenantId, resultType: typeof cancelamentosResult }, "Query 4 (cancelamentos) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de cancelamentos: resultado inválido." });
        }

        // Query 5: Pending (only if today)
        let pendenciasResult: any[] = [];
        let entregas_em_andamento = 0;
        if (ehHoje) {
          pendenciasResult = await (app.db as any).execute(
            sql`
              SELECT
                c.id AS comanda_id,
                c.tipo::text AS tipo,
                c.mesa_numero AS mesa_numero,
                c.rotulo AS rotulo,
                to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS aberta_em,
                CAST(c.subtotal AS DECIMAL(10,2)) AS subtotal_parcial
              FROM comandas c
              WHERE c.restaurante_id = ${tenantId} AND c.status = 'aberta'
              ORDER BY c.created_at ASC, c.id ASC
              LIMIT 50
            `
          ) as any[];

          if (!Array.isArray(pendenciasResult)) {
            app.logger.error({ tenantId, resultType: typeof pendenciasResult }, "Query 5 (pending) result is not an array");
            return await reply.code(500).send({ error: "Falha na consulta de pendências: resultado inválido." });
          }

          // Query 5b: Count entregas_em_andamento
          const entregasCountResult = await (app.db as any).execute(
            sql`
              SELECT COUNT(*)::integer AS total FROM entregas WHERE restaurante_id = ${tenantId} AND status IN ('pendente', 'preparando', 'saiu_entrega')
            `
          ) as any[];

          if (!Array.isArray(entregasCountResult) || entregasCountResult.length === 0) {
            app.logger.error({ tenantId, resultType: typeof entregasCountResult }, "Query 5b (entregas em andamento) result is not an array or empty");
            return await reply.code(500).send({ error: "Falha na consulta de entregas em andamento." });
          }
          entregas_em_andamento = parseInt(String(entregasCountResult[0].total || 0)) || 0;
        }

        // Process sales data
        const vendidosRow = vendidosResult[0];
        const totalComandasFechadas = parseInt(String(vendidosRow.comandas_fechadas || 0)) || 0;
        const totalRecebido = parseFloat(String(vendidosRow.total_recebido || 0));

        // Process channel data from Query 1 columns
        const porCanalMap = new Map<string, { comandas: number; total: number }>();
        porCanalMap.set("mesa", {
          comandas: parseInt(String(vendidosRow.mesa_comandas || 0)) || 0,
          total: parseFloat(String(vendidosRow.mesa_total || 0)),
        });
        porCanalMap.set("delivery", {
          comandas: parseInt(String(vendidosRow.delivery_comandas || 0)) || 0,
          total: parseFloat(String(vendidosRow.delivery_total || 0)),
        });

        // Process payments data
        const formasMap = new Map<string, { quantidade: number; valor_entregue: number; troco: number }>();
        formasMap.set("dinheiro", { quantidade: 0, valor_entregue: 0, troco: 0 });
        formasMap.set("pix", { quantidade: 0, valor_entregue: 0, troco: 0 });
        formasMap.set("cartao_debito", { quantidade: 0, valor_entregue: 0, troco: 0 });
        formasMap.set("cartao_credito", { quantidade: 0, valor_entregue: 0, troco: 0 });

        for (const row of pagamentosResult) {
          const forma = row.forma || "pix";
          formasMap.set(forma, {
            quantidade: parseInt(String(row.quantidade || 0)) || 0,
            valor_entregue: parseFloat(String(row.valor_entregue || 0)),
            troco: parseFloat(String(row.troco || 0)),
          });
        }

        // Process cancelamentos data
        const cancelRow = cancelamentosResult[0] || { quantidade: 0, valor: 0, quantidade_perda: 0, valor_perda: 0 };

        // Process pending data
        const pendenciasRows = pendenciasResult || [];

        // Query 6: Conciliacao (payment reconciliation)
        const conciliacaoResult = await (app.db as any).execute(
          sql`
            ${baseComandas},
            pagamentos_fontes AS (
              SELECT p.id AS id, p.restaurante_id AS restaurante_id, p.valor AS valor, p.troco AS troco, p.comanda_id AS comanda_id, 0 AS prioridade_fonte
              FROM pagamentos p
              WHERE p.restaurante_id = ${tenantId} AND p.status::text = 'confirmado'
              UNION ALL
              SELECT ph.id AS id, ph.restaurante_id AS restaurante_id, ph.valor AS valor, COALESCE(ph.troco, 0) AS troco, ph.comanda_id AS comanda_id, 1 AS prioridade_fonte
              FROM pagamentos_historico ph
              WHERE ph.restaurante_id = ${tenantId} AND ph.status::text = 'confirmado'
            ),
            pagamentos_unicos AS (
              SELECT DISTINCT ON (pf.restaurante_id, pf.id)
                pf.valor, pf.troco, pf.comanda_id
              FROM pagamentos_fontes pf
              ORDER BY pf.restaurante_id, pf.id, pf.prioridade_fonte ASC
            ),
            pagos_por_comanda AS (
              SELECT pu.comanda_id, SUM(pu.valor - COALESCE(pu.troco, 0)) AS valor_liquido
              FROM pagamentos_unicos pu
              GROUP BY pu.comanda_id
            ),
            conciliacao_data AS (
              SELECT
                COALESCE(SUM(CASE WHEN v.total::numeric - COALESCE(ppc.valor_liquido,0)::numeric > 0.01::numeric THEN 1 ELSE 0 END),0)::integer AS comandas_pago_menor,
                COALESCE(SUM(CASE WHEN v.total::numeric - COALESCE(ppc.valor_liquido,0)::numeric > 0.01::numeric THEN v.total::numeric - COALESCE(ppc.valor_liquido,0)::numeric ELSE 0::numeric END),0)::double precision AS valor_faltante,
                COALESCE(SUM(CASE WHEN COALESCE(ppc.valor_liquido,0)::numeric - v.total::numeric > 0.01::numeric THEN 1 ELSE 0 END),0)::integer AS comandas_pago_maior,
                COALESCE(SUM(CASE WHEN COALESCE(ppc.valor_liquido,0)::numeric - v.total::numeric > 0.01::numeric THEN COALESCE(ppc.valor_liquido,0)::numeric - v.total::numeric ELSE 0::numeric END),0)::double precision AS valor_excedente,
                COALESCE(SUM(CASE WHEN ppc.comanda_id IS NULL THEN 1 ELSE 0 END),0)::integer AS comandas_sem_pagamento
              FROM vendidas v
              LEFT JOIN pagos_por_comanda ppc ON v.id = ppc.comanda_id
              WHERE v.total > 0
            )
            SELECT * FROM conciliacao_data
          `
        ) as any[];

        if (!Array.isArray(conciliacaoResult)) {
          app.logger.error({ tenantId, resultType: typeof conciliacaoResult }, "Query 6 (conciliacao) result is not an array");
          return await reply.code(500).send({ error: "Falha na consulta de conciliação: resultado inválido." });
        }

        const conciliacaoRow = conciliacaoResult[0] || { comandas_pago_menor: 0, valor_faltante: 0, comandas_pago_maior: 0, valor_excedente: 0, comandas_sem_pagamento: 0 };

        app.logger.info(
          {
            tenantId,
            data: dateStr,
            comandas_fechadas: totalComandasFechadas,
            total_recebido: totalRecebido,
          },
          "Fechamento-dia report retrieved successfully"
        );

        return await reply.code(200).send({
          data: dateStr,
          eh_hoje: ehHoje,
          vendas: {
            comandas_fechadas: totalComandasFechadas,
            faturamento_itens: Number(Number(parseFloat(String(vendidosRow.faturamento_itens || 0))).toFixed(2)),
            gorjeta: Number(Number(parseFloat(String(vendidosRow.gorjeta || 0))).toFixed(2)),
            taxa_entrega: Number(Number(parseFloat(String(vendidosRow.taxa_entrega || 0))).toFixed(2)),
            total_recebido: Number(Number(parseFloat(String(vendidosRow.total_recebido || 0))).toFixed(2)),
            ticket_medio: totalComandasFechadas > 0 ? Number(Number(totalRecebido / totalComandasFechadas).toFixed(2)) : 0,
            por_canal: {
              mesa: {
                comandas_fechadas: porCanalMap.get("mesa")?.comandas || 0,
                total_recebido: Number(Number((porCanalMap.get("mesa")?.total || 0)).toFixed(2)),
              },
              delivery: {
                comandas_fechadas: porCanalMap.get("delivery")?.comandas || 0,
                total_recebido: Number(Number((porCanalMap.get("delivery")?.total || 0)).toFixed(2)),
              },
            },
          },
          pagamentos: {
            formas: {
              dinheiro: {
                quantidade: formasMap.get("dinheiro")?.quantidade || 0,
                valor_entregue: Number(Number((formasMap.get("dinheiro")?.valor_entregue || 0)).toFixed(2)),
                troco: Number(Number((formasMap.get("dinheiro")?.troco || 0)).toFixed(2)),
                valor_liquido: Number(Number(((formasMap.get("dinheiro")?.valor_entregue || 0) - (formasMap.get("dinheiro")?.troco || 0))).toFixed(2)),
              },
              pix: {
                quantidade: formasMap.get("pix")?.quantidade || 0,
                valor_entregue: Number(Number((formasMap.get("pix")?.valor_entregue || 0)).toFixed(2)),
                troco: Number(Number((formasMap.get("pix")?.troco || 0)).toFixed(2)),
                valor_liquido: Number(Number(((formasMap.get("pix")?.valor_entregue || 0) - (formasMap.get("pix")?.troco || 0))).toFixed(2)),
              },
              cartao_debito: {
                quantidade: formasMap.get("cartao_debito")?.quantidade || 0,
                valor_entregue: Number(Number((formasMap.get("cartao_debito")?.valor_entregue || 0)).toFixed(2)),
                troco: Number(Number((formasMap.get("cartao_debito")?.troco || 0)).toFixed(2)),
                valor_liquido: Number(Number(((formasMap.get("cartao_debito")?.valor_entregue || 0) - (formasMap.get("cartao_debito")?.troco || 0))).toFixed(2)),
              },
              cartao_credito: {
                quantidade: formasMap.get("cartao_credito")?.quantidade || 0,
                valor_entregue: Number(Number((formasMap.get("cartao_credito")?.valor_entregue || 0)).toFixed(2)),
                troco: Number(Number((formasMap.get("cartao_credito")?.troco || 0)).toFixed(2)),
                valor_liquido: Number(Number(((formasMap.get("cartao_credito")?.valor_entregue || 0) - (formasMap.get("cartao_credito")?.troco || 0))).toFixed(2)),
              },
            },
            total_liquido: Number(
              Number(
                Array.from(formasMap.values()).reduce((sum, f) => sum + (f.valor_entregue - f.troco), 0)
              ).toFixed(2)
            ),
            dinheiro_em_caixa: Number(
              Number((formasMap.get("dinheiro")?.valor_entregue || 0) - (formasMap.get("dinheiro")?.troco || 0)).toFixed(2)
            ),
            conciliacao: {
              comandas_pago_menor: parseInt(String(conciliacaoRow.comandas_pago_menor || 0)) || 0,
              valor_faltante: Number(Number(parseFloat(String(conciliacaoRow.valor_faltante || 0))).toFixed(2)),
              comandas_pago_maior: parseInt(String(conciliacaoRow.comandas_pago_maior || 0)) || 0,
              valor_excedente: Number(Number(parseFloat(String(conciliacaoRow.valor_excedente || 0))).toFixed(2)),
            },
            comandas_sem_pagamento: parseInt(String(conciliacaoRow.comandas_sem_pagamento || 0)) || 0,
          },
          cancelamentos: {
            quantidade: parseInt(String(cancelRow.quantidade || 0)) || 0,
            valor: Number(Number(parseFloat(String(cancelRow.valor || 0))).toFixed(2)),
            quantidade_perda: parseInt(String(cancelRow.quantidade_perda || 0)) || 0,
            valor_perda: Number(Number(parseFloat(String(cancelRow.valor_perda || 0))).toFixed(2)),
          },
          pendencias: {
            disponivel: ehHoje,
            total_comandas_abertas: ehHoje ? pendenciasRows.length : 0,
            valor_parcial_total: ehHoje
              ? Number(
                  Number(
                    (pendenciasRows as any[]).reduce((sum: number, row: any) => sum + (parseFloat(String(row.subtotal_parcial || 0)) || 0), 0)
                  ).toFixed(2)
                )
              : 0,
            comandas_abertas: ehHoje
              ? (pendenciasRows as any[]).map((row: any) => ({
                  comanda_id: row.comanda_id || "",
                  tipo: (row.tipo || "mesa") as "mesa" | "delivery",
                  mesa_numero: row.mesa_numero || null,
                  rotulo: row.rotulo || null,
                  aberta_em: row.aberta_em || "",
                  subtotal_parcial: Number(Number(parseFloat(String(row.subtotal_parcial || 0))).toFixed(2)),
                }))
              : [],
            entregas_em_andamento: ehHoje ? entregas_em_andamento : 0,
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get fechamento-dia report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de fechamento do dia." });
      }
    }
  );

  // GET /api/relatorios/margem-pratos
  app.fastify.get(
    "/api/relatorios/margem-pratos",
    { schema: {} } as any,
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const session = await customRequireAuth(app, request, reply);
        if (!session) return;
        if (!(await requireRole(session, ["administrador", "gerente", "admin"], reply))) return;
        const restauranteId = requireTenant(session);

        const query = request.query as { periodo?: string; dataInicio?: string; dataFim?: string };
        const { inicio, fim } = resolvePeriodo(query.periodo, query.dataInicio, query.dataFim);

        const diaInicio = diaLocalDeInstante(inicio);
        const diaFim = diaLocalDeInstante(new Date(fim.getTime() - 1000));

        const dataInicioStr = `${String(diaInicio.ano).padStart(4, "0")}-${String(diaInicio.mes0 + 1).padStart(2, "0")}-${String(diaInicio.dia).padStart(2, "0")}`;
        const dataFimStr = `${String(diaFim.ano).padStart(4, "0")}-${String(diaFim.mes0 + 1).padStart(2, "0")}-${String(diaFim.dia).padStart(2, "0")}`;

        const result: any = await (app.db as any).execute(
          sql`
            WITH comandas_fontes AS (
              SELECT c.id, c.restaurante_id, c.status::text, c.closed_at, 0 AS prioridade_fonte
              FROM ${schema.comandas} c
              WHERE c.restaurante_id = ${restauranteId}
              UNION ALL
              SELECT ch.id, ch.restaurante_id, ch.status::text, ch.closed_at, 1 AS prioridade_fonte
              FROM ${schema.comandasHistorico} ch
              WHERE ch.restaurante_id = ${restauranteId}
            ),
            comandas_unicas AS (
              SELECT DISTINCT ON (cf.restaurante_id, cf.id)
                cf.id, cf.restaurante_id, cf.status, cf.closed_at, cf.prioridade_fonte
              FROM comandas_fontes cf
              ORDER BY cf.restaurante_id, cf.id, cf.prioridade_fonte ASC
            ),
            vendidas AS (
              SELECT cu.id
              FROM comandas_unicas cu
              WHERE cu.status = 'fechada' AND cu.closed_at >= ${dataInicioStr}::date::timestamp AT TIME ZONE 'America/Sao_Paulo'
                AND cu.closed_at < (${dataFimStr}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo'
            ),
            pedidos_fontes AS (
              SELECT p.id, p.comanda_id, p.prato_id, p.quantidade, p.preco_unitario, p.status::text, p.cancelado_em, p.restaurante_id, 0 AS prioridade_fonte
              FROM ${schema.pedidos} p
              WHERE p.restaurante_id = ${restauranteId}
              UNION ALL
              SELECT ph.id, ph.comanda_id, ph.prato_id, ph.quantidade, ph.preco_unitario, ph.status::text, ph.cancelado_em, ph.restaurante_id, 1 AS prioridade_fonte
              FROM ${schema.pedidosHistorico} ph
              WHERE ph.restaurante_id = ${restauranteId}
            ),
            pedidos_unicas AS (
              SELECT DISTINCT ON (pf.restaurante_id, pf.id)
                pf.id, pf.comanda_id, pf.prato_id, pf.quantidade, pf.preco_unitario, pf.status, pf.cancelado_em, pf.restaurante_id
              FROM pedidos_fontes pf
              ORDER BY pf.restaurante_id, pf.id, pf.prioridade_fonte ASC
            ),
            vendas_por_prato AS (
              SELECT
                COALESCE(MAX(pu.prato_id::text), MAX(p.nome)) AS prato_key,
                MAX(pu.prato_id::text) AS prato_id,
                MAX(p.nome) AS prato_nome,
                SUM(pu.quantidade) AS quantidade_vendida,
                SUM(pu.quantidade * pu.preco_unitario) AS receita_total
              FROM pedidos_unicas pu
              INNER JOIN vendidas v ON pu.comanda_id = v.id
              LEFT JOIN ${schema.pratos} p ON pu.prato_id = p.id AND p.restaurante_id = ${restauranteId}
              WHERE pu.status = 'gravado' AND (pu.cancelado_em IS NULL AND pu.status != 'cancelado')
              GROUP BY COALESCE(MAX(pu.prato_id::text), MAX(p.nome))
            ),
            prato_insumos_custo AS (
              SELECT
                pi.restaurante_id,
                pi.prato_id,
                SUM(pi.quantidade_usada * COALESCE(i.custo_unitario, 0)) AS custo_total_ficha,
                ARRAY_AGG(DISTINCT CASE WHEN i.custo_unitario IS NULL OR i.custo_unitario <= 0 THEN i.nome ELSE NULL END) FILTER (WHERE i.custo_unitario IS NULL OR i.custo_unitario <= 0) AS insumos_sem_custo
              FROM ${schema.pratoInsumos} pi
              LEFT JOIN ${schema.insumos} i ON pi.insumo_id = i.id AND i.restaurante_id = pi.restaurante_id
              WHERE pi.restaurante_id = ${restauranteId}
              GROUP BY pi.restaurante_id, pi.prato_id
            )
            SELECT
              vpp.prato_key,
              vpp.prato_id,
              vpp.prato_nome,
              vpp.quantidade_vendida,
              vpp.receita_total,
              COALESCE(pic.custo_total_ficha, 0)::numeric AS custo_ficha,
              COALESCE(pic.insumos_sem_custo, ARRAY[]::text[]) AS insumos_sem_custo
            FROM vendas_por_prato vpp
            LEFT JOIN prato_insumos_custo pic ON vpp.prato_id::uuid = pic.prato_id OR vpp.prato_name = pic.prato_id
          `
        );

        if (!Array.isArray(result)) {
          app.logger.error({}, "Query result is not an array");
          return await reply.code(500).send({ error: "Não foi possível gerar o relatório de margem por prato." });
        }

        const comFicha: any[] = [];
        const semFicha: any[] = [];
        const custoIncompleto: any[] = [];

        let receitaTotalGeral = 0;
        let receitaCoberta = 0;
        let custoTotal = 0;
        let margemTotal = 0;

        for (const row of result) {
          if (!row || typeof row !== "object") continue;

          const quantidadeVendida = Number(row.quantidade_vendida || 0);
          const receitaTotal = Number(row.receita_total || 0);
          const custoFicha = Number(row.custo_ficha || 0);
          const insumosEmCusto = Array.isArray(row.insumos_sem_custo) ? row.insumos_sem_custo.filter((x: any) => x) : [];

          if (!Number.isFinite(quantidadeVendida) || !Number.isFinite(receitaTotal) || !Number.isFinite(custoFicha)) {
            continue;
          }

          receitaTotalGeral += receitaTotal;
          const pratoId = row.prato_id || null;
          const pratoNome = row.prato_nome || "Prato removido";

          if (insumosEmCusto.length > 0) {
            custoIncompleto.push({
              id: pratoId,
              nome: pratoNome,
              quantidade_vendida: quantidadeVendida,
              receita: Number(receitaTotal.toFixed(2)),
              insumos_sem_custo: insumosEmCusto,
            });
          } else if (custoFicha <= 0) {
            semFicha.push({
              id: pratoId,
              nome: pratoNome,
              quantidade_vendida: quantidadeVendida,
              receita: Number(receitaTotal.toFixed(2)),
            });
          } else {
            const custoTotalPrato = custoFicha * quantidadeVendida;
            const margemPrato = receitaTotal - custoTotalPrato;
            const margemPercentualPrato = receitaTotal > 0 ? (100 * margemPrato) / receitaTotal : null;

            comFicha.push({
              id: pratoId,
              nome: pratoNome,
              quantidade_vendida: quantidadeVendida,
              receita: Number(receitaTotal.toFixed(2)),
              custo_unitario_ficha: Number(custoFicha.toFixed(2)),
              custo_total: Number(custoTotalPrato.toFixed(2)),
              margem: Number(margemPrato.toFixed(2)),
              margem_percentual: margemPercentualPrato !== null ? Number(margemPercentualPrato.toFixed(2)) : null,
            });

            receitaCoberta += receitaTotal;
            custoTotal += custoTotalPrato;
            margemTotal += margemPrato;
          }
        }

        comFicha.sort((a, b) => {
          const margem_cmp = b.margem - a.margem;
          if (margem_cmp !== 0) return margem_cmp;
          return a.nome.localeCompare(b.nome, "pt-BR");
        });

        semFicha.sort((a, b) => {
          const receita_cmp = b.receita - a.receita;
          if (receita_cmp !== 0) return receita_cmp;
          return a.nome.localeCompare(b.nome, "pt-BR");
        });

        custoIncompleto.sort((a, b) => {
          const receita_cmp = b.receita - a.receita;
          if (receita_cmp !== 0) return receita_cmp;
          return a.nome.localeCompare(b.nome, "pt-BR");
        });

        const margemPercentualGeral = receitaCoberta > 0 ? (100 * margemTotal) / receitaCoberta : null;
        const coberturaPercentual = receitaTotalGeral > 0 ? (100 * receitaCoberta) / receitaTotalGeral : null;

        if (!Number.isFinite(margemTotal) || !Number.isFinite(custoTotal) || (margemPercentualGeral !== null && !Number.isFinite(margemPercentualGeral)) || (coberturaPercentual !== null && !Number.isFinite(coberturaPercentual))) {
          app.logger.error({}, "Invalid numeric values in final calculations");
          return await reply.code(500).send({ error: "Não foi possível gerar o relatório de margem por prato." });
        }

        app.logger.info(
          {
            data_inicio: dataInicioStr,
            data_fim: dataFimStr,
            total_pratos_vendidos: comFicha.length + semFicha.length + custoIncompleto.length,
            pratos_com_ficha: comFicha.length,
            pratos_sem_ficha: semFicha.length,
            pratos_custo_incompleto: custoIncompleto.length,
          },
          "Margem por prato report retrieved"
        );

        return await reply.code(200).send({
          periodo: { inicio: dataInicioStr, fim: dataFimStr },
          resumo: {
            total_pratos_vendidos: comFicha.length + semFicha.length + custoIncompleto.length,
            pratos_com_ficha: comFicha.length,
            pratos_sem_ficha: semFicha.length,
            pratos_custo_incompleto: custoIncompleto.length,
            receita_total_geral: Number(receitaTotalGeral.toFixed(2)),
            receita_coberta: Number(receitaCoberta.toFixed(2)),
            custo_total: Number(custoTotal.toFixed(2)),
            margem_total: Number(margemTotal.toFixed(2)),
            margem_percentual: margemPercentualGeral !== null ? Number(margemPercentualGeral.toFixed(2)) : null,
            cobertura_percentual: coberturaPercentual !== null ? Number(coberturaPercentual.toFixed(2)) : null,
          },
          com_ficha: comFicha,
          sem_ficha: semFicha,
          custo_incompleto: custoIncompleto,
          observacao_custo: "Custo calculado com o custo atual dos insumos, sem histórico de preços. Pratos sem ficha ou com custo incompleto não entram nos totais de custo e margem.",
        });
      } catch (error) {
        app.logger.error({}, "Failed to get margem-pratos report");
        return await reply.code(500).send({ error: "Não foi possível gerar o relatório de margem por prato." });
      }
    }
  );
}
