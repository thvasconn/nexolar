import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Chip, Chips, ErrorText, Field, Screen, Section } from '@/components/ui';
import { eventTypes } from '@/lib/events';
import { useFamily } from '@/lib/family';
import { parseDateTime } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

export default function NewEvent() {
  const { family, members } = useFamily();
  const [type, setType] = useState<string>('meal');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [wholeFamily, setWholeFamily] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    const when = parseDateTime(date, time);
    if (!title.trim()) return setError('Dê um nome ao evento.');
    if (!when) return setError('Data ou hora inválida. Use dd/mm/aaaa e hh:mm.');
    setError('');
    setLoading(true);
    const { data, error } = await supabase.from('events').insert({
      family_id: family!.id, type, title: title.trim(), starts_at: when.toISOString(),
      location_text: location.trim() || null, description: description.trim() || null,
    }).select('id').single();
    if (error) {
      setLoading(false);
      return setError(errorMessage(error));
    }
    // nome é preenchido pelo servidor a partir do membro; o 'x' só satisfaz o not null
    const participants = wholeFamily ? members : members.filter((m) => m.user_id);
    await supabase.from('event_participants')
      .insert(participants.map((m) => ({ event_id: data.id, member_id: m.id, display_name: 'x' })));
    setLoading(false);
    router.replace({ pathname: '/evento/[id]', params: { id: data.id } });
  }

  return (
    <Screen>
      <Section>Tipo</Section>
      <Chips>{eventTypes.map((t) => <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />)}</Chips>
      <Field label="Nome" value={title} onChangeText={setTitle} placeholder="Ex.: Natal da família" maxLength={120} />
      <Field label="Dia" value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Field label="Hora" value={time} onChangeText={setTime} placeholder="hh:mm" keyboardType="numbers-and-punctuation" maxLength={5} />
      <Field label="Local (opcional)" value={location} onChangeText={setLocation} maxLength={200} />
      <Field label="Descrição (opcional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />
      <Section>Participantes</Section>
      <Chips>
        <Chip label="Toda a família" selected={wholeFamily} onPress={() => setWholeFamily(true)} />
        <Chip label="Só quem tem login" selected={!wholeFamily} onPress={() => setWholeFamily(false)} />
      </Chips>
      <ErrorText>{error}</ErrorText>
      <Button title="Criar evento" onPress={save} loading={loading} />
    </Screen>
  );
}
