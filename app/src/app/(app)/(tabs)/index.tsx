import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Chips, colors, Empty, Muted, Screen, Section, Title } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { fmtDay, fmtPeriod, isoDate, longToday } from '@/lib/format';
import { type Goal, type GoalLog, logsSince, periodLabel, progress, step } from '@/lib/goals';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Item = { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; owner_id: string;
  calendar_participants: { member_id: string }[] };
type Task = { id: string; title: string; due_on: string | null };
type Meal = { id: string; meal: string; title: string; recipe_id: string | null };

const mealLabel: Record<string, string> = { breakfast: 'Café', lunch: 'Almoço', snack: 'Lanche', dinner: 'Jantar' };
const mealOrder = ['breakfast', 'lunch', 'snack', 'dinner'];

// H01 Home pessoal: o dia de UMA pessoa.
export default function MyDay() {
  const { session } = useSession();
  const uid = session!.user.id;
  const { family, families, me, selectFamily, reload } = useFamily();
  const [items, setItems] = useState<Item[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [logs, setLogs] = useState<GoalLog[]>([]);

  const load = useCallback(() => {
    if (!family) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const week = new Date(start); week.setDate(week.getDate() + 7);
    // compromissos em que eu estou: os meus e os que me incluíram (o filtro final é no app)
    supabase.from('calendar_items').select('id, title, starts_at, ends_at, all_day, owner_id, calendar_participants(member_id)')
      .gte('starts_at', start.toISOString()).lt('starts_at', week.toISOString()).order('starts_at')
      .then(({ data }) => setItems((data ?? []) as Item[]));
    if (me) {
      supabase.from('tasks').select('id, title, due_on').is('done_at', null).eq('family_id', family.id)
        .or(`assigned_to.eq.${me.id},and(assigned_to.is.null,created_by.eq.${uid})`).order('due_on', { nullsFirst: false })
        // sem prazo, para hoje ou atrasada
        .then(({ data }) => setTasks((data ?? []).filter((t) => !t.due_on || t.due_on <= isoDate())));
    }
    supabase.from('meal_plan').select('id, meal, title, recipe_id').eq('family_id', family.id).eq('day', isoDate())
      .then(({ data }) => setMeals(data ?? []));
    supabase.from('goals').select('id, owner_id, title, target, unit, period, visibility').eq('owner_id', uid).eq('archived', false)
      .then(({ data }) => setGoals((data ?? []) as Goal[]));
    supabase.from('goal_logs').select('goal_id, logged_on, amount').gte('logged_on', logsSince())
      .then(({ data }) => setLogs(data ?? []));
  }, [family, me, uid]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useFocusEffect(load);

  if (!family) return null;
  const involved = items.filter((i) => i.owner_id === uid || i.calendar_participants.some((p) => p.member_id === me?.id));
  const todayKey = new Date().toDateString();
  const today = involved.filter((i) => new Date(i.starts_at).toDateString() === todayKey);
  const next = involved.filter((i) => new Date(i.starts_at).toDateString() !== todayKey);
  const firstName = session!.user.user_metadata?.full_name?.split(' ')[0] ?? '';

  async function finishTask(t: Task) {
    setTasks((all) => all.filter((x) => x.id !== t.id));
    await supabase.from('tasks').update({ done_at: new Date().toISOString() }).eq('id', t.id);
  }

  async function logGoal(g: Goal) {
    const amount = step(g);
    setLogs((l) => [...l, { goal_id: g.id, logged_on: isoDate(), amount }]);
    await supabase.from('goal_logs').insert({ goal_id: g.id, amount, logged_on: isoDate() });
  }

  return (
    <Screen>
      <Title>Olá{firstName ? `, ${firstName}` : ''}!</Title>
      <Muted>{longToday()} · {family.name}</Muted>
      {families.length > 1 && (
        <Chips>{families.map((f) => <Chip key={f.id} label={f.name} selected={f.id === family.id} onPress={() => selectFamily(f.id)} />)}</Chips>
      )}

      <Section>Minhas tarefas</Section>
      {tasks.length === 0 && <Empty>Nenhuma tarefa pendente. 🎉</Empty>}
      {tasks.map((t) => (
        <Card key={t.id} title={`☐ ${t.title}`}
          subtitle={t.due_on && t.due_on < isoDate() ? `⚠️ atrasada (${t.due_on.split('-').reverse().join('/')})` : t.due_on ? 'para hoje' : null}
          onPress={() => finishTask(t)} />
      ))}

      <Section>Hoje na agenda</Section>
      {today.length === 0 && <Empty>Nada marcado para você hoje.</Empty>}
      {today.map((i) => (
        <Card key={i.id} title={i.title} subtitle={i.all_day ? 'Dia todo' : fmtPeriod(i.starts_at, i.ends_at)}
          onPress={() => router.push('/agenda')} />
      ))}

      <Section>Refeições de hoje</Section>
      {meals.length === 0 && <Empty>Cardápio de hoje não definido.</Empty>}
      {[...meals].sort((a, b) => mealOrder.indexOf(a.meal) - mealOrder.indexOf(b.meal)).map((m) => (
        <Card key={m.id} title={`${mealLabel[m.meal]}: ${m.title}`}
          onPress={() => (m.recipe_id ? router.push({ pathname: '/receita/[id]', params: { id: m.recipe_id } }) : router.push('/cardapio'))} />
      ))}

      <Section>Minhas metas</Section>
      {goals.length === 0 && <Empty>Sem metas. Crie uma em Mais → Metas.</Empty>}
      {goals.map((g) => {
        const done = progress(g, logs);
        const pct = Math.min(1, done / g.target);
        return (
          <View key={g.id} style={styles.goal}>
            <View style={{ flex: 1 }}>
              <Text style={styles.goalTitle}>{g.title}</Text>
              <Muted>{done.toLocaleString('pt-BR')} / {Number(g.target).toLocaleString('pt-BR')} {g.unit} {periodLabel(g.period)}</Muted>
              <View style={styles.bar}><View style={[styles.fill, { width: `${pct * 100}%` }]} /></View>
            </View>
            <Pressable onPress={() => logGoal(g)} style={styles.plus} accessibilityRole="button" accessibilityLabel={`Registrar ${g.title}`}>
              <Text style={styles.plusText}>+{step(g).toLocaleString('pt-BR')}</Text>
            </Pressable>
          </View>
        );
      })}

      <Section>Próximos compromissos</Section>
      {next.length === 0 && <Empty>Nada nos próximos 7 dias.</Empty>}
      {next.map((i) => (
        <Card key={i.id} title={i.title} subtitle={`${fmtDay(i.starts_at)} · ${i.all_day ? 'dia todo' : fmtPeriod(i.starts_at, i.ends_at)}`}
          onPress={() => router.push('/agenda')} />
      ))}

      <Section>Atalhos</Section>
      <Chips>
        <Chip label="+ Tarefa" onPress={() => router.push('/tarefas')} />
        <Chip label="+ Compromisso" onPress={() => router.push('/compromisso/novo')} />
        <Chip label="Receitas" onPress={() => router.push('/receitas')} />
        <Chip label="Cardápio" onPress={() => router.push('/cardapio')} />
        <Chip label="Metas" onPress={() => router.push('/metas')} />
      </Chips>
      <Button title="Meu perfil" variant="link" onPress={() => me && router.push({ pathname: '/membro/[id]', params: { id: me.id } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  goal: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14 },
  goalTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  bar: { height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: '#16a34a' },
  plus: { backgroundColor: colors.primary, borderRadius: 22, width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: '#fff', fontWeight: '700' },
});
