import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireRole, requireTenant } from "../utils/auth.js";
import { MAX_IMAGEM_BYTES, detectarImagem, chaveImagemPrato, resolverImagemUrlEntrada } from "../utils/imagem.js";

interface FiscalFields {
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  csosn?: string | null;
  cstIcms?: string | null;
  cst_icms?: string | null;
  origemMercadoria?: number | null;
  origem_mercadoria?: number | null;
  unidadeComercial?: string | null;
  unidade_comercial?: string | null;
  aliquotaIcms?: string | null;
  aliquota_icms?: string | null;
}

interface CreatePratoBody extends FiscalFields {
  nome: string;
  descricao?: string;
  preco: string;
  categoriaId?: string;
  categoria_id?: string;
  imagemUrl?: string;
  imagem_url?: string;
  disponivel?: boolean;
  tempoPreparoMinutos?: number | null;
}

interface UpdatePratoBody extends FiscalFields {
  nome?: string;
  descricao?: string;
  preco?: string;
  categoriaId?: string;
  categoria_id?: string;
  imagemUrl?: string;
  imagem_url?: string;
  disponivel?: boolean;
  tempoPreparoMinutos?: number | null;
}

// Helper function to normalize decimal values (comma to dot)
function normalizeDecimal(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value.replace(',', '.'));
  return value;
}

// Validate fiscal digit fields have correct length and contain only digits
function validateFiscalDigits(valueRaw: string | null | undefined, fieldName: string, expectedLength: number): string | null {
  if (valueRaw === null || valueRaw === undefined || valueRaw === "") return null;
  const value = String(valueRaw).replace(/[^0-9]/g, "");
  if (value === "") return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} deve conter apenas dígitos`);
  }
  if (value.length !== expectedLength) {
    throw new Error(`${fieldName} deve ter exatamente ${expectedLength} dígitos`);
  }
  return value;
}

// Validate origem_mercadoria is 0-8
function validateOrigemMercadoria(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 8) {
    throw new Error('origem_mercadoria deve ser um inteiro entre 0 e 8');
  }
  return value;
}

// Normalize unidade_comercial: trim and uppercase, 1-6 characters
function normalizeUnidadeComercial(value: string | null | undefined): string {
  if (!value) return 'UN'; // default
  const normalized = value.trim().toUpperCase();
  if (normalized.length < 1 || normalized.length > 6) {
    throw new Error('unidade_comercial deve ter entre 1 e 6 caracteres');
  }
  return normalized;
}

// Validate and normalize fiscal fields
function validateAndNormalizeFiscalFields(body: any): any {
  const normalized: any = {};

  if (body.ncm !== undefined) {
    normalized.ncm = validateFiscalDigits(body.ncm, 'NCM', 8);
  }

  if (body.cfop !== undefined) {
    normalized.cfop = validateFiscalDigits(body.cfop, 'CFOP', 4) || '5102';
  }

  if (body.cest !== undefined) {
    normalized.cest = validateFiscalDigits(body.cest, 'CEST', 7);
  }

  if (body.csosn !== undefined) {
    normalized.csosn = validateFiscalDigits(body.csosn, 'CSOSN', 3);
  }

  const cstIcms = body.cst_icms !== undefined ? body.cst_icms : body.cstIcms;
  if (cstIcms !== undefined) {
    normalized.cstIcms = validateFiscalDigits(cstIcms, 'CST ICMS', 2);
  }

  const origemMercadoria = body.origem_mercadoria !== undefined ? body.origem_mercadoria : body.origemMercadoria;
  if (origemMercadoria !== undefined) {
    normalized.origemMercadoria = validateOrigemMercadoria(origemMercadoria);
  }

  const unidadeComercial = body.unidade_comercial !== undefined ? body.unidade_comercial : body.unidadeComercial;
  if (unidadeComercial !== undefined) {
    normalized.unidadeComercial = normalizeUnidadeComercial(unidadeComercial);
  }

  const aliquota = body.aliquota_icms !== undefined ? body.aliquota_icms : body.aliquotaIcms;
  if (aliquota !== undefined) {
    normalized.aliquotaIcms = (aliquota === null || aliquota === "")
      ? null
      : normalizeDecimal(aliquota).toString();
  }

  return normalized;
}

export function registerDishRoutes(app: App) {
  // GET /api/pratos - List pratos with optional filtering
  app.fastify.get<{ Querystring: { categoria_id?: string; disponivel?: string } }>(
    "/api/pratos",
    {
      schema: {
        description: "List pratos with optional filtering by categoria_id and disponivel",
        tags: ["pratos"],
        querystring: {
          type: "object",
          properties: {
            categoria_id: { type: "string", format: "uuid", description: "Filter by category ID" },
            disponivel: { type: "string", enum: ["true", "false"], description: "Filter by availability" },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                nome: { type: "string" },
                descricao: { type: "string", nullable: true },
                preco: { type: "number" },
                imagem_url: { type: "string", nullable: true },
                disponivel: { type: "boolean" },
                categoria_id: { type: "string", format: "uuid", nullable: true },
                categoria: {
                  type: "object",
                  nullable: true,
                  properties: {
                    id: { type: "string", format: "uuid" },
                    nome: { type: "string" },
                  },
                },
                ncm: { type: "string", nullable: true },
                cfop: { type: "string" },
                cest: { type: "string", nullable: true },
                csosn: { type: "string", nullable: true },
                cst_icms: { type: "string", nullable: true },
                origem_mercadoria: { type: "integer" },
                unidade_comercial: { type: "string" },
                aliquota_icms: { type: "string", nullable: true },
                tempoPreparoMinutos: { type: "integer", nullable: true },
                created_at: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { categoria_id?: string; disponivel?: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        const { categoria_id, disponivel } = request.query;
        app.logger.info({ categoria_id, disponivel, restauranteId }, "Listing pratos");

        // Build filters - tenant filter always present
        const filters: any[] = [eq(schema.pratos.restauranteId, restauranteId)];

        if (categoria_id) {
          filters.push(eq(schema.pratos.categoriaId, categoria_id));
        }

        if (disponivel !== undefined) {
          const disponibleBoolean = disponivel === "true";
          filters.push(eq(schema.pratos.disponivel, disponibleBoolean));
        }

        const query = app.db
          .select({
            id: schema.pratos.id,
            nome: schema.pratos.nome,
            descricao: schema.pratos.descricao,
            preco: schema.pratos.preco,
            categoriaId: schema.pratos.categoriaId,
            categoriaIdFk: schema.categorias.id,
            categoriaNome: schema.categorias.nome,
            imagemUrl: schema.pratos.imagemUrl,
            disponivel: schema.pratos.disponivel,
            tempoPreparoMinutos: schema.pratos.tempoPreparoMinutos,
            ncm: schema.pratos.ncm,
            cfop: schema.pratos.cfop,
            cest: schema.pratos.cest,
            csosn: schema.pratos.csosn,
            cstIcms: schema.pratos.cstIcms,
            origemMercadoria: schema.pratos.origemMercadoria,
            unidadeComercial: schema.pratos.unidadeComercial,
            aliquotaIcms: schema.pratos.aliquotaIcms,
            createdAt: schema.pratos.createdAt,
          })
          .from(schema.pratos)
          .leftJoin(schema.categorias, eq(schema.pratos.categoriaId, schema.categorias.id));

        const pratos = await query.where(and(...filters)).orderBy(schema.pratos.nome);

        app.logger.info({ count: pratos.length }, "Listed pratos");

        return reply.code(200).send(
          pratos.map((p) => ({
            id: p.id,
            nome: p.nome,
            descricao: p.descricao,
            preco: parseFloat(p.preco || "0"),
            imagem_url: p.imagemUrl,
            disponivel: p.disponivel,
            categoria_id: p.categoriaId,
            categoria: p.categoriaIdFk && p.categoriaNome ? { id: p.categoriaIdFk, nome: p.categoriaNome } : null,
            ncm: p.ncm,
            cfop: p.cfop,
            cest: p.cest,
            csosn: p.csosn,
            cst_icms: p.cstIcms,
            origem_mercadoria: p.origemMercadoria,
            unidade_comercial: p.unidadeComercial,
            aliquota_icms: p.aliquotaIcms,
            tempoPreparoMinutos: p.tempoPreparoMinutos,
            created_at: p.createdAt.toISOString(),
          }))
        );
      } catch (error) {
        app.logger.error({ err: error }, "Failed to list pratos");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/pratos - Create a new prato
  app.fastify.post<{ Body: CreatePratoBody }>(
    "/api/pratos",
    {
      schema: {
        description: "Create a new prato (requires admin/administrador/gerente role)",
        tags: ["pratos"],
        body: {
          type: "object",
          required: ["nome", "preco"],
          properties: {
            nome: { type: "string" },
            descricao: { type: "string", nullable: true },
            preco: { type: "string" },
            categoriaId: { type: "string", format: "uuid", nullable: true },
            categoria_id: { type: "string", format: "uuid", nullable: true },
            imagemUrl: { type: "string", nullable: true },
            imagem_url: { type: "string", nullable: true },
            disponivel: { type: "boolean" },
            tempoPreparoMinutos: { type: "integer", nullable: true },
            ncm: { type: "string", nullable: true },
            cfop: { type: "string", nullable: true },
            cest: { type: "string", nullable: true },
            csosn: { type: "string", nullable: true },
            cst_icms: { type: "string", nullable: true },
            origem_mercadoria: { type: "integer", nullable: true },
            unidade_comercial: { type: "string", nullable: true },
            aliquota_icms: { type: "string", nullable: true },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              prato: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  descricao: { type: "string", nullable: true },
                  preco: { type: "string" },
                  categoriaId: { type: "string", format: "uuid", nullable: true },
                  imagemUrl: { type: "string", nullable: true },
                  disponivel: { type: "boolean" },
                  tempoPreparoMinutos: { type: "integer", nullable: true },
                  ncm: { type: "string", nullable: true },
                  cfop: { type: "string" },
                  cest: { type: "string", nullable: true },
                  csosn: { type: "string", nullable: true },
                  cstIcms: { type: "string", nullable: true },
                  origemMercadoria: { type: "integer" },
                  unidadeComercial: { type: "string" },
                  aliquotaIcms: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreatePratoBody }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["admin", "administrador", "gerente"], reply))) return;

      try {
        if (!request.body.nome || !request.body.preco) {
          return await reply.code(400).send({ error: "nome and preco are required" });
        }

        const restauranteId = requireTenant(authUser);
        if (!restauranteId) {
          return await reply.code(404).send({ error: "Nenhum restaurante associado" });
        }

        // Validate preco
        const precoFloat = parseFloat(request.body.preco);
        if (isNaN(precoFloat) || precoFloat < 0) {
          return await reply.code(400).send({ error: "Preço inválido: deve ser um número maior ou igual a zero." });
        }

        // Validate tempoPreparoMinutos if provided
        if (request.body.tempoPreparoMinutos !== undefined && request.body.tempoPreparoMinutos !== null) {
          if (!Number.isInteger(request.body.tempoPreparoMinutos) || request.body.tempoPreparoMinutos < 0 || request.body.tempoPreparoMinutos > 600) {
            return await reply.code(400).send({ error: "Tempo de preparo inválido: deve ser um inteiro entre 0 e 600 minutos." });
          }
        }

        // Validate categoriaId if provided
        const categoriaId = request.body.categoriaId ?? request.body.categoria_id;
        if (categoriaId !== undefined && categoriaId !== null) {
          const categoria = await app.db
            .select()
            .from(schema.categorias)
            .where(and(
              eq(schema.categorias.id, categoriaId as any),
              eq(schema.categorias.restauranteId, restauranteId as any)
            ))
            .limit(1);

          if (categoria.length === 0) {
            return await reply.code(400).send({ error: "Categoria não encontrada." });
          }
        }

        app.logger.info({ nome: request.body.nome, restauranteId }, "Creating prato");

        // Validate and normalize fiscal fields
        let fiscalFields: any = {};
        try {
          fiscalFields = validateAndNormalizeFiscalFields(request.body);
        } catch (validationError: any) {
          app.logger.warn({ err: validationError, body: request.body }, "Fiscal field validation failed");
          return await reply.code(400).send({ error: validationError.message });
        }

        const imagemCriacao = resolverImagemUrlEntrada(request.body.imagemUrl ?? request.body.imagem_url);
        if (!imagemCriacao.ok) {
          return await reply.code(400).send({ error: (imagemCriacao as any).erro });
        }

        const normalizedPreco = normalizeDecimal(request.body.preco);

        const insertValues: any = {
          nome: request.body.nome,
          descricao: request.body.descricao,
          preco: normalizedPreco.toString(),
          categoriaId: request.body.categoriaId ?? request.body.categoria_id,
          imagemUrl: imagemCriacao.valor,
          disponivel: request.body.disponivel !== false,
          tempoPreparoMinutos: request.body.tempoPreparoMinutos ?? null,
          restauranteId,
          cfop: fiscalFields.cfop || '5102',
          origemMercadoria: fiscalFields.origemMercadoria !== undefined ? fiscalFields.origemMercadoria : 0,
          unidadeComercial: fiscalFields.unidadeComercial || 'UN',
        };

        if (fiscalFields.ncm) insertValues.ncm = fiscalFields.ncm;
        if (fiscalFields.cest) insertValues.cest = fiscalFields.cest;
        if (fiscalFields.csosn) insertValues.csosn = fiscalFields.csosn;
        if (fiscalFields.cstIcms) insertValues.cstIcms = fiscalFields.cstIcms;
        if (fiscalFields.aliquotaIcms) insertValues.aliquotaIcms = fiscalFields.aliquotaIcms;

        const [prato] = await app.db
          .insert(schema.pratos)
          .values(insertValues)
          .returning();

        app.logger.info({ pratoId: prato.id }, "Prato created successfully");

        return await reply.code(201).send({
          prato: {
            id: prato.id,
            nome: prato.nome,
            descricao: prato.descricao,
            preco: prato.preco,
            categoriaId: prato.categoriaId,
            imagemUrl: prato.imagemUrl,
            disponivel: prato.disponivel,
            tempoPreparoMinutos: prato.tempoPreparoMinutos,
            ncm: prato.ncm,
            cfop: prato.cfop,
            cest: prato.cest,
            csosn: prato.csosn,
            cstIcms: prato.cstIcms,
            origemMercadoria: prato.origemMercadoria,
            unidadeComercial: prato.unidadeComercial,
            aliquotaIcms: prato.aliquotaIcms,
            createdAt: prato.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error, body: request.body }, "Failed to create prato");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/pratos/:id - Get a prato
  app.fastify.get<{ Params: { id: string } }>(
    "/api/pratos/:id",
    {
      schema: {
        description: "Get a prato by ID (requires authentication)",
        tags: ["pratos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              nome: { type: "string" },
              descricao: { type: "string", nullable: true },
              preco: { type: "number" },
              categoria_id: { type: "string", format: "uuid", nullable: true },
              tempoPreparoMinutos: { type: "integer", nullable: true },
              prato: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  descricao: { type: "string", nullable: true },
                  preco: { type: "string" },
                  categoriaId: { type: "string", format: "uuid", nullable: true },
                  imagemUrl: { type: "string", nullable: true },
                  disponivel: { type: "boolean" },
                  tempoPreparoMinutos: { type: "integer", nullable: true },
                  ncm: { type: "string", nullable: true },
                  cfop: { type: "string" },
                  cest: { type: "string", nullable: true },
                  csosn: { type: "string", nullable: true },
                  cstIcms: { type: "string", nullable: true },
                  origemMercadoria: { type: "integer" },
                  unidadeComercial: { type: "string" },
                  aliquotaIcms: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                  categoria: {
                    type: "object",
                    nullable: true,
                    properties: {
                      id: { type: "string", format: "uuid" },
                      nome: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = await customRequireAuth(app, request, reply);
      if (!session) return;

      try {
        const restauranteId = requireTenant(session);
        app.logger.info({ pratoId: request.params.id }, "Getting prato");

        const pratos = await app.db
          .select({
            id: schema.pratos.id,
            nome: schema.pratos.nome,
            descricao: schema.pratos.descricao,
            preco: schema.pratos.preco,
            categoriaId: schema.pratos.categoriaId,
            categoriaIdFromJoin: schema.categorias.id,
            categoriaNome: schema.categorias.nome,
            imagemUrl: schema.pratos.imagemUrl,
            disponivel: schema.pratos.disponivel,
            tempoPreparoMinutos: schema.pratos.tempoPreparoMinutos,
            ncm: schema.pratos.ncm,
            cfop: schema.pratos.cfop,
            cest: schema.pratos.cest,
            csosn: schema.pratos.csosn,
            cstIcms: schema.pratos.cstIcms,
            origemMercadoria: schema.pratos.origemMercadoria,
            unidadeComercial: schema.pratos.unidadeComercial,
            aliquotaIcms: schema.pratos.aliquotaIcms,
            createdAt: schema.pratos.createdAt,
          })
          .from(schema.pratos)
          .leftJoin(schema.categorias, eq(schema.pratos.categoriaId, schema.categorias.id))
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        if (!pratos.length) {
          return await reply.code(404).send({ error: "Prato not found" });
        }

        const p = pratos[0];
        return await reply.code(200).send({
          prato: {
            id: p.id,
            nome: p.nome,
            descricao: p.descricao,
            preco: p.preco,
            categoriaId: p.categoriaId,
            categoria: p.categoriaIdFromJoin ? { id: p.categoriaIdFromJoin, nome: p.categoriaNome } : null,
            imagemUrl: p.imagemUrl,
            disponivel: p.disponivel,
            tempoPreparoMinutos: p.tempoPreparoMinutos,
            ncm: p.ncm,
            cfop: p.cfop,
            cest: p.cest,
            csosn: p.csosn,
            cstIcms: p.cstIcms,
            origemMercadoria: p.origemMercadoria,
            unidadeComercial: p.unidadeComercial,
            aliquotaIcms: p.aliquotaIcms,
            createdAt: p.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get prato");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/pratos/:id - Update a prato
  app.fastify.put<{ Params: { id: string }; Body: UpdatePratoBody }>(
    "/api/pratos/:id",
    {
      schema: {
        description: "Update a prato (requires admin/administrador/gerente role)",
        tags: ["pratos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            nome: { type: "string" },
            descricao: { type: "string", nullable: true },
            preco: { type: "string" },
            categoriaId: { type: "string", format: "uuid", nullable: true },
            categoria_id: { type: "string", format: "uuid", nullable: true },
            imagemUrl: { type: "string", nullable: true },
            imagem_url: { type: "string", nullable: true },
            disponivel: { type: "boolean" },
            tempoPreparoMinutos: { type: "integer", nullable: true },
            ncm: { type: "string", nullable: true },
            cfop: { type: "string", nullable: true },
            cest: { type: "string", nullable: true },
            csosn: { type: "string", nullable: true },
            cst_icms: { type: "string", nullable: true },
            origem_mercadoria: { type: "integer", nullable: true },
            unidade_comercial: { type: "string", nullable: true },
            aliquota_icms: { type: "string", nullable: true },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              prato: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  descricao: { type: "string", nullable: true },
                  preco: { type: "string" },
                  categoriaId: { type: "string", format: "uuid", nullable: true },
                  imagemUrl: { type: "string", nullable: true },
                  disponivel: { type: "boolean" },
                  tempoPreparoMinutos: { type: "integer", nullable: true },
                  ncm: { type: "string", nullable: true },
                  cfop: { type: "string" },
                  cest: { type: "string", nullable: true },
                  csosn: { type: "string", nullable: true },
                  cstIcms: { type: "string", nullable: true },
                  origemMercadoria: { type: "integer" },
                  unidadeComercial: { type: "string" },
                  aliquotaIcms: { type: "string", nullable: true },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdatePratoBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["admin", "administrador", "gerente"], reply))) return;

      try {
        const restauranteId = requireTenant(authUser);

        // Validate preco if provided
        if (request.body.preco !== undefined) {
          const precoFloat = parseFloat(request.body.preco);
          if (isNaN(precoFloat) || precoFloat < 0) {
            return await reply.code(400).send({ error: "Preço inválido: deve ser um número maior ou igual a zero." });
          }
        }

        // Validate tempoPreparoMinutos if provided
        if (request.body.tempoPreparoMinutos !== undefined && request.body.tempoPreparoMinutos !== null) {
          if (!Number.isInteger(request.body.tempoPreparoMinutos) || request.body.tempoPreparoMinutos < 0 || request.body.tempoPreparoMinutos > 600) {
            return await reply.code(400).send({ error: "Tempo de preparo inválido: deve ser um inteiro entre 0 e 600 minutos." });
          }
        }

        // Validate categoriaId if provided
        const categoriaIdToValidate = request.body.categoriaId !== undefined ? request.body.categoriaId : request.body.categoria_id;
        if (categoriaIdToValidate !== undefined && categoriaIdToValidate !== null) {
          const categoria = await app.db
            .select()
            .from(schema.categorias)
            .where(and(
              eq(schema.categorias.id, categoriaIdToValidate as any),
              eq(schema.categorias.restauranteId, restauranteId as any)
            ))
            .limit(1);

          if (categoria.length === 0) {
            return await reply.code(400).send({ error: "Categoria não encontrada." });
          }
        }

        app.logger.info({ pratoId: request.params.id }, "Updating prato");

        const existing = await app.db
          .select()
          .from(schema.pratos)
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Prato not found" });
        }

        // Validate and normalize fiscal fields
        let fiscalFields: any = {};
        try {
          fiscalFields = validateAndNormalizeFiscalFields(request.body);
        } catch (validationError: any) {
          app.logger.warn({ err: validationError, body: request.body }, "Fiscal field validation failed");
          return await reply.code(400).send({ error: validationError.message });
        }

        const updates: any = {};
        if (request.body.nome !== undefined) updates.nome = request.body.nome;
        if (request.body.descricao !== undefined) updates.descricao = request.body.descricao;
        if (request.body.preco !== undefined) updates.preco = normalizeDecimal(request.body.preco).toString();

        const categoriaId = request.body.categoriaId !== undefined ? request.body.categoriaId : request.body.categoria_id;
        if (categoriaId !== undefined) updates.categoriaId = categoriaId;

        const imagemEdicao = resolverImagemUrlEntrada(
          request.body.imagemUrl || request.body.imagem_url,
          existing[0].imagemUrl
        );
        if (!imagemEdicao.ok) {
          return await reply.code(400).send({ error: (imagemEdicao as any).erro });
        }
        if (imagemEdicao.valor !== undefined) updates.imagemUrl = imagemEdicao.valor;

        if (request.body.disponivel !== undefined) updates.disponivel = request.body.disponivel;
        if (request.body.tempoPreparoMinutos !== undefined) updates.tempoPreparoMinutos = request.body.tempoPreparoMinutos;

        // Apply fiscal field updates
        if (fiscalFields.ncm !== undefined) updates.ncm = fiscalFields.ncm;
        if (fiscalFields.cfop !== undefined) updates.cfop = fiscalFields.cfop;
        if (fiscalFields.cest !== undefined) updates.cest = fiscalFields.cest;
        if (fiscalFields.csosn !== undefined) updates.csosn = fiscalFields.csosn;
        if (fiscalFields.cstIcms !== undefined) updates.cstIcms = fiscalFields.cstIcms;
        if (fiscalFields.origemMercadoria !== undefined) updates.origemMercadoria = fiscalFields.origemMercadoria;
        if (fiscalFields.unidadeComercial !== undefined) updates.unidadeComercial = fiscalFields.unidadeComercial;
        if (fiscalFields.aliquotaIcms !== undefined) updates.aliquotaIcms = fiscalFields.aliquotaIcms;

        const [updated] = await app.db
          .update(schema.pratos)
          .set(updates)
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)))
          .returning();

        app.logger.info({ pratoId: updated.id }, "Prato updated successfully");

        return await reply.code(200).send({
          prato: {
            id: updated.id,
            nome: updated.nome,
            descricao: updated.descricao,
            preco: updated.preco,
            categoriaId: updated.categoriaId,
            imagemUrl: updated.imagemUrl,
            disponivel: updated.disponivel,
            tempoPreparoMinutos: updated.tempoPreparoMinutos,
            ncm: updated.ncm,
            cfop: updated.cfop,
            cest: updated.cest,
            csosn: updated.csosn,
            cstIcms: updated.cstIcms,
            origemMercadoria: updated.origemMercadoria,
            unidadeComercial: updated.unidadeComercial,
            aliquotaIcms: updated.aliquotaIcms,
            createdAt: updated.createdAt.toISOString(),
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to update prato");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PATCH /api/pratos/:id/disponibilidade - Toggle only availability (esgotado/disponível).
  // Narrower than PUT /api/pratos/:id on purpose: cozinheiro can mark a dish as out of
  // stock from the kitchen, but should not be able to edit price, description, or fiscal fields.
  app.fastify.patch<{ Params: { id: string }; Body: { disponivel: boolean } }>(
    "/api/pratos/:id/disponibilidade",
    {
      schema: {
        description: "Toggle prato availability (admin/administrador/gerente/cozinheiro)",
        tags: ["pratos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["disponivel"],
          properties: {
            disponivel: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              prato: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  nome: { type: "string" },
                  disponivel: { type: "boolean" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { disponivel: boolean } }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["admin", "administrador", "gerente", "cozinheiro"], reply))) return;

      if (typeof request.body?.disponivel !== "boolean") {
        return await reply.code(400).send({ error: "disponivel (boolean) is required" });
      }

      try {
        const restauranteId = requireTenant(authUser);
        app.logger.info(
          { pratoId: request.params.id, disponivel: request.body.disponivel, authUserId: authUser.id, authUserRole: authUser.role },
          "Toggling prato disponibilidade"
        );

        const existing = await app.db
          .select()
          .from(schema.pratos)
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Prato not found" });
        }

        const [updated] = await app.db
          .update(schema.pratos)
          .set({ disponivel: request.body.disponivel })
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)))
          .returning();

        app.logger.info({ pratoId: updated.id, disponivel: updated.disponivel }, "Prato disponibilidade updated");

        return await reply.code(200).send({
          prato: {
            id: updated.id,
            nome: updated.nome,
            disponivel: updated.disponivel,
          },
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to toggle prato disponibilidade");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/pratos/:id - Delete a prato
  app.fastify.delete<{ Params: { id: string } }>(
    "/api/pratos/:id",
    {
      schema: {
        description: "Delete a prato (requires admin/administrador/gerente role)",
        tags: ["pratos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          204: { description: "Prato deleted successfully" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["admin", "administrador", "gerente"], reply))) return;

      try {
        const restauranteId = requireTenant(authUser);
        app.logger.info({ pratoId: request.params.id }, "Deleting prato");

        const existing = await app.db
          .select()
          .from(schema.pratos)
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        if (!existing.length) {
          return await reply.code(404).send({ error: "Prato not found" });
        }

        await app.db.delete(schema.pratos).where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        app.logger.info({ pratoId: request.params.id }, "Prato deleted successfully");

        return reply.code(204).send();
      } catch (error) {
        app.logger.error({ err: error }, "Failed to delete prato");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /api/pratos/:id/foto - Upload photo for a prato (supports multipart form-data or JSON base64)
  app.fastify.post<{ Params: { id: string } }>(
    "/api/pratos/:id/foto",
    {
      schema: {
        description: "Upload a photo for a prato via multipart/form-data (file) or application/json (imagem_base64). Requires authentication and administrador/gerente/cozinheiro role.",
        tags: ["pratos"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              url: { type: "string" },
              imagem_url: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          413: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      if (!(await requireRole(authUser, ["admin", "administrador", "gerente", "cozinheiro"], reply))) return;

      try {
        const restauranteId = requireTenant(authUser);
        app.logger.info({ pratoId: request.params.id }, "Uploading prato photo");

        // Check if prato exists first
        const existing = await app.db
          .select()
          .from(schema.pratos)
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)));

        if (!existing.length) {
          app.logger.warn({ pratoId: request.params.id }, "Prato not found");
          return await reply.code(404).send({ error: "Prato não encontrado" });
        }

        let buffer: Buffer;

        // Detect format by Content-Type header
        const contentType = request.headers["content-type"] || "";

        if (contentType.includes("multipart/form-data")) {
          // Format 1: Multipart file upload
          app.logger.debug({ pratoId: request.params.id }, "Processing multipart file upload");

          const data = await request.file({ limits: { fileSize: MAX_IMAGEM_BYTES } }); // 5MB limit

          if (!data) {
            app.logger.warn({ pratoId: request.params.id }, "No file provided in multipart upload");
            return await reply.code(400).send({ error: "Nenhuma imagem enviada" });
          }

          try {
            buffer = await data.toBuffer();
          } catch (error) {
            app.logger.warn({ err: error, pratoId: request.params.id }, "File too large");
            return reply.code(413).send({ error: "Arquivo muito grande" });
          }
        } else if (contentType.includes("application/json")) {
          // Format 2: JSON with base64 data URI
          app.logger.debug({ pratoId: request.params.id }, "Processing JSON base64 upload");

          const body = request.body as any;
          const imagemBase64 = body.imagem_base64;

          if (!imagemBase64) {
            app.logger.warn({ pratoId: request.params.id }, "No imagem_base64 provided in JSON body");
            return await reply.code(400).send({ error: "Nenhuma imagem enviada" });
          }

          if (typeof imagemBase64 !== "string") {
            return await reply.code(400).send({ error: "Formato base64 inválido" });
          }

          // Strip the data URI prefix and decode base64 (o tipo real é detectado pelos bytes)
          const base64String = imagemBase64.replace(/^data:[^;]+;base64,/, "");
          try {
            buffer = Buffer.from(base64String, "base64");
          } catch (error) {
            app.logger.warn({ err: error, pratoId: request.params.id }, "Invalid base64 string");
            return await reply.code(400).send({ error: "Formato base64 inválido" });
          }

          if (buffer.length === 0) {
            app.logger.warn({ pratoId: request.params.id }, "Decoded base64 is empty");
            return await reply.code(400).send({ error: "Nenhuma imagem enviada" });
          }
        } else {
          app.logger.warn({ pratoId: request.params.id, contentType }, "Unsupported content type");
          return await reply.code(400).send({ error: "Content-Type deve ser multipart/form-data ou application/json" });
        }

        if (buffer.length > MAX_IMAGEM_BYTES) {
          return reply.code(413).send({ error: "Imagem muito grande (máximo 5 MB)" });
        }
        if (buffer.length === 0) {
          return await reply.code(400).send({ error: "Nenhuma imagem enviada" });
        }

        // Tipo e extensão vêm dos bytes do arquivo, nunca do que o cliente declarou
        const tipo = detectarImagem(buffer);
        if (!tipo) {
          app.logger.warn({ pratoId: request.params.id }, "Prato photo rejected: not a JPEG/PNG/WebP image");
          return await reply.code(400).send({ error: "Formato de imagem não suportado. Envie JPEG, PNG ou WebP." });
        }

        const filename = chaveImagemPrato(restauranteId, request.params.id, tipo.ext);

        // Upload to storage
        const uploadedKey = await app.storage.upload(filename, buffer);

        // Get signed URL for client access
        const { url } = await app.storage.getSignedUrl(uploadedKey);

        // Update prato with image URL (never store base64 or data URIs)
        const [updated] = await app.db
          .update(schema.pratos)
          .set({ imagemUrl: url })
          .where(and(eq(schema.pratos.id, request.params.id), eq(schema.pratos.restauranteId, restauranteId)))
          .returning();

        app.logger.info({ pratoId: request.params.id, chave: uploadedKey }, "Prato photo uploaded successfully");

        return await reply.code(200).send({
          id: updated.id,
          url,
          imagem_url: updated.imagemUrl,
        });
      } catch (error) {
        app.logger.error({ err: error, pratoId: request.params.id }, "Failed to upload prato photo");
        return await reply.code(500).send({ error: "Erro ao salvar imagem" });
      }
    }
  );
}
