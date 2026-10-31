import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { rememberFamily } from '@/lib/family';
import { setPendingInvite, useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

// Aberto pelo link do convite. Fica fora dos grupos protegidos para funcionar logado ou não.
export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useSession();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!session) {
    return (
      <Screen>
        <Title>Você foi convidado para uma família</Title>
        <Muted>Entre ou crie sua conta grátis para aceitar.</Muted>
        <Button title="Continuar" onPress={() => { setPendingInvite(token); router.replace('/entrar'); }} />
      </Screen>
    );
  }

  async function accept() {
    setError('');
    setLoading(true);
    const { data, error } = await supabase.rpc('accept_family_invite', { p_token: token });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    await rememberFamily(data as string);
    router.replace('/');
  }

  return (
    <Screen>
      <Title>Entrar na família</Title>
      <Muted>Ao aceitar, os membros da família vão ver seu nome e sua agenda compartilhada.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Aceitar convite" onPress={accept} loading={loading} />
      <Button title="Agora não" variant="link" onPress={() => router.replace('/')} />
    </Screen>
  );
}
