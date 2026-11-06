const pad = (n: number) => String(n).padStart(2, "0");

// Hora e minuto (HH:MM) de um instante ISO, no fuso do aparelho. Traço se inválido.
export function horaDoAparelho(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Dia (AAAA-MM-DD) de um instante ISO, no fuso do aparelho. Nulo se inválido.
export function diaDoAparelho(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
