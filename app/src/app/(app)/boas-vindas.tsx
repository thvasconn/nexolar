import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, Field, Muted, Screen, Section, Title } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Event = { id: string; title: string; starts_at: string };

// Quem ainda não tem família cai aqui (o layout das abas redireciona).
// Convidado externo de evento também: vê os eventos para os quais foi chamado.
export default function Welcome() {
  const [code, setCode] = useState('');
  const [events, setEvents] = useState<Event[]>([]);

  useFocusEffect(useCallback(() => {
    supabase.from('events').select('id, title, starts_at').order('starts_at')
      .then(({ data }) => setEvents(data ?? []));
  }, []));

  return (
    <Screen>
      <Title>Bem-vindo!</Title>
      {events.length > 0 && (
        <>
          <Section>Eventos em que você está</Section>
          {events.map((e) => (
            <Card key={e.id} title={e.title} subtitle={fmtDateTime(e.starts_at)}
              onPress={() => router.push({ pathname: '/evento/[id]', params: { id: e.id } })} />
          ))}
        </>
      )}

      <Section>Sua família</Section>
      <Muted>Crie sua família para organizar agenda, compras, receitas e eventos.</Muted>
      <Button title="Criar minha família" onPress={() => router.push('/nova-familia')} />

      <Field label="Recebeu um código de convite de família?" value={code} onChangeText={setCode} autoCapitalize="none"
        placeholder="Cole o código aqui" />
      <Button title="Usar convite" variant="link"
        onPress={() => code.trim() && router.push({ pathname: '/convite/[token]', params: { token: code.trim() } })} />

      <Button title="Sair da conta" variant="link" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
