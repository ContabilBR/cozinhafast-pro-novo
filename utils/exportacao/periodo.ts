import type { Periodo } from './definicao';
import { TIME_ZONE } from './definicao';

export type OpcaoPeriodo = 'hoje' | 'ontem' | '7dias' | 'mes' | 'mesAnterior' | 'personalizado';
export const OPCOES_PERIODO: { valor: OpcaoPeriodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7dias', rotulo: 'Últimos 7 dias' },
  { valor: 'mes', rotulo: 'Mês atual' },
  { valor: 'mesAnterior', rotulo: 'Mês anterior' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
];

export function hojeBrasilia(agora = new Date()): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  const g = (t: string) => p.find(x => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function deslocarDias(iso: string, delta: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + delta, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
export const dataValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  && deslocarDias(v, 0) === v;

export function resolverPeriodo(opcao: OpcaoPeriodo, inicioPersonalizado = '', fimPersonalizado = '', hoje = hojeBrasilia()): Periodo {
  if (opcao === 'hoje') return { inicio: hoje, fim: hoje };
  if (opcao === 'ontem') { const o = deslocarDias(hoje, -1); return { inicio: o, fim: o }; }
  if (opcao === '7dias') return { inicio: deslocarDias(hoje, -6), fim: hoje };
  if (opcao === 'mes') return { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje };
  if (opcao === 'mesAnterior') {
    const primeiro = `${hoje.slice(0, 7)}-01`;
    const fim = deslocarDias(primeiro, -1);
    return { inicio: `${fim.slice(0, 7)}-01`, fim };
  }
  const inicio = dataValida(inicioPersonalizado) ? inicioPersonalizado : hoje;
  const fim = dataValida(fimPersonalizado) ? fimPersonalizado : inicio;
  return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
}
export function diasDoPeriodo(p: Periodo): string[] {
  const dias: string[] = [];
  for (let d = p.inicio; d <= p.fim && dias.length < 400; d = deslocarDias(d, 1)) dias.push(d);
  return dias;
}
