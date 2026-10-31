import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Screen, Section } from '@/components/ui';
import { memberName, useFamily } from '@/lib/family';
import { isoDate, parseDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Task = {
  id: string; title: string; assigned_to: string | null; due_on: string | null; visibility: string;
  done_at: string | null; created_by: string;
};
type Filter = 'mine' | 'family' | 'done';

export default function Tasks() {
  const { session } = useSession();
  const uid = session!.user.id;
  const { family, members, me, isAdmin } = useFamily();
  const [filter, setFilter] = useState<Filter>('mine');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [privateTask, setPrivateTask] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!family) return;
    supabase.from('tasks').select('id, title, assigned_to, due_on, visibility, done_at, created_by')
      .eq('family_id', family.id).order('due_on', { nullsFirst: false }).order('created_at').limit(200)
      .then(({ data }) => setTasks(data ?? []));
  }, [family]);
  useFocusEffect(load);

  if (!family) return null;

  const mine = (t: Task) => t.assigned_to === me?.id || (!t.assigned_to && t.created_by === uid);
  const shown = tasks.filter((t) => (filter === 'done' ? !!t.done_at : !t.done_at && (filter === 'family' || mine(t))));

  async function add() {
    if (!title.trim()) return setError('Descreva a tarefa.');
    const dueDate = due.trim() ? parseDateTime(due) : null;
    if (due.trim() && !dueDate) return setError('Prazo inválido. Use dd/mm/aaaa.');
    setError('');
    const { error } = await supabase.from('tasks').insert({
      family_id: family!.id, title: title.trim(), assigned_to: assignee, due_on: dueDate ? isoDate(dueDate) : null,
      visibility: privateTask ? 'private' : 'family',
    });
    if (error) return setError(errorMessage(error));
    setTitle(''); setDue(''); setAssignee(null);
    load();
  }

  async function toggle(t: Task) {
    await supabase.from('tasks').update({ done_at: t.done_at ? null : new Date().toISOString() }).eq('id', t.id);
    load();
  }

  function remove(t: Task) {
    Alert.alert('Apagar tarefa?', t.title, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('tasks').delete().eq('id', t.id);
        if (error) setError(errorMessage(error));
        load();
      } },
    ]);
  }

  const who = (t: Task) => (t.assigned_to ? memberName(members.find((m) => m.id === t.assigned_to)!) : 'sem responsável');
  const dueText = (t: Task) => (t.due_on ? `${t.due_on < isoDate() && !t.done_at ? '⚠️ ' : ''}até ${t.due_on.split('-').reverse().join('/')}` : null);

  return (
    <Screen>
      <Chips>
        {([['mine', 'Minhas'], ['family', 'Da família'], ['done', 'Concluídas']] as const).map(([v, l]) => (
          <Chip key={v} label={l} selected={filter === v} onPress={() => setFilter(v)} />
        ))}
      </Chips>
      {shown.length === 0 && <Empty>Nenhuma tarefa aqui.</Empty>}
      {shown.map((t) => (
        <Card key={t.id} title={`${t.done_at ? '☑' : '☐'} ${t.visibility === 'private' ? '🔒 ' : ''}${t.title}`}
          subtitle={[who(t), dueText(t)].filter(Boolean).join(' · ')}
          onPress={() => toggle(t)}
          right={t.created_by === uid || (isAdmin && t.visibility === 'family')
            ? <Button title="✕" variant="link" onPress={() => remove(t)} /> : undefined} />
      ))}

      <Section>Nova tarefa</Section>
      <Field label="O que precisa ser feito?" value={title} onChangeText={setTitle} placeholder="Ex.: levar o lixo, pagar a escola" maxLength={120} />
      <Field label="Prazo (opcional)" value={due} onChangeText={setDue} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Chips>
        <Chip label="Sem responsável" selected={!assignee} onPress={() => setAssignee(null)} />
        {members.filter((m) => m.kind === 'person').map((m) => (
          <Chip key={m.id} label={memberName(m)} selected={assignee === m.id} onPress={() => setAssignee(m.id)} />
        ))}
      </Chips>
      <Chips>
        <Chip label="👪 Visível para a família" selected={!privateTask} onPress={() => setPrivateTask(false)} />
        <Chip label="🔒 Só eu e o responsável" selected={privateTask} onPress={() => setPrivateTask(true)} />
      </Chips>
      <ErrorText>{error}</ErrorText>
      <Button title="Adicionar tarefa" onPress={add} />
    </Screen>
  );
}
