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

  // Helper: Validate and normalize quantity (string|number only)
  function validarQuantidade(qty: any): { valid: boolean; value: number | null; error?: string } {
    if (typeof qty !== "string" && typeof qty !== "number") {
      return { valid: false, value: null, error: "Quantidade deve ser texto ou número." };
    }

    let str = "";
    if (typeof qty === "string") {
      str = qty.trim();
      if (str.length === 0 || str.length > 200) {
        return { valid: false, value: null, error: "Quantidade inválida." };
      }
    } else {
      if (!isFinite(qty)) {
        return { valid: false, value: null, error: "Quantidade inválida." };
      }
      str = String(qty);
    }

    str = str.replace(/,/g, ".");
    if (!/^[0-9]+(\.[0-9]{1,3})?$/.test(str)) {
      return { valid: false, value: null, error: "Quantidade inválida." };
    }

    const num = parseFloat(str);
    if (!isFinite(num) || num <= 0 || num > 1000000) {
      return { valid: false, value: null, error: "Quantidade inválida." };
    }
    return { valid: true, value: num };
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

  // Helper: Load pratos, insumos, vinculos from database
  async function carregarDados(connection: any, restauranteId: string) {
    const pratos: any = await connection.select({
      id: schema.pratos.id,
      nome: schema.pratos.nome,
    }).from(schema.pratos).where(eq(schema.pratos.restauranteId, restauranteId));

    if (!Array.isArray(pratos)) throw new Error("Pratos result not array");
    for (const p of pratos) {
      if (!p || typeof p !== "object" || Array.isArray(p) || !p.id || typeof p.nome !== "string") {
        throw new Error("Invalid prato row");
      }
    }

    const insumos: any = await connection.select({
      id: schema.insumos.id,
      nome: schema.insumos.nome,
      unidade: schema.insumos.unidade,
      ativo: schema.insumos.ativo,
    }).from(schema.insumos).where(eq(schema.insumos.restauranteId, restauranteId));

    if (!Array.isArray(insumos)) throw new Error("Insumos result not array");
    for (const i of insumos) {
      if (!i || typeof i !== "object" || Array.isArray(i) || !i.id || typeof i.nome !== "string" || typeof i.unidade !== "string" || typeof i.ativo !== "boolean") {
        throw new Error("Invalid insumo row");
      }
    }

    const vinculos: any = await connection.select({
      id: schema.pratoInsumos.id,
      pratoId: schema.pratoInsumos.pratoId,
      insumoId: schema.pratoInsumos.insumoId,
      quantidadeUsada: schema.pratoInsumos.quantidadeUsada,
    }).from(schema.pratoInsumos).where(eq(schema.pratoInsumos.restauranteId, restauranteId));

    if (!Array.isArray(vinculos)) throw new Error("Vinculos result not array");
    for (const v of vinculos) {
      if (!v || typeof v !== "object" || Array.isArray(v) || !v.id || !v.pratoId || !v.insumoId || typeof v.quantidadeUsada !== "string") {
        throw new Error("Invalid vinculo row");
      }
      const qtyNum = parseFloat(v.quantidadeUsada);
      if (!isFinite(qtyNum)) throw new Error("Invalid vinculo quantity");
    }

    return { pratos, insumos, vinculos };
  }

  // Helper: Validate and classify all rows (used in both phase 1 and phase 2)
  function validarEClassificar(
    linhas: any[],
    pratos: any[],
    insumos: any[],
    vinculos: any[],
    restauranteId: string
  ) {
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

    const vinculoMap = new Map<string, any>();
    for (const v of vinculos) {
      const key = `${v.pratoId}|${v.insumoId}`;
      if (vinculoMap.has(key)) {
        vinculoMap.set(key, null);
      } else {
        vinculoMap.set(key, v);
      }
    }

    const resultados: any[] = [];
    const seenPairs = new Set<string>();
    let novas = 0, atualizam = 0, sem_alteracao = 0, com_erro = 0;

    for (let idx = 0; idx < linhas.length; idx++) {
      const linha = linhas[idx] as any;
      const lineNumber = idx + 1;
      let resultado: any = { linha: lineNumber, status: "erro" };

      // Validate required fields exist
      if (linha.prato === undefined || linha.insumo === undefined || linha.unidade === undefined || linha.quantidade === undefined) {
        resultado.mensagem = "Prato, insumo, quantidade e unidade são obrigatórios.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }

      // Type checks: must be string (never null)
      if (typeof linha.prato !== "string") {
        resultado.mensagem = "Nome do prato inválido.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }
      if (typeof linha.insumo !== "string") {
        resultado.mensagem = "Nome do insumo inválido.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }
      if (typeof linha.unidade !== "string") {
        resultado.mensagem = "Unidade inválida.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }

      // Trim and normalize
      const pratoNome = linha.prato.trim();
      const insumoNome = linha.insumo.trim();
      const unidadeStr = linha.unidade.trim().toLowerCase();

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
      if (unidadeStr.length === 0 || unidadeStr.length > 200) {
        resultado.mensagem = "Unidade inválida.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }

      const qtyValidation = validarQuantidade(linha.quantidade);
      if (!qtyValidation.valid || qtyValidation.value === null) {
        resultado.mensagem = qtyValidation.error || "Quantidade inválida.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }
      const qty = qtyValidation.value;

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

      // Check for duplicates in file (first occurrence reserves)
      const pair = `${pratoId}|${insumoId}`;
      if (seenPairs.has(pair)) {
        resultado.mensagem = "Repetida no arquivo";
        resultados.push(resultado);
        com_erro++;
        continue;
      }
      seenPairs.add(pair);

      // Check for DB duplicate
      const existing = vinculoMap.get(pair);
      if (existing === null) {
        resultado.mensagem = "Prato e insumo duplicados no banco de dados.";
        resultados.push(resultado);
        com_erro++;
        continue;
      }

      // Determine status
      if (existing) {
        const existingQty = parseFloat(existing.quantidadeUsada);
        if (Math.abs(existingQty - qty) < 1e-10) {
          resultado.status = "sem_alteracao";
          resultado.quantidade_atual = existingQty;
          sem_alteracao++;
        } else {
          resultado.status = "atualiza";
          resultado.quantidade_atual = existingQty;
          resultado.quantidade_solicitada = qty;
          resultado.vinculo_id = existing.id;
          atualizam++;
        }
      } else {
        resultado.status = "nova";
        resultado.quantidade_solicitada = qty;
        novas++;
      }

      resultados.push(resultado);
    }

    return { resultados, resumo: { total: linhas.length, novas, atualizam, sem_alteracao, com_erro } };
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

      // Validate UUID format: 8-4-4-4-12 hex digits
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!uuidRegex.test(id) || !uuidRegex.test(pratoId)) {
        return await reply.code(404).send({ error: "Vínculo não encontrado" });
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return await reply.code(400).send({ error: "Body deve ser um objeto." });
      }

      if (body.quantidade === undefined) {
        return await reply.code(400).send({ error: "quantidade é obrigatória." });
      }

      const qtyValidation = validarQuantidade(body.quantidade);
      if (!qtyValidation.valid) {
        return await reply.code(400).send({ error: qtyValidation.error || "quantidade inválida." });
      }
      if (qtyValidation.value === null) {
        return await reply.code(400).send({ error: "quantidade inválida." });
      }
      const qty = qtyValidation.value;

      // Atomic update with existence check
      const updated: any = await db.update(schema.pratoInsumos).set({
        quantidadeUsada: qty.toString(),
      }).where(
        and(
          eq(schema.pratoInsumos.id, id),
          eq(schema.pratoInsumos.pratoId, pratoId),
          eq(schema.pratoInsumos.restauranteId, restauranteId),
          sql`EXISTS (SELECT 1 FROM ${schema.pratos} WHERE ${eq(schema.pratos.id, pratoId)} AND ${eq(schema.pratos.restauranteId, restauranteId)})`
        )
      ).returning();

      if (!Array.isArray(updated)) {
        app.logger.error({ resultType: typeof updated }, "UPDATE returned non-array");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }

      if (updated.length === 0) {
        return await reply.code(404).send({ error: "Vínculo não encontrado" });
      }

      if (updated.length !== 1 || !updated[0] || typeof updated[0] !== "object" || Array.isArray(updated[0])) {
        app.logger.error({ rows: updated.length }, "Unexpected UPDATE result structure");
        return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
      }

      app.logger.info({ vinculo_id: id }, "Vínculo atualizado");
      return await reply.code(200).send(updated[0]);
    } catch (err: any) {
      app.logger.error({}, "Erro ao atualizar vínculo");
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

      app.logger.info({ confirmar: body?.confirmar, ignorar_erros: body?.ignorar_erros }, "Iniciando importação de ficha técnica");

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

      // Load data from database
      const dados = await carregarDados(db, restauranteId);

      // Phase 1: Validate and classify all rows
      const validacao = validarEClassificar(linhas, dados.pratos, dados.insumos, dados.vinculos, restauranteId);

      if (!confirmar) {
        app.logger.info({ total: linhas.length, com_erro: validacao.resumo.com_erro }, "Pré-visualização concluída");
        return await reply.code(200).send({
          resumo: validacao.resumo,
          resultados: validacao.resultados
        });
      }

      // Phase 2: Confirmation with transaction
      if (validacao.resumo.com_erro > 0 && !ignorar_erros) {
        app.logger.info({ total: linhas.length, com_erro: validacao.resumo.com_erro }, "Importação abortada: há erros");
        return await reply.code(409).send({
          conflito: true,
          resumo: validacao.resumo,
          resultados: validacao.resultados,
          mensagem: "Há linhas com erro. Corrija ou escolha ignorar as linhas com erro."
        });
      }

      let criados = 0, atualizados = 0;

      await (db as any).transaction(async (tx: any) => {
        // Advisory lock (transactional)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${restauranteId})::bigint)`);

        // Reload data within transaction for confirmation
        const dadosTx = await carregarDados(tx, restauranteId);

        // Revalidate with fresh data
        const validacaoTx = validarEClassificar(linhas, dadosTx.pratos, dadosTx.insumos, dadosTx.vinculos, restauranteId);

        // If errors and !ignorar_erros, abort transaction (writes nothing)
        if (validacaoTx.resumo.com_erro > 0 && !ignorar_erros) {
          throw new Error("ABORT_ON_ERRORS");
        }

        // Process valid operations only
        for (const res of validacaoTx.resultados) {
          if (res.status === "nova") {
            const linha = linhas[res.linha - 1];
            const pratoNorm = normalizeNameNFD(String(linha.prato).trim());
            const insumoNorm = normalizeNameNFD(String(linha.insumo).trim());

            const pratoId = dadosTx.pratos.find(p => normalizeNameNFD(p.nome) === pratoNorm)?.id;
            const insumoId = dadosTx.insumos.find(i => normalizeNameNFD(i.nome) === insumoNorm)?.id;

            if (!pratoId || !insumoId) continue;

            const qtyValidation = validarQuantidade(linha.quantidade);
            if (!qtyValidation.valid || qtyValidation.value === null) continue;

            const qtyStr = qtyValidation.value.toFixed(3);
            const [inserted] = await tx.insert(schema.pratoInsumos).values({
              pratoId,
              insumoId,
              quantidadeUsada: qtyStr,
              restauranteId,
            }).returning();

            if (!inserted || typeof inserted !== "object" || Array.isArray(inserted)) {
              throw new Error("INSERT_UNEXPECTED");
            }
            criados++;
          } else if (res.status === "atualiza") {
            const linha = linhas[res.linha - 1];
            const qtyValidation = validarQuantidade(linha.quantidade);
            if (!qtyValidation.valid || qtyValidation.value === null) continue;

            const qtyStr = qtyValidation.value.toFixed(3);
            const [updated] = await tx.update(schema.pratoInsumos).set({
              quantidadeUsada: qtyStr,
            }).where(
              and(
                eq(schema.pratoInsumos.id, res.vinculo_id),
                eq(schema.pratoInsumos.restauranteId, restauranteId)
              )
            ).returning();

            if (!updated || typeof updated !== "object" || Array.isArray(updated)) {
              throw new Error("UPDATE_UNEXPECTED");
            }
            atualizados++;
          }
        }
      });

      app.logger.info({ criados, atualizados, total: linhas.length }, "Importação concluída com sucesso");

      return await reply.code(200).send({
        resumo: validacao.resumo,
        resultados: validacao.resultados
      });
    } catch (err: any) {
      app.logger.error({}, "Erro ao processar ficha técnica");
      return await reply.code(500).send({ error: "Não foi possível processar a ficha técnica." });
    }
  });
}
