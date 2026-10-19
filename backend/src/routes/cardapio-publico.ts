import { eq, and, sql, not } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import * as schema from "../db/schema/schema.js";
import { checkRateLimit, increment } from "../utils/rate-limit.js";
import { abrirComandaNaMesaComPublicacao, type EntradaAbertura, publicarEventoComandaCriada } from "../services/abrir-comanda.js";
import { lancarItens, publicarEventosPedidosLancados } from "../services/lancamento-pedidos.js";
import { realtimeHub } from "../realtime/hub.js";

const UUID_RE = /^(?:\d{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PRATO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasInvalidLineBreaks(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0d || c === 0x0a || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function registerCardapioPublicoRoutes(app: App) {
  const db = app.db as any;

  app.fastify.get("/cardapio", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply, { routeKey: "cardapio-html", max: 60, windowMs: 60_000 })) return;
    const q = request.query as any;
    const rBruto = typeof q.r === "string" ? q.r : "";
    const mBruto = typeof q.m === "string" ? q.m : "";
    const r = UUID_RE.test(rBruto) ? rBruto : "";
    const m = /^\d{1,6}$/.test(mBruto) ? mBruto : "0";
    let restNome = "Restaurante";
    if (r) {
      try {
        const [rest] = await db.select({ nome: schema.restaurante.nome }).from(schema.restaurante).where(eq(schema.restaurante.id, r));
        if (rest) restNome = rest.nome;
      } catch (_) {}
    }
    const mesaLabel = m !== "0" ? `Mesa ${m}` : "Cardapio Digital";
    const restNomeHtml = escHtml(restNome);
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${restNomeHtml}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#FAF7F4;color:#1a1a1a;max-width:480px;margin:0 auto;padding-bottom:80px}
.hd{background:#E8521A;color:#fff;padding:20px 16px;text-align:center}
.hd h1{font-size:22px}
.hd p{font-size:14px;opacity:.85;margin-top:4px}
.ct{padding:12px 16px;background:rgba(232,82,26,.1);font-size:13px;font-weight:600;color:#E8521A;text-transform:uppercase;position:sticky;top:0;z-index:2}
.it{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:.5px solid #eee;cursor:pointer}
.it:active{background:#f0f0f0}
.pr{font-size:16px;font-weight:700;color:#E8521A;white-space:nowrap;margin-left:12px}
.cr{position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;background:#E8521A;color:#fff;padding:16px;display:none;cursor:pointer;z-index:5}
.md{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10}
.mc{position:absolute;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;background:#fff;border-radius:16px 16px 0 0;padding:20px;max-height:80vh;overflow-y:auto}
.bt{width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;margin-top:12px}
.bp{background:#E8521A;color:#fff}
.bo{background:#fff;border:1.5px solid #E8521A;color:#E8521A}
.qi{display:flex;align-items:center;gap:12px}
.qi button{width:32px;height:32px;border-radius:50%;border:1.5px solid #E8521A;background:#fff;color:#E8521A;font-size:18px;cursor:pointer}
.cart-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:.5px solid #eee}
.cart-total{display:flex;justify-content:space-between;padding:14px 0;font-size:18px;font-weight:700}
.cart-input{width:100%;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;margin-bottom:8px}
.success{text-align:center;padding:40px}
.success h2{color:#22C55E;font-size:22px;margin-top:16px}
.success p{color:#888;margin-top:8px}
.img-prato{width:56px;height:56px;border-radius:8px;object-fit:cover;margin-left:12px;flex-shrink:0}
</style>
</head>
<body>
<div class="hd"><h1>${restNomeHtml}</h1><p>${mesaLabel}</p></div>
<div id="cd"><div style="text-align:center;padding:60px;color:#888">Carregando...</div></div>
<div class="cr" id="cr" onclick="oc()">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="background:#fff;color:#E8521A;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700" id="cc">0</div>
      <span>Ver pedido</span>
    </div>
    <div style="font-size:18px;font-weight:700" id="ctt">R$ 0</div>
  </div>
</div>
<div class="md" id="md" onclick="if(event.target===this)cl()"><div class="mc" id="mc"></div></div>
<script>
var R="${r}",M=${m},D=[],C=[];
function fmt(v){return"R$ "+v.toFixed(2).replace(".",",")}
function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML}
function su(u){try{u=encodeURI(String(u||""))}catch(e){return""}return u.slice(0,8).toLowerCase()==="https://"?u:""}
function init(){
  if(!R){document.getElementById("cd").innerHTML='<div style="text-align:center;padding:60px;color:#c00"><h2>QR Code invalido</h2><p style="margin-top:8px;color:#888">Escaneie o QR Code da mesa para acessar o cardapio.</p></div>';return}
  fetch("/api/public/cardapio/"+R)
    .then(function(r){return r.json()})
    .then(function(d){D=d.cardapio||[];ren()})
    .catch(function(){document.getElementById("cd").innerHTML='<div style="text-align:center;padding:60px;color:#c00">Erro ao carregar o cardapio</div>'})
}
function ren(){
  var h="";
  D.forEach(function(c){
    h+='<div class="ct">'+esc(c.categoria.nome)+'</div>';
    c.pratos.forEach(function(p){
      h+='<div class="it" data-id="'+p.id+'" data-nome="'+esc(p.nome).replace(/"/g,"&quot;")+'" data-preco="'+p.preco+'">';
      h+='<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:500">'+esc(p.nome)+'</div>';
      if(p.descricao)h+='<div style="font-size:12px;color:#888;margin-top:2px">'+esc(p.descricao)+'</div>';
      h+='</div>';
      var iu=su(p.imagemUrl);if(iu)h+='<img class="img-prato" src="'+iu+'" alt="">';
      h+='<div class="pr">'+fmt(p.preco)+'</div></div>';
    })
  });
  document.getElementById("cd").innerHTML=h||'<div style="text-align:center;padding:60px;color:#888">Nenhum prato disponivel</div>';
  document.querySelectorAll(".it").forEach(function(el){
    el.addEventListener("click",function(){
      ad(el.dataset.id,el.dataset.nome,parseFloat(el.dataset.preco));
    })
  })
}
function ad(id,n,p){var e=C.find(function(i){return i.id===id});if(e)e.q++;else C.push({id:id,n:n,p:p,q:1});uc()}
function uc(){var t=0,c=0;C.forEach(function(i){t+=i.p*i.q;c+=i.q});document.getElementById("cr").style.display=c>0?"block":"none";document.getElementById("cc").textContent=c;document.getElementById("ctt").textContent=fmt(t)}
function oc(){
  var t=0;C.forEach(function(i){t+=i.p*i.q});
  var h='<h2 style="font-size:18px;margin-bottom:16px">Seu Pedido</h2>';
  C.forEach(function(i,x){
    h+='<div class="cart-row"><div><div style="font-weight:500">'+esc(i.n)+'</div><div style="color:#888;font-size:13px">'+fmt(i.p)+'</div></div>';
    h+='<div class="qi"><button onclick="cq('+x+',-1)">-</button><span style="font-size:16px;font-weight:600;min-width:20px;text-align:center">'+i.q+'</span><button onclick="cq('+x+',1)">+</button></div></div>';
  });
  h+='<div class="cart-total"><span>Total</span><span style="color:#E8521A">'+fmt(t)+'</span></div>';
  h+='<input class="cart-input" id="cn" placeholder="Seu nome (opcional)">';
  h+='<button class="bt bp" onclick="ep()">Enviar pedido</button>';
  h+='<button class="bt bo" onclick="cl()" style="margin-top:8px">Continuar pedindo</button>';
  document.getElementById("mc").innerHTML=h;
  document.getElementById("md").style.display="block"
}
function cl(){document.getElementById("md").style.display="none"}
function cq(x,d){C[x].q+=d;if(C[x].q<=0)C.splice(x,1);uc();if(C.length>0)oc();else cl()}
function ep(){
  var n=document.getElementById("cn");var nome=n?n.value:"";
  var btn=document.querySelector(".mc .bp");if(btn){btn.disabled=true;btn.textContent="Enviando..."}
  fetch("/api/public/pedido",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({restaurante_id:R,mesa_numero:M,cliente_nome:nome||undefined,itens:C.map(function(i){return{prato_id:i.id,quantidade:i.q}})})})
  .then(function(r){return r.json().then(function(d){
    if(r.ok){
      document.getElementById("md").style.display="none";
      document.getElementById("cr").style.display="none";
      document.getElementById("cd").innerHTML='<div class="success"><div style="font-size:48px">✓</div><h2>Pedido enviado!</h2><p>'+esc(d.mensagem||"A cozinha ja esta preparando.")+'</p><button class="bt bp" onclick="C=[];ren();uc()" style="margin-top:20px">Novo pedido</button></div>';
    }else{alert(d.error||"Erro ao enviar pedido");if(btn){btn.disabled=false;btn.textContent="Enviar pedido"}}
  })}).catch(function(){alert("Erro de conexao. Verifique sua internet.");if(btn){btn.disabled=false;btn.textContent="Enviar pedido"}})
}
init()
</script>
</body>
</html>`;
    await reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });

  app.fastify.get<{ Params: { restauranteId: string } }>(
    "/api/public/cardapio/:restauranteId",
    async (request: FastifyRequest<{ Params: { restauranteId: string } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-cardapio", max: 60, windowMs: 60_000 })) return;
      try {
        const { restauranteId } = request.params;
        if (!UUID_RE.test(restauranteId)) return await reply.code(404).send({ error: "Restaurante nao encontrado" });

        const [rest] = await db.select({ id: schema.restaurante.id, nome: schema.restaurante.nome }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest) return await reply.code(404).send({ error: "Restaurante nao encontrado" });

        const categorias = await db.select().from(schema.categorias).where(eq(schema.categorias.restauranteId, restauranteId));
        const pratos = await db.select().from(schema.pratos).where(and(eq(schema.pratos.restauranteId, restauranteId), eq(schema.pratos.disponivel, true)));

        const cardapio = categorias.map((cat: any) => ({
          categoria: { id: cat.id, nome: cat.nome },
          pratos: pratos.filter((p: any) => p.categoriaId === cat.id).map((p: any) => ({
            id: p.id, nome: p.nome, descricao: p.descricao, preco: parseFloat(p.preco), imagemUrl: p.imagemUrl,
          })),
        })).filter((c: any) => c.pratos.length > 0);

        const pratosSeemCategoria = pratos.filter((p: any) => !p.categoriaId || !categorias.find((c: any) => c.id === p.categoriaId));
        if (pratosSeemCategoria.length > 0) {
          cardapio.push({ categoria: { id: "outros", nome: "Outros" }, pratos: pratosSeemCategoria.map((p: any) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: parseFloat(p.preco), imagemUrl: p.imagemUrl })) });
        }

        return await reply.code(200).send({ restaurante: rest, cardapio });
      } catch (err) {
        app.logger.error({ err }, "Erro ao carregar cardapio publico");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  app.fastify.post<{ Body: { restaurante_id: string; mesa_numero: number; cliente_nome?: string; itens: Array<{ prato_id: string; quantidade: number; observacao?: string }> } }>(
    "/api/public/pedido",
    {
      schema: {
        body: {
          type: "object",
          required: ["restaurante_id", "mesa_numero", "itens"],
          properties: {
            restaurante_id: { type: "string" },
            mesa_numero: { type: "number" },
            cliente_nome: { type: "string" },
            itens: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { restaurante_id: string; mesa_numero: number; cliente_nome?: string; itens: Array<{ prato_id: string; quantidade: number; observacao?: string }> } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-pedido", max: 10, windowMs: 60_000 })) {
        app.logger.warn({ tipoLimite: "ip", rota: "POST /api/public/pedido" }, "Limite por IP do pedido publico atingido");
        return;
      }

      try {
        const { restaurante_id, mesa_numero, cliente_nome, itens } = request.body;
        app.logger.info({ restaurante_id, mesa_numero }, "POST /api/public/pedido iniciado");

        if (typeof restaurante_id !== "string" || !UUID_RE.test(restaurante_id)) {
          return await reply.code(400).send({ error: "restaurante_id invalido" });
        }

        if (typeof mesa_numero !== "number" || !Number.isSafeInteger(mesa_numero) || mesa_numero <= 0 || mesa_numero > 2147483647) {
          return await reply.code(400).send({ error: "mesa_numero deve ser um numero inteiro positivo" });
        }

        if (!Array.isArray(itens) || itens.length < 1 || itens.length > 30) {
          return await reply.code(400).send({ error: "Informe entre 1 e 30 itens" });
        }

        for (let idx = 0; idx < itens.length; idx++) {
          const item = itens[idx];
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return await reply.code(400).send({ error: `Item ${idx} invalido` });
          }

          if (typeof item.prato_id !== "string" || !PRATO_UUID_RE.test(item.prato_id)) {
            return await reply.code(400).send({ error: `Item ${idx}: prato_id invalido` });
          }

          if (typeof item.quantidade !== "number" || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 20) {
            return await reply.code(400).send({ error: `Item ${idx}: quantidade deve ser inteiro entre 1 e 20` });
          }

          if (item.observacao !== undefined) {
            if (typeof item.observacao !== "string") {
              return await reply.code(400).send({ error: `Item ${idx}: observacao deve ser texto` });
            }
            if (item.observacao.length > 300) {
              return await reply.code(400).send({ error: `Item ${idx}: observacao maximo 300 caracteres` });
            }
            if (hasInvalidLineBreaks(item.observacao)) {
              return await reply.code(400).send({ error: `Item ${idx}: observacao invalida` });
            }
          }
        }

        let nomeValidado = "Cliente QR";
        if (cliente_nome !== undefined) {
          if (typeof cliente_nome !== "string") {
            return await reply.code(400).send({ error: "cliente_nome deve ser texto" });
          }
          if (cliente_nome.length > 60) {
            return await reply.code(400).send({ error: "cliente_nome maximo 60 caracteres" });
          }
          if (hasInvalidLineBreaks(cliente_nome)) {
            return await reply.code(400).send({ error: "cliente_nome invalido" });
          }
          nomeValidado = cliente_nome.trim() || "Cliente QR";
        }

        const [rest] = await db.select({ id: schema.restaurante.id, modoComanda: schema.restaurante.modoComanda }).from(schema.restaurante).where(eq(schema.restaurante.id, restaurante_id));
        if (!rest) return await reply.code(404).send({ error: "Restaurante nao encontrado" });

        if (rest.modoComanda === "individual") {
          return await reply.code(409).send({ error: "Este restaurante atende por comanda individual. Chame o garcom para fazer o seu pedido." });
        }

        let abrturaMarcada = false;
        let metadadosAbertura: any = null;
        let metadadosLancamento: any = null;

        const result = await (db as any).transaction(async (tx: any) => {
          const mesasLock = await tx.execute(
            sql`SELECT id FROM mesas WHERE numero = ${mesa_numero} AND restaurante_id = ${restaurante_id} FOR UPDATE`
          );
          const mesasRows = Array.isArray(mesasLock) ? mesasLock : (mesasLock as any)?.rows || [];
          if (!mesasRows.length) throw new DomainError("mesa_nao_encontrada", "Mesa nao encontrada");
          const mesaId = mesasRows[0]?.id;

          const [comandaExistente] = await tx.select().from(schema.comandas).where(and(eq(schema.comandas.mesaId, mesaId), eq(schema.comandas.status, "aberta"), eq(schema.comandas.restauranteId, restaurante_id)));

          let comanda;
          if (comandaExistente) {
            comanda = comandaExistente;
          } else {
            const entrada: EntradaAbertura = {
              restauranteId: restaurante_id,
              mesaId,
              mesaNumero: mesa_numero,
              garcomId: null as any,
              total: "0",
              rotulo: undefined,
            };

            const abrirResult = await abrirComandaNaMesaComPublicacao(app, entrada, tx);
            if (abrirResult.tipo !== "criada") {
              if (abrirResult.tipo === "mesa_ja_tem_comanda") throw new DomainError("mesa_ja_tem_comanda", "Esta mesa ja tem uma comanda aberta");
              if (abrirResult.tipo === "mesa_nao_encontrada") throw new DomainError("mesa_nao_encontrada", "Mesa nao encontrada");
              throw new DomainError("erro_abertura", "Erro ao abrir comanda");
            }

            comanda = abrirResult.comanda;
            abrturaMarcada = true;
            metadadosAbertura = { restauranteId: restaurante_id, comandaId: comanda.id, mesaId, mesaNumero: mesa_numero };

            await tx
              .update(schema.comandas)
              .set({ rotulo: nomeValidado })
              .where(and(eq(schema.comandas.id, comanda.id), eq(schema.comandas.restauranteId, restaurante_id)));

            await tx
              .update(schema.mesas)
              .set({ status: "ocupada" })
              .where(and(eq(schema.mesas.id, mesaId), eq(schema.mesas.restauranteId, restaurante_id)));
          }

          const itensMapeados = itens.map((item) => ({
            pratoId: item.prato_id,
            quantidade: item.quantidade,
            observacao: item.observacao?.trim() || null,
          }));

          const lancamentoResult = await lancarItens(
            app,
            {
              restauranteId: restaurante_id,
              comandaId: comanda.id,
              usuario: { id: "qr-publico", role: "garcom" },
              itens: itensMapeados,
            },
            realtimeHub,
            tx
          );

          if (lancamentoResult.tipo !== "lancado") {
            if (lancamentoResult.tipo === "comanda_nao_encontrada") throw new DomainError("comanda_nao_encontrada", "Comanda nao encontrada");
            if (lancamentoResult.tipo === "prato_indisponivel") throw new DomainError("prato_indisponivel", "Prato indisponivel ou nao encontrado.");
            if (lancamentoResult.tipo === "itens_invalidos") throw new DomainError("itens_invalidos", lancamentoResult.mensagem || "Itens invalidos");
            throw new DomainError("erro_lancamento", "Erro ao lancar itens");
          }

          metadadosLancamento = lancamentoResult.__metadataParaPublicar;

          const mesaRateLimitKey = `qr-mesa:${restaurante_id.toLowerCase()}:${mesa_numero}`;
          const mesaCount = increment(mesaRateLimitKey, 3600_000);
          if (mesaCount > 20) {
            app.logger.warn({ tipoLimite: "qr-mesa", rota: "POST /api/public/pedido" }, "Limite de 20 pedidos/hora para mesa atingido");
            throw new DomainError("limite_mesa", "Limite de 20 pedidos por hora para esta mesa atingido. Tente novamente mais tarde.");
          }

          return { comanda_id: comanda.id, mesa: mesa_numero, itens_adicionados: lancamentoResult.pedidos.length };
        });

        if (metadadosAbertura) {
          try {
            publicarEventoComandaCriada(app, metadadosAbertura, realtimeHub);
          } catch (err) {
            app.logger.debug({ err }, "Falha ao publicar comanda.created apos QR-pedido");
          }
        }
        if (metadadosLancamento) {
          try {
            publicarEventosPedidosLancados(app, restaurante_id, result.comanda_id, metadadosLancamento.pedidos, realtimeHub);
          } catch (err) {
            app.logger.debug({ err }, "Falha ao publicar pedidos.created apos QR-pedido");
          }
        }

        app.logger.info({ ...result }, "Pedido QR criado com sucesso");
        return await reply.code(201).send({ success: true, ...result, mensagem: "Pedido recebido! Enviado para a cozinha." });
      } catch (err) {
        if (err instanceof DomainError) {
          const code = (err as DomainError).code;
          if (code === "mesa_nao_encontrada" || code === "comanda_nao_encontrada") {
            return await reply.code(404).send({ error: err.message });
          }
          if (code === "mesa_ja_tem_comanda") {
            return await reply.code(409).send({ error: err.message });
          }
          if (code === "prato_indisponivel" || code === "itens_invalidos") {
            return await reply.code(400).send({ error: err.message });
          }
          if (code === "limite_mesa") {
            return await reply.code(429).send({ error: err.message });
          }
          app.logger.error({ err }, "Erro desconhecido no pedido QR");
          return await reply.code(500).send({ error: "Erro interno" });
        }
        app.logger.error({ err }, "Erro interno no pedido QR");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  app.fastify.get<{ Params: { restauranteId: string; mesaNumero: string } }>(
    "/api/public/mesa/:restauranteId/:mesaNumero",
    async (request: FastifyRequest<{ Params: { restauranteId: string; mesaNumero: string } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-mesa-status", max: 30, windowMs: 60_000 })) return;
      try {
        const { restauranteId, mesaNumero } = request.params;

        if (!UUID_RE.test(restauranteId)) {
          return await reply.code(404).send({ error: "Mesa nao encontrada" });
        }

        const mesaNum = (() => {
          const n = Number(mesaNumero);
          return Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : NaN;
        })();

        if (isNaN(mesaNum)) {
          return await reply.code(404).send({ error: "Mesa nao encontrada" });
        }

        const [mesa] = await db
          .select({ id: schema.mesas.id, numero: schema.mesas.numero })
          .from(schema.mesas)
          .where(and(eq(schema.mesas.numero, mesaNum), eq(schema.mesas.restauranteId, restauranteId)));

        if (!mesa) return await reply.code(404).send({ error: "Mesa nao encontrada" });

        let comanda = null;
        let pedidos: any[] = [];

        const [comandaAberta] = await db
          .select({ id: schema.comandas.id, rotulo: schema.comandas.rotulo, subtotal: schema.comandas.subtotal })
          .from(schema.comandas)
          .where(and(eq(schema.comandas.mesaId, mesa.id), eq(schema.comandas.status, "aberta"), eq(schema.comandas.restauranteId, restauranteId)));

        if (comandaAberta) {
          comanda = { cliente_nome: comandaAberta.rotulo || "Cliente QR", subtotal: parseFloat(comandaAberta.subtotal || "0") };
          pedidos = await db
            .select({
              id: schema.pedidos.id,
              pratoNome: schema.pratos.nome,
              quantidade: schema.pedidos.quantidade,
              observacao: schema.pedidos.observacao,
              status: schema.pedidos.status,
              precoUnitario: schema.pedidos.precoUnitario,
            })
            .from(schema.pedidos)
            .leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id))
            .where(and(eq(schema.pedidos.comandaId, comandaAberta.id), not(eq(schema.pedidos.status, "cancelado"))));
        }

        return await reply.code(200).send({ mesa: { numero: mesa.numero }, comanda, pedidos });
      } catch (err) {
        app.logger.error({ err }, "Erro ao consultar mesa publica");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );
}
