import { isoDate } from './format';

export type Bill = {
  id: string; name: string; category: string | null; amount_cents: number | null; due_day: number;
  responsible_id: string | null; active: boolean;
};
export type BillPayment = { bill_id: string; period: string };

// Vencimento no mês atual (dia 31 vira o último dia em meses curtos).
export function dueThisMonth(bill: Bill) {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return new Date(now.getFullYear(), now.getMonth(), Math.min(bill.due_day, last));
}

export const currentPeriod = () => isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

export const isPaid = (bill: Bill, payments: BillPayment[]) =>
  payments.some((p) => p.bill_id === bill.id && p.period === currentPeriod());

export function dueLabel(bill: Bill) {
  const due = dueThisMonth(bill);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `⚠️ venceu dia ${due.getDate()}`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `vence dia ${due.getDate()}`;
}
