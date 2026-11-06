export interface GrupoFuso {
  id: 'brasilia' | 'amazonas' | 'acre' | 'noronha';
  nome: string;
  deslocamento: string;
  descricao: string;
  principal: string; // nome IANA gravado no servidor
  fusos: string[]; // nomes IANA que pertencem ao grupo
}

export const GRUPOS_FUSO: GrupoFuso[] = [
  {
    id: 'brasilia',
    nome: 'Brasília',
    deslocamento: 'UTC-3',
    descricao: 'Maior parte do país, como SP, RJ, MG, BA, PE, CE, GO e DF',
    principal: 'America/Sao_Paulo',
    fusos: [
      'America/Sao_Paulo',
      'America/Belem',
      'America/Fortaleza',
      'America/Recife',
      'America/Araguaina',
      'America/Maceio',
      'America/Bahia',
      'America/Santarem',
    ],
  },
  {
    id: 'amazonas',
    nome: 'Amazonas',
    deslocamento: 'UTC-4',
    descricao: 'AM, RO, RR, MT e MS',
    principal: 'America/Manaus',
    fusos: ['America/Manaus', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Cuiaba', 'America/Campo_Grande'],
  },
  {
    id: 'acre',
    nome: 'Acre',
    deslocamento: 'UTC-5',
    descricao: 'AC e oeste do AM',
    principal: 'America/Rio_Branco',
    fusos: ['America/Rio_Branco', 'America/Eirunepe'],
  },
  {
    id: 'noronha',
    nome: 'Fernando de Noronha',
    deslocamento: 'UTC-2',
    descricao: 'Ilha de Fernando de Noronha (PE)',
    principal: 'America/Noronha',
    fusos: ['America/Noronha'],
  },
];

export const FUSO_PADRAO = 'America/Sao_Paulo';

export function grupoDoFuso(nomeIana: string | null | undefined): GrupoFuso | null {
  if (!nomeIana) return null;
  return GRUPOS_FUSO.find((g) => g.fusos.includes(nomeIana)) ?? null;
}

// Fuso do aparelho; nulo quando não é de nenhum grupo (UTC, outro país) ou a leitura falha.
export function grupoDoAparelho(): GrupoFuso | null {
  try {
    return grupoDoFuso(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}
