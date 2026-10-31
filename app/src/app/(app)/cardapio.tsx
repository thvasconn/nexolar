import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorText, Field, Muted, Screen, Section, Title } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { isoDate, today } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

type Meal = { id: string; day: string; meal: string; title: string; recipe_id: string | null };
type Recipe = { id: string; title: string; ingredients: { name: string }[] };

const meals = [
  { value: 'breakfast', label: 'Café' }, { value: 'lunch', label: 'Almoço' },
  { value: 'snack', label: 'Lanche' }, { value: 'dinner', label: 'Jantar' },
];

const days = () => Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; });

export default function MealPlan() {
  const { family } = useFamily();
  const [plan, setPlan] = useState<Meal[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [slot, setSlot] = useState<{ day: string; meal: string } | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(() => {
    if (!family) return;
    const week = days();
    supabase.from('meal_plan').select('id, day, meal, title, recipe_id').eq('family_id', family.id)
      .gte('day', isoDate(week[0])).lte('day', isoDate(week[6]))
      .then(({ data }) => setPlan(data ?? []));
    // receitas que a família pode usar: minhas + da família (RLS filtra)
    supabase.from('recipes').select('id, title, ingredients').neq('visibility', 'public').order('title').limit(100)
      .then(({ data }) => setRecipes((data ?? []) as Recipe[]));
  }, [family]);
  useFocusEffect(load);

  if (!family) return null;

  async function choose(title: string, recipe_id: string | null) {
    if (!slot || !title.trim()) return;
    setError('');
    const { error } = await supabase.from('meal_plan')
      .upsert({ family_id: family!.id, day: slot.day, meal: slot.meal, title: title.trim(), recipe_id }, { onConflict: 'family_id,day,meal' });
    if (error) return setError(errorMessage(error));
    setSlot(null); setText('');
    load();
  }

  async function clear(m: Meal) {
    await supabase.from('meal_plan').delete().eq('id', m.id);
    load();
  }

  // Ingredientes das receitas da semana vão para a lista aberta (ou uma nova).
  async function toList() {
    const used = plan.map((p) => recipes.find((r) => r.id === p.recipe_id)).filter(Boolean) as Recipe[];
    const names = used.flatMap((r) => r.ingredients.map((i) => i.name.slice(0, 120)));
    if (names.length === 0) return setInfo('Nenhuma receita cadastrada no cardápio desta semana.');
    let { data: list } = await supabase.from('shopping_lists').select('id').eq('family_id', family!.id).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!list) {
      const created = await supabase.from('shopping_lists').insert({ family_id: family!.id, name: `Cardápio ${today().slice(0, 5)}` }).select('id').single();
      if (created.error) return setError(errorMessage(created.error));
      list = created.data;
    }
    const { error } = await supabase.from('shopping_items').insert(names.map((name) => ({ list_id: list!.id, name })));
    if (error) return setError(errorMessage(error));
    setInfo(`${names.length} ingrediente(s) adicionados à lista de compras.`);
  }

  return (
    <Screen>
      <Button title="🛒 Ingredientes da semana para a lista" variant="link" onPress={toList} />
      {info ? <Muted>{info}</Muted> : null}
      <ErrorText>{error}</ErrorText>
      {days().map((d) => {
        const key = isoDate(d);
        return (
          <View key={key}>
            <Section>{d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</Section>
            {meals.map((m) => {
              const item = plan.find((p) => p.day === key && p.meal === m.value);
              return (
                <Pressable key={m.value} style={styles.slot} accessibilityRole="button"
                  onPress={() => (item ? Alert.alert(item.title, undefined, [
                    { text: 'Fechar', style: 'cancel' },
                    { text: 'Trocar', onPress: () => setSlot({ day: key, meal: m.value }) },
                    { text: 'Remover', style: 'destructive', onPress: () => clear(item) },
                  ]) : setSlot({ day: key, meal: m.value }))}>
                  <Text style={styles.meal}>{m.label}</Text>
                  <Text style={[styles.value, !item && { color: colors.muted }]}>{item?.title ?? '+ definir'}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <Modal visible={!!slot} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSlot(null)}>
        <Screen>
          <Title>{meals.find((m) => m.value === slot?.meal)?.label} · {slot?.day.split('-').reverse().join('/')}</Title>
          <Field label="Escrever o prato" value={text} onChangeText={setText} placeholder="Ex.: arroz, feijão e bife" maxLength={120} />
          <Button title="Usar esse texto" onPress={() => choose(text, null)} />
          <Section>Ou escolha uma receita</Section>
          {recipes.length === 0 && <Empty>Nenhuma receita sua ou da família ainda.</Empty>}
          {recipes.map((r) => <Card key={r.id} title={r.title} onPress={() => choose(r.title, r.id)} />)}
          <Button title="Cancelar" variant="link" onPress={() => setSlot(null)} />
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slot: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 12 },
  meal: { width: 64, color: colors.muted, fontWeight: '600' },
  value: { flex: 1, color: colors.text, fontSize: 15 },
});
