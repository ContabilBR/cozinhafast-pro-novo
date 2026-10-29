import { CORES, LEGENDA, linhaCompacta, linhasDoRestaurante, periodoTexto } from './definicao';
import type { ColunaDef, CorBloco, RelatorioDef, TipoColuna, Valor } from './definicao';

const COR_BLOCO: Record<CorBloco, string> = {
  azul: CORES.azul, verdeAgua: CORES.verdeAgua, ambar: CORES.ambar, roxo: CORES.roxo, rosa: CORES.rosa,
  verdeEscuro: CORES.verdeEscuro, neutro: CORES.neutro, positivo: CORES.positivo, negativo: CORES.negativo,
};
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatar(tipo: TipoColuna, v: Valor | undefined): string {
  if (v == null || v === '') return '';
  if (tipo === 'texto') return esc(v);
  if (tipo === 'data') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(v);
  }
  if (tipo === 'hora') {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(v)));
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (tipo === 'moeda') return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (tipo === 'percentual') return `${(n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return Math.round(n).toLocaleString('pt-BR');
}
const classeNumero = (tipo: TipoColuna, v: Valor | undefined) =>
  tipo === 'texto' ? '' : `num${typeof v === 'number' && v < 0 ? ' neg' : ''}`;

function tabelaHtml(r: RelatorioDef, t: RelatorioDef['tabelas'][number]): string {
  const cols: ColunaDef[] = t.colunas;
  const total = t.linhas.length > 0 && cols.some(c => c.somar)
    ? `<tr class="total">${cols.map((c, i) => {
      if (i === 0) return `<td>${esc(t.rotuloTotal ?? 'Total')}</td>`;
      if (!c.somar) return '<td></td>';
      const soma = t.linhas.reduce((s, l) => s + Number(l[i] ?? 0), 0);
      return `<td class="${classeNumero(c.tipo, soma)}">${formatar(c.tipo, soma)}</td>`;
    }).join('')}</tr>` : '';
  // A linha compacta fica no cabeçalho da tabela: o WebKit a repete em cada página que a tabela ocupa.
  return `<section><h2>${esc(t.titulo)}</h2>${t.observacao ? `<p class="obs">${esc(t.observacao)}</p>` : ''}
<table><thead><tr><th class="compacta" colspan="${cols.length}">${esc(linhaCompacta(r))}</th></tr>
<tr>${cols.map(c => `<th class="${c.tipo === 'texto' ? '' : 'num'}">${esc(c.titulo)}</th>`).join('')}</tr></thead>
<tbody>${t.linhas.map(l => `<tr>${cols.map((c, i) =>
    `<td class="${classeNumero(c.tipo, l[i])}">${formatar(c.tipo, l[i])}</td>`).join('')}</tr>`).join('')}${total}</tbody></table></section>`;
}

export function gerarHtmlPdf(r: RelatorioDef): string {
  const linhasRest = linhasDoRestaurante(r.contexto);
  const blocos = r.resumo.map(ind => {
    const cor = COR_BLOCO[ind.cor ?? 'neutro'];
    const negativo = typeof ind.valor === 'number' && ind.valor < 0;
    const alerta = !!ind.formula && typeof ind.valor === 'number';
    const confere = !!ind.formula && ind.valor === 'Confere';
    const valor = ind.tipo === 'texto' || typeof ind.valor === 'string' ? esc(ind.valor) : formatar(ind.tipo, ind.valor);
    const corValor = negativo || alerta ? CORES.negativo : confere ? CORES.positivo : CORES.texto;
    return `<div class="bloco" style="border-left:5px solid #${cor}"><span class="rot">${esc(ind.rotulo)}</span>
<strong style="color:#${corValor}">${valor}</strong>${ind.nota ? `<span class="nota">${esc(ind.nota)}</span>` : ''}</div>`;
  }).join('');
  const pendentes = r.pendentes?.length
    ? `<p class="obs"><b>Não disponível neste relatório:</b></p>${r.pendentes.map(p => `<p class="obs">• ${esc(p)}</p>`).join('')}` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 14mm 10mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 10px; color: #${CORES.texto}; margin: 0; }
.topo { background: #${CORES.escuro}; color: #fff; padding: 12px 14px; border-radius: 6px; }
.topo h1 { margin: 0 0 3px; font-size: 15px; } .topo p { margin: 1px 0; font-size: 9.5px; }
.info { background: #${CORES.claro}; padding: 8px 14px; margin: 6px 0 10px; border-radius: 6px; line-height: 1.5; }
h2 { font-size: 12px; color: #${CORES.escuro}; margin: 16px 0 6px; border-bottom: 2px solid #${CORES.principal}; padding-bottom: 3px; }
.bloco { display: block; background: #${CORES.faixa}; margin: 0 0 5px; padding: 6px 10px; border-radius: 3px; page-break-inside: avoid; }
.bloco .rot { display: inline-block; width: 58%; } .bloco strong { display: inline-block; width: 40%; text-align: right; font-size: 11px; }
.bloco .nota, .obs { display: block; color: #${CORES.cinza}; font-size: 8.5px; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 9px; }
th { background: #${CORES.escuro}; color: #fff; padding: 5px 6px; text-align: left; }
th.compacta { background: #fff; color: #${CORES.cinza}; font-weight: normal; font-size: 8px; padding: 0 0 4px; }
td { padding: 4px 6px; border-bottom: 1px solid #${CORES.borda}; }
tbody tr:nth-child(even) td { background: #${CORES.faixa}; }
tr { page-break-inside: avoid; } thead { display: table-header-group; }
.num { text-align: right; white-space: nowrap; } .neg { color: #${CORES.negativo}; }
tr.total td { font-weight: bold; background: #${CORES.claro} !important; border-top: 2px solid #${CORES.principal}; }
section { page-break-inside: auto; } .rodape { margin-top: 18px; border-top: 1px solid #${CORES.borda}; padding-top: 6px; color: #${CORES.cinza}; font-size: 8.5px; }
</style></head><body>
<div class="topo">${linhasRest.map((l, i) => i === 0 ? `<h1>${esc(l)}</h1>` : `<p>${esc(l)}</p>`).join('')}</div>
<div class="info"><b>${esc(r.titulo)}</b><br>Período: ${esc(periodoTexto(r.periodo))}<br>Gerado em ${esc(r.geradoEm)} (horário de Brasília) por ${esc(r.contexto.geradoPor)}</div>
<h2>${esc(r.resumoTitulo ?? 'Resumo')}</h2>${blocos}${pendentes}
${r.tabelas.map(t => tabelaHtml(r, t)).join('')}
<div class="rodape">${LEGENDA.map(esc).join('<br>')}</div></body></html>`;
}
