import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { isoDate } from '@/lib/format';
import { type Goal, type GoalLog, logsSince, periodLabel, progress, step } from '@/lib/goals';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

const presets = [
  { title: 'Beber água', target: '2', unit: 'L', period: 'day' as const },
  { title: 'Exercitar', target: '3', unit: 'vezes', period: 'week' as const },
  { title: 'Dormir', target: '8', unit: 'h', period: 'day' as const },
  { title: 'Ler', target: '30', unit: 'min', period: 'day' as const },
];

export default function Goals() {
  const { session } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [logs, setLogs] = useState<GoalLog[]>([]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('vezes');
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [privateGoal, setPrivateGoal] = useState(false);
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    supabase.from('goals').select('id, owner_id, title, target, unit, period, visibility')
      .eq('owner_id', session!.user.id).eq('archived', false).order('created_at')
      .then(({ data }) => setGoals((data ?? []) as Goal[]));
    supabase.from('goal_logs').select('goal_id, logged_on, amount').gte('logged_on', logsSince())
      .then(({ data }) => setLogs(data ?? []));
  }, [session]);
  useFocusEffect(load);

  async function add() {
    const t = Number(target.replace(',', '.'));
    if (!title.trim()) return setError('Dê um nome à meta.');
    if (!(t > 0)) return setError('Informe a quantidade alvo.');
    setError('');
    const { error } = await supabase.from('goals').insert({
      title: title.trim(), target: t, unit: unit.trim() || 'vezes', period, visibility: privateGoal ? 'private' : 'family',
    });
    if (error) return setError(errorMessage(error));
    setTitle(''); setTarget('');
    load();
  }

  async function log(g: Goal) {
    const typed = Number((amount[g.id] ?? '').replace(',', '.'));
    const value = typed > 0 ? typed : step(g);
    const { error } = await supabase.from('goal_logs').insert({ goal_id: g.id, amount: value, logged_on: isoDate() });
    if (error) return setError(errorMessage(error));
    setAmount((a) => ({ ...a, [g.id]: '' }));
    load();
  }

  function archive(g: Goal) {
    Alert.alert('Encerrar meta?', g.title, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Encerrar', style: 'destructive', onPress: async () => {
        await supabase.from('goals').update({ archived: true }).eq('id', g.id); load();
      } },
    ]);
  }

  return (
    <Screen>
      {goals.length === 0 && <Empty>Nenhuma meta ainda. Comece por uma sugestão abaixo.</Empty>}
      {goals.map((g) => {
        const done = progress(g, logs);
        return (
          <Card key={g.id}
            title={`${done >= g.target ? '✅ ' : ''}${g.visibility === 'private' ? '🔒 ' : ''}${g.title}`}
            subtitle={`${done.toLocaleString('pt-BR')} / ${Number(g.target).toLocaleString('pt-BR')} ${g.unit} ${periodLabel(g.period)}`}
            right={<>
              <Field label="" value={amount[g.id] ?? ''} onChangeText={(v) => setAmount((a) => ({ ...a, [g.id]: v }))}
                placeholder={`+${step(g).toLocaleString('pt-BR')}`} keyboardType="decimal-pad" style={{ width: 64, padding: 8 }} />
              <Button title="Registrar" variant="link" onPress={() => log(g)} />
              <Button title="✕" variant="link" onPress={() => archive(g)} />
            </>} />
        );
      })}

      <Section>Nova meta</Section>
      <Chips>
        {presets.map((p) => (
          <Chip key={p.title} label={`${p.title} (${p.target} ${p.unit}/${p.period === 'day' ? 'dia' : 'semana'})`}
            onPress={() => { setTitle(p.title); setTarget(p.target); setUnit(p.unit); setPeriod(p.period); }} />
        ))}
      </Chips>
      <Field label="Meta" value={title} onChangeText={setTitle} placeholder="Ex.: Beber água" maxLength={80} />
      <Field label="Quanto" value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="Ex.: 2" />
      <Field label="Unidade" value={unit} onChangeText={setUnit} placeholder="vezes, L, h, min, páginas" maxLength={20} />
      <Chips>
        <Chip label="Por dia" selected={period === 'day'} onPress={() => setPeriod('day')} />
        <Chip label="Por semana" selected={period === 'week'} onPress={() => setPeriod('week')} />
      </Chips>
      <Chips>
        <Chip label="👪 Família vê" selected={!privateGoal} onPress={() => setPrivateGoal(false)} />
        <Chip label="🔒 Só eu" selected={privateGoal} onPress={() => setPrivateGoal(true)} />
      </Chips>
      <Muted>Semana começa na segunda-feira.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Criar meta" onPress={add} />
    </Screen>
  );
}
