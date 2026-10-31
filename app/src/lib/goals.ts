import { isoDate } from './format';

export type Goal = { id: string; owner_id: string; title: string; target: number; unit: string; period: 'day' | 'week'; visibility: string };
export type GoalLog = { goal_id: string; logged_on: string; amount: number };

// Início do período atual: hoje, ou a segunda-feira da semana.
export function periodStart(period: Goal['period']) {
  const d = new Date();
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}

export const progress = (goal: Goal, logs: GoalLog[]) =>
  logs.filter((l) => l.goal_id === goal.id && l.logged_on >= periodStart(goal.period)).reduce((s, l) => s + Number(l.amount), 0);

// Quanto soma cada toque no "+": copo de 250 ml para litros, 1 para o resto.
export const step = (goal: Goal) => (goal.unit.toLowerCase() === 'l' ? 0.25 : 1);

export const periodLabel = (p: Goal['period']) => (p === 'day' ? 'hoje' : 'nesta semana');

// Logs desde a segunda-feira cobrem metas diárias e semanais.
export const logsSince = () => periodStart('week');
