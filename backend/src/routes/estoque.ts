import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, sql, desc, lte } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";

export function registerEstoqueRoutes(app: App) {
  const db = app.db as any;

  // ==================== INSUMOS ====================

  // GET /api/insumos — listar insumos
  app.fastify.get(
    "/api/insumos",
    { schema: {} } as any,
    async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      const restauranteId = requireTenant(session);
      const insumos = await db.select().from(schema.insumos)
        .where(eq(schema.insumos.restauranteId, restauranteId))
        .orderBy(schema.insumos.nome);
      return await reply.code(200).send(insumos);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // GET /api/insumos/alertas — insumos com estoque baixo
  app.fastify.get(
    "/api/insumos/alertas",
    { schema: {} } as any,
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const session = await customRequireAuth(app, request, reply);
        if (!session) return;
        const restauranteId = requireTenant(session);
        const alertas = await db.select().from(schema.insumos)
          .where(and(
            eq(schema.insumos.restauranteId, restauranteId),
            eq(schema.insumos.ativo, true),
            lte(schema.insumos.estoqueAtual, schema.insumos.estoqueMinimo)
          ))
          .orderBy(schema.insumos.nome);
        return await reply.code(200).send(alertas);
      } catch (err: any) {
        if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // POST /api/insumos — criar insumo
  app.fastify.post(
    "/api/insumos",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Body: { nome: string; descricao?: string; unidade: string; estoqueAtual?: string; estoqueMinimo?: string; custoUnitario?: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { nome, descricao, unidade, estoqueAtual, estoqueMinimo, custoUnitario } = request.body;
      if (!nome || !unidade) return await reply.code(400).send({ error: "nome e unidade são obrigatórios" });

      const VALID_UNITS = ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"];
      if (!VALID_UNITS.includes(unidade)) {
        return await reply.code(400).send({ error: "Unidade inválida. Use: " + VALID_UNITS.join(", ") });
      }

      const estMinNum = parseFloat(estoqueMinimo || "0");
      const custUnitNum = parseFloat(custoUnitario || "0");
      if (!isFinite(estMinNum) || estMinNum < 0) {
        return await reply.code(400).send({ error: "estoqueMinimo deve ser um número não-negativo." });
      }
      if (!isFinite(custUnitNum) || custUnitNum < 0) {
        return await reply.code(400).send({ error: "custoUnitario deve ser um número não-negativo." });
      }

      const [insumo] = await db.insert(schema.insumos).values({
        nome, descricao: descricao || null, unidade,
        estoqueAtual: estoqueAtual || "0",
        estoqueMinimo: estoqueMinimo || "0",
        custoUnitario: custoUnitario || "0",
        restauranteId,
      }).returning();

      return await reply.code(201).send(insumo);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // PUT /api/insumos/:id — atualizar insumo
  app.fastify.put(
    "/api/insumos/:id",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { id: string }; Body: { nome?: string; descricao?: string; unidade?: string; estoqueMinimo?: string; custoUnitario?: string; ativo?: boolean } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { id } = request.params;
      const body = request.body;

      const [existing] = await db.select().from(schema.insumos).where(and(eq(schema.insumos.id, id), eq(schema.insumos.restauranteId, restauranteId)));
      if (!existing) return await reply.code(404).send({ error: "Insumo não encontrado" });

      if (body.unidade !== undefined) {
        const VALID_UNITS = ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"];
        if (!VALID_UNITS.includes(body.unidade)) {
          return await reply.code(400).send({ error: "Unidade inválida. Use: " + VALID_UNITS.join(", ") });
        }
      }

      if (body.estoqueMinimo !== undefined) {
        const estMinNum = parseFloat(body.estoqueMinimo);
        if (!isFinite(estMinNum) || estMinNum < 0) {
          return await reply.code(400).send({ error: "estoqueMinimo deve ser um número não-negativo." });
        }
      }

      if (body.custoUnitario !== undefined) {
        const custUnitNum = parseFloat(body.custoUnitario);
        if (!isFinite(custUnitNum) || custUnitNum < 0) {
          return await reply.code(400).send({ error: "custoUnitario deve ser um número não-negativo." });
        }
      }

      const updates: any = { updatedAt: new Date() };
      if (body.nome !== undefined) updates.nome = body.nome;
      if (body.descricao !== undefined) updates.descricao = body.descricao;
      if (body.unidade !== undefined) updates.unidade = body.unidade;
      if (body.estoqueMinimo !== undefined) updates.estoqueMinimo = body.estoqueMinimo;
      if (body.custoUnitario !== undefined) updates.custoUnitario = body.custoUnitario;
      if (body.ativo !== undefined) updates.ativo = body.ativo;

      const [updated] = await db.update(schema.insumos).set(updates).where(eq(schema.insumos.id, id)).returning();
      return await reply.code(200).send(updated);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // DELETE /api/insumos/:id — desativar insumo (soft delete)
  app.fastify.delete(
    "/api/insumos/:id",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { id } = request.params;

      const [existing] = await db.select().from(schema.insumos).where(and(eq(schema.insumos.id, id), eq(schema.insumos.restauranteId, restauranteId)));
      if (!existing) return await reply.code(404).send({ error: "Insumo não encontrado" });

      await db.update(schema.insumos).set({ ativo: false, updatedAt: new Date() }).where(eq(schema.insumos.id, id));
      return await reply.code(200).send({ success: true });
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // ==================== MOVIMENTAÇÕES ====================

  // POST /api/estoque/movimentacao — registrar entrada, saída ou ajuste
  app.fastify.post(
    "/api/estoque/movimentacao",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Body: { insumoId: string; tipo: string; quantidade: string; motivo?: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { insumoId, tipo, quantidade, motivo } = request.body;

      if (!insumoId || !tipo || !quantidade) return await reply.code(400).send({ error: "insumoId, tipo e quantidade são obrigatórios" });
      if (!["entrada", "saida", "ajuste"].includes(tipo)) return await reply.code(400).send({ error: "tipo deve ser entrada, saida ou ajuste" });

      const qty = parseFloat(quantidade);
      if (isNaN(qty) || qty <= 0) return await reply.code(400).send({ error: "quantidade deve ser um número positivo" });

      const result = await (db as any).transaction(async (tx: any) => {
        const [insumo] = await tx.select().from(schema.insumos).where(and(eq(schema.insumos.id, insumoId), eq(schema.insumos.restauranteId, restauranteId)));
        if (!insumo) return { error: "Insumo não encontrado" };

        const estoqueAnterior = parseFloat(insumo.estoqueAtual);
        let estoqueNovo: number;

        if (tipo === "entrada") {
          estoqueNovo = estoqueAnterior + qty;
        } else if (tipo === "saida") {
          estoqueNovo = estoqueAnterior - qty;
          if (estoqueNovo < 0) return { error: "Estoque insuficiente. Atual: " + estoqueAnterior + " " + insumo.unidade };
        } else {
          // ajuste: quantidade é o valor absoluto novo
          estoqueNovo = qty;
        }

        await tx.update(schema.insumos).set({ estoqueAtual: estoqueNovo.toString(), updatedAt: new Date() }).where(eq(schema.insumos.id, insumoId));

        const [mov] = await tx.insert(schema.movimentacoesEstoque).values({
          insumoId, tipo, quantidade: qty.toString(),
          estoqueAnterior: estoqueAnterior.toString(),
          estoqueNovo: estoqueNovo.toString(),
          motivo: motivo || null,
          usuarioId: (session as any).id || null,
          restauranteId,
        }).returning();

        return { movimentacao: mov, estoqueNovo };
      });

      if (result.error) return await reply.code(400).send({ error: result.error });
      return await reply.code(201).send(result);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // GET /api/estoque/movimentacoes/:insumoId — histórico de movimentações de um insumo
  app.fastify.get(
    "/api/estoque/movimentacoes/:insumoId",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { insumoId: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      const restauranteId = requireTenant(session);
      const { insumoId } = request.params;

      const movimentacoes = await db.select().from(schema.movimentacoesEstoque)
        .where(and(eq(schema.movimentacoesEstoque.insumoId, insumoId), eq(schema.movimentacoesEstoque.restauranteId, restauranteId)))
        .orderBy(desc(schema.movimentacoesEstoque.createdAt));

      return await reply.code(200).send(movimentacoes);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // ==================== PRATO-INSUMOS (RECEITA) ====================

  // GET /api/pratos/:pratoId/insumos — listar insumos de um prato
  app.fastify.get(
    "/api/pratos/:pratoId/insumos",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { pratoId: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      const restauranteId = requireTenant(session);
      const { pratoId } = request.params;

      const items = await db.select({
        id: schema.pratoInsumos.id,
        insumoId: schema.pratoInsumos.insumoId,
        quantidadeUsada: schema.pratoInsumos.quantidadeUsada,
        insumoNome: schema.insumos.nome,
        insumoUnidade: schema.insumos.unidade,
      }).from(schema.pratoInsumos)
        .leftJoin(schema.insumos, eq(schema.pratoInsumos.insumoId, schema.insumos.id))
        .where(and(eq(schema.pratoInsumos.pratoId, pratoId), eq(schema.pratoInsumos.restauranteId, restauranteId)));

      return await reply.code(200).send(items);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // POST /api/pratos/:pratoId/insumos — vincular insumo a prato
  app.fastify.post(
    "/api/pratos/:pratoId/insumos",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { pratoId: string }; Body: { insumo_id: string; quantidade: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { pratoId } = request.params;
      const { insumo_id, quantidade } = request.body;

      if (!insumo_id || !quantidade) return await reply.code(400).send({ error: "insumo_id e quantidade são obrigatórios" });

      const qty = parseFloat(quantidade);
      if (!isFinite(qty) || qty <= 0) {
        return await reply.code(400).send({ error: "quantidade deve ser um número maior que zero." });
      }

      // Check if prato exists and belongs to tenant
      const [prato] = await db.select().from(schema.pratos).where(and(eq(schema.pratos.id, pratoId), eq(schema.pratos.restauranteId, restauranteId)));
      if (!prato) return await reply.code(404).send({ error: "Prato não encontrado" });

      // Check if insumo exists and belongs to tenant
      const [insumo] = await db.select().from(schema.insumos).where(and(eq(schema.insumos.id, insumo_id), eq(schema.insumos.restauranteId, restauranteId)));
      if (!insumo) return await reply.code(404).send({ error: "Insumo não encontrado" });

      // Check for duplicate link
      const [existing] = await db.select().from(schema.pratoInsumos).where(and(eq(schema.pratoInsumos.pratoId, pratoId), eq(schema.pratoInsumos.insumoId, insumo_id)));
      if (existing) return await reply.code(400).send({ error: "Este insumo já está vinculado a este prato." });

      const [item] = await db.insert(schema.pratoInsumos).values({
        pratoId, insumoId: insumo_id, quantidadeUsada: quantidade, restauranteId,
      }).returning();

      return await reply.code(201).send(item);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });

  // DELETE /api/pratos/:pratoId/insumos/:id — remover vínculo
  app.fastify.delete(
    "/api/pratos/:pratoId/insumos/:id",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { pratoId: string; id: string } }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { id } = request.params;

      const [existing] = await db.select().from(schema.pratoInsumos).where(and(eq(schema.pratoInsumos.id, id), eq(schema.pratoInsumos.restauranteId, restauranteId)));
      if (!existing) return await reply.code(404).send({ error: "Vínculo não encontrado" });

      await db.delete(schema.pratoInsumos).where(eq(schema.pratoInsumos.id, id));
      return await reply.code(200).send({ success: true });
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      return await reply.code(500).send({ error: "Erro interno" });
    }
  });
}
