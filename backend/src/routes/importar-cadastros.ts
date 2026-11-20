import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../db/schema/schema.js";
import type { App } from "../index.js";
import { registrarCustoInsumo } from "../db/historico-custo.js";
import { requireAuth as customRequireAuth, requireTenant, requireRole } from "../utils/auth.js";

const LIMITE_LINHAS = 500;
const TAMANHO_MAX_NOME = 120;
const UNIDADES_VALIDAS = ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"];

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function vazio(v: any): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function primeiro(obj: any, ...chaves: string[]): any {
  for (const c of chaves) {
    if (obj[c] !== undefined) return obj[c];
  }
  return undefined;
}

// Aceita vírgula ou ponto como separador decimal, sem separador de milhar.
function lerDecimal(
  valor: any,
  casas: number,
  minimo: "positivo" | "zero",
  maximo: number
): { ok: boolean; texto: string; numero: number } {
  const falha = { ok: false, texto: "", numero: 0 };
  let s = "";
  if (typeof valor === "number") {
    if (!isFinite(valor)) return falha;
    s = String(valor);
  } else if (typeof valor === "string") {
    s = valor.trim();
  } else {
    return falha;
  }
  if (s.length === 0 || s.length > 30) return falha;
  const re = new RegExp("^[0-9]+([.,][0-9]{1," + casas + "})?$");
  if (!re.test(s)) return falha;
  const texto = s.replace(",", ".");
  const numero = parseFloat(texto);
  if (!isFinite(numero) || numero > maximo) return falha;
  if (minimo === "positivo" && !(numero > 0)) return falha;
  if (minimo === "zero" && numero < 0) return falha;
  return { ok: true, texto, numero };
}

function lerNome(valor: any): { ok: boolean; nome: string; erro?: string } {
  if (typeof valor !== "string" && typeof valor !== "number") {
    return { ok: false, nome: "", erro: "Nome obrigatório." };
  }
  const nome = String(valor).trim();
  if (nome.length === 0) return { ok: false, nome: "", erro: "Nome obrigatório." };
  if (nome.length > TAMANHO_MAX_NOME) {
    return { ok: false, nome, erro: `Nome muito longo (máximo ${TAMANHO_MAX_NOME} caracteres).` };
  }
  return { ok: true, nome };
}

function agrupar(itens: any[]): Map<string, any[]> {
  const mapa = new Map<string, any[]>();
  for (const it of itens) {
    const k = normalizarNome(it.nome);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(it);
  }
  return mapa;
}

async function carregarDados(conexao: any, restauranteId: string) {
  const categorias: any = await conexao
    .select({ id: schema.categorias.id, nome: schema.categorias.nome, createdAt: schema.categorias.createdAt })
    .from(schema.categorias)
    .where(eq(schema.categorias.restauranteId, restauranteId));
  const pratos: any = await conexao
    .select({ id: schema.pratos.id, nome: schema.pratos.nome })
    .from(schema.pratos)
    .where(eq(schema.pratos.restauranteId, restauranteId));
  const insumos: any = await conexao
    .select({
      id: schema.insumos.id,
      nome: schema.insumos.nome,
      unidade: schema.insumos.unidade,
      ativo: schema.insumos.ativo,
    })
    .from(schema.insumos)
    .where(eq(schema.insumos.restauranteId, restauranteId));
  const vinculos: any = await conexao
    .select({
      id: schema.pratoInsumos.id,
      pratoId: schema.pratoInsumos.pratoId,
      insumoId: schema.pratoInsumos.insumoId,
      quantidadeUsada: schema.pratoInsumos.quantidadeUsada,
    })
    .from(schema.pratoInsumos)
    .where(eq(schema.pratoInsumos.restauranteId, restauranteId));
  if (!Array.isArray(categorias) || !Array.isArray(pratos) || !Array.isArray(insumos) || !Array.isArray(vinculos)) {
    throw new Error("Resultado inesperado do banco");
  }
  // Categoria mais antiga primeiro, para escolher sempre a mesma quando houver nomes repetidos
  categorias.sort((a: any, b: any) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  return { categorias, pratos, insumos, vinculos };
}

function planejar(listas: { pratos: any[]; insumos: any[]; fichas: any[] }, dados: any) {
  const catDb = agrupar(dados.categorias);
  const pratosDb = agrupar(dados.pratos);
  const insumosDb = agrupar(dados.insumos);
  const vinculoPorPar = new Map<string, any>();
  for (const v of dados.vinculos) vinculoPorPar.set(`${v.pratoId}|${v.insumoId}`, v);

  // ---------- Pratos ----------
  const pratosRes: any[] = [];
  const pratosLista = new Map<string, any>();
  const pratosNovos: any[] = [];
  const categoriasNovas = new Map<string, string>(); // norm -> nome
  const rPratos = { total: listas.pratos.length, novas: 0, ja_existem: 0, com_erro: 0 };

  listas.pratos.forEach((linha: any, idx: number) => {
    const n = idx + 1;
    const erro = (mensagem: string) => {
      pratosRes.push({ linha: n, status: "erro", mensagem });
      rPratos.com_erro++;
    };
    const nm = lerNome(primeiro(linha, "nome", "prato"));
    if (!nm.ok) return erro(nm.erro || "Nome inválido.");
    const norm = normalizarNome(nm.nome);
    const anterior = pratosLista.get(norm);
    if (anterior) return erro(`Nome repetido; primeira ocorrência na linha ${anterior.linha}.`);
    const entrada: any = { linha: n, norm, nome: nm.nome, status: "erro", id: null };
    pratosLista.set(norm, entrada);

    const preco = lerDecimal(primeiro(linha, "preco", "preço"), 2, "positivo", 99999999.99);
    if (!preco.ok) return erro("Preço inválido.");

    let categoriaNome: string | null = null;
    const catBruta = primeiro(linha, "categoria");
    if (!vazio(catBruta)) {
      if (typeof catBruta !== "string" && typeof catBruta !== "number") return erro("Categoria inválida.");
      categoriaNome = String(catBruta).trim();
      if (categoriaNome.length > TAMANHO_MAX_NOME) return erro("Categoria inválida.");
    }

    let descricao: string | null = null;
    const descBruta = primeiro(linha, "descricao", "descrição");
    if (!vazio(descBruta)) {
      if (typeof descBruta !== "string") return erro("Descrição inválida.");
      descricao = descBruta.trim();
    }

    let tempo: number | null = null;
    const tempoBruto = primeiro(linha, "tempo_preparo", "tempoPreparo", "tempo_preparo_min", "tempoPreparoMinutos");
    if (!vazio(tempoBruto)) {
      const ts = typeof tempoBruto === "number" ? String(tempoBruto) : typeof tempoBruto === "string" ? tempoBruto.trim() : "";
      if (!/^[0-9]{1,4}$/.test(ts)) return erro("Tempo de preparo inválido.");
      tempo = parseInt(ts, 10);
      if (tempo < 1 || tempo > 600) return erro("Tempo de preparo inválido.");
    }

    const existentes = pratosDb.get(norm) || [];
    if (existentes.length > 1) return erro("Nome de prato ambíguo.");
    if (existentes.length === 1) {
      entrada.status = "existe";
      entrada.id = existentes[0].id;
      pratosRes.push({ linha: n, status: "ja_existe", mensagem: "Já existe" });
      rPratos.ja_existem++;
      return;
    }

    entrada.status = "nova";
    let catNorm: string | null = null;
    if (categoriaNome) {
      catNorm = normalizarNome(categoriaNome);
      if (!catDb.has(catNorm) && !categoriasNovas.has(catNorm)) {
        categoriasNovas.set(catNorm, categoriaNome.replace(/\s+/g, " "));
      }
    }
    pratosNovos.push({ entrada, nome: nm.nome, descricao, preco: preco.texto, tempo, catNorm });
    pratosRes.push({ linha: n, status: "nova", mensagem: "Será cadastrado." });
    rPratos.novas++;
  });

  // ---------- Insumos ----------
  const insumosRes: any[] = [];
  const insumosLista = new Map<string, any>();
  const insumosNovos: any[] = [];
  const rInsumos = { total: listas.insumos.length, novas: 0, ja_existem: 0, com_erro: 0 };

  listas.insumos.forEach((linha: any, idx: number) => {
    const n = idx + 1;
    const erro = (mensagem: string) => {
      insumosRes.push({ linha: n, status: "erro", mensagem });
      rInsumos.com_erro++;
    };
    const nm = lerNome(primeiro(linha, "nome", "insumo"));
    if (!nm.ok) return erro(nm.erro || "Nome inválido.");
    const norm = normalizarNome(nm.nome);
    const anterior = insumosLista.get(norm);
    if (anterior) return erro(`Nome repetido; primeira ocorrência na linha ${anterior.linha}.`);
    const entrada: any = { linha: n, norm, nome: nm.nome, status: "erro", id: null };
    insumosLista.set(norm, entrada);

    const unBruta = primeiro(linha, "unidade");
    if (typeof unBruta !== "string") return erro("Unidade inválida.");
    const unidade = unBruta.trim().toLowerCase();
    if (!UNIDADES_VALIDAS.includes(unidade)) return erro("Unidade inválida.");

    let custo = "0";
    const custoBruto = primeiro(linha, "custo_unitario", "custoUnitario", "custo");
    if (!vazio(custoBruto)) {
      const c = lerDecimal(custoBruto, 2, "zero", 99999999.99);
      if (!c.ok) return erro("Custo unitário inválido.");
      custo = c.texto;
    }

    let minimo = "0";
    const minBruto = primeiro(linha, "estoque_minimo", "estoqueMinimo");
    if (!vazio(minBruto)) {
      const m = lerDecimal(minBruto, 3, "zero", 9999999.999);
      if (!m.ok) return erro("Estoque mínimo inválido.");
      minimo = m.texto;
    }

    const existentes = insumosDb.get(norm) || [];
    if (existentes.length > 1) return erro("Nome de insumo ambíguo.");
    if (existentes.length === 1) {
      const ex = existentes[0];
      if (String(ex.unidade).toLowerCase() !== unidade) return erro(`Unidade diferente da cadastrada: ${ex.unidade}.`);
      if (ex.ativo !== true) return erro("Insumo inativo.");
      entrada.status = "existe";
      entrada.id = ex.id;
      insumosRes.push({ linha: n, status: "ja_existe", mensagem: "Já existe" });
      rInsumos.ja_existem++;
      return;
    }

    entrada.status = "nova";
    insumosNovos.push({ entrada, nome: nm.nome, unidade, custo, minimo });
    insumosRes.push({ linha: n, status: "nova", mensagem: "Será cadastrado." });
    rInsumos.novas++;
  });

  // ---------- Fichas ----------
  const fichasRes: any[] = [];
  const fichasNovas: any[] = [];
  const fichasAtualizam: any[] = [];
  const paresVistos = new Map<string, number>();
  const rFichas = { total: listas.fichas.length, novas: 0, atualizam: 0, sem_alteracao: 0, com_erro: 0 };

  listas.fichas.forEach((linha: any, idx: number) => {
    const n = idx + 1;
    const erro = (mensagem: string) => {
      fichasRes.push({ linha: n, status: "erro", mensagem });
      rFichas.com_erro++;
    };
    const np = lerNome(primeiro(linha, "prato", "nome_prato", "nomePrato"));
    if (!np.ok) return erro("Nome do prato inválido.");
    const ni = lerNome(primeiro(linha, "insumo", "nome_insumo", "nomeInsumo"));
    if (!ni.ok) return erro("Nome do insumo inválido.");
    const q = lerDecimal(primeiro(linha, "quantidade"), 3, "positivo", 1000000);
    if (!q.ok) return erro("Quantidade inválida.");

    const pNorm = normalizarNome(np.nome);
    const iNorm = normalizarNome(ni.nome);

    // Prato
    let pratoRef: any = null;
    let pratoDep = false;
    const pLista = pratosLista.get(pNorm);
    if (pLista) {
      if (pLista.status === "erro") pratoDep = true;
      else pratoRef = pLista;
    } else {
      const ex = pratosDb.get(pNorm) || [];
      if (ex.length === 0) return erro("Prato não encontrado.");
      if (ex.length > 1) return erro("Nome de prato ambíguo.");
      pratoRef = { id: ex[0].id, status: "existe" };
    }

    // Insumo
    let insumoRef: any = null;
    let insumoDep = false;
    const iLista = insumosLista.get(iNorm);
    if (iLista) {
      if (iLista.status === "erro") insumoDep = true;
      else insumoRef = iLista;
    } else {
      const ex = insumosDb.get(iNorm) || [];
      if (ex.length === 0) return erro("Insumo não encontrado.");
      if (ex.length > 1) return erro("Nome de insumo ambíguo.");
      if (ex[0].ativo !== true) return erro("Insumo inativo.");
      insumoRef = { id: ex[0].id, status: "existe" };
    }

    if (pratoDep || insumoDep) return erro("Depende de uma linha com erro.");

    const par = `${pNorm}|${iNorm}`;
    const primeiraLinha = paresVistos.get(par);
    if (primeiraLinha !== undefined) return erro(`Repetida no arquivo; primeira ocorrência na linha ${primeiraLinha}.`);
    paresVistos.set(par, n);

    if (pratoRef.id && insumoRef.id) {
      const ex = vinculoPorPar.get(`${pratoRef.id}|${insumoRef.id}`);
      if (ex) {
        const atual = parseFloat(ex.quantidadeUsada);
        if (Math.abs(atual - q.numero) < 1e-9) {
          fichasRes.push({ linha: n, status: "sem_alteracao", mensagem: "Sem alteração.", quantidade_atual: atual });
          rFichas.sem_alteracao++;
        } else {
          fichasRes.push({
            linha: n,
            status: "atualiza",
            mensagem: "Quantidade será atualizada.",
            quantidade_atual: atual,
            quantidade_solicitada: q.numero,
          });
          fichasAtualizam.push({ vinculoId: ex.id, qtd: q.texto });
          rFichas.atualizam++;
        }
        return;
      }
    }
    fichasRes.push({ linha: n, status: "nova", mensagem: "Será ligada.", quantidade_solicitada: q.numero });
    fichasNovas.push({ pratoRef, insumoRef, qtd: q.texto });
    rFichas.novas++;
  });

  const nomesCategorias = Array.from(categoriasNovas.values());
  const comErro = rPratos.com_erro + rInsumos.com_erro + rFichas.com_erro;
  const resumo = {
    total: rPratos.total + rInsumos.total + rFichas.total,
    com_erro: comErro,
    pratos_novos: rPratos.novas,
    insumos_novos: rInsumos.novas,
    categorias_novas: nomesCategorias.length,
    fichas_novas: rFichas.novas,
    fichas_atualizadas: rFichas.atualizam,
  };

  const resposta = {
    resumo,
    categorias: { novas: nomesCategorias.length, nomes: nomesCategorias },
    pratos: { resumo: rPratos, resultados: pratosRes },
    insumos: { resumo: rInsumos, resultados: insumosRes },
    fichas: { resumo: rFichas, resultados: fichasRes },
  };

  return { resposta, comErro, categoriasNovas, pratosNovos, insumosNovos, fichasNovas, fichasAtualizam };
}

export function registerImportarCadastrosRoutes(app: App) {
  const db = app.db as any;

  // POST /api/estoque/cadastros/importar — importação de pratos, insumos, categorias e fichas técnicas
  app.fastify.post(
    "/api/estoque/cadastros/importar",
    { schema: {} } as any,
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const session = await customRequireAuth(app, request, reply);
        if (!session) return;
        if (!(await requireRole(session, ["gerente", "administrador", "admin"], reply))) return;
        const restauranteId = requireTenant(session);
        const body: any = request.body;

        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return await reply.code(400).send({ error: "Body deve ser um objeto." });
        }
        if (body.confirmar !== undefined && typeof body.confirmar !== "boolean") {
          return await reply.code(400).send({ error: "confirmar deve ser booleano." });
        }
        if (body.ignorar_erros !== undefined && typeof body.ignorar_erros !== "boolean") {
          return await reply.code(400).send({ error: "ignorar_erros deve ser booleano." });
        }
        const confirmar = body.confirmar === true;
        const ignorarErros = body.ignorar_erros === true;

        const listas: any = {};
        const rotulos: any = { pratos: "pratos", insumos: "insumos", fichas: "fichas" };
        for (const chave of ["pratos", "insumos", "fichas"]) {
          const valor = body[chave];
          if (valor === undefined) {
            listas[chave] = [];
            continue;
          }
          if (!Array.isArray(valor)) {
            return await reply.code(400).send({ error: `${rotulos[chave]} deve ser um array.` });
          }
          if (valor.length > LIMITE_LINHAS) {
            return await reply.code(400).send({ error: `${rotulos[chave]} deve ter no máximo ${LIMITE_LINHAS} elementos.` });
          }
          for (let i = 0; i < valor.length; i++) {
            const l = valor[i];
            if (!l || typeof l !== "object" || Array.isArray(l)) {
              return await reply.code(400).send({ error: `${rotulos[chave]}, linha ${i + 1}: deve ser um objeto.` });
            }
          }
          listas[chave] = valor;
        }
        if (listas.pratos.length + listas.insumos.length + listas.fichas.length < 1) {
          return await reply.code(400).send({ error: "Envie ao menos uma linha em pratos, insumos ou fichas." });
        }

        app.logger.info(
          {
            confirmar,
            ignorar_erros: ignorarErros,
            pratos: listas.pratos.length,
            insumos: listas.insumos.length,
            fichas: listas.fichas.length,
          },
          "Iniciando importação de cadastros"
        );

        const dados = await carregarDados(db, restauranteId);
        const plano = planejar(listas, dados);

        if (!confirmar) {
          return await reply.code(200).send(plano.resposta);
        }

        const corpoConflito = (resposta: any, mensagem: string) => ({
          conflito: true,
          ...resposta,
          mensagem,
        });

        if (plano.comErro > 0 && !ignorarErros) {
          app.logger.info({ com_erro: plano.comErro }, "Importação de cadastros abortada: há erros");
          return await reply.code(409).send(
            corpoConflito(plano.resposta, "Há linhas com erro. Corrija ou escolha ignorar as linhas com erro.")
          );
        }

        const saida: any = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${restauranteId})::bigint)`);

          // Reconferência dentro da transação
          const dadosTx = await carregarDados(tx, restauranteId);
          const p = planejar(listas, dadosTx);

          if (JSON.stringify(p.resposta) !== JSON.stringify(plano.resposta)) {
            return {
              conflito: corpoConflito(
                p.resposta,
                "Os dados mudaram desde a conferência. Confira novamente antes de importar."
              ),
            };
          }
          if (p.comErro > 0 && !ignorarErros) {
            return {
              conflito: corpoConflito(p.resposta, "Há linhas com erro. Corrija ou escolha ignorar as linhas com erro."),
            };
          }

          const criados = { categorias: 0, pratos: 0, insumos: 0, fichas: 0 };
          const atualizados = { fichas: 0 };

          // 1. Categorias
          const categoriaIdPorNorm = new Map<string, string>();
          for (const c of dadosTx.categorias) {
            const k = normalizarNome(c.nome);
            if (!categoriaIdPorNorm.has(k)) categoriaIdPorNorm.set(k, c.id);
          }
          for (const [norm, nome] of Array.from(p.categoriasNovas.entries())) {
            const [ins] = await tx
              .insert(schema.categorias)
              .values({ nome, restauranteId })
              .returning({ id: schema.categorias.id });
            if (!ins || !ins.id) throw new Error("INSERT_CATEGORIA_INESPERADO");
            categoriaIdPorNorm.set(norm, ins.id);
            criados.categorias++;
          }

          // 2. Pratos (campos fiscais ficam com os padrões do cadastro; NCM não é preenchido)
          for (const np of p.pratosNovos) {
            const valores: any = {
              nome: np.nome,
              descricao: np.descricao,
              preco: np.preco,
              categoriaId: np.catNorm ? categoriaIdPorNorm.get(np.catNorm) || null : null,
              disponivel: true,
              tempoPreparoMinutos: np.tempo,
              restauranteId,
              cfop: "5102",
              origemMercadoria: 0,
              unidadeComercial: "UN",
            };
            const [ins] = await tx.insert(schema.pratos).values(valores).returning({ id: schema.pratos.id });
            if (!ins || !ins.id) throw new Error("INSERT_PRATO_INESPERADO");
            np.entrada.id = ins.id;
            criados.pratos++;
          }

          // 3. Insumos (ativos, estoque atual zero, sem movimentação)
          for (const ni of p.insumosNovos) {
            const valores: any = {
              nome: ni.nome,
              unidade: ni.unidade,
              custoUnitario: ni.custo,
              estoqueMinimo: ni.minimo,
              estoqueAtual: "0",
              ativo: true,
              restauranteId,
            };
            const [ins] = await tx.insert(schema.insumos).values(valores).returning({ id: schema.insumos.id });
            if (!ins || !ins.id) throw new Error("INSERT_INSUMO_INESPERADO");
            await registrarCustoInsumo(tx, {
              restauranteId, insumoId: ins.id, custo: ni.custo,
              usuarioId: (session as any).id || null, origem: "importacao",
            });
            ni.entrada.id = ins.id;
            criados.insumos++;
          }

          // 4. Vínculos da ficha técnica
          for (const f of p.fichasNovas) {
            const pratoId = f.pratoRef.id;
            const insumoId = f.insumoRef.id;
            if (!pratoId || !insumoId) throw new Error("FICHA_SEM_REFERENCIA");
            const [ins] = await tx
              .insert(schema.pratoInsumos)
              .values({ pratoId, insumoId, quantidadeUsada: f.qtd, restauranteId })
              .returning({ id: schema.pratoInsumos.id });
            if (!ins || !ins.id) throw new Error("INSERT_FICHA_INESPERADO");
            criados.fichas++;
          }
          for (const f of p.fichasAtualizam) {
            const atualizado: any = await tx
              .update(schema.pratoInsumos)
              .set({ quantidadeUsada: f.qtd })
              .where(and(eq(schema.pratoInsumos.id, f.vinculoId), eq(schema.pratoInsumos.restauranteId, restauranteId)))
              .returning({ id: schema.pratoInsumos.id });
            if (!Array.isArray(atualizado) || atualizado.length !== 1) throw new Error("UPDATE_FICHA_INESPERADO");
            atualizados.fichas++;
          }

          return { ok: { resposta: p.resposta, criados, atualizados } };
        });

        if (saida.conflito) {
          app.logger.info({}, "Importação de cadastros não gravada: conferência divergente ou erros");
          return await reply.code(409).send(saida.conflito);
        }

        app.logger.info({ criados: saida.ok.criados, atualizados: saida.ok.atualizados }, "Importação de cadastros concluída");
        return await reply.code(200).send({
          ...saida.ok.resposta,
          criados: saida.ok.criados,
          atualizados: saida.ok.atualizados,
        });
      } catch (err: any) {
        if (err && err.statusCode) {
          return await reply.code(err.statusCode).send({ error: err.message });
        }
        app.logger.error({}, "Erro ao importar cadastros");
        return await reply.code(500).send({ error: "Não foi possível processar a importação de cadastros." });
      }
    }
  );
}
