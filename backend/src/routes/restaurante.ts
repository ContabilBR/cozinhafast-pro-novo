import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";
import { validarRestauranteParaNfce } from "../utils/fiscal-payloads.js";
import { cnpjValido, idEhCnpj } from "../utils/cnpj.js";

// Papéis que podem trocar o modo de comandas do restaurante
const PAPEIS_TROCA_MODO_COMANDA = ["administrador", "admin", "gerente", "manager", "superadmin", "super_admin"];

interface UpdateRestauranteBody {
  nome: string;
  filial?: string;
  endereco?: string;
  cnpj?: string;
  // Dados fiscais
  inscricao_estadual?: string | null;
  inscricao_municipal?: string | null;
  regime_tributario?: string | null;
  cnae_principal?: string | null;
  csc_token?: string | null;
  csc_id?: string | null;
  ambiente_focus?: number;
  ncm_padrao?: string;
  // Endereco estruturado
  cep?: string | null;
  logradouro?: string | null;
  numero_endereco?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigo_municipio_ibge?: number | null;
  uf?: string | null;
  telefone?: string | null;
  email?: string | null;
}

const REGIMES_VALIDOS = ["simples_nacional", "simples_excesso", "regime_normal", "mei"];

const MODOS_COMANDA = ["mesa", "individual"] as const;

const UFS_VALIDAS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

// Rotulos legiveis para os campos exigidos pela NFC-e
const LABELS_CAMPOS: Record<string, string> = {
  cnpj: "CNPJ",
  nome: "Razao social",
  inscricaoEstadual: "Inscricao estadual",
  regimeTributario: "Regime tributario",
  cscToken: "CSC Token (SEFAZ)",
  cscId: "CSC ID",
  cnaePrincipal: "CNAE principal",
  cep: "CEP",
  logradouro: "Logradouro",
  numeroEndereco: "Numero",
  bairro: "Bairro",
  codigoMunicipioIbge: "Codigo IBGE do municipio",
  uf: "UF",
};

function somenteDigitos(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).replace(/\D/g, "");
}

function textoOuNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Valida o body. Retorna mensagem de erro ou null se estiver tudo certo. */
function validarBodyFiscal(body: UpdateRestauranteBody): string | null {
  if (body.regime_tributario !== undefined && body.regime_tributario !== null && body.regime_tributario !== "") {
    if (!REGIMES_VALIDOS.includes(body.regime_tributario)) {
      return "regime_tributario invalido. Valores aceitos: " + REGIMES_VALIDOS.join(", ");
    }
  }
  if (body.uf !== undefined && body.uf !== null && body.uf !== "") {
    if (!UFS_VALIDAS.includes(String(body.uf).toUpperCase())) {
      return "uf invalida";
    }
  }
  if (body.codigo_municipio_ibge !== undefined && body.codigo_municipio_ibge !== null) {
    const n = Number(body.codigo_municipio_ibge);
    if (!Number.isInteger(n) || String(n).length !== 7) {
      return "codigo_municipio_ibge deve ser um inteiro de 7 digitos";
    }
  }
  if (body.ambiente_focus !== undefined && body.ambiente_focus !== null) {
    const n = Number(body.ambiente_focus);
    if (n !== 1 && n !== 2) {
      return "ambiente_focus deve ser 1 (producao) ou 2 (homologacao)";
    }
  }
  if (body.cnpj !== undefined && body.cnpj !== null && body.cnpj !== "") {
    const d = somenteDigitos(body.cnpj);
    if (d && d.length !== 14) return "cnpj deve ter 14 digitos";
    if (d && !cnpjValido(d)) return "cnpj inválido (dígitos verificadores não conferem)";
  }
  if (body.cep !== undefined && body.cep !== null && body.cep !== "") {
    const d = somenteDigitos(body.cep);
    if (d && d.length !== 8) return "cep deve ter 8 digitos";
  }
  if (body.ncm_padrao !== undefined && body.ncm_padrao !== null && body.ncm_padrao !== "") {
    const d = somenteDigitos(body.ncm_padrao);
    if (d && d.length !== 8) return "ncm_padrao deve ter 8 digitos";
  }
  return null;
}

/** Monta o objeto de resposta. Nunca inclui csc_token. */
function serializar(r: any) {
  return {
    id: r.id,
    nome: r.nome,
    filial: r.filial,
    endereco: r.endereco,
    cnpj: r.cnpj,
    inscricao_estadual: r.inscricaoEstadual,
    inscricao_municipal: r.inscricaoMunicipal,
    regime_tributario: r.regimeTributario,
    cnae_principal: r.cnaePrincipal,
    csc_configurado: !!(r.cscToken && r.cscId),
    csc_id: r.cscId,
    ambiente_focus: r.ambienteFocus,
    ncm_padrao: r.ncmPadrao,
    cep: r.cep,
    logradouro: r.logradouro,
    numero_endereco: r.numeroEndereco,
    complemento: r.complemento,
    bairro: r.bairro,
    codigo_municipio_ibge: r.codigoMunicipioIbge,
    uf: r.uf,
    telefone: r.telefone,
    email: r.email,
    modo_comanda: r.modoComanda,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

const RESTAURANTE_PROPS = {
  id: { type: "string" },
  nome: { type: "string" },
  filial: { type: "string", nullable: true },
  endereco: { type: "string", nullable: true },
  cnpj: { type: "string", nullable: true },
  inscricao_estadual: { type: "string", nullable: true },
  inscricao_municipal: { type: "string", nullable: true },
  regime_tributario: { type: "string", nullable: true },
  cnae_principal: { type: "string", nullable: true },
  csc_configurado: { type: "boolean" },
  csc_id: { type: "string", nullable: true },
  ambiente_focus: { type: "integer" },
  ncm_padrao: { type: "string", nullable: true },
  cep: { type: "string", nullable: true },
  logradouro: { type: "string", nullable: true },
  numero_endereco: { type: "string", nullable: true },
  complemento: { type: "string", nullable: true },
  bairro: { type: "string", nullable: true },
  codigo_municipio_ibge: { type: ["integer", "null"] },
  uf: { type: "string", nullable: true },
  telefone: { type: "string", nullable: true },
  email: { type: "string", nullable: true },
  modo_comanda: { type: "string", enum: ["mesa", "individual"] },
  created_at: { type: "string", format: "date-time" },
  updated_at: { type: "string", format: "date-time" },
} as const;

const BODY_PROPS = {
  nome: { type: "string" },
  filial: { type: "string", nullable: true },
  endereco: { type: "string", nullable: true },
  cnpj: { type: "string", nullable: true },
  inscricao_estadual: { type: "string", nullable: true },
  inscricao_municipal: { type: "string", nullable: true },
  regime_tributario: { type: "string", nullable: true },
  cnae_principal: { type: "string", nullable: true },
  csc_token: { type: "string", nullable: true },
  csc_id: { type: "string", nullable: true },
  ambiente_focus: { type: "integer" },
  ncm_padrao: { type: "string", nullable: true },
  cep: { type: "string", nullable: true },
  logradouro: { type: "string", nullable: true },
  numero_endereco: { type: "string", nullable: true },
  complemento: { type: "string", nullable: true },
  bairro: { type: "string", nullable: true },
  codigo_municipio_ibge: { type: ["integer", "null"] },
  uf: { type: "string", nullable: true },
  telefone: { type: "string", nullable: true },
  email: { type: "string", nullable: true },
} as const;

export function registerRestauranteRoutes(app: App) {
  // GET /api/restaurante
  app.fastify.get(
    "/api/restaurante",
    {
      schema: {
        description: "Get restaurant information including fiscal config (csc_token never returned)",
        tags: ["restaurante"],
        response: {
          200: { description: "OK", type: "object", properties: RESTAURANTE_PROPS },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          app.logger.warn({}, "User has no tenant for get operation");
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        app.logger.info({ tenantId }, "Getting restaurante info");

        const result = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId))
          .limit(1);

        if (result.length === 0) {
          app.logger.info({ tenantId }, "No restaurante record found");
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        return await reply.code(200).send(serializar(result[0]));
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get restaurante info");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/restaurante/fiscal/status - diagnostico de prontidao para NFC-e
  app.fastify.get(
    "/api/restaurante/fiscal/status",
    {
      schema: {
        description: "Check whether the restaurant is fully configured to emit NFC-e",
        tags: ["restaurante", "fiscal"],
        response: {
          200: {
            type: "object",
            properties: {
              pronto_para_nfce: { type: "boolean" },
              campos_faltantes: { type: "array", items: { type: "string" } },
              campos_faltantes_labels: { type: "array", items: { type: "string" } },
              ambiente_focus: { type: "integer" },
              ambiente_label: { type: "string" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        const result = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId))
          .limit(1);

        if (result.length === 0) {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        const r = result[0] as any;
        const validacao = validarRestauranteParaNfce(r);
        const ambiente = r.ambienteFocus ?? 2;

        return await reply.code(200).send({
          pronto_para_nfce: validacao.ok,
          campos_faltantes: validacao.camposFaltantes,
          campos_faltantes_labels: validacao.camposFaltantes.map(
            (c: string) => LABELS_CAMPOS[c] || c
          ),
          ambiente_focus: ambiente,
          ambiente_label: ambiente === 1 ? "producao" : "homologacao",
        });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get fiscal status");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /api/restaurante/modo-comanda - modo de controle de comandas do restaurante
  app.fastify.get(
    "/api/restaurante/modo-comanda",
    {
      schema: {
        description: "Get the comanda mode of the restaurant (mesa or individual)",
        tags: ["restaurante"],
        response: {
          200: {
            type: "object",
            properties: { modo_comanda: { type: "string", enum: ["mesa", "individual"] } },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        const result = await app.db
          .select({ modoComanda: schema.restaurante.modoComanda })
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId))
          .limit(1);

        if (result.length === 0) {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        return await reply.code(200).send({ modo_comanda: result[0].modoComanda });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to get modo_comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/restaurante/modo-comanda - administrador, admin ou gerente alteram; bloqueado com comanda de mesa aberta
  app.fastify.put<{ Body: { modo_comanda: string } }>(
    "/api/restaurante/modo-comanda",
    {
      schema: {
        description: "Change the comanda mode of the restaurant (administrador, admin or gerente; blocked while there are open mesa comandas)",
        tags: ["restaurante"],
        body: { type: "object", required: ["modo_comanda"], properties: { modo_comanda: { type: "string" } } },
        response: {
          200: {
            type: "object",
            properties: { modo_comanda: { type: "string", enum: ["mesa", "individual"] } },
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
      request: FastifyRequest<{ Body: { modo_comanda: string } }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      // Papel normalizado (sem espaços e sem diferenciar maiúsculas). Quando recusa, registra no log
      // o papel que o servidor viu, para o motivo ficar visível se acontecer de novo.
      const papel = String(authUser.role ?? "").trim().toLowerCase();
      if (!PAPEIS_TROCA_MODO_COMANDA.includes(papel)) {
        app.logger.warn(
          { userId: authUser.id, papel, permitidos: PAPEIS_TROCA_MODO_COMANDA },
          "modo_comanda: troca recusada, papel sem permissão"
        );
        return await reply.code(403).send({ error: "Você não tem permissão para esta ação." });
      }

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        const novoModo = request.body.modo_comanda;
        if (!(MODOS_COMANDA as readonly string[]).includes(novoModo)) {
          return await reply.code(400).send({ error: "modo_comanda invalido. Valores aceitos: " + MODOS_COMANDA.join(", ") });
        }

        const atual = await app.db
          .select({ modoComanda: schema.restaurante.modoComanda })
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId))
          .limit(1);

        if (atual.length === 0) {
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        // Mesmo modo: nada a fazer
        if (atual[0].modoComanda === novoModo) {
          return await reply.code(200).send({ modo_comanda: novoModo });
        }

        // Comandas de delivery não entram na conta: só as de mesa travam a troca
        const abertas = await app.db
          .select({ id: schema.comandas.id })
          .from(schema.comandas)
          .where(
            and(
              eq(schema.comandas.restauranteId, tenantId),
              eq(schema.comandas.status, "aberta" as any),
              eq(schema.comandas.tipo, "mesa" as any)
            )
          )
          .limit(1);

        if (abertas.length > 0) {
          app.logger.warn({ tenantId }, "Cannot change modo_comanda with open mesa comandas");
          return await reply
            .code(409)
            .send({ error: "Feche ou cancele as comandas abertas antes de mudar o modo de comanda." });
        }

        await app.db
          .update(schema.restaurante)
          .set({ modoComanda: novoModo as any, updatedAt: new Date() })
          .where(eq(schema.restaurante.id, tenantId));

        app.logger.info({ tenantId, de: atual[0].modoComanda, para: novoModo }, "modo_comanda changed");

        return await reply.code(200).send({ modo_comanda: novoModo });
      } catch (error) {
        app.logger.error({ err: error }, "Failed to change modo_comanda");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/restaurante - atualizacao parcial nos campos fiscais
  app.fastify.put<{ Body: UpdateRestauranteBody }>(
    "/api/restaurante",
    {
      schema: {
        description: "Update restaurant information and fiscal config (partial for fiscal fields)",
        tags: ["restaurante"],
        body: { type: "object", required: ["nome"], properties: BODY_PROPS },
        response: {
          200: { description: "OK", type: "object", properties: RESTAURANTE_PROPS },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: UpdateRestauranteBody }>,
      reply: FastifyReply
    ) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          app.logger.warn({}, "User has no tenant for put operation");
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        const body = request.body;

        if (!body.nome) {
          return await reply.code(400).send({ error: "nome e obrigatorio" });
        }

        const erroValidacao = validarBodyFiscal(body);
        if (erroValidacao) {
          return await reply.code(400).send({ error: erroValidacao });
        }

        const existing = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId));

        if (existing.length === 0) {
          app.logger.warn({ tenantId }, "Tenant restaurante not found for update");
          return await reply.code(404).send({ error: "Restaurante not found" });
        }

        // Campos legados: comportamento original preservado
        const updates: any = {
          nome: body.nome,
          filial: body.filial,
          endereco: body.endereco,
          updatedAt: new Date(),
        };

        if (body.cnpj !== undefined) {
          const novoCnpj = somenteDigitos(body.cnpj);
          // O id do restaurante É o CNPJ: depois de criado, ele não pode mudar.
          if (idEhCnpj(tenantId)) {
            if (novoCnpj && novoCnpj !== tenantId) {
              return await reply.code(400).send({ error: "O CNPJ é o identificador do restaurante e não pode ser alterado" });
            }
            updates.cnpj = tenantId;
          } else {
            updates.cnpj = novoCnpj;
          }
        }

        // Campos fiscais: parcial - so aplica o que veio no body
        if (body.inscricao_estadual !== undefined) updates.inscricaoEstadual = somenteDigitos(body.inscricao_estadual);
        if (body.inscricao_municipal !== undefined) updates.inscricaoMunicipal = somenteDigitos(body.inscricao_municipal);
        if (body.regime_tributario !== undefined) updates.regimeTributario = textoOuNull(body.regime_tributario);
        if (body.cnae_principal !== undefined) updates.cnaePrincipal = somenteDigitos(body.cnae_principal);
        if (body.csc_token !== undefined) updates.cscToken = textoOuNull(body.csc_token);
        if (body.csc_id !== undefined) updates.cscId = textoOuNull(body.csc_id);
        if (body.ambiente_focus !== undefined) updates.ambienteFocus = Number(body.ambiente_focus);
        if (body.ncm_padrao !== undefined) updates.ncmPadrao = somenteDigitos(body.ncm_padrao) || "21069090";

        if (body.cep !== undefined) updates.cep = somenteDigitos(body.cep);
        if (body.logradouro !== undefined) updates.logradouro = textoOuNull(body.logradouro);
        if (body.numero_endereco !== undefined) updates.numeroEndereco = textoOuNull(body.numero_endereco);
        if (body.complemento !== undefined) updates.complemento = textoOuNull(body.complemento);
        if (body.bairro !== undefined) updates.bairro = textoOuNull(body.bairro);
        if (body.codigo_municipio_ibge !== undefined) {
          updates.codigoMunicipioIbge = body.codigo_municipio_ibge === null ? null : Number(body.codigo_municipio_ibge);
        }
        if (body.uf !== undefined) updates.uf = body.uf ? String(body.uf).toUpperCase() : null;
        if (body.telefone !== undefined) updates.telefone = somenteDigitos(body.telefone);
        if (body.email !== undefined) updates.email = textoOuNull(body.email);

        app.logger.info(
          { tenantId, camposAtualizados: Object.keys(updates).length },
          "Upserting restaurante"
        );

        const [updated] = await app.db
          .update(schema.restaurante)
          .set(updates)
          .where(eq(schema.restaurante.id, tenantId))
          .returning();

        app.logger.info({ restauranteId: updated.id }, "Restaurante updated successfully");

        return await reply.code(200).send(serializar(updated));
      } catch (error) {
        app.logger.error({ err: error }, "Failed to upsert restaurante");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/restaurante
  app.fastify.delete(
    "/api/restaurante",
    {
      schema: {
        description: "Delete restaurant information (requires authentication)",
        tags: ["restaurante"],
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
          400: { type: "object", properties: { error: { type: "string" } } },
          401: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authUser = await customRequireAuth(app, request, reply);
      if (!authUser) return;
      if (!(await requireRole(authUser, ["administrador", "gerente"], reply))) return;

      try {
        let tenantId: string;
        try {
          tenantId = requireTenant(authUser);
        } catch {
          app.logger.warn({}, "User has no tenant for delete operation");
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        app.logger.info({ tenantId }, "Deleting restaurante");

        const existing = await app.db
          .select()
          .from(schema.restaurante)
          .where(eq(schema.restaurante.id, tenantId as any))
          .limit(1);

        if (!existing || existing.length === 0) {
          app.logger.warn({ tenantId }, "Restaurante not found for deletion");
          return await reply.code(404).send({ error: "Nenhum dado cadastrado" });
        }

        let deleteError: any = null;
        try {
          await app.db
            .delete(schema.restaurante)
            .where(eq(schema.restaurante.id, tenantId as any));
        } catch (err: any) {
          deleteError = err;
        }

        if (deleteError) {
          const errorStr = JSON.stringify(deleteError).toLowerCase();
          const message = String(deleteError?.message || "").toLowerCase();
          const detail = String(deleteError?.detail || "").toLowerCase();
          const code = deleteError?.code;

          const isFKError = code === '23503' ||
                           code === 23503 ||
                           message.includes('foreign key') ||
                           message.includes('violates') ||
                           detail.includes('foreign key') ||
                           detail.includes('restrict') ||
                           errorStr.includes('foreign key') ||
                           errorStr.includes('still referenced');

          if (isFKError) {
            app.logger.warn({ tenantId }, "Cannot delete restaurante - has dependent records");
            return await reply.code(400).send({ error: "Nao e possivel deletar restaurante com registros relacionados" });
          }

          app.logger.error({ err: deleteError, code, message }, "Delete failed with non-FK error");
          throw deleteError;
        }

        app.logger.info({ restauranteId: tenantId }, "Restaurante deleted successfully");
        return await reply.code(200).send({ success: true });
      } catch (error: any) {
        app.logger.error({ err: error }, "Failed to delete restaurante");
        return await reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

}
