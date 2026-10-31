import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, Chip, Chips, Empty, Screen } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Recipe = { id: string; title: string; prep_minutes: number | null; tags: string[]; visibility: string };
const tabs = [
  { value: 'mine', label: 'Minhas' },
  { value: 'family', label: 'Da família' },
  { value: 'public', label: 'Comunidade' },
] as const;

export default function Recipes() {
  const { session } = useSession();
  const { family } = useFamily();
  const [tab, setTab] = useState<(typeof tabs)[number]['value']>('mine');
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useFocusEffect(useCallback(() => {
    let q = supabase.from('recipes').select('id, title, prep_minutes, tags, visibility').order('created_at', { ascending: false }).limit(50);
    if (tab === 'mine') q = q.eq('owner_id', session!.user.id);
    if (tab === 'family') q = q.eq('visibility', 'family').eq('family_id', family!.id);
    if (tab === 'public') q = q.eq('visibility', 'public');
    q.then(({ data }) => setRecipes(data ?? []));
  }, [tab, session, family]));

  return (
    <Screen>
      <Button title="+ Nova receita" onPress={() => router.push('/receita/nova')} />
      <Chips>{tabs.map((t) => <Chip key={t.value} label={t.label} selected={tab === t.value} onPress={() => setTab(t.value)} />)}</Chips>
      {recipes.length === 0 && <Empty>Nenhuma receita aqui ainda.</Empty>}
      {recipes.map((r) => (
        <Card key={r.id} title={r.title}
          subtitle={[r.prep_minutes ? `${r.prep_minutes} min` : null, ...r.tags].filter(Boolean).join(' · ')}
          onPress={() => router.push({ pathname: '/receita/[id]', params: { id: r.id } })} />
      ))}
    </Screen>
  );
}
