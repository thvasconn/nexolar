import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, Empty, Screen, Section } from '@/components/ui';
import { eventTypeLabel } from '@/lib/events';
import { useFamily } from '@/lib/family';
import { fmtDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Event = { id: string; title: string; type: string; starts_at: string; family_id: string };

export default function Events() {
  const { families } = useFamily();
  const [events, setEvents] = useState<Event[]>([]);

  // RLS já devolve os eventos das minhas famílias e os que fui convidado
  useFocusEffect(useCallback(() => {
    supabase.from('events').select('id, title, type, starts_at, family_id').order('starts_at').limit(100)
      .then(({ data }) => setEvents(data ?? []));
  }, []));

  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() >= now - 86400000);
  const past = events.filter((e) => new Date(e.starts_at).getTime() < now - 86400000).reverse();
  const card = (e: Event) => (
    <Card key={e.id} title={e.title}
      subtitle={`${eventTypeLabel(e.type)} · ${fmtDateTime(e.starts_at)}${families.some((f) => f.id === e.family_id) ? '' : ' · convidado'}`}
      onPress={() => router.push({ pathname: '/evento/[id]', params: { id: e.id } })} />
  );

  return (
    <Screen>
      <Button title="+ Novo evento" onPress={() => router.push('/evento/novo')} />
      <Section>Próximos</Section>
      {upcoming.length === 0 && <Empty>Nenhum evento marcado.</Empty>}
      {upcoming.map(card)}
      {past.length > 0 && <Section>Anteriores</Section>}
      {past.map(card)}
    </Screen>
  );
}
