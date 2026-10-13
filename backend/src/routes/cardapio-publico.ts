import { eq, and, sql } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { App } from "../index.js";
import * as schema from "../db/schema/schema.js";
import { checkRateLimit } from "../utils/rate-limit.js";

// Id do restaurante: CNPJ (14 dígitos) ou uuid (restaurantes antigos)
const UUID_RE = /^(?:\d{14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Escape para texto colocado dentro de HTML (título e cabeçalho da página do cardápio)
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function registerCardapioPublicoRoutes(app: App) {
  const db = app.db as any;

  // GET /cardapio — página web do cardápio digital
  app.fastify.get("/cardapio", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkRateLimit(request, reply, { routeKey: "cardapio-html", max: 60, windowMs: 60_000 })) return;
    const q = request.query as any;
    // r e m entram dentro do JavaScript da página: só aceitamos CNPJ/UUID e número inteiro curto
    const rBruto = typeof q.r === "string" ? q.r : "";
    const mBruto = typeof q.m === "string" ? q.m : "";
    const r = UUID_RE.test(rBruto) ? rBruto : "";
    const m = /^\d{1,6}$/.test(mBruto) ? mBruto : "0";
    let restNome = "Restaurante";
    if (r) {
      try {
        const [rest] = await db.select({ nome: schema.restaurante.nome }).from(schema.restaurante).where(eq(schema.restaurante.id, r));
        if (rest) restNome = rest.nome;
      } catch (_) { /* invalid uuid, keep default name */ }
    }
    const mesaLabel = m !== "0" ? `Mesa ${m}` : "Cardápio Digital";
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
  if(!R){document.getElementById("cd").innerHTML='<div style="text-align:center;padding:60px;color:#c00"><h2>QR Code inválido</h2><p style="margin-top:8px;color:#888">Escaneie o QR Code da mesa para acessar o cardápio.</p></div>';return}
  fetch("/api/public/cardapio/"+R)
    .then(function(r){return r.json()})
    .then(function(d){D=d.cardapio||[];ren()})
    .catch(function(){document.getElementById("cd").innerHTML='<div style="text-align:center;padding:60px;color:#c00">Erro ao carregar o cardápio</div>'})
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
  document.getElementById("cd").innerHTML=h||'<div style="text-align:center;padding:60px;color:#888">Nenhum prato disponível</div>';
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
    h+='<div class="qi"><button onclick="cq('+x+',-1)">−</button><span style="font-size:16px;font-weight:600;min-width:20px;text-align:center">'+i.q+'</span><button onclick="cq('+x+',1)">+</button></div></div>';
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
      document.getElementById("cd").innerHTML='<div class="success"><div style="font-size:48px">✅</div><h2>Pedido enviado!</h2><p>'+esc(d.mensagem||"A cozinha já está preparando.")+'</p><button class="bt bp" onclick="C=[];ren();uc()" style="margin-top:20px">Novo pedido</button></div>';
    }else{alert(d.error||"Erro ao enviar pedido");if(btn){btn.disabled=false;btn.textContent="Enviar pedido"}}
  })}).catch(function(){alert("Erro de conexão. Verifique sua internet.");if(btn){btn.disabled=false;btn.textContent="Enviar pedido"}})
}
init()
</script>
</body>
</html>`;
    await reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });

  // GET /api/public/cardapio/:restauranteId — cardápio público (sem auth)
  app.fastify.get<{ Params: { restauranteId: string } }>(
    "/api/public/cardapio/:restauranteId",
    async (request: FastifyRequest<{ Params: { restauranteId: string } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-cardapio", max: 60, windowMs: 60_000 })) return;
      try {
        const { restauranteId } = request.params;
        const [rest] = await db.select({ id: schema.restaurante.id, nome: schema.restaurante.nome }).from(schema.restaurante).where(eq(schema.restaurante.id, restauranteId));
        if (!rest) return await reply.code(404).send({ error: "Restaurante não encontrado" });

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
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // POST /api/public/pedido — cliente faz pedido pelo QR Code (sem auth)
  app.fastify.post<{ Body: { restaurante_id: string; mesa_numero: number; cliente_nome?: string; itens: Array<{ prato_id: string; quantidade: number; observacao?: string }> } }>(
    "/api/public/pedido",
    async (request: FastifyRequest<{ Body: { restaurante_id: string; mesa_numero: number; cliente_nome?: string; itens: Array<{ prato_id: string; quantidade: number; observacao?: string }> } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-pedido", max: 10, windowMs: 60_000 })) return;
      try {
        const { restaurante_id, mesa_numero, cliente_nome, itens } = request.body;
        if (!restaurante_id || !mesa_numero || !itens || itens.length === 0) {
          return await reply.code(400).send({ error: "restaurante_id, mesa_numero e itens são obrigatórios" });
        }

        const [rest] = await db.select({ id: schema.restaurante.id, modoComanda: schema.restaurante.modoComanda }).from(schema.restaurante).where(eq(schema.restaurante.id, restaurante_id));
        if (!rest) return await reply.code(404).send({ error: "Restaurante não encontrado" });

        // No modo "individual" a mesa tem várias comandas, cada uma com o nome de uma pessoa. O pedido
        // por QR Code não sabe a qual delas pertence (e deixar o cliente escolher pelo nome permitiria
        // lançar itens na conta de outra pessoa). Até existir um fluxo próprio, o pedido é feito pelo garçom.
        if (rest.modoComanda === "individual") {
          return await reply.code(409).send({ error: "Este restaurante atende por comanda individual. Chame o garçom para fazer o seu pedido." });
        }

        const [mesa] = await db.select().from(schema.mesas).where(and(eq(schema.mesas.numero, mesa_numero), eq(schema.mesas.restauranteId, restaurante_id)));
        if (!mesa) return await reply.code(404).send({ error: "Mesa não encontrada" });

        const result = await (db as any).transaction(async (tx: any) => {
          const itensPedido: any[] = [];

          // Validate pratos and collect order items
          for (const item of itens) {
            const [prato] = await tx.select({ id: schema.pratos.id, preco: schema.pratos.preco }).from(schema.pratos).where(and(eq(schema.pratos.id, item.prato_id), eq(schema.pratos.restauranteId, restaurante_id)));
            if (!prato) return { error: "Prato não encontrado: " + item.prato_id };
            itensPedido.push({ pratoId: item.prato_id, quantidade: item.quantidade, precoUnitario: prato.preco, observacao: item.observacao || null });
          }

          // Check for existing open comanda
          let comanda;
          const [comandaExistente] = await tx.select().from(schema.comandas).where(and(eq(schema.comandas.mesaId, mesa.id), eq(schema.comandas.status, "aberta"), eq(schema.comandas.restauranteId, restaurante_id)));

          if (comandaExistente) {
            comanda = comandaExistente;
          } else {
            [comanda] = await tx.insert(schema.comandas).values({
              tipo: "mesa", mesaId: mesa.id, mesaNumero: mesa_numero, status: "aberta",
              clienteNome: cliente_nome || "Cliente QR", subtotal: "0", total: "0", restauranteId: restaurante_id,
            }).returning();
            await tx.update(schema.mesas).set({ status: "ocupada" }).where(eq(schema.mesas.id, mesa.id));
          }

          // Insert order items
          for (const item of itensPedido) {
            await tx.insert(schema.pedidos).values({
              comandaId: comanda.id, pratoId: item.pratoId, quantidade: item.quantidade,
              precoUnitario: item.precoUnitario, observacao: item.observacao, status: "pendente", restauranteId: restaurante_id,
            });
          }

          // Recalculate subtotal via SQL aggregation
          const subtotalResult = await tx.select({
            subtotal: sql<string>`COALESCE(SUM(quantidade * preco_unitario) FILTER (WHERE status <> 'cancelado'), 0)`,
          }).from(schema.pedidos).where(eq(schema.pedidos.comandaId, comanda.id));

          const subtotalValue = subtotalResult[0]?.subtotal || "0";
          const subtotal = parseFloat(String(subtotalValue));

          // Fetch gorjeta from comanda
          const gorjetaResult = await tx.select({ gorjeta: schema.comandas.gorjeta }).from(schema.comandas).where(eq(schema.comandas.id, comanda.id));
          const gorjetaValue = gorjetaResult[0]?.gorjeta || "0";
          const gorjeta = parseFloat(String(gorjetaValue));

          const newTotal = (subtotal + gorjeta).toFixed(2);

          // Update comanda with calculated subtotal and total
          await tx.update(schema.comandas).set({ subtotal: subtotal.toString(), total: newTotal }).where(eq(schema.comandas.id, comanda.id));

          return { comanda_id: comanda.id, mesa: mesa_numero, itens_adicionados: itensPedido.length };
        });

        if (result.error) return await reply.code(400).send({ error: result.error });
        return await reply.code(201).send({ success: true, ...result, mensagem: "Pedido recebido! A cozinha já está preparando." });
      } catch (err) {
        app.logger.error({ error: (err as any).message }, "Erro no pedido público");
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );

  // GET /api/public/mesa/:restauranteId/:mesaNumero — status da mesa (sem auth)
  app.fastify.get<{ Params: { restauranteId: string; mesaNumero: string } }>(
    "/api/public/mesa/:restauranteId/:mesaNumero",
    async (request: FastifyRequest<{ Params: { restauranteId: string; mesaNumero: string } }>, reply: FastifyReply) => {
      if (!checkRateLimit(request, reply, { routeKey: "public-mesa-status", max: 30, windowMs: 60_000 })) return;
      try {
        const { restauranteId, mesaNumero } = request.params;
        const [mesa] = await db.select().from(schema.mesas).where(and(eq(schema.mesas.numero, parseInt(mesaNumero)), eq(schema.mesas.restauranteId, restauranteId)));
        if (!mesa) return await reply.code(404).send({ error: "Mesa não encontrada" });

        let comanda = null;
        let pedidos: any[] = [];
        const [comandaAberta] = await db.select().from(schema.comandas).where(and(eq(schema.comandas.mesaId, mesa.id), eq(schema.comandas.status, "aberta")));
        if (comandaAberta) {
          comanda = comandaAberta;
          pedidos = await db.select({ id: schema.pedidos.id, quantidade: schema.pedidos.quantidade, precoUnitario: schema.pedidos.precoUnitario, status: schema.pedidos.status, pratoNome: schema.pratos.nome }).from(schema.pedidos).leftJoin(schema.pratos, eq(schema.pedidos.pratoId, schema.pratos.id)).where(eq(schema.pedidos.comandaId, comandaAberta.id));
        }

        return await reply.code(200).send({ mesa: { numero: mesa.numero, status: mesa.status }, comanda, pedidos });
      } catch (err) {
        return await reply.code(500).send({ error: "Erro interno" });
      }
    }
  );
}
