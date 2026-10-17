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

  // ==================== FICHA TÉCNICA ====================

  // Helper: Validate and normalize quantity
  function validarQuantidade(qty: string | number): number | null {
    let str = "";
    if (typeof qty === "string") {
      str = qty.trim();
      if (str.length === 0 || str.length > 200) return null;
    } else if (typeof qty === "number") {
      if (!isFinite(qty)) return null;
      str = String(qty);
    } else {
      return null;
    }

    str = str.replace(/,/g, ".");
    if (!/^[0-9]+(\.[0-9]{1,3})?$/.test(str)) return null;

    const num = parseFloat(str);
    if (!isFinite(num) || num <= 0 || num > 1000000) return null;
    return num;
  }

  // Helper: Normalize Unicode name for matching
  function normalizeNameNFD(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  // PUT /api/pratos/:pratoId/insumos/:id — atualizar quantidade do vínculo
  app.fastify.put(
    "/api/pratos/:pratoId/insumos/:id",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Params: { pratoId: string; id: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const { pratoId, id } = request.params;
      const body: any = request.body;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return await reply.code(400).send({ error: "Body deve ser um objeto." });
      }

      if (body.quantidade === undefined) {
        return await reply.code(400).send({ error: "quantidade é obrigatória." });
      }

      const qty = validarQuantidade(body.quantidade as string | number);
      if (qty === null) {
        return await reply.code(400).send({ error: "quantidade inválida." });
      }

      // Atomic update with existence check
      const updated = await db.update(schema.pratoInsumos).set({
        quantidadeUsada: qty.toString(),
      }).where(
        and(
          eq(schema.pratoInsumos.id, id),
          eq(schema.pratoInsumos.pratoId, pratoId),
          eq(schema.pratoInsumos.restauranteId, restauranteId),
          sql`EXISTS (SELECT 1 FROM ${schema.pratos} WHERE ${eq(schema.pratos.id, pratoId)} AND ${eq(schema.pratos.restauranteId, restauranteId)})`
        )
      ).returning();

      if (!Array.isArray(updated) || updated.length === 0) {
        return await reply.code(404).send({ error: "Vínculo não encontrado" });
      }

      if (updated.length !== 1 || typeof updated[0] !== "object") {
        app.logger.error({ rows: updated.length }, "Resultado inesperado ao atualizar vínculo");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }

      app.logger.info({ vínculo_id: id }, "Vínculo atualizado");
      return await reply.code(200).send(updated[0]);
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      app.logger.error({ err: err.message }, "Erro ao atualizar vínculo");
      return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
    }
  });

  // POST /api/estoque/ficha-tecnica/importar — bulk import com validação e transação
  app.fastify.post(
    "/api/estoque/ficha-tecnica/importar",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;
      if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
      const restauranteId = requireTenant(session);
      const body: any = request.body;

      // Validate body structure
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return await reply.code(400).send({ error: "Body deve ser um objeto." });
      }

      const confirmar = (body as any).confirmar === true;
      const ignorar_erros = (body as any).ignorar_erros === true;

      if ((body as any).confirmar !== undefined && typeof (body as any).confirmar !== "boolean") {
        return await reply.code(400).send({ error: "confirmar deve ser booleano." });
      }
      if ((body as any).ignorar_erros !== undefined && typeof (body as any).ignorar_erros !== "boolean") {
        return await reply.code(400).send({ error: "ignorar_erros deve ser booleano." });
      }

      const linhas = (body as any).linhas;
      if (!Array.isArray(linhas)) {
        return await reply.code(400).send({ error: "linhas deve ser um array." });
      }
      if (linhas.length < 1 || linhas.length > 500) {
        return await reply.code(400).send({ error: "linhas deve ter entre 1 e 500 elementos." });
      }

      for (let i = 0; i < (linhas as any[]).length; i++) {
        const linha = (linhas as any[])[i];
        if (!linha || typeof linha !== "object" || Array.isArray(linha)) {
          return await reply.code(400).send({ error: `Linha ${i + 1}: deve ser um objeto.` });
        }
      }

      // Phase 1: Validate all rows
      const pratos: any = await db.select({ id: schema.pratos.id, nome: schema.pratos.nome })
        .from(schema.pratos)
        .where(eq(schema.pratos.restauranteId, restauranteId));

      const insumos: any = await db.select({ id: schema.insumos.id, nome: schema.insumos.nome, unidade: schema.insumos.unidade, ativo: schema.insumos.ativo })
        .from(schema.insumos)
        .where(eq(schema.insumos.restauranteId, restauranteId));

      if (!Array.isArray(pratos) || !pratos.every(p => p && typeof p === "object")) {
        app.logger.error({ rows: pratos.length }, "Resultado inválido ao carregar pratos");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }
      if (!Array.isArray(insumos) || !insumos.every(i => i && typeof i === "object")) {
        app.logger.error({ rows: insumos.length }, "Resultado inválido ao carregar insumos");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }

      // Build normalized maps (allowing collisions)
      const pratoNormMap = new Map<string, string[]>();
      pratos.forEach(p => {
        const norm = normalizeNameNFD(p.nome);
        if (!pratoNormMap.has(norm)) pratoNormMap.set(norm, []);
        pratoNormMap.get(norm)!.push(p.id);
      });

      const insumoNormMap = new Map<string, string[]>();
      insumos.forEach(i => {
        const norm = normalizeNameNFD(i.nome);
        if (!insumoNormMap.has(norm)) insumoNormMap.set(norm, []);
        insumoNormMap.get(norm)!.push(i.id);
      });

      // Get existing links
      const existingLinks: any = await db.select({
        pratoId: schema.pratoInsumos.pratoId,
        insumoId: schema.pratoInsumos.insumoId,
        quantidadeUsada: schema.pratoInsumos.quantidadeUsada,
      })
        .from(schema.pratoInsumos)
        .where(eq(schema.pratoInsumos.restauranteId, restauranteId));

      if (!Array.isArray(existingLinks) || !existingLinks.every(l => l && typeof l === "object")) {
        app.logger.error({ rows: existingLinks.length }, "Resultado inválido ao carregar vínculos");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }

      const linkKey = (pratoId: string, insumoId: string) => `${pratoId}|${insumoId}`;
      const linkMap = new Map<string, any>();
      for (const link of existingLinks) {
        const key = linkKey(link.pratoId, link.insumoId);
        if (linkMap.has(key)) {
          // Duplicate in DB - error on any line trying to use it
          linkMap.set(key, null);
        } else {
          linkMap.set(key, link);
        }
      }

      const resultados: any[] = [];
      const seenPairs = new Set<string>();
      let novas = 0, atualizam = 0, sem_alteracao = 0, com_erro = 0;

      // Validate each row
      for (let idx = 0; idx < (linhas as any[]).length; idx++) {
        const linha = (linhas as any[])[idx];
        const lineNumber = idx + 1;
        let resultado: any = { linha: lineNumber, status: "erro" };

        // Check structure
        if (!linha.prato || !linha.insumo || linha.quantidade === undefined || !linha.unidade) {
          resultado.mensagem = "Prato, insumo, quantidade e unidade são obrigatórios.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        const pratoNome = String((linha as any).prato).trim();
        const insumoNome = String((linha as any).insumo).trim();
        const unidadeStr = String((linha as any).unidade).trim().toLowerCase();

        if (pratoNome.length === 0 || pratoNome.length > 200) {
          resultado.mensagem = "Nome do prato inválido.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        if (insumoNome.length === 0 || insumoNome.length > 200) {
          resultado.mensagem = "Nome do insumo inválido.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        const qty = validarQuantidade((linha as any).quantidade as string | number);
        if (qty === null) {
          resultado.mensagem = "Quantidade inválida.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        // Resolve prato
        const pratoNorm = normalizeNameNFD(pratoNome);
        const pratoIds = pratoNormMap.get(pratoNorm) || [];
        if (pratoIds.length === 0) {
          resultado.mensagem = "Prato não encontrado.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        if (pratoIds.length > 1) {
          resultado.mensagem = "Nome de prato ambíguo.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        const pratoId = pratoIds[0];

        // Resolve insumo
        const insumoNorm = normalizeNameNFD(insumoNome);
        const insumoIds = insumoNormMap.get(insumoNorm) || [];
        if (insumoIds.length === 0) {
          resultado.mensagem = "Insumo não encontrado.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        if (insumoIds.length > 1) {
          resultado.mensagem = "Nome de insumo ambíguo.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        const insumoId = insumoIds[0];

        const insumoObj = insumos.find(i => i.id === insumoId);
        if (!insumoObj || insumoObj.ativo !== true) {
          resultado.mensagem = "Insumo inativo.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        // Check unidade
        const cadastradoUnit = insumoObj.unidade.toLowerCase();
        if (unidadeStr !== cadastradoUnit) {
          resultado.mensagem = `Unidade inválida. Cadastrada: ${insumoObj.unidade}`;
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        // Check for duplicates in file
        const pair = linkKey(pratoId, insumoId);
        if (seenPairs.has(pair)) {
          resultado.mensagem = "Repetida no arquivo";
          resultados.push(resultado);
          com_erro++;
          continue;
        }
        seenPairs.add(pair);

        // Check for DB duplicate
        const existing = linkMap.get(pair);
        if (existing === null) {
          resultado.mensagem = "Prato e insumo duplicados no banco de dados.";
          resultados.push(resultado);
          com_erro++;
          continue;
        }

        // Determine status
        if (existing) {
          const existingQty = parseFloat(existing.quantidadeUsada);
          if (Math.abs(existingQty - qty) < 1e-6) {
            resultado.status = "sem_alteracao";
            resultado.quantidade_atual = existingQty;
            sem_alteracao++;
          } else {
            resultado.status = "atualiza";
            resultado.quantidade_atual = existingQty;
            resultado.quantidade_solicitada = qty;
            atualizam++;
          }
        } else {
          resultado.status = "nova";
          resultado.quantidade_solicitada = qty;
          novas++;
        }

        resultados.push(resultado);
      }

      // Phase 2: Commit if confirmar and no errors (or ignorar_erros)
      const hasErrors = com_erro > 0;
      if (confirmar && hasErrors && !ignorar_erros) {
        app.logger.info({ total: linhas.length, com_erro }, "Importação abortada: há erros");
        return await reply.code(409).send({
          resumo: { total: linhas.length, novas, atualizam, sem_alteracao, com_erro },
          resultados,
          mensagem: "Há linhas com erro. Corrija ou escolha ignorar as linhas com erro.",
        });
      }

      let gravados = { criados: 0, atualizados: 0 };

      if (confirmar) {
        const result = await (db as any).transaction(async (tx: any) => {
          // Re-lock and recheck within transaction
          await tx.execute(sql`LOCK TABLE ${schema.pratoInsumos} IN SHARE ROW EXCLUSIVE MODE`);

          const recheckLinks: any = await tx.select({
            pratoId: schema.pratoInsumos.pratoId,
            insumoId: schema.pratoInsumos.insumoId,
            quantidadeUsada: schema.pratoInsumos.quantidadeUsada,
          })
            .from(schema.pratoInsumos)
            .where(eq(schema.pratoInsumos.restauranteId, restauranteId));

          if (!Array.isArray(recheckLinks)) throw new Error("Invalid recheck result");

          const recheckMap = new Map<string, any>();
          for (const link of recheckLinks as any[]) {
            const key = linkKey((link as any).pratoId, (link as any).insumoId);
            if (recheckMap.has(key)) {
              recheckMap.set(key, null);
            } else {
              recheckMap.set(key, link);
            }
          }

          // Re-validate insumo ativo status
          const recheckInsumos: any = await tx.select({ id: schema.insumos.id, ativo: schema.insumos.ativo })
            .from(schema.insumos)
            .where(eq(schema.insumos.restauranteId, restauranteId));

          if (!Array.isArray(recheckInsumos)) throw new Error("Invalid insumo recheck");

          const insumoAtivoMap = new Map((recheckInsumos as any[]).map((i: any) => [i.id, i.ativo]));

          // Process each row
          for (let idx = 0; idx < resultados.length; idx++) {
            const res = resultados[idx];
            if (res.status !== "nova" && res.status !== "atualiza") continue;

            const linha = (linhas as any[])[res.linha - 1];
            const pratoNorm = normalizeNameNFD(String((linha as any).prato).trim());
            const insumoNorm = normalizeNameNFD(String((linha as any).insumo).trim());

            const pratoId = pratoNormMap.get(pratoNorm)?.[0];
            const insumoId = insumoNormMap.get(insumoNorm)?.[0];

            if (!pratoId || !insumoId) {
              res.status = "erro";
              res.mensagem = "Prato ou insumo não encontrado no recheck.";
              continue;
            }

            if (insumoAtivoMap.get(insumoId) !== true) {
              res.status = "erro";
              res.mensagem = "Insumo inativo no recheck.";
              continue;
            }

            const pair = linkKey(pratoId, insumoId);
            const recheckExisting = recheckMap.get(pair);

            if (recheckExisting === null) {
              res.status = "erro";
              res.mensagem = "Prato e insumo duplicados no recheck.";
              continue;
            }

            const qty = validarQuantidade((linha as any).quantidade as string | number);
            if (qty === null) {
              res.status = "erro";
              res.mensagem = "Quantidade inválida no recheck.";
              continue;
            }

            if (res.status === "nova" && !recheckExisting) {
              const inserted = await tx.insert(schema.pratoInsumos).values({
                pratoId,
                insumoId,
                quantidadeUsada: qty.toString(),
                restauranteId,
              }).returning();

              if (!Array.isArray(inserted) || inserted.length !== 1) {
                throw new Error("Insert failed");
              }
              gravados.criados++;
            } else if (res.status === "atualiza" && recheckExisting) {
              const updated = await tx.update(schema.pratoInsumos).set({
                quantidadeUsada: qty.toString(),
              }).where(
                and(
                  eq(schema.pratoInsumos.pratoId, pratoId),
                  eq(schema.pratoInsumos.insumoId, insumoId),
                  eq(schema.pratoInsumos.restauranteId, restauranteId)
                )
              ).returning();

              if (!Array.isArray(updated) || updated.length !== 1) {
                throw new Error("Update failed");
              }
              gravados.atualizados++;
            }
          }
        });
      }

      app.logger.info({
        total: (linhas as any[]).length,
        novas,
        atualizam,
        sem_alteracao,
        com_erro,
        gravados_criados: gravados.criados,
        gravados_atualizados: gravados.atualizados,
      }, "Importação concluída");

      return await reply.code(200).send({
        resumo: { total: (linhas as any[]).length, novas, atualizam, sem_alteracao, com_erro },
        resultados,
        ...(confirmar && { gravados }),
      });
    } catch (err: any) {
      if (err.statusCode) return await reply.code(err.statusCode).send({ error: err.message });
      app.logger.error({ err: err.message }, "Erro na importação de ficha técnica");
      return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
    }
  });
}
