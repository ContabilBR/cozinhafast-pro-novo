// Agrupamento de reservas de várias mesas (grupo).
// A API devolve uma linha por mesa; linhas com o mesmo grupo_id são uma só reserva.

export interface ReservaApi {
  id: string;
  nome_pessoa: string;
  telefone?: string | null;
  data_hora: string;
  numero_pessoas: number;
  mesa: { id: string; numero: number; capacidade?: number } | null;
  observacao?: string | null;
  status: "confirmada" | "sentada" | "cancelada" | "nao_compareceu";
  duracao?: number;
  comanda_id?: string | null;
  grupo_id?: string | null;
}

export interface MesaDoGrupo {
  id: string;
  numero: number;
  reservaId: string;
  comandaId: string | null;
}

export interface ItemIndividual {
  tipo: "individual";
  key: string;
  reserva: ReservaApi;
}

export interface ItemGrupo {
  tipo: "grupo";
  key: string;
  grupoId: string;
  // Primeira linha: carrega nome, telefone, hora, pessoas, observação, status, duração
  reserva: ReservaApi;
  nome_pessoa: string;
  telefone?: string | null;
  data_hora: string;
  // Cada linha guarda o total do grupo (não é por mesa); por isso não se soma.
  numero_pessoas: number;
  observacao?: string | null;
  status: ReservaApi["status"];
  duracao?: number;
  mesas: MesaDoGrupo[];
  ids: string[];
}

export type ItemReserva = ItemIndividual | ItemGrupo;

export function agruparReservas(lista: ReservaApi[]): ItemReserva[] {
  const saida: ItemReserva[] = [];
  const grupos = new Map<string, ItemGrupo>();
  for (const r of lista) {
    if (!r.grupo_id) {
      saida.push({ tipo: "individual", key: r.id, reserva: r });
      continue;
    }
    let g = grupos.get(r.grupo_id);
    if (!g) {
      g = {
        tipo: "grupo",
        key: "grupo-" + r.grupo_id,
        grupoId: r.grupo_id,
        reserva: r,
        nome_pessoa: r.nome_pessoa,
        telefone: r.telefone,
        data_hora: r.data_hora,
        numero_pessoas: r.numero_pessoas,
        observacao: r.observacao,
        status: r.status,
        duracao: r.duracao,
        mesas: [],
        ids: [],
      };
      grupos.set(r.grupo_id, g);
      saida.push(g);
    }
    g.ids.push(r.id);
    if (r.mesa) g.mesas.push({ id: r.mesa.id, numero: r.mesa.numero, reservaId: r.id, comandaId: r.comanda_id ?? null });
  }
  for (const g of grupos.values()) g.mesas.sort((a, b) => a.numero - b.numero);
  return saida;
}

// Conta reservas tratando cada grupo como uma só
export function contarReservas(lista: ReservaApi[] | { status: string; grupo_id?: string | null }[]): { total: number; aguardando: number } {
  const itens = agruparReservas(lista as ReservaApi[]);
  const validas = itens.filter((i) => {
    const s = i.tipo === "grupo" ? i.status : i.reserva.status;
    return s !== "cancelada" && s !== "nao_compareceu";
  });
  const aguardando = validas.filter((i) => (i.tipo === "grupo" ? i.status : i.reserva.status) === "confirmada").length;
  return { total: validas.length, aguardando };
}

// "3", "3 e 4", "3, 4 e 5"
export function listaMesas(numeros: number[]): string {
  if (numeros.length <= 1) return numeros.join("");
  return `${numeros.slice(0, -1).join(", ")} e ${numeros[numeros.length - 1]}`;
}
