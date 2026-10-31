// Datas digitadas como dd/mm/aaaa e hh:mm (protótipo, sem date picker).

export function parseDateTime(date: string, time = ''): Date | null {
  const d = date.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!d) return null;
  const t = time.trim() ? time.trim().match(/^(\d{1,2}):(\d{2})$/) : ['', '0', '0'];
  if (!t) return null;
  const [day, month, year, h, min] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  const result = new Date(year, month - 1, day, h, min);
  // rejeita 31/02 e afins (o Date "rola" para o mês seguinte)
  if (result.getDate() !== day || result.getMonth() !== month - 1 || h > 23 || min > 59) return null;
  return result;
}

export const today = () => new Date().toLocaleDateString('pt-BR');

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// 18:00–18:30, ou só 18:00 sem término
export const fmtPeriod = (start: string, end?: string | null) => (end ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start));

export const fmtDateTime = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`;

// "12,50" / "12.50" / "12" -> 1250 centavos
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/^R\$\s*/i, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (cents: number) => brl.format(cents / 100);

// Aniversários (birth_date aaaa-mm-dd) que caem nos próximos `days` dias.
export function upcomingBirthdays<T extends { birth_date: string | null }>(people: T[], days = 30) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return people
    .filter((p) => p.birth_date)
    .map((p) => {
      const [, m, d] = p.birth_date!.split('-').map(Number);
      let next = new Date(now.getFullYear(), m - 1, d);
      if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
      return { person: p, date: next, inDays: Math.round((next.getTime() - now.getTime()) / 86400000) };
    })
    .filter((b) => b.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

type PricedItem = { price_cents: number | null; quantity: number; checked: boolean };
export const listTotal = (items: PricedItem[], onlyChecked = false) =>
  Math.round(items.filter((i) => !onlyChecked || i.checked).reduce((sum, i) => sum + (i.price_cents ?? 0) * i.quantity, 0));

// aaaa-mm-dd no fuso do aparelho (colunas `date` do banco)
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const longToday = () =>
  new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
