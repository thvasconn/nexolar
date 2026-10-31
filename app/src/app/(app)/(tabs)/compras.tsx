import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Empty, Screen, Section } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { fmtMoney, listTotal, today } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

type List = {
  id: string; name: string; status: 'open' | 'done'; finished_at: string | null;
  stores: { name: string } | null;
  shopping_items: { price_cents: number | null; quantity: number; checked: boolean }[];
};

export default function Shopping() {
  const { family } = useFamily();
  const [lists, setLists] = useState<List[]>([]);

  useFocusEffect(useCallback(() => {
    if (!family) return;
    supabase.from('shopping_lists')
      .select('id, name, status, finished_at, stores(name), shopping_items(price_cents, quantity, checked)')
      .eq('family_id', family.id).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setLists((data ?? []) as unknown as List[]));
  }, [family]));

  async function create() {
    const { data, error } = await supabase.from('shopping_lists')
      .insert({ family_id: family!.id, name: `Compras ${today().slice(0, 5)}` }).select('id').single();
    if (error) return Alert.alert(errorMessage(error));
    router.push({ pathname: '/lista/[id]', params: { id: data.id } });
  }

  const open = lists.filter((l) => l.status === 'open');
  const done = lists.filter((l) => l.status === 'done');
  const go = (id: string) => router.push({ pathname: '/lista/[id]', params: { id } });

  return (
    <Screen>
      <Button title="+ Nova lista" onPress={create} />
      <Section>Abertas</Section>
      {open.length === 0 && <Empty>Nenhuma lista aberta.</Empty>}
      {open.map((l) => (
        <Card key={l.id} title={l.name} subtitle={`${l.shopping_items.length} item(ns) · ${fmtMoney(listTotal(l.shopping_items))} estimado`}
          onPress={() => go(l.id)} />
      ))}
      <Section>Finalizadas</Section>
      {done.length === 0 && <Empty>Nenhuma compra finalizada ainda.</Empty>}
      {done.map((l) => (
        <Card key={l.id} title={l.name}
          subtitle={`${fmtMoney(listTotal(l.shopping_items, true))}${l.stores ? ` · ${l.stores.name}` : ''} · ${new Date(l.finished_at!).toLocaleDateString('pt-BR')}`}
          onPress={() => go(l.id)} />
      ))}
    </Screen>
  );
}
