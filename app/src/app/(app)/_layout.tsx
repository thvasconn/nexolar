import { Redirect, router, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { FamilyProvider } from '@/lib/family';
import { isPasswordResetPending } from '@/lib/recovery';
import { takePendingInvite } from '@/lib/session';

export default function AppLayout() {
  const pathname = usePathname();

  useEffect(() => {
    const invite = takePendingInvite();
    if (invite) router.push({ pathname: '/convite/[token]', params: { token: invite } });
  }, []);

  if (isPasswordResetPending() && pathname !== '/nova-senha') return <Redirect href="/nova-senha" />;

  return (
    <FamilyProvider>
      <Stack screenOptions={{ headerBackTitle: 'Voltar' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="boas-vindas" options={{ title: 'Bem-vindo', headerBackVisible: false }} />
        <Stack.Screen name="nova-familia" options={{ title: 'Nova família' }} />
        <Stack.Screen name="familia" options={{ title: 'Perfis da família' }} />
        <Stack.Screen name="membro/[id]" options={{ title: 'Perfil' }} />
        <Stack.Screen name="perfil" options={{ title: 'Editar meu perfil' }} />
        <Stack.Screen name="notificacoes" options={{ title: 'Notificações' }} />
        <Stack.Screen name="localizacao" options={{ title: 'Localização' }} />
        <Stack.Screen name="compromisso/novo" options={{ title: 'Compromisso' }} />
        <Stack.Screen name="lista/[id]" options={{ title: 'Lista de compras' }} />
        <Stack.Screen name="eventos" options={{ title: 'Eventos' }} />
        <Stack.Screen name="evento/novo" options={{ title: 'Novo evento' }} />
        <Stack.Screen name="evento/[id]" options={{ title: 'Evento' }} />
        <Stack.Screen name="receitas" options={{ title: 'Receitas' }} />
        <Stack.Screen name="receita/nova" options={{ title: 'Nova receita' }} />
        <Stack.Screen name="receita/[id]" options={{ title: 'Receita' }} />
        <Stack.Screen name="tarefas" options={{ title: 'Tarefas' }} />
        <Stack.Screen name="cardapio" options={{ title: 'Cardápio da semana' }} />
        <Stack.Screen name="metas" options={{ title: 'Minhas metas' }} />
        <Stack.Screen name="contas" options={{ title: 'Contas a pagar' }} />
        <Stack.Screen name="nova-senha" options={{ title: 'Nova senha', headerBackVisible: false }} />
      </Stack>
    </FamilyProvider>
  );
}
