import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Chip, Chips, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { memberName, useFamily } from '@/lib/family';
import { parseDateTime, today } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

const recurrences = [
  { value: null, label: 'Não repete' }, { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' }, { value: 'yearly', label: 'Todo ano' },
] as const;

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

// Criar (sem id) ou editar (com id) um compromisso. Só o dono chega aqui para editar.
export default function AppointmentForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { family, members, me } = useFamily();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [privateItem, setPrivateItem] = useState(false);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.from('calendar_items')
      .select('title, starts_at, ends_at, all_day, location_text, notes, visibility, recurrence, calendar_participants(member_id)')
      .eq('id', id).single()
      .then(({ data, error }) => {
        if (error) return setError(errorMessage(error));
        setTitle(data.title);
        setDate(new Date(data.starts_at).toLocaleDateString('pt-BR'));
        setTime(data.all_day ? '' : hhmm(data.starts_at));
        setEndTime(data.ends_at ? hhmm(data.ends_at) : '');
        setLocation(data.location_text ?? '');
        setNotes(data.notes ?? '');
        setPrivateItem(data.visibility === 'private');
        setRecurrence(data.recurrence);
        const ids = data.calendar_participants.map((p: { member_id: string }) => p.member_id);
        setPeople(ids);
        setOriginal(ids);
      });
  }, [id]);

  const toggle = (mid: string) => setPeople((p) => (p.includes(mid) ? p.filter((x) => x !== mid) : [...p, mid]));

  async function save() {
    const when = parseDateTime(date, time);
    if (!title.trim()) return setError('Dê um título.');
    if (!when) return setError('Data ou hora inválida. Use dd/mm/aaaa e hh:mm.');
    const end = endTime.trim() ? parseDateTime(date, endTime) : null;
    if (endTime.trim() && !time.trim()) return setError('Informe a hora de início.');
    if (endTime.trim() && (!end || end <= when)) return setError('O término precisa ser depois do início.');
    setError('');
    setLoading(true);
    const fields = {
      title: title.trim(), starts_at: when.toISOString(), ends_at: end?.toISOString() ?? null, all_day: !time.trim(),
      location_text: location.trim() || null, notes: notes.trim() || null, recurrence,
      visibility: privateItem ? 'private' : 'family',
    };
    const res = id
      ? await supabase.from('calendar_items').update(fields).eq('id', id).select('id').single()
      : await supabase.from('calendar_items').insert({ ...fields, family_id: family!.id }).select('id').single();
    if (res.error) { setLoading(false); return setError(errorMessage(res.error)); }
    const itemId = res.data.id;
    const added = people.filter((p) => !original.includes(p));
    const removed = original.filter((p) => !people.includes(p));
    if (added.length) await supabase.from('calendar_participants').insert(added.map((member_id) => ({ item_id: itemId, member_id })));
    if (removed.length) await supabase.from('calendar_participants').delete().eq('item_id', itemId).in('member_id', removed);
    setLoading(false);
    router.back();
  }

  function remove() {
    Alert.alert('Apagar compromisso?', title, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('calendar_items').delete().eq('id', id!);
        if (error) return setError(errorMessage(error));
        router.back();
      } },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Editar compromisso' : 'Novo compromisso' }} />
      <Field label="O quê?" value={title} onChangeText={setTitle} placeholder="Ex.: Médico, reunião da escola" maxLength={120} />
      <Field label="Dia" value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" maxLength={10} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Das (vazio = dia todo)" value={time} onChangeText={setTime} placeholder="hh:mm" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Até (opcional)" value={endTime} onChangeText={setEndTime} placeholder="hh:mm" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </View>
      <Field label="Onde (opcional)" value={location} onChangeText={setLocation} maxLength={200} />

      <Section>Quem vê</Section>
      <Chips>
        <Chip label="👪 Compartilhar com a família" selected={!privateItem} onPress={() => setPrivateItem(false)} />
        <Chip label="🔒 Só eu e quem vai junto" selected={privateItem} onPress={() => setPrivateItem(true)} />
      </Chips>

      <Section>Convidar da família</Section>
      <Muted>Cada pessoa recebe uma notificação e pode aceitar ou recusar.</Muted>
      <Chips>
        {members.filter((m) => m.id !== me?.id && m.kind === 'person').map((m) => (
          <Chip key={m.id} label={memberName(m)} selected={people.includes(m.id)} onPress={() => toggle(m.id)} />
        ))}
      </Chips>

      <Section>Repetir</Section>
      <Chips>
        {recurrences.map((r) => <Chip key={r.label} label={r.label} selected={recurrence === r.value} onPress={() => setRecurrence(r.value)} />)}
      </Chips>

      <Field label="Lembrete / observações (opcional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <ErrorText>{error}</ErrorText>
      <Button title="Salvar" onPress={save} loading={loading} />
      {id && <Button title="Apagar compromisso" variant="link" onPress={remove} />}
    </Screen>
  );
}
