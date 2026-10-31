import { router, type Href } from 'expo-router';
import { Button, Card, Screen, Section } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { supabase } from '@/lib/supabase';

const modules: { title: string; subtitle: string; href: Href }[] = [
  { title: '🎉 Eventos', subtitle: 'Festas, amigo oculto, rateio', href: '/eventos' },
  { title: '🍲 Receitas', subtitle: 'Suas, da família e da comunidade', href: '/receitas' },
  { title: '🍽️ Cardápio da semana', subtitle: 'Planeje as refeições', href: '/cardapio' },
  { title: '✅ Tarefas', subtitle: 'Afazeres da casa e de cada um', href: '/tarefas' },
  { title: '🎯 Metas', subtitle: 'Água, exercício, sono...', href: '/metas' },
  { title: '💡 Contas a pagar', subtitle: 'Vencimentos e responsáveis', href: '/contas' },
  { title: '📍 Localização', subtitle: 'Onde está cada um', href: '/localizacao' },
];

export default function More() {
  const { me } = useFamily();
  return (
    <Screen>
      <Section>Módulos</Section>
      {modules.map((m) => <Card key={m.title} title={m.title} subtitle={m.subtitle} onPress={() => router.push(m.href)} />)}
      <Section>Família e conta</Section>
      <Card title="👪 Perfis da família" subtitle="Membros, pets e convites" onPress={() => router.push('/familia')} />
      {me && <Card title="🙂 Meu perfil" onPress={() => router.push({ pathname: '/membro/[id]', params: { id: me.id } })} />}
      <Card title="🔔 Notificações" onPress={() => router.push('/notificacoes')} />
      <Button title="Criar outra família" variant="link" onPress={() => router.push('/nova-familia')} />
      <Button title="Sair da conta" variant="link" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
