import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, colors, Empty, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { fmtMoney, listTotal, parseMoney } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

type Item = {
  id: string; name: string; quantity: number; unit: string | null; price_cents: number | null;
  checked: boolean; product_id: string | null;
};
type List = { id: string; name: string; status: 'open' | 'done'; store_id: string | null; stores: { name: string } | null };
type Hint = { store_name: string; last_price_cents: number };

// % e _ viram curinga no ilike; aqui a busca é pelo nome exato
const exact = (text: string) => text.replace(/[\\%_]/g, '\\$&');

// Produto do catálogo compartilhado pelo nome exato; cria se não existir. Base do histórico de preços.
async function productFor(name: string) {
  const { data } = await supabase.from('products').select('id').ilike('name', exact(name)).limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created } = await supabase.from('products').insert({ name }).select('id').single();
  return (created?.id as string) ?? null;
}

async function storeFor(name: string) {
  const { data } = await supabase.from('stores').select('id').ilike('name', exact(name)).limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await supabase.from('stores').insert({ name }).select('id').single();
  if (error) throw error;
  return created.id as string;
}

export default function ShoppingList() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [list, setList] = useState<List | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [hints, setHints] = useState<Record<string, Hint[]>>({});
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [l, i] = await Promise.all([
      supabase.from('shopping_lists').select('id, name, status, store_id, stores(name)').eq('id', id).single(),
      supabase.from('shopping_items').select('id, name, quantity, unit, price_cents, checked, product_id')
        .eq('list_id', id).order('created_at'),
    ]);
    if (l.data) {
      setList(l.data as unknown as List);
      setStore((s) => s || (l.data as unknown as List).stores?.name || '');
    }
    setItems(i.data ?? []);
  }, [id]);

  useEffect(() => {
    load();
    // tempo real: quem está em casa vê o carrinho enchendo
    const channel = supabase.channel(`lista-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `list_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, load]);

  // Último preço de cada produto em cada mercado (base colaborativa de todos os usuários).
  useEffect(() => {
    items.filter((i) => i.product_id && !hints[i.product_id]).forEach((i) => {
      supabase.rpc('price_board', { p_product_id: i.product_id }).then(({ data }) => {
        setHints((h) => ({ ...h, [i.product_id!]: (data ?? []) as Hint[] }));
      });
    });
  }, [items, hints]);

  async function add() {
    const quantity = Number(qty.replace(',', '.'));
    const cents = price.trim() ? parseMoney(price) : null;
    if (!name.trim()) return setError('Informe o item.');
    if (!(quantity > 0)) return setError('Quantidade inválida.');
    if (price.trim() && cents === null) return setError('Preço inválido. Ex.: 12,90');
    setError('');
    const product_id = await productFor(name.trim());
    const { error } = await supabase.from('shopping_items')
      .insert({ list_id: id, name: name.trim(), quantity, price_cents: cents, product_id });
    if (error) return setError(errorMessage(error));
    setName(''); setQty('1'); setPrice('');
    load();
  }

  async function update(item: Item, patch: Partial<Item>) {
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from('shopping_items').update(patch).eq('id', item.id);
    if (error) setError(errorMessage(error));
  }

  async function setItemPrice(item: Item, text: string) {
    if (!text.trim()) return update(item, { price_cents: null });
    const cents = parseMoney(text);
    if (cents === null) return setError('Preço inválido. Ex.: 12,90');
    update(item, { price_cents: cents });
  }

  async function finish() {
    setError('');
    try {
      const store_id = store.trim() ? await storeFor(store.trim()) : null;
      // a ordem importa: grava o mercado antes de fechar, para o preço entrar no histórico dele
      await supabase.from('shopping_lists').update({ store_id }).eq('id', id);
      const { error } = await supabase.from('shopping_lists').update({ status: 'done' }).eq('id', id);
      if (error) throw error;
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function removeList() {
    Alert.alert('Apagar lista?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        await supabase.from('shopping_lists').delete().eq('id', id);
        router.back();
      } },
    ]);
  }

  if (!list) return null;
  const open = list.status === 'open';

  return (
    <Screen>
      <Stack.Screen options={{ title: list.name }} />
      <View style={styles.totals}>
        <Text style={styles.total}>No carrinho: {fmtMoney(listTotal(items, true))}</Text>
        <Muted>Lista inteira: {fmtMoney(listTotal(items))}</Muted>
        {!open && <Muted>Finalizada{list.stores ? ` · ${list.stores.name}` : ''}</Muted>}
      </View>

      {items.length === 0 && <Empty>Lista vazia.</Empty>}
      {items.map((i) => {
        const best = i.product_id ? hints[i.product_id]?.[0] : undefined;
        return (
          <View key={i.id} style={styles.row}>
            <Pressable style={{ flex: 1 }} disabled={!open} onPress={() => update(i, { checked: !i.checked })}
              accessibilityRole="checkbox" accessibilityState={{ checked: i.checked }}>
              <Text style={[styles.itemName, i.checked && styles.done]}>
                {i.checked ? '☑' : '☐'} {i.name}{i.quantity !== 1 ? ` × ${i.quantity}` : ''}
              </Text>
              {best && <Muted>Mais barato recente: {fmtMoney(best.last_price_cents)} no {best.store_name}</Muted>}
            </Pressable>
            {open ? (
              <TextInput style={styles.price} placeholder="R$" keyboardType="decimal-pad" accessibilityLabel={`Preço de ${i.name}`}
                defaultValue={i.price_cents != null ? (i.price_cents / 100).toFixed(2).replace('.', ',') : ''}
                onEndEditing={(e) => setItemPrice(i, e.nativeEvent.text)} />
            ) : (
              <Text>{i.price_cents != null ? fmtMoney(i.price_cents * i.quantity) : '-'}</Text>
            )}
            {open && <Button title="✕" variant="link" onPress={async () => { await supabase.from('shopping_items').delete().eq('id', i.id); load(); }} />}
          </View>
        );
      })}
      <ErrorText>{error}</ErrorText>

      {open && (
        <>
          <Section>Adicionar item</Section>
          <Field label="Item" value={name} onChangeText={setName} placeholder="Ex.: Feijão 1kg" maxLength={120} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Qtd." value={qty} onChangeText={setQty} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Preço un. (opcional)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0,00" /></View>
          </View>
          <Button title="Adicionar" onPress={add} />

          <Section>Finalizar compra</Section>
          <Field label="Mercado" value={store} onChangeText={setStore} placeholder="Ex.: Guanabara" maxLength={80} />
          <Muted>Os preços dos itens marcados entram no histórico desse mercado.</Muted>
          <Button title="Finalizar compra" onPress={finish} />
        </>
      )}
      <Button title="Apagar lista" variant="link" onPress={removeList} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  totals: { backgroundColor: '#eef2ff', borderRadius: 12, padding: 14, gap: 2 },
  total: { fontSize: 20, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8 },
  itemName: { fontSize: 16, color: colors.text },
  done: { textDecorationLine: 'line-through', color: colors.muted },
  price: { width: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, textAlign: 'right' },
});
