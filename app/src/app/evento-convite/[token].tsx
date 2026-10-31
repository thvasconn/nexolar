import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

// Convite de evento para quem é de fora da família: a pessoa vê só este evento.
export default function AcceptEventInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useSession();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!session) {
    return (
      <Screen>
        <Title>Você foi convidado para um evento</Title>
        <Muted>Crie sua conta grátis (ou entre) e depois toque no link de novo para confirmar.</Muted>
        <Button title="Entrar ou criar conta" onPress={() => router.replace('/entrar')} />
      </Screen>
    );
  }

  async function accept() {
    setError('');
    setLoading(true);
    const { data, error } = await supabase.rpc('accept_event_invite', { p_token: token });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    router.replace({ pathname: '/evento/[id]', params: { id: data as string } });
  }

  return (
    <Screen>
      <Title>Confirmar presença</Title>
      <Muted>Você vai ver os detalhes, participantes, pratos e o rateio deste evento.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Aceitar convite" onPress={accept} loading={loading} />
      <Button title="Agora não" variant="link" onPress={() => router.replace('/')} />
    </Screen>
  );
}
